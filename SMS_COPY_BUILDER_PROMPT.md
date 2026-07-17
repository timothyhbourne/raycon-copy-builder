# SMS Copy Mode — email/SMS switch in the Copy Builder

You are adding SMS copywriting to the Copy Builder in `raycon-copy-builder` (Next 16, React 19, Tailwind v4). Read `AGENTS.md` first. Reuse the UI primitives (`src/components/ui/`), the voice module (`src/lib/prompts/voice.ts`), and the Anthropic client (`src/lib/anthropic.ts`). No new dependencies.

## The feature

At the top of the Copy Builder the user picks a channel: **Email** (everything exactly as today) or **SMS**. SMS mode offers two entry paths:

1. **From an email campaign** — pick a finished email campaign; the AI distills it into SMS copy: **3 distinct variants**, each following SMS best practice (character budget, one idea, plain construction).
2. **From scratch** — a short SMS brief (no email sections/conceits machinery); same 3-variant output.

---

## Step 1 — Data model + store

New store, mirroring the repo's file-store idiom (`lib/campaigns.ts` is the reference): `src/lib/sms.ts` + `data/sms/` (one JSON per SMS campaign) + `src/app/api/sms/route.ts` (GET list / GET ?id / POST upsert / DELETE, same auth posture as `/api/campaigns`).

```ts
interface SmsCampaign {
  id: string;                 // date-slug like SavedCampaign ids
  name: string;
  source_email_id?: string;   // library/draft id it was distilled from
  brief: { offer: string; promo_code?: string; deadline?: string; angle?: string; audience?: string };
  variants: [{ text: string }, { text: string }, { text: string }];
  selected_variant: number;   // 0-2 — the one that ships
  planner_row_id?: string;
  status: "draft" | "final";
  created_at: string; updated_at: string;
}
```

## Step 2 — SMS craft utilities

`src/lib/sms-format.ts` (pure functions, unit-testable):
- `isGsm7(text)`: true when every char is in the GSM-7 basic charset (build the set; curly quotes/em dashes/emoji are NOT in it).
- `smsLength(text)`: `{ chars, encoding: "GSM-7" | "Unicode", segments }` — segments: GSM-7 = 1 up to 160 chars, then 153/segment; Unicode = 1 up to 70, then 67/segment.
- `TARGET_CHARS = 145` — leave headroom for Postscript's appended opt-out text on compliance-required sends.

## Step 3 — Generation

**Prompt** `src/lib/prompts/sms.ts`. Compose: the `RAYCON_VOICE` module, then an SMS craft block (exact rules):
- One message = ONE idea: the offer/hook, the code, the deadline, a link. Nothing else.
- Hard budget: aim ≤ 145 characters; never exceed 160. Count before returning.
- GSM-7 only: no emoji, no em/en dashes, no curly quotes (they silently cut the budget to 70/segment).
- Open with "Raycon:" so the sender is instant.
- Deadline named plainly ("Ends Sunday"), code in caps, exactly one `{link}` placeholder at the end.
- No "Hurry!!"-style shouting, no all-caps words except the promo code, at most one exclamation point across the whole message.
- The 3 variants must be construction-distinct, in this order: (1) DIRECT — offer-first, plainest; (2) FRIENDLY — warm, human phrasing of the same offer; (3) ANGLE — leads with the hook/occasion, offer second. Not three rewordings.
- If the construction index exists (`src/lib/constructions.ts`), inject its recency slice and record finalized SMS variants into it (add an `sms` field per campaign in the index) so SMS stops repeating too.

**Route** `src/app/api/sms-generate/route.ts`: POST `{ brief, source_email?: <full normalized email content> }` → calls Anthropic (same model/config pattern as `/api/generate`, but non-streaming JSON — 3 short variants don't need streaming) → returns `{ variants: [{text},{text},{text}] }`, validated: parse defensively, and server-side re-check each variant with `smsLength`; if any exceeds 160 chars, one automatic corrective round-trip ("variant N is X chars — cut to under 145") before returning.

**From-email path:** client fetches the source campaign via the existing copy summary endpoint (`/api/planner/copy?id=...&full=1`) and passes it as `source_email`. The prompt instructs: distill — one offer, one hook, one deadline from the email; do NOT compress the whole email into fragments.

## Step 4 — UI

**Channel switch.** Segmented control (Email / SMS) at the top of the left form panel. Email selected → the app is pixel-identical to today (zero regressions; all email state/logic untouched). Persist the choice in component state only.

**SMS mode layout.** The sections/conceits machinery does not apply. Replace the form panel content with:
- Entry toggle: "From email campaign" | "From scratch".
- From email: searchable picker over library entries + finalized drafts (name, date, type). Picking one pre-fills the SMS brief (offer, code, deadline parsed from the entry's fields where available) and stores `source_email_id`.
- From scratch: compact brief — name, offer*, promo code, deadline, angle/hook (2 rows), audience note.
- "Generate SMS" primary button (with the confirm-modal pattern used for email briefs).

**Canvas (SMS).** Three variant cards, radio-selectable (`selected_variant`, mirroring the subheader-variant pattern in `SectionBlock.tsx`): each card shows the variant label (Direct / Friendly / Angle), editable text (plain textarea styling, EditableField-consistent), and a LIVE counter from `smsLength` — "142 · GSM-7 · 1 segment", turning amber past 145 and red past 160 or when encoding flips to Unicode (with a hint naming the offending character). Actions: Copy (clipboard, selected variant), Save Draft / Save Final (to the SMS store), New. Sidebar gets an "SMS" tab or grouped section listing saved SMS campaigns (load/delete).

## Step 5 — Planner hookup (SMS rows finally get copy)

- Extend the planner link route + drawer Copy section to accept SMS copy for SMS rows: "Write copy" on an SMS row deep-links to the copy builder in SMS mode (`/copy-builder?planner=<rowId>&channel=sms`, prefilling the brief from the row); "Attach existing" lists SMS campaigns for SMS rows.
- The planner copy viewer modal renders an SMS campaign as the three variants with the selected one highlighted and its segment count — same read-only document treatment.
- The copy-builder write-back on save stamps the SMS row exactly like email rows.

## Step 6 — Verify

1. Email mode untouched: generate/save/library flows identical (`npm run build` + manual pass).
2. From-email: pick a library promo → 3 variants land, all ≤160 chars, GSM-7, construction-distinct, code + `{link}` present.
3. From-scratch generates equally well with only the brief.
4. Type an emoji into a variant → counter flips to Unicode/red with the hint.
5. SMS planner row → Write copy → generate → Save Final → row shows the copy chip; viewer modal shows the 3 variants with the selected one marked.
6. Character math sanity: a 161-char GSM-7 string = 2 segments; a 71-char string with an emoji = 2 segments.

Commit order: (1) store + format utils, (2) generation prompt + route, (3) copy-builder UI, (4) planner hookup, (5) verification notes. State deviations explicitly.
