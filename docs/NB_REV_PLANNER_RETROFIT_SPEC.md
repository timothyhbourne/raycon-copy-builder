# Planner "NB Rev" Column — Retrofit to the Confirmed Export Recipe

Status: ready to implement (nothing applied yet)
Date: 2026-07-23
Supersedes: `NORTHBEAM_CAMPAIGN_REVENUE_SPEC.md` (root) — its Phase 2 (planner wiring) is BUILT and stays; its Phase 1 assumptions are now resolved by the sandbox probes and several were wrong. This spec replaces those assumptions with live-confirmed facts.

## The situation

The planner already has the full NB-rev pipeline: `getCampaignRevenue()` in `northbeam.ts`, the sync pass in `src/app/api/planner/sync/route.ts` (rows matched by linked Klaviyo/Postscript campaign name, `northbeam_unmatched` surfaced in the toast, failures isolated from the Klaviyo/Postscript sync), the `northbeam_revenue` field, the "NB rev (1d click)" column and StatCard in `src/app/planner/page.tsx`. It has never produced data because the export request it sends is invalid — the sandbox probes (2026-07-23) proved the correct recipe. This retrofit swaps the recipe in; the plumbing above it barely changes.

## Confirmed facts (from the sandbox probes — do not re-litigate)

| Fact | Confirmed value | How |
|---|---|---|
| "Clicks only" model id | `northbeam_custom` (NOT any "click"-named id) | docs + live platform reconciliation to the dollar |
| Dashboard-matching config | `northbeam_custom` · window `"1"` · `cash` · DAILY granularity | probe #1 matched CRM Campaign (v2) exactly once end date was pinned |
| Campaign granularity | `level: "campaign"` — campaign is a LEVEL, not a breakdown | probe #2 + docs; `"Campaign"` breakdown key 422s ("not a valid breakdown key") |
| Breakdowns | every breakdown REQUIRES `values`; platform breakdown only: `{ key: "Platform (Northbeam)", values: ["Klaviyo","Postscript"] }` | 422 confirmed live |
| Campaign name | arrives as a CSV COLUMN at campaign level; matches the Klaviyo campaign name (utm_campaign), e.g. `RAY \| O25 30% Flash Sale \| US \| 07.16.26` | probe #2 matched the queried name |
| Discovery endpoints | `/v1/exports/attribution-models`, `/v1/exports/metrics`, `/v1/exports/breakdowns` (bare paths 404) | live + docs |
| WEEKLY granularity hazard | weekly buckets spill revenue across arbitrary window edges — probe overshot by ~$7.6k until DAILY + pinned end date | probe #1 |
| Data freshness | Northbeam's own "month to date" ends at the last fully processed day, not today | dashboard header + probe #1 reconciliation |
| Export queue | can run minutes; result endpoint throws transient HTML 500s mid-poll | observed live; pollExport now retries 5xx, ~5 min budget (already shipped) |

