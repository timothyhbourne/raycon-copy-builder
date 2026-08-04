# Planner Tool — UI/UX Refinement Spec

A structured spec for a UI/UX refinement pass on the Campaign Planner and app-wide chrome in `raycon-copy-builder` (Next 16, React 19, Tailwind v4).

**Read first:** `AGENTS.md` — this is NOT the Next.js you know. Work within the existing design-token layer in `src/app/globals.css` (`bg-chrome` / `bg-canvas` / `bg-surface`, `text-ink` / `text-ink-secondary` / `text-ink-muted`, `border-line` / `border-line-strong`, `--color-accent` indigo, semantic 50/200/600 triads, radius-sm/md/lg, `shadow-card` / `shadow-pop`) and the UI primitives in `src/components/ui/` (Button, Chip, Drawer, Modal, Toast, Skeleton). Reuse tokens and primitives — do not hand-roll colors or add dependencies unless a section explicitly calls for one.

**Primary files in play:** `src/app/planner/page.tsx` (calendar + table + editor), `src/components/AppNav.tsx` (left nav), `src/app/globals.css` and `src/app/layout.tsx` (typography), `src/lib/planner-types.ts` (status/label + offer fields). Do not touch API routes or `data/*.json` except where a section explicitly allows read-time logic.

---

## 1. Calendar View — Holiday Markers

Add lightweight visual markers for **major** public holidays to the calendar grid in `CalendarView` (`src/app/planner/page.tsx`).

- **Regions:** US and Europe only.
- **Scope:** major, well-known holidays only — e.g. New Year's Day, Easter (Good Friday / Easter Monday), Labour Day / May Day, US Memorial Day, US Independence Day, US Labor Day, US Thanksgiving, Christmas Eve / Christmas Day, Boxing Day, New Year's Eve. Exclude minor or niche observances.
- **Implementation:** add a small static holiday lookup keyed by `YYYY-MM-DD` (a local helper/const in the planner file or a tiny `src/lib/holidays.ts`). Compute movable dates (Easter) per year rather than hardcoding a single year. No external date/holiday library — keep it self-contained.
- **Rendering:** the calendar already builds a per-day cell (`cells.map`, `dayKey(d)`) and a `byDay` map. In each day cell, if the date is a holiday, show a quiet marker that does not compete with campaign pills: a small muted label or dot in the day-number row (near the existing `{d}` / "Today" affordance), using `text-ink-muted` / a soft token tint. On hover/`title`, show the holiday name. Markers are informational only — they must not block the day's click-to-create or the drag-to-reschedule drop target.
- Keep it visually calm: a marker is a hint, not a banner.

## 2. Table View — Layout Cleanup

General information-density and legibility pass on the `TableView` component (`src/app/planner/page.tsx`, the `GRID` constant + shared `cell` class).

- Reduce visual noise so the table scans at a glance. Establish a clear primary vs. secondary column hierarchy: campaign name, status, planned date, offer, and revenue are primary; recipients / open / click / rev-per-recipient are quieter, right-aligned mono metrics grouped behind a single subtle divider; audience and notes should not crowd the default row (move them to progressive disclosure / expand-row or hover).
- Fold the channel signal into the campaign-name cell (the existing `ChannelGlyph`) rather than a standalone text column.
- Let the table breathe: consistent column widths rebuilt in `GRID`, generous row padding, hairline `border-line` separators (optionally very subtle zebra with `bg-canvas`), blank metrics as a faint `—`.
- Do not trap the list in a fixed-height inner scroll pane; it should scroll with the page with the filter bar + column header pinned.
- Preserve all behavior: filters, sort, drag-to-reschedule (date sort only), row-click-to-edit, copy links, and the footer summary totals — all aligned to a single `GRID` definition.

> Note: this overlaps with `PLANNER_TABLE_REDESIGN_PROMPT.md`. If that pass has already landed, treat this section as a consistency check rather than a rebuild.

## 3. Offer Column — Split into Two Columns

Today a single **Offer** column mixes the offer value and the discount code via the `offerLabel(r)` helper (which renders `promo_code · offer`, or `Evergreen · <EVERGREEN_OFFER>`).

- Split into **two distinct columns: `Offer Value` and `Discount Code`.**
  - **Offer Value** = the human offer description. For `offer_type === "evergreen"` show the evergreen offer (`EVERGREEN_OFFER`); for `promo` show `r.offer`.
  - **Discount Code** = `r.promo_code` when present; otherwise a faint `—` (evergreen rows have no code).
- Update the `GRID` template-columns constant and the header row, body rows, and summary row so all stay aligned. Keep `offerLabel` available if it's used elsewhere (e.g. calendar tooltips), but the table should render the two fields separately rather than the combined string.
- Truncate long offer values gracefully; keep the code column narrow and mono/tabular.

## 4. Typography Overhaul (app-wide)

**Accurate diagnosis:** the app body font is already **DM Sans** (a modern sans, loaded in `globals.css`), but the "typewriter/dated" feel comes from **pervasive `font-mono` (JetBrains Mono)** usage — micro-labels, status pills, dates, counts, day-group headers, nav labels, and section labels are almost all mono uppercase. That monospace layer is what reads as dated.

