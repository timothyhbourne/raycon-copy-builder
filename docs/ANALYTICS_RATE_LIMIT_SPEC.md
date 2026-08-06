# Analytics Rate Limiting — Root Cause & Permanent Fix

**Status:** Ready to implement
**Area:** Measurement (`src/lib/measure.ts`, `/api/klaviyo/measure`, `/api/dashboard/briefing`, `/api/planner/sync`, `src/lib/reports/recipients.ts`, `src/lib/klaviyo.ts`)
**Goal:** Stop hitting Klaviyo's rate limits — permanently — by fixing the actual cause rather than adding more retry patience.

**Read §1–§3 before writing any code.** The fix only works if the root cause is understood; several "obvious" solutions here make things worse.

---

## 1. The verified constraint

Klaviyo rate-limits **per account**, using two fixed windows (burst = 1 second, steady = 1 minute), plus a **daily cap**. The reporting endpoints this app depends on are among the tightest tiers. For **Query Campaign Values** (`/campaign-values-reports/`):

> **Burst: 1/s · Steady: 2/min · Daily: 225/day**

Flow Values is in the same tight family. This is not negotiable, not raiseable by retrying, and shared across *everything* — every feature, every user, every environment (local dev and production draw from the **same account budget**).

**Implication:** the entire app gets roughly **2 reporting calls per minute**, account-wide. Any design that spends more than that on a single user action is guaranteed to 429.

---

## 2. Root cause

### 2.1 The primary cause: there is no shared server-side cache

The measurement rebuild (`MEASUREMENT_LIVE_FETCH_SPEC.md`) deliberately deleted the on-disk snapshot store and replaced it with a **client-side, per-session cache** in the dashboard layout. That decision — made in that spec, and it is the wrong one at this quota — is the root cause. Consequences:

- The cache lives in **one browser tab**. A refresh, a new tab, an incognito window, or a **second person** (management — the exact intended audience) all start cold and re-fetch byte-identical data.
- Nothing is shared between users or across serverless instances. Two managers viewing month-to-date = double the calls for identical numbers.
- Historical ranges are **immutable** (June 1–12 will never change) yet are re-fetched from scratch every single time anyone looks at them.

At 2 reporting calls/min, a cache that doesn't survive a page refresh is not a cache.

### 2.2 Each range view costs ~9 calls, 2 of them on the tightest quota

`fetchRangeOverview()` in `src/lib/measure.ts` issues, per uncached range:

| Call | Endpoint family | Quota pressure |
|---|---|---|
| `getAccountTimezone()` | accounts | low (per-process cached, but see §2.4) |
| `resolvePlacedOrderMetric()` | — | **0 calls** (pinned by default/env) ✅ |
| `aggregateMetric()` | metric-aggregates | moderate |
| `flowValuesReport()` | **reporting** | **TIGHT (2/min)** |
| `campaignValuesReport()` | **reporting** | **TIGHT (2/min, 225/day)** |
| `listFlows()` | flows | moderate |
| `fetchCampaignsByIds()` | campaigns | moderate (can paginate) |
| `fetchCampaignsByStatus("Draft")` | campaigns | moderate |
| `fetchCampaignsByStatus("Scheduled")` | campaigns | moderate |

So **one** dashboard load spends the account's entire per-minute reporting budget.

### 2.3 The briefing doubles it, instantly

`/api/dashboard/briefing` calls `fetchRangeOverview()` for the **prior window** (`src/app/api/dashboard/briefing/route.ts`). So: open the dashboard (2 reporting calls) → click "Brief me" (2 more) = **4 reporting calls within seconds against a 2/min steady limit**. This reliably 429s. It is the single most likely trigger of the errors being seen.

### 2.4 Serverless resets the in-process caches

`metricIdCache` and `accountTzCache` in `src/lib/klaviyo.ts` are module-level (per-process). On Vercel, cold invocations start empty, so the timezone gets re-fetched repeatedly. Minor per call, but it adds avoidable load and, worse, in-process caches create the *illusion* of caching while providing almost none in production.

