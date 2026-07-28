# Prompt: replace the written brief with a deterministic, selection-driven brief compiler

Hand this to Claude Code from the repo root. Goal: stop making the user write a brief or a hero angle. They pick from structured fields; the backend deterministically compiles those picks into the structured brief the generator already consumes. This removes two AI steps (brief-expansion and conceits), makes output more consistent, and gets copy generation to near-instant.

Run `npx tsc --noEmit` after each task. Do not regress recent work (hard-rules gate + checker, copy-variations, reviews / product-card-review, metrics/UI).

**Dependency:** the occasion picker and the auto Send-stage/urgency rely on the Promotional Calendar ingestion (`docs/PROMO_CALENDAR_INGESTION_PROMPT.md`). Build that first, or make the occasion picker degrade gracefully (manual occasion dropdown + manual offer) until the calendar exists.

## How it works today (what we're replacing)
- `BriefInput` (`src/lib/schemas.ts`) includes free-text `hero_angle` and `campaign_specific_rules`.
- `/api/brief` (`src/lib/prompts/brief.ts`) is an LLM step that improvises those into an `ExpandedBrief` (`headline_thesis, audience_mindset, key_message, tonal_direction, structural_notes, rewritten_hero_angle`). **This improvisation is the main source of inconsistent quality.**
- `/api/conceits` generates angle options; the user picks one (a `Conceit` with `architecture: offer_led | story_led | product_truth_led`).
- `/api/generate` consumes `expanded_brief` + `chosen_conceit` + `section_structure` + `retrieved_examples` + `tone_dial` (+ fetched reviews).
- Per-type structure/pacing already lives in `src/lib/prompts/playbooks.ts` (`PLAYBOOKS`). We build on it.

## Target flow
`fill fields` → **deterministic `compileBrief()`** (no LLM) → `/api/generate` (the one creative, gated LLM call) → checks. The brief step and conceits step are gone from the fast path.

---

## Task 1 — Input model
In `src/lib/schemas.ts`:
- Add types:
  - `type Angle = "offer_led" | "product_led" | "story_led" | "occasion_led";`
  - `type SendStage = "launch" | "reminder" | "last_call";`
  - `type UrgencyTier = 1 | 2 | 3;`
- Extend `BriefInput` with: `angle: Angle`, `promotion_id?: string` (selected calendar promotion), `occasion?: string` (label; auto-set from the promotion, or manual), `hero_product_slug?: string` (which featured product leads above the fold), and keep `campaign_specific_rules` but treat it as the optional **nudge** (relabel in UI).
- `hero_angle` is no longer required/collected. Keep the field optional in the type for backward-compat with saved library items, but the UI stops showing it.
- Add computed (not user-entered) fields the compiler fills: `send_stage?: SendStage`, `urgency?: UrgencyTier` (persist them so saved campaigns reload faithfully).

