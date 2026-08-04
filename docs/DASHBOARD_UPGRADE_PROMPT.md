# Task: Rework the Klaviyo dashboard — split Flows vs Campaigns, add campaign status subsections, and fix data sync

You are working in the `raycon-copy-builder` Next.js app (Next 16, React 19, App Router, Tailwind v4). Read `AGENTS.md` first: this is NOT the Next.js you know — check `node_modules/next/dist/docs/` before writing anything that touches App Router / route conventions.

## Context: what exists today

The dashboard lives at `src/app/dashboard/page.tsx` (client component). It calls one endpoint, `GET /api/klaviyo/overview?start=YYYY-MM-DD&end=YYYY-MM-DD`, which is defined in `src/app/api/klaviyo/overview/route.ts`. All Klaviyo HTTP logic is in `src/lib/klaviyo.ts`.

Current behavior:
- The page renders two revenue tiles (Total store revenue, Klaviyo-attributed revenue) and a single **Flows** performance table. There is **no Campaigns section in the UI at all.**
- The overview route already fetches campaign data via `campaignValuesReport(...)` but only uses it to compute the aggregate number `attributed_from_campaigns`. It does **not** build or return per-campaign rows. So the campaign data is fetched and thrown away except for one sum.
- `src/lib/klaviyo.ts` has `listFlows()` but there is **no equivalent for Klaviyo campaigns** (no function that hits `/campaigns/`). So we currently have no campaign names, statuses, or scheduled send times — only the values report keyed by `campaign_id`.
- There is a separate, unrelated concept called `SavedCampaign` in `src/lib/campaigns.ts` / `src/app/api/campaigns/route.ts` — these are locally-authored email copy drafts stored as markdown in `generated/`. **These are NOT Klaviyo campaigns and must not be conflated** with the campaign performance/status data below. Do not change that system.

Environment: `KLAVIYO_API_KEY` is in `.env.local`. API base is `https://a.klaviyo.com/api`, revision `2026-04-15` (see constants at the top of `klaviyo.ts`). Rate-limit/429 retry handling already exists in `klaviyoFetch()` — reuse it, don't reinvent it.

## What to build

### 1. Split the dashboard into two clearly separated performance sections

Restructure `src/app/dashboard/page.tsx` so Flows and Campaigns are visually distinct top-level sections, each with its own header and table. Keep the existing revenue tiles up top. The Flows table stays as-is (columns: Flow, Recipients, Opens, Clicks, Revenue, Rev/recipient). Add a parallel **Campaigns performance** table with the same metric columns (Campaign, Send date, Recipients, Opens, Clicks, Revenue, Rev/recipient) sorted by revenue descending. This table shows **sent** campaigns with performance stats.

### 2. Add campaign status subsections

Within the Campaigns area, add a subsection that groups campaigns by Klaviyo status into three buckets:
- **Draft / upcoming** — campaigns in `Draft` status (not yet scheduled).
- **Scheduled** — campaigns with a future scheduled send; show the scheduled send datetime.
- **Sent** — already-sent campaigns (these are the ones that also appear in the performance table above).

For draft and scheduled campaigns there are no performance stats yet, so show name, status, audience/list if easily available, and scheduled send time where applicable. Use tabs or three labeled sub-tables — your call, but keep it consistent with the existing minimal slate/mono Tailwind styling already in the file.

