# Structural Variability + Planner Channel Polish

You are working in `raycon-copy-builder` (Next 16, React 19, Tailwind v4). Read `AGENTS.md` first — this is NOT the Next.js you know. Two goals: (0) small planner channel/status polish, (1–3) make copy generation structurally varied by campaign type and non-repetitive across consecutive sends.

Design principle for the copy work (learned the hard way in the voice rebuild): **modulate structure with small, per-type guidance and real data — do not pile on more rules.** The brand voice module (`src/lib/prompts/voice.ts`) stays the single global voice source; nothing below duplicates or overrides it.

---

## Step 0 — Planner: channel glyphs + channel-aware status

**0a. Channel icons.** On the planner calendar pills AND the table's channel column, replace the colored channel dots with glyphs: ✉️ for email, 📱 for SMS (the user explicitly wants emoji). Render at a small size (`text-[11px]`), before the campaign name, with `aria-label="Email"/"SMS"`. If emoji rendering looks misaligned inside the pills, fall back to same-size inline SVG outline glyphs (envelope / smartphone, 1.5px stroke) — but try emoji first. Remove the old dot styling and the amber-SMS-dot logic; the glyph now carries the channel signal.

**0b. Channel-aware "scheduled" status.** Rename the stored status `scheduled_in_klaviyo` → `scheduled` using the repo's read-time backfill idiom in `lib/planner.ts` (add `scheduled_in_klaviyo` → `scheduled` to the existing status migration map; keep the old mappings). Display label becomes channel-dependent everywhere the status appears (segmented control in the drawer, table, calendar tooltip): email → "Scheduled in Klaviyo", sms → "Scheduled in Postscript". Same transparent-green pill + check for both. Update `PlannerStatus`, `PLANNER_STATUSES`, `isEffectivelySent`, and every status-literal reference (grep for `scheduled_in_klaviyo`).

---

## Step 1 — Campaign-type playbooks

Create `src/lib/prompts/playbooks.ts` exporting `PLAYBOOKS: Record<CampaignType, Playbook>` where `Playbook = { job: string; shape: string; default_structure: SectionSpec-template }`. Use EXACTLY this content for job/shape (each intentionally short — do not expand them):

- **promo**: job: "Make the deal unmissable. The offer is the story." shape: "Offer-first: short hero stating the deal, offer/code block early, product grid welcome, deadline named plainly near the top and again at the close. Short overall — a promo send earns its click fast or not at all."
- **launch**: job: "Introduce the product. Desire first, discount second." shape: "Story-first: hero names the product and its one big promise, body tells why it exists / what it solves, USPs prove it, ONE product card. Any offer waits until after the story and stays secondary. No product grid."
- **restock**: job: "It's back because people bought it out. Lead with proof." shape: "Popularity-first: hero announces the return, body leans on reputation and social proof (supplied reviews if any), single product focus, CTA to grab it before it goes again — stated as fact, not panic."
- **story**: job: "Give the reader something worth reading. Sell gently." shape: "Editorial: the conceit carries the email. Body-forward with the longest copy of any type, product enters as the natural conclusion, offer appears only in the footer CTA if at all."
- **seasonal**: job: "Connect the moment to the product." shape: "Occasion-first: hero names the moment (holiday, season, event), body bridges from the reader's occasion to the products that fit it, grid or cards fine, offer and dates close it out."
- **winback**: job: "Reopen the relationship warmly. No guilt." shape: "Welcome-first: open warm and human (never 'we miss you' clichés or guilt), lead with what's new or improved since they left, the offer lands as a welcome-back gesture, single clear CTA. Short."
- **newsletter**: job: "Inform first, sell lightly." shape: "Multi-topic: sectioned like a briefing, each section standalone, product mentions woven in rather than pitched, storefront link at the end. No hard offer blocks."

