# Build Brief — Lifecycle screen in the app (auto-refreshed, self-serve)

**For:** Claude Code, working in this repo.
**Goal:** A live `/lifecycle` page management can open to see the whole audience by lifecycle stage **and** today's ranked "cohorts to send," auto-refreshed daily — no presentation, no manual steps. Reuse the app's existing patterns; do not introduce new infra.

**Companion files (already in repo root):**
- `lifecycle-snapshot.seed.json` — real, computed snapshot (sizes from 24 months of Shopify orders). Ship this so the page renders live numbers immediately, before the daily job exists.
- `lifecycle_engine_master_spec.md` — the model/engine spec this sits on top of.

---

## Architecture — mirror the existing sync→store→read pattern

The dashboard already does exactly this: a **sync route writes a store**, the **page reads the store instantly** and shows a "last synced Xm ago" badge with a **Sync now** button and background polling (`src/app/dashboard/layout.tsx`, `/api/planner/sync`, `/api/metrics/sync`, `src/lib/storage.ts` `getAdapter`). Reuse it.

```
daily cron ─▶ POST /api/lifecycle/sync ─▶ recompute cohorts ─▶ lifecycle store: "snapshot.json"
                                                                      │
                          GET /api/lifecycle/snapshot ◀───────────────┘  (instant read)
                                          │
                                   /lifecycle page (client) ─ Send Today | Overview tabs
```

The per-customer scores come from the Phase-2 worker (order data → `src/lib/lifecycle/store.ts` fitted store). **Until the worker runs, seed `snapshot.json` from `lifecycle-snapshot.seed.json`** so the page is live now; the sync route recomputes from the store once populated.

---

## 1. Snapshot store + types

Write/read a single blob via the existing lifecycle store (`getAdapter(DATA_ROOT, "lifecycle")`, key **`snapshot.json`**). Seed it now with `lifecycle-snapshot.seed.json`'s contents. Shape (add to `src/lib/lifecycle/`):

```ts
export interface LifecycleCohort {
  id: string; title: string; color: string;
  size: number; assumed_response: number; aov: number; modeled_revenue: number;
  rule: string; why: string; pills: string[];
  recommendation: { message: string; offer: string };
  klaviyo_segment: string;
}
export interface LifecycleSnapshot {
  generated_at: string; source: "seed" | "worker"; model_version: string;
  currency: string; aov_basis: number; assumptions: string; total_audience: number;
  overview: {
    bands: { key: string; label: string; count: number; pct: number; color: string }[];
    tiles: { label: string; count: number; sub: string; color: string }[];
  };
  insight_next_best_product: { return_rate_pct: number; items: { label: string; pct: number }[] };
  cohorts: LifecycleCohort[];            // pre-sorted by modeled_revenue desc
  secondary_segments: { label: string; size: number; rule: string }[];
}
```

## 2. Routes (match existing route conventions + `/api/*` cookie gating)

