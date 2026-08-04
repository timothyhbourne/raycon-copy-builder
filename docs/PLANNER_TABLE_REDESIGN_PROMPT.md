# Planner Table View Redesign — break out of the box, declutter, calmer day groups

You are redesigning **only the Table view** of the Campaign Planner in `raycon-copy-builder` (Next 16, React 19, Tailwind v4). Read `AGENTS.md` first — this is NOT the Next.js you know. The app has a design-token layer (`src/app/globals.css`: `bg-chrome`, `bg-canvas`, `bg-surface`, `text-ink` / `text-ink-secondary` / `text-ink-muted`, `border-line`, `shadow-card`, `--color-accent`, etc.) and UI primitives in `src/components/ui/` (Button, Chip, Drawer, Modal, Toast, Skeleton). Use the tokens and primitives — do not hand-roll colors or introduce new fonts (stay within the DM Sans / JetBrains Mono pairing).

## Scope

Touch **only** the `TableView` component in `src/app/planner/page.tsx` (starts ~line 485, including the `GRID` constant on line 485 and the shared `cell` class). You may add small local helpers/components inside that file. Reuse the existing formatters (`money`, `int`, `pct`, `rpr`, `fmtDate`), the `ChannelGlyph`, `StatusPill`, `CopyLink` components, and the `offerLabel` helper as-is.

**Do NOT touch:** the calendar view (`CalendarView`), the row editor (`RowEditor` / `Drawer`), `src/lib/planner*.ts`, any API route, or `data/*.json`. This is a re-skin and layout change of the table only. All existing behavior must keep working: filters (channel / status / from / to / sort), the drag-to-reschedule DnD (`@hello-pangea/dnd`, only active when `sortBy === "date"`), row `onClick` → `onEdit`, the copy links, and the footer summary row.

---

## The problems to fix (user's words, translated)

1. **The table is trapped in a box.** Today the grid lives inside `bg-surface border ... rounded-md shadow-card overflow-hidden`, and the rows scroll inside a nested `overflow-auto max-h-[calc(100vh-20rem)]` region with a hard `minWidth: 1360`. That creates a small scroll window inside a card, with a second horizontal scrollbar — scrolling up/down and left/right feels cramped and "boxed in."
2. **Too much information, too dense.** Twelve columns (Name, Channel, Status, Planned, Offer, Audience, Recipients, Open, Click, Revenue, Rev/recip, Notes) are crammed edge-to-edge. It reads as a wall of data.
3. **The per-day grouping is cluttered.** The day-divider rows (`fmtDate` on a `bg-canvas` strip) chop the table into busy fragments and add visual noise.

## Design intent

Calm, easy on the eyes, and spacious. The table should feel like it breathes and scrolls naturally with the page — not like a window inside a window. Prioritize the columns a marketer actually scans; make everything else secondary or on-demand.

---

## Step 1 — Get out of the box (fix the scrolling)

