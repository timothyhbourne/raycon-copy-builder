# App-wide UI/UX Revamp — adopt a clean analytics design language

Overhaul the visual design of `raycon-copy-builder` (Next 16, React 19, Tailwind v4) to match a reference analytics dashboard's design language. This is a **design-system and layout revamp**, not a data or feature change — every existing route, handler, and data shape keeps working; we are restyling structure, navigation, components, typography, color, tables, and charts.

**Read first:** `AGENTS.md` (this is NOT the Next.js you know). Work through the token layer in `src/app/globals.css` and the primitives in `src/components/ui/`. Touch: `src/components/AppNav.tsx` (sidebar rebuild), `src/app/layout.tsx` + `src/app/globals.css` (tokens/type scale/shell), `src/app/dashboard/*`, `src/app/reports/*`, `src/app/planner/*`, `src/app/copy-builder/*`, and the shared `ui/` primitives. Do not change API routes, `src/lib/*` logic, or data files.

---

## The target design language (extracted from the reference)

Study these patterns and reproduce them as a coherent system. This is the whole point of the task — match the *feel*: calm, dense-but-legible, confident typography, generous whitespace, one strong accent + semantic green/red, restrained borders.

### 1. App shell & layout
- **Two-pane shell:** a fixed, full-height **left sidebar (~240–260px, labeled)** + a main content area on a light neutral canvas (`bg-canvas`/`bg-chrome`), white cards (`bg-surface`) floating on it. Main content has generous horizontal padding and a comfortable max width; it scrolls with the page (no trapped inner panes).
- The sidebar is **light** (white/near-white), separated by a hairline, not a dark rail. It replaces today's 72px icon-only rail.

