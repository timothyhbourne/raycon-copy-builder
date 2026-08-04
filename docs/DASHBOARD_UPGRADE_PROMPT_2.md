# Task: Dashboard v2 — split Flows and Campaigns into toggleable pages, pin the Placed Order metric, and only fetch/show data that has activity

You are working in the `raycon-copy-builder` Next.js app (Next 16, React 19, App Router, Tailwind v4). Read `AGENTS.md` first — this is NOT the Next.js you know; verify App Router **layout, nested-route, and redirect** conventions in `node_modules/next/dist/docs/` before writing routing code, because how a client layout persists state across child routes is the crux of this task.

This builds directly on the current working dashboard. Do not regress the sync fixes already in place: shared email-only channel filter for flows AND campaigns (`REPORT_CHANNEL_FILTER` in `src/lib/klaviyo.ts`), account-timezone alignment between the aggregate and the values reports (`dayRangeISO` + `getAccountTimezone`), and the pagination-truncation warnings.

## Current state (what exists today)

- `src/app/dashboard/page.tsx` — one long client page. Renders: date-range controls + Load/Force-refresh, a "loaded at / cached at" line, a sync-warnings banner, two revenue tiles + a reconciliation line, then the **Flows** table, then the **Campaigns** table, then three **campaign status** columns (Draft / Scheduled / Sent) via the `StatusColumn` component. Everything is stacked on one scrolling page; campaigns are at the very bottom.
- `src/app/api/klaviyo/overview/route.ts` — single `GET` endpoint that fetches everything and returns `{ revenue, flows, campaigns, campaign_status, warnings, range, served_from_cache?, cache_age_seconds? }`. 10-minute in-process cache keyed by date range; `nocache=1` bypasses it; `debug=1` adds a `debug` block.
- `src/lib/klaviyo.ts` — all HTTP. Relevant exports: `klaviyoFetch` (private, has 429 retry), `aggregateMetric`, `flowValuesReport`, `campaignValuesReport` (both return `{ results, truncated }`), `listFlows`, `listKlaviyoCampaigns` (returns `{ campaigns, truncated }`, pages recent-first up to `MAX_CAMPAIGN_LIST_PAGES = 5`), `resolvePlacedOrderMetric` (returns `{ id, chosen, candidates, ambiguous }`), `listMetricsByName`, `getAccountTimezone`, `dayRangeISO`, `sumArray`.
- `src/components/AppNav.tsx` — left rail; links to `/copy-builder` and `/dashboard`.

Three problems to fix, in priority order.

---

## 1. UX: make Flows and Campaigns separate, toggleable pages inside the dashboard feature (highest priority)

Right now you cannot switch between flows and campaigns — campaigns are just pinned to the bottom of the same scroll. Split them into two routes under the dashboard with a tab/segmented-control toggle, while sharing one data fetch so switching is **instant and never refetches**.

Target structure:
- `src/app/dashboard/layout.tsx` — a **client** layout that owns everything shared: the date-range inputs, Load / Force-refresh buttons, the loaded-at/cached-at line, the sync-warnings banner, the two revenue tiles + reconciliation line, and a segmented **Flows | Campaigns** toggle. It performs the single fetch to `/api/klaviyo/overview` and holds the result in state, exposing it to child pages via React Context (e.g. a `DashboardDataProvider` + `useDashboardData()` hook). Because an App-Router layout does not remount when navigating between its child routes, this state persists across the toggle — verify this behavior holds in this Next version before relying on it.
- `src/app/dashboard/flows/page.tsx` — renders only the Flows table (reuse the existing table markup/columns).
- `src/app/dashboard/campaigns/page.tsx` — renders the Campaigns performance table + the three status columns (reuse existing markup + `StatusColumn`).
- `src/app/dashboard/page.tsx` — redirect to `/dashboard/flows` (default tab).
- The toggle uses `Link` + `usePathname` to highlight the active tab, matching the existing slate/mono styling. `AppNav`'s `/dashboard` link stays; the redirect handles it.

If — and only if — layout-held state does not reliably persist across child-route navigation in this Next version, fall back to a single `/dashboard` client page with an `activeTab` state synced to a `?tab=flows|campaigns` query param. Either way: one fetch, instant toggle, and the shared header (tiles, date range, warnings) stays put while only the table area swaps.

Keep the revenue tiles and reconciliation line in the shared header so they're visible on both tabs.

## 2. Pin the Placed Order conversion metric to the Shopify one (`JxF6bB`)

The dashboard currently shows a sync warning: *multiple "Placed Order" metrics found*. The correct one is the **Shopify** Placed Order metric, id **`JxF6bB`**. Pin it:

- Add `KLAVIYO_PLACED_ORDER_METRIC_ID=JxF6bB` to `.env.local` (and mention it in `README`/comments).
- In `src/lib/klaviyo.ts`, change `resolvePlacedOrderMetric()` so that when `process.env.KLAVIYO_PLACED_ORDER_METRIC_ID` is set, it uses that id **directly** and returns `ambiguous: false` — **without** paging through `/metrics/` at all. Hardcode `"JxF6bB"` as the default fallback constant if the env var is unset. Only fall back to the existing name-based auto-resolution (and its ambiguity flag) if neither the env var nor the default is usable.
- Net effect: the "multiple Placed Order metrics" warning disappears, `revenue.total` / `attributed` are computed against `JxF6bB`, and we skip the (potentially multi-page) `/metrics/` scan on every load — which is also a speed win (see #3).
- In the `debug=1` block, still report the resolved metric id and note it was pinned via env/default, so this stays auditable.

Verify after: `/api/klaviyo/overview?...&debug=1` shows `resolved_conversion_metric_id: "JxF6bB"`, no ambiguity warning appears in the UI, and the revenue numbers match what Klaviyo's own dashboard reports for the Shopify Placed Order metric over the same range.

## 3. Only fetch and show data that has activity (recipients or revenue) — the main speed problem

Loads are slow because the endpoint fetches far more than it displays. Two things to fix: what we render, and what we fetch.

**a. Render only rows with activity.**
- Flows table: today the route unions `listFlows` with the report results, so every flow renders even with zero recipients and zero revenue. Change it to include only flows where `recipients > 0 || revenue > 0`. The values report is already activity-scoped, so build flow rows from the report results and join names from `listFlows`, dropping idle flows.
- Campaign performance table: same rule — only campaigns with `recipients > 0 || revenue > 0`.
- Keep the existing revenue tiles and reconciliation totals computed from the full report totals (don't let row-filtering change the headline numbers).

**b. Fetch metadata only for what's needed instead of scanning history.**
The current `listKlaviyoCampaigns` pages recent-first through up to ~500 campaigns on every load just to get names/status/send-times. Most of that is thrown away. Drive metadata from what actually needs it:
- **Performance rows (sent, in range):** collect the `campaign_id`s that appear in the campaign values report *with activity*. Fetch metadata only for those — either by filtering the `/campaigns/` list to `scheduled_at` (or the correct sent-time field for revision `2026-04-15` — verify) within `[start, end]` on the email channel, or by fetching those specific ids. Pick whichever is fewer sequential calls; explain the choice in a comment.
- **Draft / Scheduled subsections:** these are not date-bound but are small sets. Fetch them with a **status filter** on `/campaigns/` (e.g. Draft, then Scheduled) rather than paging all history. Combine the channel filter with the status filter; verify exact filter syntax + field names against the bundled docs / a real response before parsing.
- Preserve the `truncated` → `warnings` behavior so nothing is dropped silently.
- Keep all Klaviyo calls **sequential** (the 1 req/s burst limit is why fan-out with `Promise.all` triggers 429s). The goal is *fewer* calls, not parallel ones. Removing the `/metrics/` scan (#2) plus not paging all campaign history should be the bulk of the speedup.

**c. (Optional, only if a-b aren't enough) lazy per-tab fetch.** If the combined fetch is still slow, you may split into `/api/klaviyo/flows` and `/api/klaviyo/campaigns` and have each tab load its own data on first view (caching so re-toggling is instant), with a small shared summary for the tiles. Prefer keeping the single fast fetch if a-b get it acceptable; only split if measurably necessary, and don't break the shared revenue tiles.

---

## Interfaces / response shape
Keep the `/api/klaviyo/overview` response shape (`revenue`, `flows`, `campaigns`, `campaign_status`, `warnings`, `range`) so the split pages can consume the same payload from the shared layout. If you add `/dashboard/flows` and `/dashboard/campaigns`, the client interfaces (`RevenueData`, `FlowRow`, `CampaignRow`, `CampaignMeta`, `CampaignStatus`) currently declared in `page.tsx` should move to a shared module (e.g. `src/app/dashboard/types.ts`) imported by the layout and both pages. If you split endpoints (3c), document the new shapes.

## Constraints
- Reuse `klaviyoFetch`, `dayRangeISO`, `getAccountTimezone`, `sumArray`, and the existing report helpers. Don't duplicate HTTP/retry logic and don't add parallel report calls.
- Keep the existing visual language (slate palette, `font-mono` uppercase micro-labels, rounded white cards). No new UI libraries.
- Do NOT touch the unrelated local email-copy `SavedCampaign` system (`src/lib/campaigns.ts`, `src/app/api/campaigns/route.ts`).
- Preserve the timezone alignment, shared email-only channel filter, and truncation warnings from the prior pass.

## Acceptance criteria — verify before reporting done
1. `npm run build` passes with no type errors.
2. `/dashboard` redirects to `/dashboard/flows`. A **Flows | Campaigns** toggle switches the table area; the date range, revenue tiles, and warnings stay in place and **do not refetch** when toggling (confirm via the network tab — no new request on toggle).
3. The "multiple Placed Order metrics found" warning is gone. `/api/klaviyo/overview?...&debug=1` shows `resolved_conversion_metric_id: "JxF6bB"`.
4. Flows and Campaigns tables show only rows with recipients or revenue > 0; idle flows/campaigns no longer appear. Headline revenue tiles are unchanged by this filtering.
5. First-load time is materially lower than before (note the before/after; the `/metrics/` scan is gone and campaign-history paging is bounded to what's needed). Draft and Scheduled campaigns still populate their subsections; sent-in-range campaigns still appear in both the status list and the performance table.
6. Force refresh still bypasses the cache; a normal Load within 10 min is still served from cache with a correct age.

Before implementing #3's metadata fetching and any new `/campaigns/` filters, make one real call (or read the bundled Klaviyo docs) to confirm the exact field names and filter syntax for scheduled/sent times and status under revision `2026-04-15`, so parsing matches reality — that's the usual source of back-and-forth.
