# Planner Calendar Visibility + Notes-Into-Copy Spec

**Status:** Ready to implement
**Area:** `src/app/planner/page.tsx` (the `CalendarView` component), `src/lib/holidays.ts`, `src/lib/promo/*`, `src/app/api/copy-seed/route.ts`, `src/lib/planner-copy-link.ts`, `src/lib/prompts/copy-seed.ts`
**Goal:** Three fixes to the Planner calendar and the planner→copy handoff. (1) Show current promotions as clear, unmissable date-range bands. (2) Make US holidays clearly visible and fix the dead adjacent-month days. (3) Make the Copy Builder actually use the notes/learnings a planner row carries.

---

## Fix 1 — Promotion period bands on the calendar

### Problem
The promotional calendar (`data/promo-calendar.json` via `readPromoStore()`) is fully populated — each `Promotion` has `startDate`, `endDate`, `sale`, `promotion`, `products`, `promotionType` — but the planner calendar shows **none** of it. A user looking at August has no way to see that the Back-to-School sale runs Aug 4 → Sep 8. It's invisible.

### What to build
Render each active promotion as a **coloured horizontal band spanning its date range**, sitting at the top of the calendar grid, above the day-entry pills — the way a Google Calendar all-day event spans days.

- **Data:** `CalendarView` already receives `rows`; also load promotions. Fetch `GET /api/promotions?year=<y>` (it's daily-cached server-side, cheap) or pass them from the planner page. Filter to promotions whose `[startDate, endDate]` overlaps the visible month.
- **Rendering:** for each promotion, draw one band per calendar week it touches, positioned by weekday column and width = number of days in that week the promo covers. A promo spanning a month boundary (Back-to-School: Aug 4 → Sep 8) shows correctly in both August and September, clipped to the visible weeks.
- **Label:** the band carries the **sale name in readable text** (e.g. "Back-to-School Sale"), left-aligned, with the offer/code as a secondary detail on hover. On the first week it appears, show the full name; on continuation weeks show a subtle "… continues" so it's clearly the same promo, not a new one.
- **Colour — the explicit ask:** NOT a transparent grey. Give it a **solid, saturated accent fill with white/dark text at full contrast** so it reads as a real banner. Use a small fixed palette keyed off `promotionType` (or the promo `id` hashed) so two overlapping promos are visually distinct, drawn from the design-system data palette (`--color-data-1…6` from `DESIGN_SYSTEM_SPEC.md`). Each band is a rounded pill with the promo's colour at ~90% opacity and legible text.
- **Interaction:** clicking a band opens a small read-only popover with the promotion's `sale`, `promotion` description, dates, `products`, `promotionType`, and `learnings`. It must not block the day cell beneath from its click-to-create (the band sits in its own row above the day-number row, or is pointer-transparent except on its label).
- **Stacking:** if multiple promos overlap the same days, stack their bands vertically (max ~3 visible, "+N more" if beyond) and let the day cells grow to accommodate — the current `min-h-[96px]` becomes a floor, not a fixed height.
- **Empty state:** no active promotions in the month → no band row, no layout shift.

### Acceptance
- Viewing August shows a clearly-coloured "Back-to-School Sale" band running Aug 4 onward, legible at a glance, not grey.
- The same promo continues visibly into September when navigating forward.
- Clicking a band reveals its details; clicking a day beneath still creates/opens an entry.
- Overlapping promotions are individually distinguishable.

---

## Fix 2 — Holiday visibility + clickable adjacent-month days

### Problem A — holidays are near-invisible
`holidayName(key)` works and returns e.g. "Independence Day (US)", but it renders as a **1px muted dot + 9px truncated grey text** (`text-ink-muted/80`) in the corner of the day cell. It's easy to miss entirely — exactly the complaint. Labor Day (Sep 7) has the same problem.

### Problem B — adjacent-month days are dead
The grid pads leading/trailing cells with `null` (`cells.push(null)`), rendered as inert coloured blocks. So when viewing September, the Aug 31 cell that fills the first row's Monday is **not clickable** — you must navigate back to August to act on it. The user explicitly wants to click that Monday from the September view.

### What to build

**Holidays — make them a real marker:**
- Replace the corner dot with a **distinct, readable holiday chip** at the top of the day cell: a small pill with a warm/neutral holiday colour (a dedicated `--color-holiday` token, visually separate from promos and from campaign-status pills), an optional emoji/glyph, and the holiday name (truncate gracefully, full name on hover).
- It should read as clearly as a campaign entry does — a manager glancing at the month should immediately see "Independence Day", "Labor Day", etc.
- Keep it informational and pointer-transparent so it never blocks click-to-create or the drop target (the current code already gets this right — preserve it).
- Holidays and promo bands must coexist cleanly: promo bands span the top band-row; the holiday chip sits inside the day cell under it. Define the vertical order explicitly: promo bands → holiday chip → today badge → campaign entries.

**Adjacent-month days — make them live:**
- Render leading/trailing days as the **real dates they are** (Aug 31 in the Sep view), not `null`. Show the day number muted (`text-ink-muted`) and the cell background slightly recessed (`--color-sunken`) so it's visually "not this month" — but it is **fully interactive**: clickable to create, a valid drop target, shows its entries, holidays, and promo bands.
- Clicking an adjacent-month day either (a) creates/opens the entry inline for that real date, or (b) navigates to that month with the day focused — **(a) is preferred** (the user wants to act without navigating). Dragging an entry onto an adjacent-month day reschedules it to that real date.
- Compute these dates properly: the leading cells are the tail of the previous month, the trailing cells the head of the next month. `dayKey`/`ymdOf` must produce the correct real ISO date for them, so `byDay`, `holidayName`, promo overlap, and the droppable id all resolve against the true date.
- Optional nicety: a hairline or subtle divider between the last in-month row and any trailing week, so the month boundary is still legible.

### Acceptance
- Independence Day and Labor Day are immediately visible as labelled chips, not grey dots.
- In the September view, the Aug 31 Monday cell is clickable, shows its content, and accepts a dropped entry — no back-navigation needed.
- Adjacent-month days are visually distinct (muted/recessed) but fully functional.
- Holidays, promo bands, today, and campaign entries stack in a defined, non-overlapping order.

---

## Fix 3 — Copy Builder uses the row's notes / learnings

### Current state (partly built — don't rebuild it)
The planner→copy handoff **already reads notes**: `/api/copy-seed` passes `Planner notes: ${row.notes}` to the seed prompt, and `copySeedRoleInstruction` says "Fold in anything useful from the planner notes." So notes already softly influence the AI-proposed hero angle at handoff time.

### The real gaps
1. **Notes are a low-authority soft input, not a carried-through instruction.** `plannerRowToBriefSeed()` (`src/lib/planner-copy-link.ts`) maps the row to a `BriefInput` but does **not** populate `campaign_specific_rules` — the brief's highest-priority "user's literal instructions" tier. So a specific learning ("last time the 30% code confused people — state it in the body, not the subject") gets blurred into a hero angle by the fast model instead of surviving as a hard instruction into final generation.
2. **Notes added *after* the handoff never reach copy.** The user is now adding learnings in the campaign modal over time. If copy was already seeded, or notes are edited later, there's no re-sync — the copy builder never sees them.
3. **The writer can't see the notes are being used.** No visibility, so there's no trust that a learning was honoured.

### What to build
- **Map notes into `campaign_specific_rules`.** In `plannerRowToBriefSeed()`, carry `row.notes` (trimmed) into `campaign_specific_rules` so it flows through `compileBrief()` into generation at the literal-instruction priority tier, not just into the seed's hero angle. Keep the copy-seed AI fold-in too — belt and suspenders — but the notes must survive verbatim as a constraint.
- **Also fold in the promotion's `learnings`.** When the row is linked to a promotion (`promotion_id`), the matching `Promotion.learnings` from the promo store is a second, valuable source. Concatenate row notes + promotion learnings (clearly delimited) into the same constraint. This connects the Promotions calendar's institutional memory to the copy — genuinely useful and near-free.
- **Surface it in the Copy Builder.** Show a small, readable "Notes & learnings carried from the planner" panel near the brief inputs, displaying the exact text being used, with a toggle to exclude it. Same spirit as the performance-memory visibility in `LEARNING_LOOP_SPEC.md` — the writer sees and controls what's influencing the copy.
- **Re-sync on change.** When notes are edited in the modal on a row that already has linked copy, mark the copy's brief stale and offer a one-click "refresh brief from planner" in the Copy Builder (don't silently overwrite edited copy). At minimum, always read the latest notes at generation time rather than only at first handoff.