**Wire it in:**
1. `src/lib/prompts/brief.ts` and `src/lib/prompts/generate.ts` (`generateUserPrompt`): inject a short `CAMPAIGN PLAYBOOK (${type})` block with the job + shape lines. In the generation prompt it sits directly above the section structure and reads: "This send type has a defined job and shape — let it govern pacing and structure. It never overrides the voice rules or the user's literal instructions."
2. **Default structures pre-fill the section builder (editable).** Give each playbook a `default_structure` (array of `{ type, focus?, grid_cols?, grid_rows? }` templates — assign fresh `nanoid()` ids at apply time). Derive sensible structures from the shape lines (e.g. launch: header / body / usps / product_card / footer_cta; promo: header / cta_bridge(offer) / product_grid / footer_cta). In `src/components/InputForm.tsx`: when the user changes `campaign_type` AND the current `section_structure` is still an untouched default (deep-equal to `DEFAULT_SECTION_STRUCTURE` or to another playbook's default — i.e. the user hasn't customized), swap in the new type's default structure. Never overwrite a customized structure; in that case show a small ghost-button hint: "Use the ${type} structure" that applies it on click.

## Step 2 — Anti-repetition memory (data, not rules)

The model repeats itself because it can't see what it wrote last week. Fix with data:

1. New helper in `src/lib/library.ts`: `recentConstructions(limit = 6, excludeId?)` — the most recent finalized library campaigns by date, returning per campaign: title, date, subject lines, headline(s), and the first sentence of the first body-like element (parse `structured.campaign` when present; best-effort on legacy flat bodies; skip unparseable entries silently).
2. Inject into `generateUserPrompt` (and `regenerate-meta.ts`, which rewrites subject lines) as:
   ```
   RECENTLY SENT — the last few campaigns used these constructions. Do not reuse their headline shapes, subject-line constructions, or opening moves. Same voice, different build:
   - <date> "<title>": headline "<...>", subjects: <...>; opened with "<...>"
   ```
3. Keep it bounded: max 6 campaigns, truncate each line to ~200 chars. If the library is empty, omit the block entirely.
4. Exclude the campaign being regenerated/updated (`excludeId` = current library id when re-finalizing).

## Step 3 — Structurally distinct conceits

1. Extend the `Conceit` schema (`src/lib/schemas.ts`) with `architecture?: "offer_led" | "story_led" | "product_truth_led"`.
2. `src/lib/prompts/conceits.ts`: require the three conceits to carry three DIFFERENT architectures, one each: offer_led (the deal/mechanics are the hook), story_led (a moment, occasion, or narrative is the hook), product_truth_led (one concrete product fact/benefit is the hook). They must differ in construction, not just angle. Update the expected JSON output shape accordingly (backward-compatible parse: missing architecture is fine).
3. `src/components/ConceitPicker.tsx`: show the architecture as a small muted Chip on each card ("Offer-led" / "Story-led" / "Product-truth-led").
4. `generateUserPrompt`: when the chosen conceit has an architecture, add one line: offer_led → "Architecture: offer-led — the deal is the through-line; state it early and let sections reinforce it." story_led → "Architecture: story-led — hold the offer until the narrative has landed." product_truth_led → "Architecture: product-truth-led — one concrete product truth anchors every section; the offer supports it."

## Step 4 — Guardrails + verify

1. Prompt-size sanity: the combined additions (playbook block + recent-constructions block + architecture line) must add well under 100 lines to the final prompt. Print the assembled user prompt length in the existing debug path if one exists; otherwise skip.
2. `npm run build` passes; grep confirms no `scheduled_in_klaviyo` literals remain.
3. Functional A/B: generate (a) a `launch` and (b) a `promo` for the same product at tone 3. Confirm in your summary, with quoted output: different section structures were pre-filled, the launch held the offer back while the promo led with it, and neither reused a headline/subject construction listed in the RECENTLY SENT block.
4. Planner: calendar shows ✉️/📱 correctly per channel; an SMS row's drawer shows "Scheduled in Postscript"; legacy rows with `scheduled_in_klaviyo` load as `scheduled`.

Commit order: (0) planner polish, (1) playbooks + prefill, (2) recency memory, (3) conceit architectures, (4) verification notes in the final summary. Note deviations explicitly rather than improvising.
