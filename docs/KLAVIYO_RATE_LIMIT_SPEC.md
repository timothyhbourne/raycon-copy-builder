# Klaviyo Analytics — Rate Limit Fix

**Status:** researched, live-tested, fix proposed. **Urgent.**
**Surface:** `src/lib/klaviyo.ts`, `measure.ts`, `measure-cache.ts`,
`klaviyo-budget.ts`, `/api/klaviyo/*`, the dashboard, weekly reports, planner sync.
**Supersedes the throttling half of** `docs/ANALYTICS_RATE_LIMIT_SPEC.md`.

---

## 1. The live test

Ran the real query against the real account: campaign values report,
**2026-07-31 → 2026-08-24**, `equals(send_channel,'email')`, conversion metric
`JxF6bB` (Placed Order).

**Result: succeeded, no 429.** It returned **all 14 email campaigns** in the
window, in **one request**, with `links.next: null` — **no pagination**.

Four things that test settles:

**(a) Our per-call shape is already right.** We are not looping per campaign. One
call returns every campaign grouped by `campaign_id`. The most commonly cited
Klaviyo fix — "stop filtering per campaign" — does not apply to us.

**(b) There is no pagination at our data volume.** `fetchAllPages`
(`klaviyo.ts:315-334`) with `MAX_REPORT_PAGES = 25` loops exactly once. The
suspicion that we silently spend up to 25 quota units while recording 1 is
theoretical, not our actual problem.

**(c) The report already contains the campaign metadata we make extra calls
for.** Every result carries a `campaign_details` block with `name`, `status`,
`send_time`, `created_at`, `scheduled_at`, and full `audiences.included` /
`audiences.excluded`. We separately call `GET /api/campaigns` to resolve names
and audiences. **Those calls are redundant.**

**(d) The deliverability data we said we couldn't see is available in the call we
already make.** The test requested and received `unsubscribes`,
`spam_complaints`, `bounced`, `delivered`, `delivery_rate`, `open_rate`,
`click_rate`, `conversion_rate`, `revenue_per_recipient`, `average_order_value`.
Our `VALUES_REPORT_STATISTICS` (`klaviyo.ts:255-263`) asks for seven fields and
then throws `delivered` away in `foldStat` (`measure.ts:32-40`). Adding unsub,
spam and bounce rates costs **zero extra requests**.

One caveat: this test ran through the OAuth-authenticated Klaviyo connection,
which per §2.3 has its **own** quota. It proves the query shape and the data. It
does not prove our private key's quota is healthy.

---

## 2. What the limits actually are

From Klaviyo's machine-readable OpenAPI spec (`stable.json`, revision
2026-07-15) — quoted, not inferred:

| Endpoint | Burst | Steady | **Daily** |
|---|---|---|---|
| `POST /campaign-values-reports` | 1/s | **2/min** | **225/day** |
| `POST /flow-values-reports` | 1/s | **2/min** | **225/day** |
| `POST /flow-series-reports` | 1/s | **2/min** | **225/day** |
| **`POST /metric-aggregates`** | **3/s** | **60/min** | **none** |
| `GET /events` | 350/s | 3500/min | none |
| `GET /campaigns` | 10/s | 150/min | none |
| `GET /flows` | 3/s | 60/min | none |

Our `klaviyo-budget.ts` already has `DAILY_CAP = 225` right. What it does not
model is the far more binding constraint.

### 2.1 The actual cause of our 429s: 2 per minute

225/day sounds generous. **2/minute does not.** Our measure path spends **two**
reporting-tier calls per uncached range — one flow-values, one campaign-values
(`measure.ts:66`, `:71`). That is the entire minute's budget in one page load.

Every distinct date range is its own cache key (`overview:v1:start..end`,
`measure-cache.ts:73`). So:

> A manager opens the dashboard, then drags the date picker twice to compare
> periods. That is three uncached ranges → **six reporting calls inside one
> minute** → 429 on the fourth.

That is the bug. It is not exotic, it needs no unusual behaviour, and it will
happen every single time someone explores the data. The date range picker is
currently a rate-limit landmine.

### 2.2 A throttle is not seconds — it can be most of a day

Klaviyo's `Retry-After` on a reporting throttle has been reported in the wild at
**67,608 seconds — 18.8 hours**. Our `klaviyoFetch` back-off cannot wait that
out; it will exhaust its retries, throw, and surface an error.