## Task 2 — Curated building blocks (the data that makes output consistent)
Create `src/lib/brief/blocks.ts`. These are written ONCE, well, and reused. They must obey the voice + hard rules (no clichés, no banned phrases).
- `AUDIENCE_MINDSET: Record<AudienceType, string>` — one tight paragraph per audience (all, engaged, lapsed, post_purchase, vip) describing what the reader is thinking on open. Draw from the audience tone table already in `data/brand-voice.md`.
- `ANGLE_DIRECTIVE: Record<Angle, string>` — how each angle shapes the arc: `offer_led` = the deal is the through-line, state it early; `product_led` = one concrete product truth anchors every section (maps to the generator's `product_truth_led`); `story_led` = hold the offer until the idea lands; `occasion_led` = the moment leads, product and offer follow.
- `STAGE_DIRECTIVE: Record<SendStage, string>` — `launch` = announce/curiosity, Tier 1 to 2 urgency; `reminder` = re-surface the value + one benefit, Tier 2; `last_call` = deadline-forward, Tier 3, name the real end time.
- Extend `PLAYBOOKS` (in `playbooks.ts`) or add `BRIEF_TEMPLATES: Record<CampaignType, {...}>` with per-type slotted templates for `headline_thesis`, `key_message`, `tonal_direction`, and a `structural_notes` scaffold. Slots: `{offer}`, `{code}`, `{occasion}`, `{hero_product}`, `{products}`, `{dates}`, `{stage}`.

## Task 3 — The deterministic brief compiler
Create `src/lib/brief/compile.ts`:
```ts
export function compileBrief(input: BriefInput, promotion?: Promotion, today?: Date):
  { expanded_brief: ExpandedBrief; conceit: Conceit; send_stage: SendStage; urgency: UrgencyTier };
```
Behaviour (all pure, no LLM, no I/O beyond the passed-in promotion):
1. **Resolve facts.** If a `promotion` is passed (from the calendar), use it to fill occasion, dates, and (where the form left them blank) offer / promo code / products. The user's explicitly-typed offer/code always wins over the promotion's.
2. **Auto-derive `send_stage` from dates.** Compare `today` to the promotion window: within ~1 day of start → `launch`; final day or after 70 to 100% of the window elapsed → `last_call`; otherwise → `reminder`. No promotion or no dates → `launch`.
3. **Auto-derive `urgency`** from stage: launch → 1 to 2, reminder → 2, last_call → 3.
4. **Assemble `ExpandedBrief`** by interpolating the Task-2 blocks: `audience_mindset` from AUDIENCE_MINDSET; `tonal_direction` from the type template + STAGE_DIRECTIVE; `headline_thesis` / `key_message` from the type template with `{occasion}/{offer}/{hero_product}` filled; `structural_notes` from the playbook's `default_structure` walked in order, with the ANGLE_DIRECTIVE + hero-product-leads-above-the-fold rule applied; `rewritten_hero_angle` = a deterministically composed one to two line hook seed from `{occasion + angle + hero_product + offer}` (NOT model-written). If `campaign_specific_rules` (the nudge) is present, append it verbatim as top-priority steering.
5. **Synthesize the `Conceit`** so `/api/generate` is unchanged: `architecture` = map from `angle` (`product_led`→`product_truth_led`, `occasion_led`→`offer_led` or a new value, others 1:1); `name` = a short label (e.g. `"{occasion} · {sale}"` or the campaign name); `description` = the compiled thesis.
6. Preserve all numerals/symbols exactly (offer/dates/specs). Never invent a figure or a product name; `hero_product` and featured products come from the catalogue only.

Include a worked example in a comment: promo + "Mother's Day" promotion + `offer_led` + last_call → the exact compiled `ExpandedBrief` + `Conceit`, so the output shape is unambiguous.

## Task 4 — Wire into generation, drop the two AI steps
- `/api/generate` (`src/app/api/generate/route.ts`): accept the raw `BriefInput` (+ retrieved examples + reviews as today), call `compileBrief()` server-side to get `expanded_brief` + `conceit` + `send_stage` + `urgency`, then generate exactly as now. One request, still streams. (Retrieval of `retrieved_examples` can stay client-side and be passed in, or move server-side — either is fine.)
- Client (`src/app/copy-builder/page.tsx`): `handleBriefSubmit` no longer calls `/api/brief` then `/api/conceits` then waits for a pick. It posts the structured `BriefInput` straight to `/api/generate`. Delete the conceits stage from the flow/state machine.
- Keep `/api/brief`, `/api/conceits`, `brief.ts`, `conceits.ts` files only if something else imports them (e.g. library reload); otherwise remove them and their nav/stage wiring. The synthesized `Conceit` still flows to regenerate / variations, so those keep working.

## Task 5 — Brief panel UI (`src/components/InputForm.tsx`)
- **Remove** the free-text Brief and Hero Angle fields.
- **Add** dropdowns/pickers:
  - **Angle** (Offer-led / Product-led / Story-led / Occasion-led).
  - **Occasion / Promotion** — a picker sourced from the promo calendar, filtered to the send month (there can be several per month, so this is a real chooser, not a toggle). Selecting one **auto-fills** offer, promo code, dates, and featured products (all editable). Provide a manual "Custom / evergreen" option for sends not on the calendar.
  - **Hero product** — a dropdown of the currently featured products; the one that leads above the fold.
- **Show, read-only, auto-derived from the promotion dates:** Send stage (Launch / Reminder / Last-call) and Urgency tier, as chips. Include a small manual override in case a date lands ambiguously, but default to auto.
- **Keep:** campaign name, type, offer, promo code, audience, featured products (+ the selected-count tally), tone dial, section structure, and the optional **nudge** field (relabel `campaign_specific_rules` to "Anything special about this send? (optional)").
- When the user picks a campaign type, auto-apply that type's `default_structure` (the existing "Use the {type} structure" behaviour becomes the default; still editable).

## Task 6 — Verify
- Unit-test `compileBrief()`: for every `campaign_type × angle × audience × send_stage`, it returns a fully-populated `ExpandedBrief` (no empty fields) and a valid `Conceit`. Add 2 to 3 golden snapshots (including the Mother's Day / last_call example).
- Confirm date→stage derivation: feed dates at start, middle, and final day of a window and assert launch / reminder / last_call.
- `npx tsc --noEmit` clean; browser pass: pick type + promotion + angle + hero product, hit generate, copy streams with no brief written.

---

## Guardrails / notes
- **Consistency is the goal, and sameness is the tradeoff.** Two identical selections will produce near-identical copy by design. Variety across sends comes from the occasion, hero product, send stage, the avoid-list (recent lines), the 3 subject/preview variants, and the alternatives feature. That is acceptable and wanted; do not reintroduce randomness into the brief.
- **The offer field stays the single source of truth for pricing.** The promotion auto-fill only pre-populates blanks; a user-typed offer always wins. Never round or infer discounts.
- **The nudge is the only free text**, and it maps to priority tier 1 (the user's literal instructions) in `data/copy-system.md`. Keep it optional and rare.
- **Graceful degradation:** if the promo calendar has no entry for the chosen month, the occasion picker offers manual entry and stage/urgency default to launch/Tier 2. Nothing breaks.
- **Saved campaigns:** persist `angle`, `promotion_id`, `hero_product_slug`, `send_stage`, `urgency` so a library reload rebuilds the same brief.

## Acceptance criteria
- [ ] No written brief or hero angle anywhere in the flow; only selections + an optional nudge.
- [ ] Picking a calendar promotion auto-fills offer, code, dates, and products (editable).
- [ ] Send stage and urgency are auto-derived from the promotion dates and shown as read-only chips.
- [ ] `compileBrief()` is pure and deterministic; same inputs → identical brief; every field populated.
- [ ] The brief-expansion and conceits AI steps are gone; generation is one streamed call.
- [ ] `npx tsc --noEmit` clean; regenerate + variations still work off the synthesized conceit.
