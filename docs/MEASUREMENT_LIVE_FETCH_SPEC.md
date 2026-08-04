# Measurement Section — Live-On-Demand Rebuild Spec

**Status:** Ready to implement
**Area:** Dashboard / Measurement (`/dashboard`, `/dashboard/campaigns`, `/dashboard/flows`)
**Goal:** Replace the current background "sync-then-read" data model with a **live, on-demand fetch + per-session cache** model. No background sync, no cron, no disk snapshot store, no coverage polling, no partial/incomplete results.

**Decisions locked (do not re-litigate):**
1. **Session cache is client-side, per user** — in memory, keyed by date range, surviving tab switches (and optionally a refresh via `sessionStorage`). No shared server cache.
2. **Remove the old sync system entirely** — delete the background sync engine, the daily Vercel cron, the disk snapshot store, and the sync API route. The dashboard becomes 100% live.
3. **Keep a manual Refresh button** — re-fetches the range on screen, bypassing the session cache.

---

## 1. Why we're doing this

The current model (`src/lib/metrics/sync.ts` + `src/lib/metrics/store.ts` + `src/app/api/klaviyo/overview/route.ts`) pre-fetches per-day snapshots to disk on a cron and on background triggers, then the read route sums them. In practice this causes the two things the user hates:

- **Inaccuracy:** the read route returns *incomplete* totals when days aren't synced yet (`missing_days`), and the freeze window means trailing conversions after a day freezes are never corrected. The number on screen is often "whatever has synced so far," not the truth.
- **Slowness for no reason:** Klaviyo's reporting quota (burst ~1/s, steady ~2/min) throttles the day-by-day sync, so gaps fill slowly while the UI polls every 10s (`MAX_POLLS`), and on Vercel's read-only filesystem the disk store doesn't even persist between invocations.

**Key realization:** the sync engine already fetches an entire date range from Klaviyo in ~3 reporting calls (revenue aggregate + flow values + campaign values). We are throwing away the caching/freezing/snapshot machinery and simply **returning those live results directly** for the exact range requested. On-demand is *simpler* than what exists today, not harder.

---

## 2. Target behavior (the user's spec, precise)

1. **Open the measurement section (Campaigns tab).** On load, immediately fetch **month-to-date** (1st of the current month → today) live from Klaviyo. Show a loading state while it fetches.
2. **Loading state:** clear the content area entirely and show a tasteful loading animation with a short message like *"Pulling this range from Klaviyo — this can take a few seconds."* It's acceptable for a live fetch to take a few seconds.
3. **Custom range:** the user picks a range on a **single draggable range calendar** (see §6) — e.g. drag June 1 → June 12. On apply, clear the screen, show the loading state, fetch that range live, then render.
4. **Session cache:** every range fetched this session is kept (starting with the initial month-to-date). Re-selecting a range already fetched this session renders **instantly** from cache — no refetch, no loading state. Selecting a range **not** yet fetched shows the loading state and pulls it live.
5. **No background sync, no polling, no "syncing in background" notices, no partial data.** A range either shows complete live data, the loading state, or a clear error with a retry.
6. **Refresh button:** re-fetches the current range live and overwrites its cache entry (for when someone wants the very latest numbers).

Both the Campaigns and Flows tabs share the same range, the same fetch, and the same session cache (they already share one fetch via the dashboard layout + context — keep that).

---

## 3. Ground rules

1. **Next.js 16, not the one in your training data.** Middleware is `proxy` (`src/proxy.ts`); read `node_modules/next/dist/docs/` before touching routing/config. Don't reintroduce a cron.
2. **Keep TypeScript `strict`.** No `any`, no `@ts-ignore`.
3. **Reuse existing building blocks.** The Klaviyo client (`src/lib/klaviyo.ts`), the `DateRangePicker` component, the `OverviewData` consumer shape, the `ui/` primitives (`Skeleton`, `Card`, `Button`, `toast`), and the dashboard context all stay. This is a rewire, not a greenfield.
4. **Secrets stay server-side.** All Klaviyo calls happen in the route handler, never the client.
5. **Preserve the child-page contract.** `/dashboard/campaigns` and `/dashboard/flows` read `OverviewData` from `useDashboardData()`. Keep that shape working (minus the sync-only fields we remove in §7) so those pages need minimal changes.

