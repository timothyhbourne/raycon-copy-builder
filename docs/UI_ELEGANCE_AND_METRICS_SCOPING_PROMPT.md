# Prompt: Metrics scoping, calendar width, and a white/elegant UI pass

Hand this file to Claude Code from the repo root. It contains three independent tasks. Do them in order, typecheck after each (`npx tsc --noEmit`), and do not regress the recent hard-rules / copy-variations work (`src/lib/hard-rules-*.ts`, `src/lib/prompts/variations.ts`, `src/app/api/*-variations`, `src/components/VariationsModal.tsx`).

## Repo orientation (read first)

- Next.js App Router + Tailwind (v4 `@theme` tokens in `src/app/globals.css`), TypeScript.
- Design tokens (relevant ones):
  - `--color-chrome: #f4f4ef` (the warm beige/gray we are removing as a page background)
  - `--color-canvas: #fafaf7` (near-white warm)
  - `--color-surface: #ffffff` (white)
  - `--color-line: #e2e8f0`, `--color-line-strong: #cbd5e1`, plus `shadow-card`
- App shell: `src/app/layout.tsx` — `<body className="h-full flex bg-chrome">` with `<AppNav />` (sidebar, already `bg-surface`) + `<div className="flex-1 ...">{children}</div>`.
- The pages in question:
  - Flows: `src/app/dashboard/flows/page.tsx`
  - Campaigns: `src/app/dashboard/campaigns/page.tsx`
  - Shared dashboard shell (date range + revenue tiles wrap both of the above): `src/app/dashboard/layout.tsx`
  - Reports: `src/app/reports/page.tsx` + `src/app/reports/layout.tsx`
  - Copy builder: `src/app/copy-builder/page.tsx`
  - Planner (the visual reference we are matching): `src/app/planner/layout.tsx` + `src/app/planner/page.tsx`
- Revenue data comes from `GET /api/klaviyo/overview?start=&end=` (`src/app/api/klaviyo/overview/route.ts`), typed in `src/app/dashboard/types.ts`, fetched once in `dashboard/layout.tsx` and shared to the child pages via `dashboard/dashboard-context.tsx` (`useDashboardData()`).

---

## Task 1 — Scope the revenue tiles to the active channel (flows vs campaigns)

### The problem
The Flows page and the Campaigns page show identical revenue numbers, which is wrong. The two revenue tiles ("Placed-order revenue (Klaviyo)" and "Klaviyo-attributed revenue") are rendered once in the **shared** `dashboard/layout.tsx` (around the `StatCell` / `KPIRow` block, currently using `revenue.total` and `revenue.attributed`), so both tabs display the same combined totals.

### The data you already have
`RevenueData` (in `src/app/dashboard/types.ts`) is already split by channel:
```ts
interface RevenueData {
  total: number;                     // placed-order revenue, ALL email (not channel-split)
  attributed: number;                // = attributed_from_flows + attributed_from_campaigns
  attributed_from_flows: number;     // flows-only, already computed in the overview route
  attributed_from_campaigns: number; // campaigns-only, already computed
  order_count: number;
}
```
The per-row arrays (`data.flows[]`, `data.campaigns[]`) each carry `revenue`, `recipients`, `opens`, `clicks`, and sum to `attributed_from_flows` / `attributed_from_campaigns` respectively. All of this is already scoped to the selected date range (the layout refetches `/api/klaviyo/overview` on range change).

### Required behavior
- On **Flows**, the attributed-revenue figure must be **flows-only** (`attributed_from_flows`), over the selected range.
- On **Campaigns**, it must be **campaigns-only** (`attributed_from_campaigns`), over the selected range.
- The two pages must never show identical revenue numbers (unless the underlying channel data genuinely coincides).
- Keep both existing tiles present in spirit ("Placed-order revenue" and "Klaviyo-attributed revenue"), just made channel-aware.

### Recommended implementation
Move the revenue tiles **out of the shared `dashboard/layout.tsx`** and **into each child page** (`flows/page.tsx` and `campaigns/page.tsx`), so each renders its own scoped tiles from `useDashboardData()`. Concretely:

- **Flows page** tiles:
  - Tile A — "Flow revenue (Klaviyo-attributed)" = `revenue.attributed_from_flows`.
  - Tile B — a flow-relevant secondary stat, e.g. "Share of placed-order revenue" = `attributed_from_flows / total`, or total flow recipients/orders. Pick whichever reads cleanly; label it accurately.
- **Campaigns page** tiles: the same shape but using `revenue.attributed_from_campaigns`.
- **Placed-order revenue (total, all email)** is NOT channel-split in the data. Keep it as ONE clearly-labeled, channel-neutral element (e.g. a small line or a single tile in the shared layout) worded so it is obviously "all email, both channels" and cannot be mistaken for a flows-only or campaigns-only number. Do **not** duplicate the same total onto both tabs as if it were channel-specific.

Reuse the existing `Card` / `KPIRow` / `StatCell` primitives and the `formatMoney` / `formatInt` / `formatPct` helpers (`src/app/dashboard/format.ts`) so the styling stays consistent.

