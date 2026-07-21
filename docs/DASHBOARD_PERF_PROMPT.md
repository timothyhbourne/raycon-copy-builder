# Dashboard Performance Overhaul — sync-then-read architecture

You are fixing severe load-time problems in the `raycon-copy-builder` dashboard (Next 16, React 19, App Router, deployed on Vercel). Read `AGENTS.md` first — this is NOT the Next.js you know; verify conventions in `node_modules/next/dist/docs/` before writing code.

## The problem

`/dashboard` takes 20–60+ seconds to load. Root causes, confirmed in code:

1. `src/app/api/klaviyo/overview/route.ts` computes everything at request time: a **sequential** chain of 8+ Klaviyo API calls (timezone → metric → metric-aggregate → flow values report w/ pagination → campaign values report w/ pagination → full flows list → campaign metadata by id → draft campaigns → scheduled campaigns). Klaviyo report endpoints are slow and throttled (~1 req/s burst), and `klaviyoFetch` in `src/lib/klaviyo.ts` sleeps up to 30s on 429s. Latency stacks linearly.
2. The response cache is an in-memory `Map` (`overviewCache`) — on Vercel serverless each invocation may be a fresh process, so it almost never hits in production. The code's own comments acknowledge this.
3. The cache key is the exact `start_end` string — changing the range by one day is a full cold rebuild.
4. The UI (`src/app/dashboard/layout.tsx`) waits for the entire chain before rendering anything.

## Target architecture (how Klaviyo's own dashboard is fast)

Klaviyo precomputes aggregates continuously; reads hit a store. Copy that model:

- **A local daily metrics store**: per-day snapshots of flow/campaign performance, persisted to `data/metrics/` (file-backed JSON, matching the repo's existing store pattern — see `src/lib/reports/weekly-store.ts` and `src/lib/planner.ts` for the idiom).
- **A background sync** that pulls recent days from Klaviyo on a schedule (Vercel cron — the repo already does exactly this for weekly reports: see `vercel.json`, `src/app/api/reports/weekly/run/route.ts`, and the `CRON_SECRET` env var).
- **Instant reads**: the overview route answers any date range by summing local daily rows. No Klaviyo calls on the read path. Target: **< 500ms** response, UI paints immediately.
- **Freshness honesty**: every response carries `last_synced_at`; the UI shows "Synced 12m ago" with a manual "Sync now" that triggers the background sync (not an inline recompute).

### Why daily granularity works
Klaviyo's flow/campaign values reports accept an arbitrary `timeframe`. Recipients, opens_unique, clicks_unique, and conversion_value are additive across days, so per-day snapshots summed over a range equal the range report. The metric-aggregate for total placed-order revenue already returns per-day buckets (`interval: "day"`), so store those buckets directly.

### Attribution trailing (correctness rule)
A conversion can be attributed to a send days after the day being reported. Therefore:
- Days older than `RESYNC_WINDOW_DAYS = 14` are **frozen** — synced once, never re-fetched.
- Days within the window are **re-synced** on every sync run (cheap: ~3 calls per day).
This is the whole trick: history is immutable, only the trailing window costs API calls.

## Constraints

- Reuse `src/lib/klaviyo.ts` helpers as-is (`aggregateMetric`, `flowValuesReport`, `campaignValuesReport`, `fetchCampaignsByIds`, `fetchCampaignsByStatus`, `listFlows`, `dayRangeISO`, `getAccountTimezone`, `resolvePlacedOrderMetric`). You may ADD helpers (e.g. a single-day report variant); don't rewrite the client or its retry logic.
- Keep Klaviyo calls sequential *within* a sync run (rate limits). Never fan out report calls in parallel against the same endpoint.
- File-backed JSON store, same defensive read/backfill style as `src/lib/reports/weekly-store.ts`. Add a comment that this should move to SQLite/Postgres if it outgrows single-process.
- No new dependencies.
- Don't change the response shape the dashboard UI consumes (`OverviewData` in `src/app/dashboard/types.ts`) beyond ADDING freshness fields — the flows/campaigns pages must keep working untouched.
- All secrets stay server-side. Sync routes must be protected: cron header check via `CRON_SECRET` (copy the weekly-report route's auth), UI-triggered sync goes through the existing basic-auth'd app.
- IMPORTANT (Vercel): the filesystem is read-only at runtime except `/tmp`, and writes don't persist across invocations. Check how the weekly report store handles persistence in production (see `src/lib/reports/weekly-store.ts` and its deploy notes) and follow the same approach. If file persistence is not viable in production, say so explicitly in your summary and structure the store module behind an interface so a KV/Postgres adapter can drop in — do NOT silently ship a store that loses data on Vercel.

---

## Step 0 — Instrument first (small, do not skip)

In `src/app/api/klaviyo/overview/route.ts`, wrap each external call with timing and, when `?debug=1`, include a `timings_ms` map in the debug payload (aggregate, flow_report, campaign_report, flows_list, campaign_meta, drafts, scheduled, total). Also `console.log` the total. This proves where time goes and lets us verify the win afterward. Commit separately.

## Step 1 — Quick wins on the existing read path (ship value before the rearchitecture)

1. **Parallelize across different endpoint families.** Klaviyo rate-limits per endpoint family, so these groups can run concurrently with `Promise.all` while keeping each family sequential internally:
   - Group A: metric-aggregate
   - Group B: flow values report (then flows list)
   - Group C: campaign values report (then campaign metadata by ids, then drafts, then scheduled)
   Timezone + metric resolution stay first (they're O(1)/cached). Verify with the Step 0 timings that total ≈ max(groups) instead of sum(all). If 429s appear in testing, drop back to two groups (reports together sequentially, metadata parallel).
2. **Persist the response cache to disk** (`data/cache/overview/{start}_{end}.json`, same TTL semantics) so warm loads survive process restarts. Keep the in-memory Map as L1.
3. **Auto-load + stale-while-revalidate in the UI** (`src/app/dashboard/layout.tsx`): load the default 30-day range on mount (no more "click Load" empty state); if a disk/memory cache entry exists but is expired, return it immediately with `stale: true` and let the UI show it while re-fetching fresh data in the background (fetch again with `nocache=1`, swap in when it lands, show a subtle "refreshing…" indicator).

Commit. This alone should cut perceived load dramatically. Then build the real fix:

## Step 2 — Daily metrics store

Create `src/lib/metrics/store.ts`:

- Layout: `data/metrics/daily/YYYY-MM-DD.json`, each file:
  ```json
  {
    "date": "2026-07-08",
    "synced_at": "2026-07-09T03:00:00Z",
    "frozen": false,
    "revenue": { "total": 0, "order_count": 0 },
    "flows": [ { "flow_id": "", "recipients": 0, "opens": 0, "clicks": 0, "revenue": 0 } ],
    "campaigns": [ { "campaign_id": "", "recipients": 0, "opens": 0, "clicks": 0, "revenue": 0 } ]
  }
  ```
- Plus `data/metrics/dimensions.json`: flow names/statuses, campaign metadata (name, status, send_time, audience_count), draft + scheduled campaign lists, account timezone, and a top-level `synced_at`. Dimensions are global, not per-day.
- API: `readDay(date)`, `writeDay(snapshot)`, `readRange(startYMD, endYMD)` (returns found days + list of missing dates), `readDimensions()`, `writeDimensions()`. Defensive parsing throughout (missing/corrupt file → treated as missing day, never a crash).

## Step 3 — Sync engine

Create `src/lib/metrics/sync.ts` with `syncMetrics(opts: { backfillDays?: number })`:

1. Resolve timezone + placed-order metric (existing helpers).
2. Determine days to sync: all days in the trailing `RESYNC_WINDOW_DAYS` (default 14) + any missing (never-synced) days within `backfillDays` (default 60) — capped at `MAX_DAYS_PER_RUN` (default 20, oldest-missing first) so a single run never blows up on rate limits or serverless timeouts.
3. For the **whole span being synced in this run**, make ONE metric-aggregate call with `interval: "day"` and write each day's revenue bucket — do not call per-day.
4. Per day needing flow/campaign data: one `flowValuesReport` + one `campaignValuesReport` with that day's `dayRangeISO` timeframe. Sequential, in date order.
5. Refresh dimensions once per run: `listFlows`, `fetchCampaignsByIds` (ids = all campaign ids present in the synced days that lack metadata), `fetchCampaignsByStatus("Draft")` + `("Scheduled")`.
6. Mark days older than the resync window `frozen: true`; skip frozen days on future runs.
7. Return a summary `{ days_synced, days_failed, api_calls, duration_ms, warnings }`. A single day failing must not abort the run (record a warning, continue).

Expose it via:
- `src/app/api/metrics/sync/route.ts` — POST, dual auth: valid `CRON_SECRET` header (copy the weekly-run route's check) OR an already-authenticated app session. Accepts optional `{ backfill_days }`.
- Add a Vercel cron entry in `vercel.json` (every 30 minutes) following the existing weekly-report cron pattern exactly.
- Add npm script `sync:metrics` → a small `scripts/sync-metrics.ts` (tsx, like the existing ingest scripts) for local/manual backfill: `npm run sync:metrics -- --backfill=90`.

## Step 4 — Rewire the overview route to read from the store

Rework `src/app/api/klaviyo/overview/route.ts`:

1. `readRange(start, end)` + `readDimensions()` from the store. **Zero Klaviyo calls.**
2. Aggregate daily rows into the existing response shape (same math as today: sum per flow/campaign across days, compute revenue_per_recipient, filter zero-activity rows, sort by revenue; headline totals from the daily revenue buckets; attributed = flow + campaign conversion sums; draft/scheduled/sent sections from dimensions).
3. Add to the response: `last_synced_at` (min synced_at across returned days, or dimensions' if newer... use the OLDEST so the UI never overstates freshness), `missing_days: string[]`, `coverage: { requested_days, found_days }`.
4. If some or all requested days are missing (never synced): return what exists plus `missing_days`, and fire-and-forget an internal sync trigger for those days (do not await it; guard with a simple in-flight flag so concurrent requests don't stampede).
5. Keep `?debug=1` working: include per-day coverage and the Step 0 timing map (which should now show ~0 external time).
6. Delete the in-memory Map and the Step 1 disk response cache — the store replaces both. Keep `?nocache=1` as an alias that triggers a sync of the requested range's unfrozen days and then re-reads (this is the "Force refresh" path; it may be slow, that's fine and expected — label it accordingly).

## Step 5 — UI freshness (`src/app/dashboard/layout.tsx`)

1. Auto-load on mount (if not already done in Step 1). Data now arrives in <1s.
2. Replace "Loaded at / cached at" with: `Synced 12m ago` (relative, from `last_synced_at`), amber-tinted when > 60m, plus a "Sync now" button that POSTs `/api/metrics/sync`, shows a spinner, then re-fetches the overview.
3. If `missing_days` is non-empty, show a small notice: "N days in this range haven't been synced yet — totals may be incomplete. Syncing in background…" and poll the overview every 10s (max 6 attempts) until coverage is complete or attempts exhausted.
4. Remove the old Load/Force refresh buttons in favor of: range change → instant fetch from store; "Sync now" → explicit freshness pull.

## Step 6 — Verify

1. `npm run build` passes.
2. Local: run `npm run sync:metrics -- --backfill=35`, then hit `/api/klaviyo/overview?start=<30d ago>&end=<today>&debug=1` — confirm `timings_ms.total` < 500ms and zero Klaviyo calls on the read path.
3. Correctness: for a 7-day window, compare store-derived totals against a direct one-off range report (write a temporary `scripts/verify-metrics.ts` that runs both and diffs; flows + campaigns revenue/recipients/opens/clicks must match within rounding; attributed revenue drift on recent unfrozen days is acceptable and should be noted, not failed). Report the diff in your summary, then delete or keep the script under scripts/ (keep — it's useful).
4. Confirm the sync route 401s without `CRON_SECRET`/session, and that a sync run's api_calls count for a steady-state run (14 window days, no backfill) is ≈ 1 aggregate + 28 report calls + ~4 dimension calls.
5. State explicitly in your final summary whether the file store persists on Vercel (per the Step 2 investigation) and what the production persistence story is.

## Commit order

One commit per step (0–5), verification notes in each message. If you must deviate from any instruction (e.g. Klaviyo rejects a per-day timeframe, Vercel persistence is impossible), stop and explain the deviation and your chosen alternative in the summary rather than improvising silently.
