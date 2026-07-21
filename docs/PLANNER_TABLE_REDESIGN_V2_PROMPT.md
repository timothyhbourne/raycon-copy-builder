# Planner Table View — visual redesign (apply the analytics design language)

Redesign **only the Planner Table view** in `raycon-copy-builder` to match the clean analytics design language captured in `docs/DESIGN_REVAMP_PROMPT.md` (grouped, confident, tabular, one accent + semantic green/red, hairlines over boxes, KPI stat cards in rounded boxes). The **Calendar view is good as-is — do not touch it.** This is a re-skin and layout change of `TableView` only: no data, API, filter, sort, DnD, or routing changes.

**Read first:** `AGENTS.md`. Use the token layer (`src/app/globals.css`) and `src/components/ui/` primitives. All work is inside the `TableView` component in `src/app/planner/page.tsx` (currently ~lines 511–748), plus small shared helpers. Keep every existing behavior: channel/status/date/sort filters, drag-to-reschedule (date sort only), row-click-to-edit, the copy links, and the per-row expand for Audience/Notes.

---

## The problems to fix (from the current code)

1. **The `NB rev (1d click)` column overflows.** The header string is long and the column is only ~100px (`GRID`, line 518), so the header and money values spill. 
2. **Cluttered, stacked indicators.** The Status cell stacks `StatusPill` **over** `PlatformBadge` vertically (lines 684–689), and the Campaign cell stacks name over the copy link — the vertical stacking makes rows look busy and uneven.
3. **Discount code wraps to a second line.** The `Discount code` cell (lines 692–696) is too narrow, so codes break instead of staying on one line.
4. **Inconsistent metric styling.** `Revenue` is `text-ink font-semibold` while every other metric is `text-ink-muted` (line 701 vs 697–705) — the lone bold column looks arbitrary. Metrics need one consistent, intentional hierarchy.
5. **The bottom total row looks bad.** The summary grid pinned to the bottom (lines 733–743) is heavy and awkward.

## What to build

### A. Move the totals to the TOP as KPI stat cards (rounded boxes)
Replace the bottom summary row entirely with a **row of KPI stat cards at the top of the table view** — directly under the filter bar, above the column header — exactly the "singular rounded boxes" pattern from the reference screenshots.

- Each card: white `bg-surface`, hairline `border-line`, `radius-md`, `shadow-card`, generous padding; a **tiny uppercase muted micro-label** on top and a **large bold tabular number** below. Lay them out in a responsive row (wrap on narrow widths).
- Cards (reuse the existing `summary` memo values, which already respect the active filters): **Campaigns** (`summary.count`), **Recipients** (`int`), **Avg open** (`pct`), **Avg click** (`pct`), **Revenue** (`money`), **NB rev · 1d click** (`money`). Blank averages → `—`.
- Delete the bottom summary `<div>` grid (lines 733–743). The totals now live only in the top cards.
- Build this as a small reusable `StatCard` (or `KpiCard`) in `src/components/ui/` so it matches the design-system work and can be reused on Dashboard/Reports later.

### B. Fix the columns (stop the overflow, declutter)
Rebuild the `GRID` template so the table fits the planner's content width **without a second horizontal scrollbar** at normal desktop widths; if it ever must scroll on narrow screens, make the **Campaign column sticky-left**.

- **Shorten the NB header** to `NB rev` (keep the full "Northbeam — 1-day click, last-touch, cash…" definition in the existing `title` tooltip, and/or a tiny `1d click` sub-label). Widen the column enough for `money()` values; right-align, tabular-nums, consistent with the other metric columns.
- **Combine Offer into one column.** Merge `Offer value` + `Discount code` into a single **Offer** column: the offer value as the primary text (truncating), and the discount code beneath/beside it as a **small muted mono chip** (single line, never wraps — `whitespace-nowrap` + truncate). This frees width and removes a whole column. (Keep `offerValue()` / `discountCode()` helpers.)
- Keep the plan-vs-performance split with a **single** subtle left divider before the metrics group (not a divider per column).

### C. Unstack the indicators
- **Status cell:** show a single clean line — the `StatusPill`, and when scheduled, the `PlatformBadge` **inline beside it** (or fold the platform into the pill as "Scheduled · Klaviyo/Postscript"), not stacked vertically. One row, aligned.
- **Campaign cell:** keep the channel glyph + name on the primary line; render the copy link as a **quiet secondary affordance** (smaller, muted, single line) — de-emphasized so the name reads first. Keep the expand toggle for Audience/Notes.

### D. Consistent metric treatment
- Give all six metric columns the **same weight and alignment** (right-aligned, `font-mono tabular-nums`). Establish hierarchy by **color, not random bold**: secondary metrics (Recipients, Open, Click, Rev/recip) in `text-ink-secondary`/`-muted`; the **two revenue columns (Revenue, NB rev) as the emphasized pair** in `text-ink` with a slightly stronger weight — applied consistently to both, so emphasis looks deliberate. Blank/`null` values render as a faint `—` uniformly.

### E. General polish (per the design language)
- Comfortable row rhythm, hairline separators, the existing subtle zebra — keep. No heavy boxes.
- Keep the filter bar + column header pinned to the top of the page scroll (already done); the KPI cards sit above them or scroll away — your call, but the header/columns must stay pinned.
- Keep the day-group subheaders (date sort) light; keep the "Switch sort to Planned send to drag-reschedule" note.

## Acceptance criteria
- Totals appear as **rounded KPI cards at the top**, not a bottom row; values still reflect active filters.
- **No column overflow** and no double horizontal scrollbar at desktop widths; NB rev fits; discount code never wraps.
- Status/platform and campaign/copy-link are single-line, not vertically stacked.
- All metrics share consistent alignment/weight; revenue emphasis is applied consistently (both revenue columns) via color/weight, not a lone bold cell.
- Calendar view, filters, sort, DnD, row-click-edit, copy links, and Audience/Notes expand all still work. `npm run build`/typecheck pass. No data/API changes.

## Verification
Load the Table view: confirm the KPI cards read correctly and update when you change filters; check NB rev and discount code fit on one line; toggle sort (Planned send ↔ Revenue); drag a row to a new day; expand a row; and confirm the calendar view is unchanged.
