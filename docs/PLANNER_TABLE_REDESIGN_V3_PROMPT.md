# Planner Table View — coloring & width revamp (kill the boxiness, widen it, calmer day grouping)

A focused follow-up to `docs/PLANNER_TABLE_REDESIGN_V2_PROMPT.md`. The table view is functionally right but visually still off: it's squeezed into a narrow centered column, the day grouping reads as boxy bands, and the alternating gray/white row striping looks choppy and incohesive. Fix the **background/coloring** and the **width/layout** of the Table view. **Calendar view stays as-is.** Re-skin only — no data, filter, sort, DnD, or routing changes.

**Read first:** `AGENTS.md`; the design language in `docs/DESIGN_REVAMP_PROMPT.md` (white surfaces, whitespace over boxes, one accent + semantic, hairlines). Files: `src/app/planner/layout.tsx` (width) and the `TableView` in `src/app/planner/page.tsx`. Use tokens + `src/components/ui/` primitives.

---

## The problems (from the current code)

1. **Condensed into the middle.** `src/app/planner/layout.tsx` line 6 wraps all planner content in `max-w-6xl mx-auto px-8` (~1152px, centered). With ~11 columns the table is cramped in a narrow column with dead space on both sides.
2. **Boxy day separation.** Each day group renders a full-width label row with `border-b border-line` (a hard band), chopping the table into boxes instead of flowing.
3. **Choppy alternating rows.** Rows alternate `bg-canvas` (gray) / `bg-surface` (white) zebra, and with two campaigns in a day it looks like stacked gray/white blocks — not cohesive.

## What to change

### 1. Widen the workspace
- In `src/app/planner/layout.tsx`, replace the tight `max-w-6xl` cap with a much wider workspace so the table breathes — e.g. `max-w-[110rem]` (or near-full-bleed with comfortable page padding like `px-6`/`px-8`). The table should use the available horizontal width, not sit in a narrow centered strip.
- Widening is shared with the Calendar view (same layout). The calendar looks good today, so **verify it still looks balanced** at the wider width; if the calendar feels over-stretched, cap only the calendar's own container internally (leave the table full width). Do not restyle the calendar otherwise.
- With the extra width, give columns more breathing room (comfortable padding, clear widths) so information reads clearly. No horizontal scrollbar at desktop widths.

### 2. Kill the zebra — go white with hairlines
- Remove the alternating row background entirely. **Every row sits on white** (`bg-surface`). Delete the `zebra ? "bg-canvas" : "bg-surface"` logic and the `rowIndex` counter.
- Separate rows with a **single, very subtle hairline** only (light `border-line`, or even lighter). No gray fills between rows.
- **Hover** is the one place color appears on a row: a soft, single hover tint (subtle `bg-chrome` or a faint accent wash) — not a permanent background. Selected/dragging keeps the existing `shadow-pop`.
- Overall direction: the table is a clean white surface; structure comes from **whitespace, hairlines, alignment, and the accent**, not from gray banding.

### 3. Calmer, cohesive day grouping (no bands)
- Remove the hard `border-b` day-divider band. Replace it with an **airy, quiet day label**: small uppercase muted date text with **generous vertical space above each group** and no border, no fill — days read as gentle sections that flow into the table, not boxes.
- Make the day label **sticky just beneath the pinned column header** while its rows are in view (nice-to-have) so context is kept without a heavy divider.
- Keep the per-day droppable structure and DnD reschedule intact — this is purely how the group header looks. (Consider aligning the date label to the left gutter so it feels like a margin note rather than a full-width bar.)

### 4. Reduce internal boxiness
- Minimize vertical dividers inside rows: at most **one** subtle separator between the plan columns and the metrics group (or none) — remove per-column `border-l` clutter. Let alignment and spacing group the metrics, not lines.
- Keep the KPI stat cards at the top and the pinned filter bar + column header from V2. The column header background can be white or a very light tint — keep it quiet and consistent with the no-zebra direction.

## Acceptance criteria
- Table uses the full workspace width (no narrow centered strip, no dead side gutters); columns breathe; no horizontal scrollbar at desktop widths.
- No alternating row colors anywhere — all rows white, separated by hairlines; color appears only on hover and for semantic/accent emphasis.
- Day groups read as airy whitespace-separated sections with a light label — no full-width bordered bands.
- Calendar view unchanged and still looks good at the new width.
- All behavior intact (filters, sort, DnD, row-click-edit, copy links, Audience/Notes expand, KPI cards); `npm run build`/typecheck pass; no data/API changes.

## Verification
Load the Table view: confirm it fills the width with clear, roomy columns; scroll through multiple days and multiple-campaign days to confirm rows are uniformly white with only hairlines/whitespace separating them and no gray banding; confirm day labels feel light, not boxy; drag-reschedule and the expander still work; switch to Calendar and confirm it's unchanged.