To get statuses and scheduled times you must add a Klaviyo campaigns **list** call (see #4) — the values report alone does not return draft/scheduled campaigns or send times.

### 3. Fix Klaviyo → dashboard data sync (highest priority)

The audit found several correctness/consistency bugs. Fix all of them and leave a short comment at each fix explaining why:

a. **Ambiguous conversion metric.** `getMetricId("Placed Order")` returns whichever "Placed Order" metric appears first in `/metrics/`. Klaviyo accounts often have more than one (e.g. a Shopify-integration "Placed Order" and an API one). Using the wrong one silently changes every attributed-revenue number. Fix: resolve the metric deterministically — prefer the metric whose `attributes.integration` matches the store integration (Shopify), and if multiple remain, log/expose which IDs were found (the `debug` path already calls `listMetricsByName` — use that). Make the selection explicit and documented, not "first match wins."

b. **Flows are email-only but campaigns are all-channel — inconsistent totals.** In `klaviyo.ts`, `FLOW_REPORT_FILTER = "equals(send_channel,'email')"` restricts the flow values report to email, while `campaignValuesReport` passes **no** channel filter. So `attributed_from_flows` excludes SMS/push flow revenue while `attributed_from_campaigns` includes all channels — the two halves of "attributed" are measured on different bases. Decide on one consistent policy (recommend: email-only for both for now, since that matches Raycon's email focus) and apply the same channel filter to both reports. Document the choice and how to widen it later.

c. **Timezone mismatch between total revenue and attributed revenue.** `dayRangeISO()` builds a UTC datetime window and `aggregateMetric` passes `timezone: "UTC"`. But the flow/campaign **values reports** pass a `timeframe: {start, end}` that Klaviyo interprets in the **account's timezone**, not UTC. So "Total store revenue" (aggregate, UTC) and "attributed revenue" (values reports, account TZ) are computed over slightly different day boundaries, which makes attribution % and day-edge numbers drift. Fix: make both use the same timezone basis. Determine the account timezone (via `GET /accounts/` → `data[0].attributes.timezone`) and use it consistently for both the aggregate `timezone` field and the values-report timeframe, OR force both to UTC — but they must match. Document which was chosen.

d. **"Total store revenue" label vs source.** The tile labeled "Total store revenue" is actually the sum of the Klaviyo "Placed Order" metric `sum_value`, which is Klaviyo-tracked order value, not necessarily true Shopify gross revenue. Either relabel the tile to something accurate (e.g. "Placed-order revenue (Klaviyo)") or clearly note the source. Do not leave a misleading label.

e. **Silent pagination truncation.** `MAX_REPORT_PAGES = 25` in `fetchAllPages`. If a report ever exceeds 25 pages the results are silently cut off and revenue is understated. Add detection: if the loop stops because it hit the cap (not because `next` was null), surface a warning in the API response (e.g. a `warnings: []` array the UI can show) instead of failing silently.

f. **Cache staleness / cross-worker.** The overview route uses a 10-min in-process `Map` cache. This is fine for a single dev process but won't share across serverless workers and can serve stale data after a fresh send. Keep the cache but (i) confirm the "Force refresh" button reliably bypasses it (it sends `nocache=1` — verify the route honors it, it currently does), and (ii) include the cache age in the response so the UI's "cached at" indicator is accurate. No need to move to a distributed cache now — just document the limitation in a comment.

g. **Reconciliation surfacing.** So the user can trust the sync at a glance, add a small reconciliation line under the tiles: `attributed_from_flows + attributed_from_campaigns` should equal `attributed`; show the flows/campaigns split and the attributed-% of total. If any Klaviyo call returned a warning (see e), show it.

### 4. Add the Klaviyo campaigns list function

In `src/lib/klaviyo.ts`, add a `listCampaigns()` (name it `listKlaviyoCampaigns` to avoid confusion with the local `listCampaigns` in `lib/campaigns.ts`) that calls the Klaviyo `GET /campaigns/` endpoint. Notes for this endpoint:
- Klaviyo **requires** a `filter` on `messages.channel` for this endpoint, e.g. `filter=equals(messages.channel,'email')`. Without it the call errors. URL-encode the filter.
- Return `id`, `name`, `status` (`attributes.status`), `send_time` / scheduled datetime (`attributes.send_time` or the scheduled options — inspect the actual response shape under revision `2026-04-15` before parsing; do not assume field names), `created_at`, `updated_at`, and audience/included lists if present.
- Follow `links.next` pagination the same way `listFlows` does, and route it through `klaviyoFetch` so retry handling applies.
- You may need to fetch statuses in more than one call if the API filters campaigns by a single status per request under this revision — verify against the docs/response and handle Draft, Scheduled, and Sent.

Then in `route.ts`: build per-campaign performance rows from `campaignValuesReport` (mirror exactly how per-flow rows are built today — aggregate by `campaign_id` across channel groupings, join names/status/send_time from `listKlaviyoCampaigns`), and return a new `campaigns` array plus a `campaign_status` grouping (draft/scheduled/sent) in the JSON response. Keep the existing `flows` and `revenue` shape unchanged so nothing else breaks.

## Response shape (extend, don't break)

Extend the `/api/klaviyo/overview` JSON to roughly:
```
{
  revenue: { total, attributed, attributed_from_flows, attributed_from_campaigns, order_count },
  flows: FlowRow[],                 // unchanged
  campaigns: CampaignRow[],         // NEW: sent campaigns with stats
  campaign_status: {                // NEW: for the subsections
    draft: CampaignMeta[],
    scheduled: CampaignMeta[],      // includes send_time
    sent: CampaignMeta[]
  },
  warnings: string[],               // NEW: truncation / metric-ambiguity notes
  range: { start, end },
  served_from_cache?: string
}
```
Add matching TypeScript interfaces in `route.ts` and mirror them in `page.tsx` (the page currently declares `RevenueData` and `FlowRow` inline — add `CampaignRow` and `CampaignMeta` the same way).

## Constraints
- Reuse `klaviyoFetch`, `dayRangeISO`, `sumArray`, and the existing metric-id resolution path; don't duplicate HTTP or retry logic.
- Keep the current visual language (slate palette, `font-mono` uppercase micro-labels, rounded white cards). No new UI libraries.
- Sequential Klaviyo calls only — the code comments explain the 1 req/sec burst limit; do not fan out with `Promise.all` on report endpoints (the existing `debug` block's `Promise.all` is acceptable since it's off the hot path, but don't add more parallel report calls).
- Don't touch the `SavedCampaign` / copy-builder system.

## Acceptance criteria / how to verify before you report done
1. `npm run build` passes with no type errors.
2. Load `/dashboard`, pick a 30-day range, click Load: two clearly separated sections (Flows, Campaigns) render, plus draft/scheduled/sent subsections.
3. `attributed_from_flows + attributed_from_campaigns === attributed`, and flows + campaigns use the **same** channel filter and the **same** timezone basis as the total-revenue aggregate (verify by adding a temporary `?debug=1` assertion or logging the resolved metric id, chosen timezone, and channel filter).
4. Hit `/api/klaviyo/overview?...&debug=1` and confirm: exactly one conversion metric id is chosen and it's the intended Shopify "Placed Order"; the campaign report row count and campaign list count are both non-zero; if pagination hit the cap a warning appears.
5. "Force refresh" bypasses the cache (network shows a fresh Klaviyo fetch); a normal Load within 10 min is served from cache and the "cached at" time is correct.
6. Scheduled campaigns show a future send time; draft campaigns show no stats; sent campaigns appear in both the status list and the performance table.

Before implementing, spend a moment inspecting the **actual** JSON shape of `/campaigns/` and the campaign-values-report under revision `2026-04-15` (make one real call or read the bundled docs) so field parsing matches reality rather than assumptions — this is where most back-and-forth comes from.