- **Primary fix — reduce the mono footprint:** audit every `font-mono` usage (heavily concentrated in `src/app/planner/page.tsx`, `src/components/AppNav.tsx`, `src/components/Sidebar.tsx`) and reserve monospace for genuinely tabular numerics only (metric columns, currency, counts — where `tabular-nums` alignment matters). Convert decorative micro-labels, status pills, date strings, and nav labels to the sans face with appropriate size/weight/tracking instead of uppercase mono.
- **Optional upgrade — the sans itself:** if a more refined face is desired, swap the body typeface app-wide (e.g. Inter, or keep DM Sans but tighten weights/tracking). Load via `next/font` in `src/app/layout.tsx` rather than the current Google Fonts `@import` in `globals.css` for performance, and expose it through the token layer so every component inherits it. Keep exactly one display sans + (optionally) one mono for numerics — no third font.
- **Apply app-wide**, not just the table: planner (calendar, table, editor), dashboard, reports, copy-builder, sidebar, and nav should all inherit the refined type scale consistently.
- Deliverable: a small, consistent type scale (display / heading / body / label / mono-numeric) documented in `globals.css` so future components stay consistent.

## 5. Status Differentiation — Scheduling Source (Klaviyo vs Postscript)

The data already distinguishes platform by channel: `statusLabel(status, channel)` in `src/lib/planner-types.ts` returns **"Scheduled in Klaviyo"** for email and **"Scheduled in Postscript"** for SMS. But the visual styling (`STATUS_STYLE`) is keyed on status only, so the two scheduling sources look identical at a glance.

- Add a clear per-row **platform badge/tag** distinguishing **Klaviyo (email)** vs **Postscript (SMS)** scheduling, color-coded and consistent across the table and calendar.
  - Suggested: two distinct token tints (e.g. Klaviyo = accent/indigo family, Postscript = a clearly different hue such as the warning/amber or a teal token) so they're never confused with the status-green.
  - Show the platform name on the badge (or a compact glyph + tooltip) for the `scheduled` state specifically, where "scheduled where" matters most.
- Keep it consistent with the existing `StatusPill` component and the calendar entry pills; build a small shared badge rather than duplicating styling. Respect the existing `isEffectivelySent` derivation — don't change scheduling logic, only its visual expression.

## 6. Left Nav (AppNav) — Visual Bug

In `src/components/AppNav.tsx` the nav is a fixed **72px** rail (`w-[72px]`) with a right border, and each item stacks a 20px icon above an `text-[11px]` centered label. The word **"Dashboard"** is wide enough that its label crowds/clips against the rail's right border (`border-r border-line`), so the "D" looks cut off or overlapping the edge.

- Fix so no label touches or clips at the border. Options (pick the cleanest): give labels horizontal breathing room (`px` + `text-center` with `leading-tight`), allow a controlled 2-line wrap, slightly reduce label size/tracking, or widen the rail a few px. Ensure the active-state left accent bar (`absolute left-0 … w-0.5`) and the border don't collide with text.
- Verify all four labels (Copy, Dashboard, Planner, Reports) plus "Sign out" render cleanly centered with even padding at the rail width. Minor, isolated fix — don't restructure the nav.

## 7. Date Range Picker (From / To — Planner Table filters)

The table filter bar uses native `<input type="date">` (the `dateCls` style in `src/app/planner/page.tsx`), which renders the default browser calendar — inconsistent with the product's design system.

- Replace the two native date inputs with a **custom-styled popover/modal date picker** matching the token system (surface bg, `border-line`, `radius-md`, `shadow-pop`, accent highlight for selected range). Build on the existing `Modal`/`Drawer` primitives or a lightweight popover; if a library is warranted, prefer a small headless one (e.g. `react-day-picker`) styled with tokens — otherwise hand-build to stay dependency-light.
- Support selecting a **From/To range** and wire it to the existing `fStart` / `fEnd` state (keep the `YYYY-MM-DD` string shape the filter logic expects).
- Add **quick-select presets:** Today, Last 7 days, Last 30 days, Last 90 days (each sets `fStart`/`fEnd` accordingly), plus a clear/reset. Keep keyboard and screen-reader accessibility (the native input gave this for free — don't regress it).

## 8. Overall Design Direction

Tie the above into one intentional system rather than one-off fixes. The current aesthetic reads as generic/default HTML; the goal is a custom, elegant, consistent design language across calendar, table, sidebar, and nav.

- **Consistency:** one type scale (Section 4), one spacing rhythm, shared components (status/platform badges, date picker, pills) reused everywhere instead of re-styled per view.
- **Restraint:** hairline separators over heavy boxes and shadows; monospace reserved for numerics; muted ink for secondary info; the indigo accent used sparingly for state and action, not decoration.
- **Componentry:** promote repeated patterns (badges, popovers, segmented controls, day/section headers) into `src/components/ui/` so calendar, table, and editor stay visually in sync.
- Treat tokens in `globals.css` as the single source of truth; if a value is needed that isn't a token, add a token rather than a one-off hex.

---

## Suggested sequencing

1. Typography overhaul (Section 4) + overall direction (Section 8) first — they set the foundation everything else inherits.
2. Table cleanup + offer split + platform badges (Sections 2, 3, 5) — the densest surface.
3. Date range picker (Section 7) and calendar holiday markers (Section 1).
4. Nav bug (Section 6) — quick, isolated.

## Acceptance / verification

- App-wide type change renders consistently across planner, dashboard, reports, copy-builder, nav, and sidebar; mono is limited to tabular numerics.
- Table has separate Offer Value and Discount Code columns; header/body/summary stay aligned to one `GRID`; all filters, sort, DnD, and row-click still work.
- Klaviyo vs Postscript scheduling is visually distinguishable at a glance in both table and calendar.
- Left-nav labels never clip against the rail border.
- From/To uses a custom picker with working Today / 7 / 30 / 90-day presets, wired to `fStart`/`fEnd`.
- Calendar shows major US/EU holiday markers without blocking click-to-create or drag-to-reschedule.
- `npm run build` / typecheck passes; no new fonts beyond the intended one sans (+ optional mono); no unintended dependencies.