> Decision point to confirm with the stakeholder (Tim): the true placed-order revenue cannot be attributed to flows vs campaigns from the current Klaviyo payload. If a channel-scoped placed-order number is actually wanted, that requires a new figure from the overview route (`src/app/api/klaviyo/overview/route.ts`) — flag this rather than inventing a split.

### Acceptance criteria
- [ ] Flows and Campaigns show different, channel-correct attributed revenue for the same date range.
- [ ] Changing the date preset (7d/30d/90d/custom) updates each page's figures.
- [ ] No hardcoded/duplicated totals; numbers derive from `useDashboardData()`.
- [ ] `npx tsc --noEmit` clean.

---

## Task 2 — Make the planner calendar fill the width

### The problem
On `/planner` (Calendar view) the calendar grid sits in a narrow left strip with dead white space to its right (see the stakeholder's red-marked screenshot). The planner shell is wide (`max-w-[110rem]` in `src/app/planner/layout.tsx`), but the calendar caps itself much narrower.

### The cause
In `src/app/planner/page.tsx`, the `CalendarView` container is capped at `max-w-6xl`:
```tsx
<div className="max-w-6xl bg-surface border border-line rounded-md shadow-card overflow-hidden">
```

### Required change
Let the calendar fill the available workspace width. Remove the `max-w-6xl` cap (or raise it to match the layout, e.g. `max-w-[110rem]` / `w-full`). The 7-column grid (`grid-cols-7`) and day cells (`min-h-[96px]`) will stretch to fill; verify the day pills and drag-and-drop still render correctly at the wider size, and that cells remain a sensible minimum height.

### Acceptance criteria
- [ ] Calendar view fills the workspace width with no large empty gutter on the right.
- [ ] Day cells and entry pills scale cleanly; nothing overflows or clips.
- [ ] Table view is unaffected.
- [ ] `npx tsc --noEmit` clean.

---

## Task 3 — White / elegant UI pass across all pages (match the planner)

### The goal
Replace the beige/gray page background (`bg-chrome`, `#f4f4ef`) with the clean white, hairline-structured look the planner already uses, across **Flows, Campaigns, Reports, and Copy Builder**. Structure should come from `border-line` hairlines, `shadow-card`, and whitespace — not from a gray page fill (this is exactly the pattern documented in the comment at the top of `src/app/planner/layout.tsx`).

### What to change (surfaces that currently show the gray page background)
1. **Dashboard shell** — `src/app/dashboard/layout.tsx`: the outer `<div className="flex-1 overflow-y-auto">` inherits the body's `bg-chrome`. Give it `bg-surface` (mirror `planner/layout.tsx`).
2. **Reports shell** — `src/app/reports/layout.tsx`: same change (`flex-1 overflow-y-auto` → add `bg-surface`).
3. **Copy builder** — `src/app/copy-builder/page.tsx`:
   - Outer wrapper `className="flex h-screen overflow-hidden bg-chrome"` → `bg-surface`.
   - The sticky top bar `className="... bg-chrome border-b border-line ..."` → `bg-surface` (so it doesn't read as a gray band on a white page).
   - Leave genuinely-functional gray fills that still make sense on white (segmented toggle track `bg-chrome`, `hover:bg-chrome` hovers, table sticky headers) — but review each; if any now looks like a stray gray block against white, switch it to `bg-surface`, `bg-canvas`, or a subtle border instead.
4. **Consistency check** — the `AppNav` sidebar is already `bg-surface`; keep it. Cards already use `bg-surface border border-line shadow-card`, so on a white page they still read as distinct surfaces via border + shadow. Confirm this holds; where two white surfaces meet with no separation, add a `border-line` hairline (the planner does this).

### Guidance
- Do NOT change the token values in `globals.css` (other things depend on `--color-chrome`); change the **page wrappers** to `bg-surface` instead. This is the same approach the planner took.
- Keep spacing containers consistent (`max-w-*`, `mx-auto`, `px-*`) with the planner/dashboard so the features feel like one product.
- Aim for "seamless and elegant": white canvas, thin `border-line` dividers, soft `shadow-card` on elevated blocks, accent (`--color-accent` indigo) used sparingly.

### Acceptance criteria
- [ ] Flows, Campaigns, Reports, and Copy Builder render on a white (`surface`) background, no beige page fill.
- [ ] Cards/tables remain visually distinct via hairlines + shadow, not a gray backdrop.
- [ ] No orphaned gray blocks (leftover `bg-chrome`) that look out of place on white.
- [ ] The planner still looks the same (it was already white).
- [ ] `npx tsc --noEmit` clean; a visual pass in the browser on each page.

---

## Final checklist
- [ ] `npx tsc --noEmit` passes.
- [ ] The recent hard-rules gate, deterministic checker, and copy-variations features still work (no imports or wiring broken).
- [ ] Screenshots (or a quick look) of Flows, Campaigns, Reports, Copy Builder, and Planner confirming: distinct per-channel revenue, full-width calendar, and the white/elegant look.