Worse, **the rate-limit headers cannot warn us.** Klaviyo documents that
`RateLimit-Limit` / `-Remaining` / `-Reset` "indicate the state of the **steady**
rate limit window" only. They say nothing about the daily quota. We will read
`RateLimit-Remaining: 1` and feel safe at request 224 of 225.

### 2.3 Our private key shares one quota with every other integration

Klaviyo, documented: *"OAuth apps receive their own rate limit quota per
installed app instance, while **private key integrations share the same rate
limit quota per account**."*

So Shopify, Northbeam, any BI tool, any teammate's script, and our app are all
drinking from the same 225/day and 2/min. We can be perfectly behaved and still
get 429'd by someone else's sync.

### 2.4 A dead endpoint

`campaignSeriesReport` (`klaviyo.ts:561`) is commented "404s on this account."
It 404s on **every** account: **`/api/campaign-series-reports` does not exist.**
The spec has values-reports for campaigns and both values and series for flows,
forms and segments. Campaigns have no series report. Delete the function.

---

## 3. The fix

Ordered by impact. Items 1 and 2 alone should end the 429s.

### 3.1 Stop fetching per date range — fetch once, slice locally ★

**This is the architectural fix and it eliminates the problem rather than
managing it.**

The values report is scoped by **send date**, and each result row carries its own
`send_time`. So a report for a *wide* window is a strict superset of every
narrower window inside it. Our test proved this: 14 campaigns, each with its send
date attached.

Therefore **we never need a reporting call per date range.** Pull one wide window,
store the per-campaign and per-flow rows, and compute any range the user picks by
filtering rows on `send_time` **in our own code**.

- A nightly cron pulls `last_365_days` — **2 reporting calls per day, total.**
- The dashboard reads our store and filters locally. **Zero** Klaviyo calls on a
  page load, and range changes become instant instead of a network round trip.
- 2 calls/day against a 225/day cap is 0.9% utilisation, with the other 99% left
  as headroom for the weekly report, planner sync and ad-hoc work.

Flows have no send date, so flow totals for a sub-range genuinely do need their
own call — use `flow-series-reports` with `interval: "daily"` (max 60-day
timeframe) once per night and bucket locally, which gives per-day flow numbers
we cannot currently produce at all.

### 3.2 A real limiter, shared across processes ★

`klaviyo-budget.ts` is explicitly a soft counter, not a limiter — its own header
says so. On Vercel every request is a separate process, so an in-memory limiter
protects nothing.

Add a **Redis-backed serialized queue** for reporting-tier calls only:

```
reservoir: 225, refreshed daily      // the daily cap
minTime: 30_000                       // ≥ 2/min steady, with headroom
maxConcurrent: 1                      // burst is 1/s — never parallel
```

`Bottleneck` with its Redis datastore is the standard choice and handles the
clustered case. Whatever the implementation, the requirement is that two
concurrent lambdas cannot both issue a reporting call.

Count the daily total ourselves in Redis, keyed by account and date in the
account's timezone — the headers will not tell us (§2.2). Alert at 180.

**Do not** put `metric-aggregates` in this queue. It is 3/s, 60/min, no daily
cap. Counting it against 225 is over-conservative and costs us headroom.

### 3.3 Circuit breaker, not retry ★

On any 429 from a reporting endpoint:

1. Read `Retry-After`.
2. If it exceeds a threshold (**600s**, matching Airbyte's), write
   `klaviyo:blocked_until` to Redis and **stop issuing reporting calls entirely**
   until it passes.
3. Serve stale cache with a visible "data as of {timestamp}" badge — never an
   error. `measure-cache.ts:99-101` already serves stale on 429; extend it to
   respect the breaker so fifty lambdas don't each independently rediscover the
   throttle.
4. Surface the block in the UI and in `/api/klaviyo/budget` so we can see it.

Retrying a long throttle burns quota and hides the `Retry-After` we needed.

### 3.4 Seal the past

Klaviyo revises conversion attribution for **5 days** after send (email and SMS
default; push is 24h; configurable per account — read the real setting rather
than assuming).

So: once `send_time + attribution_window < now`, a campaign's numbers are
**final**. Mark the row `final: true` and never re-fetch it. Daily sync cost then
scales with *recent* campaigns, not total campaigns, which is what keeps this
under budget permanently.

Nightly sync = one wide pull, but only rows inside the attribution window are
overwritten.

### 3.5 Free wins in the call we already make

- **Add the deliverability statistics** to `VALUES_REPORT_STATISTICS`:
  `unsubscribes`, `unsubscribe_rate`, `spam_complaints`, `spam_complaint_rate`,
  `bounced`, `bounce_rate`. Zero extra requests. This closes the list-health
  blind spot flagged in `FEATURE_OPPORTUNITIES.md` for free.
- **Stop discarding `delivered`** (`measure.ts:32-40`). Compute rates per
  *delivered*, not per *recipient*, as `docs/WEEKLY_REPORT_PROMPT.md:188` already
  specifies.
- **Drop the separate `GET /api/campaigns` metadata calls.** Name, status,
  send time and audiences all arrive in `campaign_details` on the report
  (§1c). Fewer moving parts and fewer requests.
- **Delete `campaignSeriesReport`** (§2.4).

### 3.6 Move to an OAuth app

The only way off the shared private-key quota (§2.3). Klaviyo grants OAuth apps
their own quota per installed instance. This is a real piece of work — OAuth
flow, token storage, refresh — so it is not the first fix, but it is the only one
that stops other integrations from consuming our budget. Worth scheduling once
3.1–3.3 have stopped the bleeding.

### 3.7 If we ever need finer granularity

`metric-aggregates` is 3/s, 60/min, **no daily cap**, and supports
`by: ["$message"]` for per-campaign breakdowns with `interval: "day"`. Use it for
anything high-frequency or time-series.

The tradeoff, per Klaviyo: metric-aggregates counts by **event occurrence**, not
**send date**, so its numbers will not tie out to the Klaviyo UI. Keep
`campaign-values-reports` as the authoritative headline figure and use
metric-aggregates for drill-down only, clearly labelled.

---

## 4. Acceptance criteria

- Opening the dashboard makes **zero** Klaviyo reporting calls.
- Changing the date range makes **zero** Klaviyo reporting calls, and renders
  without a network round trip.
- Total reporting-tier calls per day, steady state: **≤ 10**.
- Two concurrent requests can never issue two concurrent reporting calls.
- On a 429 with a long `Retry-After`, the app stops calling, serves stale data
  with a visible timestamp, and surfaces the block in `/api/klaviyo/budget`. No
  user sees an error.
- The daily counter is durable in Redis and keyed to the account's timezone.
- Campaigns past their attribution window are never re-fetched.
- Unsubscribe rate, spam complaint rate and bounce rate are visible per campaign
  and per flow.
- All rates are computed per *delivered*, not per *recipient*.
- `campaignSeriesReport` no longer exists in the codebase.
- Regression: reported revenue for 2026-07-31 → 2026-08-24 matches the 14
  campaigns and totals returned by the live test in §1.

---

## 5. Out of scope

- **Webhooks + our own rollup tables.** The correct long-term end state — it
  removes polling entirely and gives sub-minute freshness — but it is a
  substantially bigger build and §3.1 solves the urgent problem.
- **Bulk export.** There is no bulk/async export for campaign or flow reporting
  data. Bulk export jobs exist only for events and profiles, and are invite-only
  beta. Not an option.
- **Northbeam rate limiting.** Northbeam calls are uncached and re-run a
  multi-minute export on every planner sync — a real problem, and a separate one.

---

## 6. Sources

- [Klaviyo OpenAPI stable spec](https://raw.githubusercontent.com/klaviyo/openapi/main/openapi/stable.json) (2026-07-15) — all rate-limit numbers
- [Rate limits, status codes, and errors](https://developers.klaviyo.com/en/docs/rate_limits_and_error_handling)
- [Reporting API overview](https://developers.klaviyo.com/en/reference/reporting_api_overview)
- [Query Campaign Values](https://developers.klaviyo.com/en/reference/query_campaign_values) · [Query Flow Series](https://developers.klaviyo.com/en/reference/query_flow_series) · [Query Metric Aggregates](https://developers.klaviyo.com/en/reference/query_metric_aggregates)
- [Community: Unexpected API throttling](https://community.klaviyo.com/developer-group-64/unexpected-api-throttling-14748) — the 67,608s throttle, shared private-key quota
- [Airbyte Klaviyo connector](https://docs.airbyte.com/integrations/sources/klaviyo) — 10-minute breaker threshold, attribution lookback
- [Fivetran Klaviyo connector](https://fivetran.com/docs/connectors/applications/klaviyo)
- [Understanding message conversion tracking](https://help.klaviyo.com/hc/en-us/articles/115005248128) — attribution windows
- [klaviyo-api-node](https://github.com/klaviyo/klaviyo-api-node) — SDK retry defaults (3 retries / 60s; inadequate here)