---

## 4. New server route: live range fetch

Create **`src/app/api/klaviyo/measure/route.ts`** (a `GET`; you may instead rewrite `klaviyo/overview/route.ts` in place and keep the path — pick one and be consistent. This spec assumes a new `/api/klaviyo/measure` and deleting `overview`).

**Contract:**
- `GET /api/klaviyo/measure?start=YYYY-MM-DD&end=YYYY-MM-DD`
- Validate both params (reuse the `YMD_RE` pattern already in the codebase); `400` if missing/malformed or if `start > end`.
- Makes live Klaviyo calls for **exactly** this range and returns the fully-aggregated `OverviewData` (§7). Never returns partial data; on upstream failure return `{ error }` with a `500` (or a `429`-style "rate limited, try again" message — see §5).
- `export const dynamic = "force-dynamic";` and `export const maxDuration = 60;` (a live range needs headroom for rate-limit back-off; 60s is plenty for 3 reporting calls and comfortably under interactive patience).

**Implementation — port the aggregation from the old sync/overview, minus the storage:**

Reuse these existing `src/lib/klaviyo.ts` functions (all already implemented and quota-aware):
- `getAccountTimezone()` — day boundaries in the account tz (cached after first call).
- `resolvePlacedOrderMetric()` → `placedId` (cached after first call).
- `dayRangeISO(start, end)` → `{ start, end }` ISO bounds for the range.
- `aggregateMetric({ metricId: placedId, start, end, measurements: ["sum_value","count"], timezone })` → range **revenue total + order count**. (No `interval` needed — we want the range total, not per-day buckets. This is a simplification over the sync engine.)
- `flowValuesReport({ start, end, conversionMetricId: placedId })` → per-flow totals for the range.
- `campaignValuesReport({ start, end, conversionMetricId: placedId })` → per-campaign totals for the range.
- `fetchCampaignsByIds(ids)` → names/send_time for campaigns that appear in the values report.
- `listFlows()` → flow names/statuses.
- `fetchCampaignsByStatus("Draft")` / `fetchCampaignsByStatus("Scheduled")` → the draft/scheduled subsections.

**Aggregation logic** (lift directly from the current `klaviyo/overview/route.ts` GET body — it already does this exact folding):
- Sum flow rows into `FlowRow[]` (join names from `listFlows`, compute `revenue_per_recipient`, drop zero-activity rows, sort by revenue desc).
- Sum campaign rows into `CampaignRow[]` (join metadata from `fetchCampaignsByIds`, same treatment).
- Headline `revenue`: `total` + `order_count` from the aggregate; `attributed_from_flows` = Σ flow revenue; `attributed_from_campaigns` = Σ campaign revenue; `attributed` = their sum.
- `campaign_status`: `draft` and `scheduled` from the status fetches; `sent` = the in-range campaigns with activity.

**Important simplification vs. the old engine:** because there is no per-day store, campaigns no longer need to be "bucketed onto their send date." We take each campaign's **totals over the requested range** straight from `campaignValuesReport`. This is simpler and more accurate for range views. Delete all send-date-bucketing logic.

**Do NOT port from the old system:** freezing, `RESYNC_WINDOW_DAYS`, backfill horizons, `MAX_SPAN_DAYS` snapshot caps, `missing_days`, coverage, `synced_at`, concurrency coalescing, `writeDay`/`writeDimensions`, the `nocache` param, or any `syncMetrics` call.

---

## 5. Rate limits, latency, and the honest tradeoff

This is the one real cost of going live, and the spec must handle it deliberately:

- An uncached range costs ~**3 reporting calls** (aggregate + flow values + campaign values). Klaviyo reporting quota is ~1/s burst, ~2/min steady. Three sequential calls usually fit the burst; a cold spell or back-to-back uncached ranges can hit the 2/min wall and incur a ~30s wait.
- `klaviyoFetch` already implements patient 429 back-off with `patientThresholdS` / `maxRetryDelayMs`. For this interactive route, allow a patient wait up to ~45s so a single range reliably completes, but surface a clear, friendly error if Klaviyo is hard-throttling: *"Klaviyo is rate-limiting us right now — give it a moment and hit Refresh."*
- **The session cache is what makes this feel fast:** repeat views of a range are instant, and most sessions revisit a handful of ranges. First-touch of a brand-new range is the only slow path, and the loading UX sets that expectation.
- Fetch the 3 reporting calls **sequentially** (not parallel) to stay friendly to the burst quota; the metadata/list calls (`listFlows`, `fetchCampaignsByStatus`, `fetchCampaignsByIds`) are on separate, more generous quotas and can run after.