- Remove the nested `overflow-auto max-h-[calc(100vh-20rem)]` scroll region and the `overflow-hidden` clipping on the outer wrapper. The table should scroll **vertically with the page**, not inside a fixed-height pane. There should be exactly one vertical scrollbar (the page's), never two.
- Keep the **filter bar** and the **column header row sticky to the top of the viewport** as the user scrolls the page (`sticky top-0` relative to the page scroll, with an appropriate `z-index` and a solid `bg-surface`/`bg-chrome` background so rows don't bleed through). If there is a global app header/nav that occupies the top, offset the sticky position to sit just below it.
- For horizontal overflow: the table should fit without a horizontal scrollbar at typical desktop widths (~1280px+) after the decluttering in Step 2. Drop the hard `minWidth: 1360`. If horizontal scroll is ever needed on narrow screens, it should be a single scroll region on the table itself with the **Name column pinned/sticky-left** so context is never lost — not a scrollbar buried inside a card.
- The outer card chrome can stay as a light frame, but it must not clip or constrain scroll. Prefer letting the table sit on the page with hairline row separators over wrapping it in a heavy `shadow-card` box.

## Step 2 — Declutter the columns

Reduce cognitive load by splitting columns into **primary** (always visible) and **secondary** (de-emphasized or on demand). Target layout:

**Primary columns (always visible, comfortable widths):**
- **Campaign** — name + the existing `CopyLink` affordance beneath it; fold the channel signal into this cell as the small `ChannelGlyph` before the name (so the standalone "Channel" text column can be dropped). Keep the cancelled-row line-through treatment.
- **Status** — the existing `StatusPill`.
- **Planned** — `fmtDate`.
- **Offer** — `offerLabel`, truncated.
- **Revenue** — the headline metric, `money`, bold, right-aligned tabular-nums.

**Secondary metrics (Recipients, Open, Click, Rev/recip):** group these visually as quieter, right-aligned mono numbers with lighter ink (`text-ink-muted`) and a single subtle left divider separating the "plan" columns from the "performance" columns. Give them narrower, consistent widths. Consider collapsing Open/Click/Rev/recip into a compact metrics cluster rather than four full columns. Blank metrics should render as a faint `—`, not draw attention.

**Audience and Notes:** these are the biggest clutter offenders. Remove them from the default row. Surface them via **progressive disclosure** — e.g. a chevron/expand toggle on the row that reveals a secondary line (audience + notes) beneath, OR a tooltip/hover. Pick the expand-row approach if unsure. The data stays available; it just isn't screaming by default. (Row click still opens the editor — make the expand control a distinct affordance with `stopPropagation`.)

Rebuild the `GRID` template-columns constant to match the new column set and keep the header row, body rows, and summary row perfectly aligned to it (they all share `GRID` today — keep that discipline).

## Step 3 — Calmer day grouping

- Keep grouping-by-day when `sortBy === "date"` (and the flat, drag-disabled list when `sortBy === "revenue"`) — the logic in `groups` is correct; only restyle the presentation.
- Replace the heavy full-width `bg-canvas` divider strip with a lighter day header: small mono uppercase date label with generous vertical space above it and a hairline, so days read as gentle sections rather than hard bands. Make the day header **sticky just under the column header** while its rows are in view (nice-to-have, not required).
- Add breathing room between rows (a touch more vertical padding than the current `py-2.5`) and rely on hairline `border-line` separators + optional very subtle zebra (`bg-canvas` on alternate rows at low contrast) rather than boxes.

## Step 4 — Polish

- Right-align all numeric columns, keep `font-mono tabular-nums` so digits line up.
- Keep the footer summary row (totals + avg open/click) aligned to the new `GRID`; restyle to match but preserve every computed value in `summary`.
- Preserve the `sortBy === "revenue"` helper note ("Switch sort to 'Planned send' to drag-reschedule.").
- Hover state on rows should be a soft `hover:bg-chrome` (already present) — keep it subtle.
- Empty/loading/error states are handled by the parent `PlannerPage`; don't duplicate them.

---

## Constraints & acceptance criteria

- Filters, sort, DnD reschedule, row-click-to-edit, and copy links all still work exactly as before.
- The page has **one** vertical scrollbar; the table is not trapped in a fixed-height inner pane; no double horizontal scrollbar.
- The filter bar and column headers stay pinned while scrolling the list.
- Default row shows at most the primary + quiet-secondary columns; audience and notes are behind progressive disclosure.
- Header, body, day groups, and summary all stay aligned to a single `GRID` definition.
- No new dependencies, no new fonts, tokens/primitives only. TypeScript compiles clean (`npm run build` or the repo's typecheck passes). Calendar view, editor, libs, and data files are untouched.

## Suggested verification

After building, run the app and confirm on the Table view: scroll the full list with the page (headers stay pinned), toggle sort between Planned send and Revenue, drag a row to a new day, expand a row to see audience/notes, apply each filter, and check the summary totals still match. Run the typecheck/build before finishing.