### 2.5 Four independent features hit the same endpoints with no coordination

- `/api/klaviyo/measure` → `fetchRangeOverview` (2 reporting calls)
- `/api/dashboard/briefing` → `fetchRangeOverview` for the prior window (2 more)
- `/api/planner/sync` → `campaignValuesReport` (has a 10-min **in-process** cache — ineffective on serverless)
- `src/lib/reports/recipients.ts` (weekly report) → `campaignValuesReport` + `flowValuesReport`

There is **no global budget, no coordination, and no shared cache** between them. They collide and each one's 429 is caused by the others.

### 2.6 Request coalescing was deleted

The old sync engine had single-flight dedupe (`pendingByKey`). The rebuild removed it. Now two simultaneous identical requests each issue their own upstream calls.

### 2.7 Metadata is re-fetched every view

`listFlows`, Draft, and Scheduled campaign lists change slowly (hourly at most) but are fetched on every single range view — ~4 of the ~9 calls, for data that could be cached for an hour with zero loss of accuracy.

### 2.8 Throttling surfaces as a hard failure

`klaviyoFetch` throws when `Retry-After` exceeds the interactive threshold (30s). Since the steady window's `Retry-After` is often ~30–60s, the user sees an error instead of slightly-stale-but-correct numbers — even when perfectly good cached data exists.

### 2.9 What is NOT the cause (do not "fix" these)
- **Not** insufficient retry patience. More waiting doesn't create quota; it just moves the failure.
- **Not** a missing per-day snapshot store. Reverting to the old sync engine reintroduces the inaccuracy and slowness that were correctly removed. **Do not rebuild it.**
- **Not** a code bug in `measure.ts` — its 3-sequential-reporting-calls design is already efficient *per fetch*. The problem is **how often identical fetches happen**.

---

## 3. Design constraint that shapes the solution

**Range totals are not decomposable into days.** The old system cached per-day and summed, which required campaign send-date bucketing (and `campaign-series-reports` 404s on this account). That is exactly the complexity/inaccuracy that was removed. Therefore:

> **Cache whole ranges, keyed by range. Do NOT cache per-day and recompose.**

The revenue aggregate *could* be day-bucketed, but campaign/flow values cannot — so keep one consistent range-keyed model. A future optimization may add day-level revenue caching, but never for campaign/flow values.

---

## 4. The fix — five layers

Implement in order. Layer 1 alone eliminates the large majority of the problem.

### Layer 1 — Shared server-side cache in Redis (the actual fix)

Create **`src/lib/measure-cache.ts`**. The storage seam (`src/lib/storage.ts` → `getAdapter(root, "measure")`) already gives durable, multi-instance Redis. Wrap `fetchRangeOverview`:

- **Key:** `overview:v1:${startYMD}..${endYMD}` (add `:channel` etc. only if the payload varies by it). Version the prefix so the shape can be invalidated.
- **TTL by mutability** — this is the key insight:
  - **Range fully in the past** (`end < today` in account timezone) → the data is **immutable apart from late-attributing conversions**. TTL **7 days** (or effectively permanent). June 1–12 is fetched **once, ever**.
  - **Range includes today** → TTL **15 minutes** (tunable via env). Today's numbers move; 15 minutes is plenty fresh for a marketing dashboard.
  - **Range ends within the last ~3 days** → TTL **1 hour** (trailing conversions still land).
- **Store** the full `RangeOverview` payload plus `fetched_at`.
- Every consumer (`measure` route, briefing's prior window, and — see Layer 4 — planner sync and weekly recipients) goes through this wrapper. **No caller may call `fetchRangeOverview` directly.**

Effect: identical range = **one** upstream fetch, shared by every user, surviving refreshes, new tabs, and cold starts. The briefing's prior window is almost always already warm (it's a past range → long TTL).