State this tradeoff in the PR description so no one is surprised that a never-seen range takes a few seconds.

---

## 6. Range calendar UX (fix the picker)

**Problem today:** the dashboard layout uses two raw `<input type="date">` controls (Start / End) plus a `7d/30d/90d/custom` segmented toggle. The user wants a single draggable range calendar.

**Good news:** `src/components/ui/DateRangePicker.tsx` already is a custom, token-styled, single-popover range calendar with click-start → click-end selection, in-range highlighting, a presets rail (Today / Last 7 / 30 / 90 days), keyboard access, and it emits `(start, end)` as `YYYY-MM-DD`. It just isn't wired into the dashboard.

**Change:**
1. **Adopt `DateRangePicker` in the dashboard** in place of the two native inputs and the custom-toggle. Wire its `onChange(start, end)` to the range state + fetch.
2. **Add "drag" feel** to `DateRangePicker`: on pointer-down on a start day and move, preview the range under the cursor (hover/drag highlight to the day currently under the pointer), commit on pointer-up. Keep the existing click-start/click-end behavior as a fallback for keyboard and simple clicks. The visual "in-range" styling already exists (`bg-accent-50`); extend it to follow a hover/drag end-day preview before commit.
3. **Add a "Month to date" preset** to the picker's presets rail (1st of current month → today) and make it the default selection on mount.
4. Keep quick presets available (Month to date, 7d, 30d, 90d) — they're just shortcuts that set the range; each still flows through the same fetch/cache path.
5. Do not fire a fetch on every in-progress drag day — only when the range is **committed** (pointer-up / end-date click / preset click).

---

## 7. Client rewrite: dashboard layout + session cache

All of this lives in **`src/app/dashboard/layout.tsx`** (it owns the range state and the single fetch shared via `DashboardDataProvider`).

**Session cache:**
- Hold a cache in a ref/state: `Map<string, OverviewData>` keyed by `` `${start}..${end}` ``.
- Optionally hydrate/persist to `sessionStorage` under one key so a refresh within the session keeps warm ranges (per the client-side decision). If you use `sessionStorage`, guard for its absence and cap the number of stored ranges (e.g. last 20) to avoid unbounded growth.
- **This is NOT `localStorage`** and NOT a server store — session-scoped only.

**Load flow (`loadRange(start, end, { force })`):**
1. Compute `key = start..end`.
2. If `!force` and cache has `key` → set `data` from cache **instantly**, no loading state. Done.
3. Else → set a `loading` flag, **clear the content** (`data = null` so the content area shows the loading animation, not stale rows), fetch `/api/klaviyo/measure?start&end`.
4. On success → store in cache under `key`, set `data`, clear loading.
5. On error → clear loading, show the error card with a Retry action (Retry calls `loadRange(start, end, { force: true })`).

**On mount:** default range = **month-to-date**; call `loadRange(mtdStart, today)`. (Replaces the current `daysAgo(30)` default and the `useEffect(() => { load() }, [])`.)

**On range change (picker commit / preset):** set range state and call `loadRange`.

**Refresh button:** replaces "Sync now." Calls `loadRange(start, end, { force: true })`. Label it "Refresh"; spin the icon while loading.

**Remove entirely from the layout:**
- The 10s coverage polling `useEffect` and `MAX_POLLS` / `pollAttempts`.
- The `missing_days` coverage-notice block and the "syncing in background" messaging.
- The `syncNow` function and the `/api/metrics/sync` call.
- The store-freshness indicator based on `last_synced_at`. Replace with a simple *"Showing live data · fetched HH:MM"* stamp from a client-side `fetched_at` timestamp recorded when a range is fetched (store it alongside the cached entry).
- The two native `<input type="date">` controls and the `custom` toggle branch.