The confirmed request body (probe #2, working):

```jsonc
{
  "level": "campaign",
  "time_granularity": "DAILY",
  "period_type": "FIXED",
  "period_options": { "period_starting_at": "…T00:00:00", "period_ending_at": "…T23:59:59" },
  "breakdowns": [ { "key": "Platform (Northbeam)", "values": ["Klaviyo", "Postscript"] } ],
  "options": { "export_aggregation": "BREAKDOWN", "remove_zero_spend": false, "aggregate_data": false, "include_ids": true, "include_kind_and_platform": true },
  "metrics": [ { "id": "rev" } ],
  "attribution_options": { "attribution_models": ["northbeam_custom"], "attribution_windows": ["1"], "accounting_modes": ["cash"] }
}
```

## Changes

### 1. `src/lib/northbeam.ts` — make the confirmed recipe the shared one

- **Rewrite `buildCampaignExportBody`** to the confirmed body above (level `campaign`, platform breakdown with values, `options` block with `include_ids`, DAILY). Delete the campaign-breakdown code path and the `campaignLevel` / `campaignBreakdown` config entries + envs (`NORTHBEAM_CAMPAIGN_LEVEL`, `NORTHBEAM_CAMPAIGN_BREAKDOWN`) — they encode the disproven assumption. `getCampaignRevenue` and `runRawCampaignExport` inherit the fix unchanged.
- **Row summing:** with DAILY granularity a campaign appears once per day; `getCampaignRevenue` already returns per-row entries and the sync sums by `(platform, normalizedName)` — verify that summing survives, since it was written for WEEKLY rows.
- **Campaign-name column:** confirm which column the live CSV used in probe #2 (visible in the probe's `columns` debug output) and put that column FIRST in `campaignNameOf`'s candidate list, keeping the rest as fallbacks.
- **`runCampaignProbe` stays** as the sandbox's diagnostic (it now shares the same body builder — refactor it to call `buildCampaignExportBody` + overrides rather than duplicating).

### 2. Attribution model default — the decision in this spec

`cfg()` defaults `attributionModelId` to `last_touch`, chosen when the real "Clicks only" id was unknown. The probes proved the team's source-of-truth view (CRM Campaign v2) runs Clicks only = `northbeam_custom`.

**Change the default to `northbeam_custom`.** Set `NORTHBEAM_ATTRIBUTION_MODEL_ID=northbeam_custom` in `.env.local` AND flip the code default in `cfg()`.

Consequence to accept explicitly: the **weekly report's channel totals will shift** (they've been last-touch). That is a correction — the weekly report was approximating "1-day click" with the wrong model — but flag it in the next weekly run's notes so the discontinuity isn't mistaken for a real revenue change. The column label "NB rev (1d click)" stays accurate (clicks-only, 1-day window).

### 3. `src/app/api/planner/sync/route.ts` — window hygiene (small)

- **Pin the end of the export window to yesterday** (last fully processed day), not today — matching how Northbeam itself reports MTD. Prevents systematically low numbers for campaigns sent in the last 24h.
- Everything else (matching, unmatched surfacing, failure isolation, `writeSyncedMetrics`) stays as built.

### 4. `src/app/planner/page.tsx` — no changes required

Column, StatCard, toast summary all exist. Optional nicety: tooltip on the header noting "Clicks only · 1-day · cash — reconciles with CRM Campaign (v2)".

### 5. Optional enhancement (defer unless matching disappoints)

`include_ids: true` is now in the export. If name-matching shows misses in practice, a follow-up can match on Northbeam's campaign id ↔ Klaviyo campaign id instead of names. Don't build it until an unmatched rate justifies it.

## Acceptance tests

1. **Recipe parity:** the sync's export request body (log it once in dev) is identical to the confirmed body above except dates.
2. **Golden campaign:** after one Sync metrics run covering 2026-07-16, the planner row linked to `RAY | O25 30% Flash Sale | US | 07.16.26` shows the same revenue the sandbox probe #2 returned for the same window (and the CRM Campaign v2 row for that campaign).
3. **Per-platform reconciliation:** summed NB rev across synced rows for a pinned window ≈ probe #1's platform totals for the same window (allowing for unlinked/unmatched rows, which are listed in the toast).
4. **Unmatched visibility:** a deliberately unlinked row shows `—` and appears in the sync summary as `northbeam_unmatched` — never silently 0.
5. **Isolation:** with `NORTHBEAM_API_KEY` blanked, Klaviyo/Postscript sync still completes and the toast says Northbeam was skipped.
6. **Freshness:** a campaign sent today shows `—` (window ends yesterday), not a misleading partial number.
7. **Regression:** `npx tsx scripts/brief-compile-test.ts` and a typecheck pass; weekly report still runs (with the model-change note from §2).

## Out of scope

- Any change to the platform-level weekly export shape (WEEKLY granularity over whole ISO weeks is safe there; only the model default changes).
- Saved-view (`quickFilterId`) replication — resolved: the export API can't consume it and doesn't need to; the recipe reproduces the view's numbers directly.
- Postscript-side name resolution changes (SMS rows keep the existing resolution path).