### 2. Sidebar navigation (pay close attention — grouped sections)
This is the most distinctive element. Rebuild `AppNav.tsx` into a wide, grouped, labeled nav:
- **Brand lockup** top-left: small rounded-square logo mark + wordmark.
- **Search box** directly under the brand: full-width, rounded, muted placeholder, with a `⌘K` keyboard-hint chip on the right.
- **Grouped sections.** Nav items are organized under tiny **uppercase, letter-spaced, muted section headers** (in the reference: `PINNED`, `MANAGER`, `ASK`, `RETENTION`, `INSIGHTS`, `ADMIN`). Each section is a labeled group with its items beneath it; sections can be collapsible (chevron on the group header).
- **Nav item** = a small line icon (1.5px stroke, currentColor) + label, comfortable row height, rounded hover (`hover:bg-chrome`). **Active item** = brand-accent text + a subtle accent-tinted background (and/or a thin accent left-bar) — see the green active state in the reference; use our accent (Step "Color").
- **Badges/affordances:** small pill badges next to items (the reference shows an "AI" chip); a star/pin affordance for a "Pinned" group.
- **Map Raycon's routes into grouped sections** (propose and implement a sensible grouping), e.g.:
  - `PINNED` — user's starred views (Planner, Reports…) — optional if pinning isn't built, ship a static curated group.
  - `CREATE` — Copy Builder, SMS.
  - `PLAN` — Planner.
  - `MEASURE` — Dashboard/Overview, Flows, Campaigns, Reports.
  - `LIBRARY` — Saved copy / Library.
  - `ADMIN` — Sign out / settings at the bottom.
  - (Fold today's dashboard sub-tabs "Flows/Campaigns" into the sidebar group rather than a separate in-page tab strip, matching the reference where everything lives in the one grouped nav.)

### 3. Page header pattern
Every content page opens with the same three-part header:
- A tiny **uppercase category/eyebrow label** in a muted accent tone (reference: `RETENTION`).
- A **large, bold page title** — optionally with a **colored accent word** (reference: "…per customer **by product**" where "by product" is green).
- A **one-line muted description** beneath.
- **Right-aligned meta**: a count chip (`22 PRODUCTS`), a time-period control, and/or an **Export CSV** button. Keep this row aligned to the title's baseline.

### 4. Filter / control bar
A horizontal control row under the header:
- Each control has a **tiny uppercase label above it** (`TIME PERIOD`, `BREAKDOWN`, `METRIC`, `REPURCHASE WINDOW`…).
- Controls: white rounded dropdowns (chevron, optional lock glyph on locked ranges), a search input, and **segmented toggles** for enumerated choices (reference: `NEW / RETURNING`, and `30D 60D 90D 180D 365D UNLIMITED`).
- **Right-aligned actions:** checkboxes (`ACTIVE PRODUCTS ONLY`), `CSV`/`Export`. Reuse/extend the existing `DateRangePicker`, `Chip`, `Button`.

### 5. Cards & KPI cells
- **Card:** white surface, hairline border, `radius-md`+, soft `shadow-card`, generous padding. Header = title + muted subtitle (+ optional right action like `CSV`).
- **KPI row:** a run of stat cells, each = tiny uppercase label, a **large bold number**, a **delta pill** (`↑ green` / `↓ red`, in `pp`/`%`), a muted "WAS X PRIOR" caption, and a small description. Separate cells with a **thin accent left-border** (reference's green stat dividers).
- **Callout cards:** "STRONGEST / WEAKEST", "BEST / WORST benchmark" — a label, a bold value, a signed delta vs. a median/prior, and a secondary stat (customer count, recoverable $). Green for good, red for weak.

### 6. Tables & heatmaps
- **Dense data tables:** tiny uppercase column headers, comfortable rows, hairline separators, subtle zebra optional, right-aligned tabular-nums for all numerics, a bottom **"Page average" / summary** row.
- **In-row micro-viz:** a `TREND` column with a small **sparkline** (thin accent line), and small metric columns (`NEW`, `R-%`).
- **Cohort heatmap:** a matrix (rows = items, columns = `M0…M12` months-since-first-order) where each cell is tinted along a **sequential single-hue ramp** (light→dark = low→high). Include a **gradient legend** showing the min→max values (reference: `A$43 → A$202`). Empty cells stay blank/neutral.

### 7. Charts
No chart library is installed. Add **Recharts** (`recharts`, React-19 compatible) for standard line/area/bar, and **hand-roll small tokenized SVG** for the bespoke ones (sparklines, cohort heatmap via CSS grid, lollipop/dot-plot). All chart color must come from tokens. Match these reference styles:
- **Layered line/area (retention over time):** several thin monochrome lines in shades of the accent, dots at data points, light dashed gridlines, a compact legend of colored dots, muted axis labels, and a **shaded "DATA STILL MATURING"** region (soft warning tint) over incomplete periods.
- **Lollipop / dot-plot vs. a reference line:** one row per item; a **dashed vertical reference line** (e.g. "median 18.4%"); a dot = the item's value with a **stem to the median**; **dot size encodes volume** (customer base); **green if it clears the line, red if it trails**; right-aligned `rate` + signed `gap` columns; a caption explaining the shaded shortfall.
- Keep charts airy: thin strokes, muted grids, lots of whitespace, no heavy fills.

### 8. Color
The reference uses a **single confident brand accent + semantic green/red + a sequential ramp for heatmaps.** Map this onto Raycon:
- **Brand accent:** keep Raycon's existing **indigo** (`--color-accent`) as the primary accent for active nav, links, primary buttons, sparklines, and line charts. (The reference's own heatmap is indigo/purple, so this stays on-brand.) — *If Tim wants to mirror the reference's green brand instead, introduce a green accent token and swap; leave a single `--color-accent` switch so it's a one-line change. Default to indigo.*
- **Semantic:** green = good/above/positive delta, red = bad/below/negative delta (reuse the `success`/`danger` triads). Use consistently for deltas, best/worst, above/below-median.
- **Heatmap ramp:** a sequential indigo ramp (accent-50 → accent-600) generated in code; expose the endpoints as tokens.
- Everything else neutral: white cards, light canvas, slate inks, hairline borders.

### 9. Typography
- One refined sans app-wide (load via `next/font` in `layout.tsx`; keep the existing DM Sans or upgrade to Inter — one display sans only). Reserve monospace strictly for tabular numerics if at all.
- A tight scale used consistently: eyebrow label (tiny uppercase, tracked, muted), page title (large bold, tight tracking), card title (medium), body (sm), micro-label (tiny uppercase). Big KPI numbers are the largest weight/size on the page.

### 10. Small details (reproduce these)
- `⌘K` search hint chip; lock glyph on locked date ranges; count chips (`22 PRODUCTS`, `15 OF 15 PRODUCTS`); inline tags under names (`TOP`, `WATCH`); signed `+X.Xpp` gap annotations; "WAS X PRIOR" captions; best/worst benchmark line; right-aligned rate/gap columns; a gradient legend for heatmaps; subtle "data maturing" shading.

---

## Deliverables / acceptance criteria

- The **grouped, labeled, searchable sidebar** replaces the 72px rail; sections have uppercase headers; active item uses the accent; today's dashboard Flows/Campaigns tabs live in the sidebar.
- Every page uses the **eyebrow → bold title (+accent word) → description** header and the **labeled filter bar** with segmented toggles where appropriate.
- Cards, KPI cells (with delta pills + "was prior"), and callouts follow the reference; all numerics right-aligned tabular-nums.
- Charts added and tokenized: layered retention line/area with a "data maturing" region, a lollipop/dot-plot with a dashed reference line and volume-sized dots, cohort heatmap with a gradient legend, and in-row sparklines.
- One accent (indigo by default) + semantic green/red + sequential ramp; one sans; consistent type scale; hairline borders; generous whitespace.
- No data/feature/route/behavior changes; `npm run build` and typecheck pass; no browser-storage APIs added; `recharts` the only new dependency (plus hand-rolled SVG).

## Suggested build order
1. Tokens + type scale + `next/font` + the two-pane shell (`globals.css`, `layout.tsx`).
2. The grouped sidebar (`AppNav.tsx`) — biggest structural change.
3. Shared header + filter-bar + card + KPI + callout components in `src/components/ui/`.
4. Restyle pages to use them (Dashboard → Reports → Planner → Copy Builder).
5. Charts (Recharts + tokenized SVG heatmap/lollipop/sparkline).
6. Small details pass + full verification.

## Note on scope
Match the reference's **design language**, not its content — Raycon is an email/SMS campaign tool, not a retention analytics product, so apply these patterns to Raycon's own pages (planner, dashboard, reports, copy builder). Where a reference chart type (cohort heatmap, lollipop) maps naturally onto Raycon data (e.g. campaign performance, flow comparison), use it; otherwise adopt the same styling on the charts Raycon already needs.