### Layer 2 — Stale-while-revalidate + serve-stale-on-throttle

- On a cache hit within TTL → serve immediately, zero upstream calls.
- On a hit **past** TTL → serve the stale payload **immediately**, and trigger at most one background refresh (subject to Layer 3's budget). Never make the user wait for a refresh of data we already have.
- On a **miss** → fetch live (current behavior, with the loading state).
- **On a 429 with any cached entry present (even expired) → serve the stale entry** with its `fetched_at`, and surface a small "as of {time} — Klaviyo is rate-limiting, showing last known figures" note. Hard-fail **only** when there is nothing cached at all.
- Keep the client-side session cache as an L1 in front of this (it's still useful) — the Redis layer is L2 and the real fix.

### Layer 3 — One global reporting budget (Redis token bucket)

Create **`src/lib/klaviyo-budget.ts`**: a small Redis-backed counter/limiter that **all** reporting-endpoint calls must pass through, so the whole app draws from one account-wide budget instead of four features competing.

- Track the tight tier: ~1/s burst, ~2/min steady, and a **daily counter** against the 225/day cap.
- Before a reporting call, acquire a slot; if unavailable, either wait briefly (background jobs) or immediately fall back to stale cache (interactive requests — never block a user for a minute).
- Add **single-flight coalescing** (restore what §2.6 removed): concurrent identical range requests share one upstream fetch. Use a short-lived Redis lock keyed by the cache key, with in-process dedupe as a fast path.
- **Log daily usage** so budget consumption is visible (§6).

### Layer 4 — Cache metadata separately, and route every consumer through the cache

- **Metadata cache** (`listFlows`, Draft/Scheduled campaign lists, `fetchCampaignsByIds` results): Redis, TTL **1 hour**. Removes ~4 of the ~9 calls per view.
- **Timezone + metric id:** cache in Redis (not just per-process) with a long TTL, or pin the timezone via env. Fixes §2.4.
- **Planner sync** (`/api/planner/sync`): replace its 10-min in-process report cache with the shared Redis cache so it stops duplicating `campaignValuesReport` work the dashboard already did.
- **Weekly report** (`src/lib/reports/recipients.ts`): route through the same cache. It runs weekly on a cron, so it should almost always hit warm data.
- **Briefing:** must use the cached wrapper for the prior window (it will normally be a warm past range). Consider defaulting `includePrior` to true only when the prior range is already cached, fetching it live otherwise only if budget allows.

### Layer 5 — Optional, bounded warming

Once Layers 1–4 are in, one small scheduled job may pre-warm the handful of ranges management actually opens (month-to-date, last 30 days) a few times a day.

- This is the **one** justified cron — it is bounded (a few calls/day), it doesn't reintroduce the old sync engine, and it means the common views are always instant.
- Keep it strictly optional and behind an env flag. Do **not** warm arbitrary or historical ranges.

---

## 5. Expected outcome (the math)

| Scenario | Today | After fix |
|---|---|---|
| Manager opens MTD dashboard (first time that day) | 2 reporting calls | 2 reporting calls (or 0 if warmed) |
| Second manager opens the same MTD view | 2 more | **0** |
| Page refresh | 2 more | **0** |
| Clicks "Brief me" (prior window) | 2 more | **0** (past range, long TTL) |
| Re-opens June 1–12 next week | 2 more | **0** (immutable, cached) |
| Planner sync after a send | 1 more | **0–1** (shared cache) |

Realistic steady state: a handful of reporting calls per **day** instead of per **view** — comfortably inside 2/min and 225/day, with headroom for the weekly report and ad-hoc historical digging.

---

## 6. Observability (required — this is how you know it's fixed)

- Count and log reporting calls per day (Redis counter, exposed on an internal debug endpoint or the existing sandbox page): calls today, cache hit rate, current daily-budget headroom.
- Log every upstream fetch with its cache key and reason (`miss` / `stale-revalidate` / `forced-refresh`) so unexpected traffic is traceable to a feature.
- Surface `fetched_at` in the dashboard UI so staleness is always visible to the user.

---

## 7. Ground rules

1. **Next.js 16** (`proxy`, not middleware); TypeScript `strict`; no `any`.
2. **Do not rebuild the per-day sync engine.** Range-keyed caching only (§3).
3. **Do not solve this by increasing retry patience.** Patience is a fallback, not a fix.
4. Keep the dashboard's on-demand UX: no background polling, no auto-syncing, loading state on genuine cache misses.
5. **Never serve wrong numbers silently.** Stale data is acceptable *only* when labeled with its `fetched_at`.
6. Local dev shares the production account's quota — cache in dev too, and consider a longer dev TTL.

---

## 8. Files

**Create**
- `src/lib/measure-cache.ts` — Redis range cache: key derivation, mutability-based TTL, stale-while-revalidate, serve-stale-on-throttle.
- `src/lib/klaviyo-budget.ts` — global token bucket + daily counter + single-flight coalescing.
- `src/lib/measure-cache.test.ts` — TTL selection (past vs today-inclusive vs trailing), key derivation, stale-serving logic (pure functions; no network).

**Edit**
- `src/lib/measure.ts` — keep `fetchRangeOverview` as the raw fetcher; export a cached `getRangeOverview` that everything else uses.
- `src/app/api/klaviyo/measure/route.ts` — use the cached accessor; return `fetched_at` + a `stale` flag.
- `src/app/api/dashboard/briefing/route.ts` — cached accessor for the prior window.
- `src/app/api/planner/sync/route.ts` — drop the in-process report cache; use the shared one.
- `src/lib/reports/recipients.ts` — use the shared cache.
- `src/lib/klaviyo.ts` — route reporting calls through the budget limiter; move timezone/metric-id caching to Redis; keep the interactive-vs-patient threshold but let callers fall back to stale rather than throwing.
- `src/app/dashboard/layout.tsx` + `src/app/dashboard/types.ts` — show `fetched_at` / stale label; keep the client L1 cache.
- `vercel.json` — only if Layer 5 warming is adopted.

---

## 9. Acceptance criteria

- Opening the same range twice from **different browsers/users** issues Klaviyo reporting calls **once**, not twice (verify via the call counter in §6).
- A past/historical range is fetched from Klaviyo **once ever** (within its TTL) and served from Redis thereafter.
- Opening the dashboard and immediately clicking "Brief me" no longer 429s — the prior window comes from cache.
- With the account deliberately throttled, the dashboard shows the last known numbers labeled with `fetched_at` instead of an error; it only errors when nothing is cached.
- The daily reporting-call counter shows single/low-double digits in normal use, versus ~2 per view before.
- Concurrent identical requests result in exactly one upstream fetch (coalescing verified).
- Planner sync and the weekly report no longer duplicate reporting calls the dashboard already made.
- No per-day snapshot store or background sync engine is reintroduced.
- Unit tests cover TTL selection and stale-serving; `build`, `typecheck`, `lint`, `test` pass.

---

## 10. Out of scope
- Rebuilding the deleted sync engine or per-day store (§2.9, §3).
- Northbeam rate limiting (separate API, separate budget — worth a follow-up if it ever throttles).
- Changing which metrics/attribution model are used.
- Day-level decomposition of campaign/flow values (not possible on this account — §3).

---

## Sources
- [Klaviyo — Rate limits, status codes, and errors](https://developers.klaviyo.com/en/docs/rate_limits_and_error_handling)
- [Klaviyo — Query Campaign Values (Burst 1/s · Steady 2/m · Daily 225/d)](https://developers.klaviyo.com/en/reference/query_campaign_values)
- [Klaviyo — Reporting API overview](https://developers.klaviyo.com/en/reference/reporting_api_overview)
