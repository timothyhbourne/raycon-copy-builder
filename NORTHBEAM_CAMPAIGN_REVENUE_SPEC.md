# Planner — Northbeam 1-day-click attribution revenue (per campaign)

Add a per-campaign **Northbeam revenue** number to the planner: 1-day click, last-touch, **cash** accounting — the same attribution definition already used by the weekly report — shown as a new column and matched to each campaign **by campaign name**.

**Read first:** `AGENTS.md`. Reuse the existing Northbeam client (`src/lib/northbeam.ts`), the planner sync route (`src/app/api/planner/sync/route.ts`), the planner types (`src/lib/planner-types.ts`), and `writeSyncedMetrics` in `src/lib/planner.ts`. This is additive — do not change the existing channel-level weekly-report path.

## Decisions (locked)

- **Attribution:** 1-day click / last-touch / cash — identical to `northbeam.ts` `cfg()` (`attributionModelId=last_touch`, `attributionWindow="1"`, `accountingMode="cash"`). This new column must reconcile with the weekly report's channel totals.
- **Join key:** **campaign name.** Match a planner row to its Northbeam campaign row by name. The name that matters is the **linked platform campaign's name** (the Klaviyo/Postscript campaign the row points at via `klaviyo_campaign_id` / `postscript_campaign_id`), because Northbeam's campaign dimension = the campaign's `utm_campaign`, which defaults to that platform campaign name — **not** necessarily the planner row's display `name`.
- **Platform per channel:** email rows → Northbeam **Platform = Klaviyo**; SMS rows → Northbeam **Platform = Postscript**. (Both come from Northbeam, just different platform filter — the labels already exist as `NORTHBEAM_EMAIL_PLATFORM_LABEL` / `NORTHBEAM_SMS_PLATFORM_LABEL`.)
- **Refresh:** populate through the existing **Sync metrics** flow (async export). No live-on-load. Priority is correct data, not speed.
- **CRM v2 caveat:** the "CRM Campaign v2" view is a Northbeam UI *saved view* (a `quickFilterId` in the Sales Attribution URL). The Data Export API almost certainly can't be driven by that `quickFilterId` — so we **replicate its configuration** (campaign-level, cash, 1-day click) via the Export API and **verify our numbers match that view**. If, on investigation, the API does expose saved views by id, prefer that. Confirm during Phase 1.

---

## Phase 1 — Get the data right (do this before any UI)

Goal: prove we can pull correct per-campaign 1-day-click cash revenue for both Klaviyo and Postscript platforms, keyed by campaign name, and that it reconciles with the CRM v2 view.

1. **Extend `northbeam.ts` with a campaign-level export.** Add `getCampaignRevenue(periodStartISO, periodEndISO)` mirroring `getWeeklyChannelRevenue`, but:
   - Change the export body to **campaign level** with a **campaign breakdown** in addition to platform. Today `buildExportBody` hardcodes `level: "platform"` and `breakdowns: [{ key: "Platform (Northbeam)", values: [...] }]`. Add a campaign breakdown (likely `level: "campaign"` and/or an extra breakdown whose key is the campaign-name dimension). The exact `level` value and breakdown key are **not known** — confirm live (step 2). Keep the same `attribution_options` (1-day click / cash).
   - Return a normalized map: `{ platform: "Klaviyo"|"Postscript", campaignName: string, revenue: number }[]`, parsed defensively (reuse `pickNum` / the CSV+JSON `downloadRows` logic). Read the campaign-name column defensively across candidate keys (e.g. `campaign`, `campaign_name`, `breakdown_campaign`, the request breakdown key) — the same pattern as `platformOf()`.

2. **Add a debug route** (secret-protected, like the existing Northbeam debug helpers `listMetrics` / `runRawExport`): `src/app/api/planner/northbeam-debug/route.ts` that runs a campaign-level export for a given window and returns the raw parsed rows + the discovered column names + the distinct campaign-name values + distinct platform values. Use it to:
   - Confirm the correct `level` / breakdown key for a campaign breakdown (drive it by the 422 errors, exactly how the platform path was confirmed).
   - Capture the **exact campaign-name strings** Northbeam reports, so we know what we're matching against.
   - **Reconcile**: pick a recent week, sum campaign revenue per platform, and confirm it matches (a) the weekly report's channel totals and (b) the CRM v2 view in the Northbeam UI for the same range/accounting mode. Note any discrepancy before proceeding.

3. **Nail the name match.** Compare the Northbeam campaign-name strings against the linked Klaviyo/Postscript campaign names (from `klaviyo/campaigns-list` and the Postscript client). Define a normalization (trim, collapse whitespace, case-fold; decide how to handle emoji/pipes like `RAY | O55 …`). Document match rate and any systematic mismatch. **Matching by name is the fragile part — this step is the whole point of Phase 1.**

Exit criterion: for a known week, we can produce a `{platform, campaignName} → revenue` map whose per-platform totals reconcile with CRM v2, and a documented, high-confidence rule for matching those names to planner rows.

## Phase 2 — Wire it into the planner

4. **Types.** Add `northbeam_revenue?: number | null` to `PlannerRow` and to `SyncedMetrics` in `planner-types.ts` (default/backfill `null` on read, per the repo's read-time backfill idiom). Optionally `northbeam_synced_at`.

5. **Sync integration** (`src/app/api/planner/sync/route.ts`). After the existing Klaviyo/Postscript passes, add one Northbeam campaign-level export over the same window the sync already computes (earliest eligible send − 1 day → today). Build the `{platform, normalizedName} → revenue` map once. Then for each linked, already-sent row:
   - Resolve the row's **linked campaign name** (Klaviyo: from the campaigns list / `get_campaign` by `klaviyo_campaign_id`; Postscript: from the Postscript campaign). Do **not** assume `row.name` equals it.
   - Look up `(platform, normalize(name))` in the map; write `northbeam_revenue` via `writeSyncedMetrics` (extend it to carry the new field). If no match, set `null` and add a per-row `SyncResult` reason like `northbeam_unmatched` so unmatched campaigns are visible in the sync toast/summary, not silently zeroed.
   - Guard on `isNorthbeamConfigured()` — if unconfigured, skip and warn, exactly like the Postscript guard. A Northbeam failure must **not** take down the Klaviyo/Postscript sync (wrap independently; the existing report path fails the whole run on error — don't replicate that here).

6. **Planner column** (`src/app/planner/page.tsx` `TableView`). Add a new right-aligned, mono/tabular column **"NB rev (1d click)"** next to the existing Klaviyo/Postscript `Revenue`. Use the existing `money()` formatter; `null` → faint `—`. Add it to the `GRID` constant and keep header/body/summary aligned; include it in the footer summary total. Make clear in a header tooltip that this is Northbeam 1-day-click cash attribution (distinct from the platform-reported `Revenue`).

## Verification

- Type-check/build passes; the existing weekly report and channel-level path are unchanged.
- For a known week, the planner's summed NB-rev per channel matches the weekly report and the CRM v2 view.
- Rows whose linked campaign name doesn't match a Northbeam row show `—` and appear as `northbeam_unmatched` in the sync summary (never silently 0).
- Northbeam being unconfigured or failing does not break Klaviyo/Postscript syncing.
- SMS rows pull from Northbeam with Platform = Postscript; email rows with Platform = Klaviyo.

## Open item to confirm in Phase 1

The exact Northbeam Export API `level`/breakdown key for a **campaign** breakdown, and whether campaign + platform breakdowns can be requested together in one export (preferred) or need two exports (one per platform). Drive this from the debug route's 422 responses, the same way the platform path was confirmed.