### Scope guard
Keep it simple: this is "carry the notes through as an explicit instruction + show them + keep them fresh." It is **not** a retrieval system or a learnings database — the notes already live on the planner row and promo store; we're just routing them to the right place at the right priority. If re-sync-on-edit proves fiddly, ship the `campaign_specific_rules` mapping + visibility first (that's the high-value 80%) and treat re-sync as a fast follow.

### Acceptance
- A learning typed into a planner row's notes appears verbatim in the generated campaign's brief as a literal instruction, and is visibly reflected in the copy.
- When a row is linked to a promotion, that promotion's `learnings` are included too.
- The Copy Builder shows exactly which notes/learnings it's using, with a way to turn them off.
- Editing notes after copy exists offers a clear way to refresh the brief without clobbering manual edits.

---

## Ground rules
1. **Next.js 16** (`proxy`, not middleware); TypeScript `strict`; no `any`.
2. This touches the largest file in the app (`planner/page.tsx`, ~1.5k lines). Prefer extracting the calendar into its own component/file as part of Fix 1/2 rather than growing it — aligns with the architecture-remediation direction.
3. Colours come from design tokens (see `DESIGN_SYSTEM_SPEC.md`): promo bands from the categorical data palette, a dedicated holiday token, campaign-status pills unchanged. No raw Tailwind slate/indigo.
4. Preserve existing behaviour: drag-to-reschedule, click-to-create, copy glyph, channel/status pills, today ring.
5. Read-only where it should be: promo bands and holiday chips are informational; they never create planner rows.

## Files
**Edit**
- `src/app/planner/page.tsx` — `CalendarView`: promo band row, holiday chips, real adjacent-month days, stacking order. (Consider extracting to `src/app/planner/CalendarView.tsx`.)
- `src/lib/planner-copy-link.ts` — map notes (+ promo learnings) into `campaign_specific_rules`.
- `src/lib/prompts/copy-seed.ts` / `src/app/api/copy-seed/route.ts` — include promotion learnings; keep notes fold-in.
- `src/app/copy-builder/*` — notes/learnings visibility panel + exclude toggle + refresh-brief affordance.
- `src/lib/holidays.ts` — only if a holiday needs a category/emoji field for richer chips; the date logic is already correct.

**No new store or route required** — promotions and holidays already have their data sources.

## Acceptance (all three)
- Promo bands, holiday chips, and clickable adjacent-month days all render correctly across a month boundary (test Aug↔Sep with Back-to-School + Labor Day).
- Notes flow into generation as a real instruction and are visible in the Copy Builder.
- `build`, `typecheck`, `lint` pass; drag-reschedule and click-to-create still work.