- **`GET /api/lifecycle/snapshot`** — read store key `snapshot.json`; return the parsed `LifecycleSnapshot`. If absent, return `{ source: "empty" }` with 200. Instant, no Klaviyo call.
- **`POST /api/lifecycle/sync`** — recompute the snapshot from the per-customer lifecycle store (worker output): apply each cohort `rule` to derive `size` and member ids, compute `modeled_revenue = size × assumed_response × aov`, build `overview`/`insight`, set `generated_at = now`, `source:"worker"`, write `snapshot.json`. Guard with the **same secret/mechanism as `/api/metrics/sync` and `/api/planner/sync`** so the daily cron can call it (and the page's "Sync now" button). Until the store has data, it may no-op and leave the seed in place.
- **`GET /api/lifecycle/cohort/[id]/export`** — stream a CSV of member emails for a cohort (from the per-customer store). Disabled/410 until members exist.
- **`POST /api/lifecycle/cohort/[id]/create-list`** — via existing `klaviyoFetch`: `POST /api/lists` (name = cohort `klaviyo_segment`), then add members `POST /api/lists/{id}/relationships/profiles` in batches. Disabled until members exist. (Note: Klaviyo **lists** are pushable; **segments** are not — so the button creates a static list, consistent with `lifecycle_activation_design.md`.)

> Members (per-customer ids/emails) come from the Phase-2 worker store. For v1 with only the seed, render sizes and **disable** Create-list/Export with a tooltip ("available after the daily sync populates members"), or wire a toast. Don't fake member data.

## 3. Page — `src/app/lifecycle/page.tsx` (client component)

Follow `src/app/dashboard/layout.tsx` conventions: fetch `/api/lifecycle/snapshot` on mount into state, show `PageHeader` with title + a freshness badge from `generated_at` (reuse the `relSync` helper's logic) + a **Sync now** button (POST `/api/lifecycle/sync`, then re-read). Use `@/components/ui/*` (`Card`, `StatCell`, `Button`, `PageHeader`, `SegmentedToggle`, `toast`, `Skeleton`). Tailwind v4, match existing styling.

**Tabs** via `SegmentedToggle`: **Send Today** (default) and **Overview**.

**Send Today:** render `snapshot.cohorts` in order. Each cohort as a `Card`:
- title (in `color`), `why`, `pills`, a dashed recommendation block (`recommendation.message` + **Suggested offer:** `recommendation.offer`).
- right side: `StatCell` `modeled_revenue` (format money) labeled "modeled monthly opportunity", and `size` ("customers").
- actions: **Create Klaviyo list** / **Export CSV** (wired per §2; disabled state until members exist).
- Footer note = `snapshot.assumptions`.

**Overview:** a horizontal **distribution bar** from `overview.bands` (flex row, each segment width = `pct%`, `background:color`, label + count); a legend; **key-segment tiles** from `overview.tiles` (`Card`+`StatCell`); the **next-best-product** mini bar chart from `insight_next_best_product` (highlight "Earbuds again" — this is why the engine is replenishment-first); a methodology footnote. (This replaces the Kanban board — remove/retire the Kanban view.)

## 4. Nav + cron

- Add a **nav link to `/lifecycle`** wherever the app links its top-level areas (alongside Dashboard / Planner / Copy Builder).
- Add a **daily cron** (Vercel cron in `vercel.json`, or the existing scheduler used for metrics/planner) → `POST /api/lifecycle/sync` at ~05:00 ET, using the sync secret.

## 5. Data dependency (state plainly, don't hide)

The screen is only as fresh as the sync feed. The daily `sync` recomputes from the per-customer lifecycle store written by the **Phase-2 worker** (order-data ingestion → BG/NBD + ownership). Sequence: (1) ship page + routes + **seed** now → management sees real numbers today; (2) stand up the worker + schedule → `source` flips to `"worker"`, numbers refresh nightly, and Create-list/Export light up.

## 6. Acceptance criteria

- Opening `/lifecycle` shows the seed's real figures (911,466 audience; 5 ranked Send-Today cohorts; overview distribution) with no manual steps.
- Freshness badge reflects `generated_at`; **Sync now** re-reads the store; tabs switch without reload.
- Built with existing `@/components/ui/*`; passes `tsc`/lint; no new heavy deps.
- Kanban view removed; Send Today is the default tab of the lifecycle feature.

## Appendix — seed cohorts (already in `lifecycle-snapshot.seed.json`)

| Cohort | Size (real) | Modeled $/mo* | Rule |
|---|---|---|---|
| Reorder-Due · Earbuds | 98,075 | $666,910 | owns Earbuds AND last order 60–150d |
| At-Risk · Earbuds overdue | 147,303 | $500,830 | owns Earbuds AND last order 151–300d |
| Win-Back · lapsed 6–12mo | 303,770 | $387,307 | last order 181–365d |
| Cross-Sell · Earbuds→Headphones | 103,966 | $265,113 | owns Earbuds, not Headphones, ≤120d |
| New Customer · 2nd-order | 41,012 | $209,161 | 1 order, ≤45d |

*size × assumed response (8/4/1.5/3/6%) × $85 AOV. Sizes real; response rates placeholder until measured; cohorts overlap.
