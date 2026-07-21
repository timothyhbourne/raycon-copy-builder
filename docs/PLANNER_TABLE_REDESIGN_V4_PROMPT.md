# Planner Table View — coloring revamp: one seamless white surface, no gray banding

Follow-up to `docs/PLANNER_TABLE_REDESIGN_V3_PROMPT.md`. The row zebra is gone, but the table still looks like alternating gray/white blocks. **Root cause:** the page background is the warm-gray `bg-chrome` (`--color-chrome: #f4f4ef`, set on `body` in `globals.css` ~line 85), the table has **no white surface behind it**, and the **column header is `bg-chrome` (gray)** — so the gray page shows through in the day-group gutters and the table reads as gray/white banding. Make the Table view **one continuous white surface** on a white workspace, with structure from hairlines, whitespace, and the accent — nothing gray. **Calendar view stays as-is.** Re-skin only — no data, filter, sort, DnD, or routing changes.

**Read first:** `AGENTS.md`; `docs/DESIGN_REVAMP_PROMPT.md`. Files: `src/app/planner/page.tsx` (`TableView`) and `src/app/planner/layout.tsx`. Use tokens + `src/components/ui/` primitives.

---

## Goal

The whole Table view is **white end to end** — page, table, day-group gutters, header row — with hairline dividers and whitespace doing the separating and the indigo accent + semantic green/red the only real color. No warm-gray (`bg-chrome`) anywhere in the table region. Modern, clean, cohesive.

## What to change

### 1. Put the table on a white workspace
- The planner content currently sits directly on the gray `body` (`bg-chrome`). Give the Table view a **continuous white surface**: either (preferred) make the planner workspace background white for this view, or wrap the entire table region — filter bar + KPI cards area + column header + all day groups + rows — in a single `bg-surface` (white) container that spans the full width. The gray page must not show through **between day groups or around rows**.
- The day-group label gutters (`pt-8` spacing between groups) must be **white**, not the gray page. That single change removes the perceived banding.

### 2. Column header → white/quiet
- The column header is `bg-chrome` (gray) — change it to **white** (`bg-surface`) or a barely-there tint, kept quiet with a single bottom hairline (`border-b border-line`). Keep it sticky. It should blend into the white surface, not read as a gray bar.

### 3. Kill the remaining gray fills
- **Discount-code chip:** currently `bg-chrome` (gray fill) — make it a **hairline outline chip** (transparent/white background, `border-line`, muted mono text) so it's not a gray block. Or drop the box entirely and show the code as muted mono text.
- Audit the table region for any other `bg-chrome`/`bg-canvas` fills and remove them (rows, expanded Audience/Notes panel, hover) — replace with white + hairlines. The expanded detail panel should be white with a hairline top/bottom, not a gray fill (a very faint accent wash is fine if separation is needed).

### 4. KPI cards & filter bar on white
- On a now-white page, the KPI stat cards can't rely on white-on-gray contrast. Give each card a **hairline `border-line` + subtle `shadow-card`** (and `radius-md`) so it still reads as a distinct card on white. Keep the big-number/label styling.
- The filter bar sits on white with a bottom hairline separating it from the table.

### 5. Structure from hairlines + whitespace + accent (not gray)
- Row separation: a single very light hairline between rows. Hover: one soft tint (a faint `accent-50` wash is fine — already used) — but not a permanent background.
- Reduce internal vertical lines: at most one subtle divider before the metrics group (remove the rest). Let whitespace and right-alignment group the numbers.
- Day labels: airy, small uppercase muted text with generous space above each group — on the white surface, no fill, no border band.
- Use the indigo accent for the active view toggle, links, hover wash, and any emphasis; green/red only for semantic deltas. No decorative gray.

## Acceptance criteria
- No warm-gray (`bg-chrome`) visible anywhere in the Table view — page, gutters, header row, chips, and expanded panels are all white or hairline-outlined.
- The table reads as one continuous white surface; scrolling through single- and multi-campaign days shows no gray/white banding.
- Column header is white/quiet and still sticky; KPI cards remain distinct via border+shadow on white; filter bar separated by a hairline.
- Calendar view unchanged and still looks good.
- All behavior intact (filters, sort, DnD, row-click-edit, copy links, Audience/Notes expand, KPI cards); `npm run build`/typecheck pass; no data/API changes.

## Verification
Load the Table view and scroll: confirm there is zero gray banding — every surface between and behind rows and day labels is white, the header no longer looks like a gray bar, the discount chip is an outline not a gray block, and KPI cards still read as cards. Switch to Calendar and confirm it's unchanged.