**Loading animation:** when `loading && data === null`, render a centered loading state in the content area (reuse `Skeleton` for the tiles/table, or a small branded spinner) with the message from §2.2. Keep it calm and on-brand; nothing frantic. (See the visual/UX note in §9.)

---

## 8. Data model + files

### 8.1 `src/app/dashboard/types.ts`
- Keep: `RevenueData`, `FlowRow`, `CampaignRow`, `CampaignMeta`, `CampaignStatus`.
- `OverviewData`: **remove** the sync-era fields `last_synced_at`, `missing_days`, `coverage`, `served_from_cache`, `cache_age_seconds`, `stale`. **Add** `fetched_at: string` (ISO, set by the client when it caches a range) and keep `range: { start; end }` and `warnings: string[]` (still useful for e.g. truncation notices from the values reports).

### 8.2 Create
- `src/app/api/klaviyo/measure/route.ts` — the live route (§4).

### 8.3 Delete (per the full-teardown decision)
- `src/lib/metrics/sync.ts` (sync engine).
- `src/lib/metrics/store.ts` (disk snapshot store) — **but first confirm no other consumer** (see §8.4).
- `src/app/api/metrics/sync/route.ts` (sync API route).
- `src/app/api/klaviyo/overview/route.ts` (old read route) — replaced by `measure`.
- The `/api/metrics/sync` cron entry in `vercel.json` (leave the other crons intact).
- Remove `/api/metrics/sync` from `SELF_PROTECTED_PATHS` in `src/proxy.ts`.
- The seed/verify scripts tied to the metrics store: `scripts/sync-metrics.ts`, `scripts/verify-metrics.ts`, and the `sync:metrics` entry in `package.json`. The `data/metrics/` directory and its gitignore entry can go too.

### 8.4 Check before deleting `metrics/store.ts`
Grep first: `grep -rn "metrics/store" src`. Current known importers are the overview route (being deleted) and the validation layer (`src/lib/validation/schemas.ts`, `src/lib/validation/index.ts`, which import the `DaySnapshot`/`Dimensions` **types**). Remove those type references / validators too, since the snapshots no longer exist. Confirm nothing else (planner, weekly reports, lifecycle) reads it — the planner and weekly report use Northbeam and their own stores, so they should be unaffected, but verify.

---

## 9. Visual / UX note (optional but recommended)

For the loading state, keep it honest and calm (this is a business dashboard, not a game): a centered spinner or a shimmer over the tile/table skeletons, plus one line of copy: *"Pulling this range from Klaviyo — this can take a few seconds."* Avoid jokey microcopy here; management uses this. If you want a slightly richer treatment, animate the existing `Skeleton` blocks the layout already renders on first load.

---

## 10. Acceptance criteria

- Opening `/dashboard/campaigns` cold shows the loading state, then **month-to-date** live data. No "syncing in background" message ever appears.
- Selecting a custom range via the draggable calendar clears the screen, shows the loading state, then shows complete live data for exactly that range.
- Re-selecting a range already viewed this session renders **instantly** with no network call (verify in the network tab).
- Selecting a not-yet-viewed range shows the loading state and issues one `GET /api/klaviyo/measure` call.
- The **Refresh** button re-fetches the current range (network call fires) and updates the cache.
- There is **no** cron hitting metrics sync, **no** `/api/metrics/sync` route, **no** disk snapshot store, and **no** 10s polling loop anywhere in the dashboard.
- `grep -rn "syncMetrics\|missing_days\|metrics/store\|metrics/sync" src` returns nothing (except this spec / historical docs).
- `npm run build`, `npm run typecheck`, and (if present) `npm run lint` all pass.
- Numbers reconcile: the range total equals the sum of what the old force-refresh path produced for a fully-synced range (spot check one range against Klaviyo's own dashboard for the same window).

---

## 11. Out of scope / do not touch

- The Klaviyo client's fetch/back-off internals (`klaviyoFetch`) — reuse as-is; only tune the patience options passed in.
- Planner Northbeam revenue, weekly reports, promotions — different data paths; leave them alone.
- The attribution model / metric resolution logic — unchanged.
- Do not add a database or a server-side cache in this pass (client session cache only, per the locked decision).
- Do not change the Campaigns/Flows table columns or the `RevenueData`/`FlowRow`/`CampaignRow` shapes beyond the `OverviewData` field trims in §8.1.
