import {
  aggregateMetric,
  campaignValuesReport,
  dayRangeISO,
  fetchCampaignsByIds,
  fetchCampaignsByStatus,
  flowValuesReport,
  listFlows,
  getAccountTimezone,
  resolvePlacedOrderMetric,
  type CampaignValuesResult,
  type FlowValuesResult,
  type KlaviyoCampaign,
} from "@/lib/klaviyo";
import {
  eachDay,
  listSyncedDates,
  readDimensions,
  writeDay,
  writeDimensions,
  type CampaignDim,
  type DayCampaignStat,
  type DayFlowStat,
  type DaySnapshot,
  type Dimensions,
  type FlowDim,
} from "./store";

// Background sync engine — the WRITE side of "sync-then-read". Pulls recent days
// from Klaviyo and writes per-day snapshots the overview route reads instantly.
//
// The attribution-trailing trick keeps this cheap: a conversion can land days
// after a send, so only the trailing RESYNC_WINDOW_DAYS are re-fetched every run.
// Older days are frozen (synced once, never again). Steady state is therefore a
// bounded, constant cost regardless of how much history exists.

export const RESYNC_WINDOW_DAYS = 14;
const DEFAULT_BACKFILL_DAYS = 60;
const MAX_DAYS_PER_RUN = 20; // safety cap against rate limits / serverless timeouts

// Klaviyo's values-report endpoints have a low steady-state quota. Firing the
// per-day calls back-to-back trips the long (minutes) throttle, which klaviyoFetch
// refuses to wait out. So we PACE the per-day loop (~1 report/0.75s) to stay under
// the burst limit, and ABORT the run early after a few consecutive rate-limit
// errors — the unsynced days simply retry on the next (cron-spaced) run rather
// than hammering a throttled endpoint. This is added pacing around the shared
// client, not a change to its retry logic.
const PER_DAY_DELAY_MS = 1500;
const MAX_CONSECUTIVE_RATE_LIMITS = 3;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const isRateLimit = (e: unknown) => e instanceof Error && /rate-limited/i.test(e.message);

export interface SyncSummary {
  days_synced: number;
  days_failed: number;
  api_calls: number;
  duration_ms: number;
  warnings: string[];
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// "Today" in the account timezone so day buckets line up with Klaviyo's.
function todayInTz(tz: string): string {
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// Fold values-report rows (one per id×channel) into per-id day stats. opens/clicks
// use the *_unique measurements to match the live route's definition.
function foldFlows(results: FlowValuesResult[]): DayFlowStat[] {
  const by = new Map<string, DayFlowStat>();
  for (const r of results) {
    const id = r.groupings.flow_id;
    if (!id) continue;
    const cur = by.get(id) ?? { flow_id: id, recipients: 0, opens: 0, clicks: 0, revenue: 0 };
    cur.recipients += r.statistics.recipients ?? 0;
    cur.opens += r.statistics.opens_unique ?? r.statistics.opens ?? 0;
    cur.clicks += r.statistics.clicks_unique ?? r.statistics.clicks ?? 0;
    cur.revenue += r.statistics.conversion_value ?? 0;
    by.set(id, cur);
  }
  return [...by.values()];
}
function foldCampaigns(results: CampaignValuesResult[]): DayCampaignStat[] {
  const by = new Map<string, DayCampaignStat>();
  for (const r of results) {
    const id = r.groupings.campaign_id;
    if (!id) continue;
    const cur = by.get(id) ?? { campaign_id: id, recipients: 0, opens: 0, clicks: 0, revenue: 0 };
    cur.recipients += r.statistics.recipients ?? 0;
    cur.opens += r.statistics.opens_unique ?? r.statistics.opens ?? 0;
    cur.clicks += r.statistics.clicks_unique ?? r.statistics.clicks ?? 0;
    cur.revenue += r.statistics.conversion_value ?? 0;
    by.set(id, cur);
  }
  return [...by.values()];
}

function toCampaignDim(c: KlaviyoCampaign): CampaignDim {
  return {
    campaign_id: c.id,
    name: c.name,
    status: c.status,
    send_time: c.send_time ?? c.strategy_datetime ?? null,
    audience_count: c.audience_count,
  };
}

export async function syncMetrics(opts: { backfillDays?: number } = {}): Promise<SyncSummary> {
  const startedAt = Date.now();
  const warnings: string[] = [];
  let apiCalls = 0;
  let daysSynced = 0;
  let daysFailed = 0;

  const backfillDays = opts.backfillDays ?? DEFAULT_BACKFILL_DAYS;

  // (1) Timezone + pinned conversion metric. The metric is pinned (env/default),
  // so resolvePlacedOrderMetric makes no HTTP call.
  const timezone = await getAccountTimezone();
  apiCalls++; // timezone (cached per process, but one call on a cold run)
  const metric = await resolvePlacedOrderMetric();
  const placedId = metric.id;

  const today = todayInTz(timezone);
  const windowStart = addDays(today, -(RESYNC_WINDOW_DAYS - 1)); // oldest non-frozen day
  const isFrozen = (date: string) => date < windowStart;

  // (2) Days to sync: the whole trailing window (always re-fetched) + oldest
  // never-synced days within the backfill horizon, capped per run.
  const windowDates = eachDay(windowStart, today);
  const windowSet = new Set(windowDates);
  const synced = new Set(listSyncedDates());
  const missingBackfill = eachDay(addDays(today, -backfillDays), today)
    .filter((d) => !windowSet.has(d) && !synced.has(d))
    .sort(); // oldest first
  const backfillCapacity = Math.max(0, MAX_DAYS_PER_RUN - windowDates.length);
  // Sync order = trailing window NEWEST-first, then backfill oldest-first. The
  // window is freshness-critical, so if the run aborts early under throttling the
  // recent days are already done; older backfill days retry on the next run.
  const daysToSync = [...new Set([
    ...[...windowDates].reverse(),
    ...missingBackfill.slice(0, backfillCapacity),
  ])];

  if (missingBackfill.length > backfillCapacity) {
    warnings.push(`${missingBackfill.length - backfillCapacity} older un-synced day(s) deferred to a later run (MAX_DAYS_PER_RUN=${MAX_DAYS_PER_RUN}). Re-run to continue backfilling.`);
  }
  if (daysToSync.length === 0) {
    return { days_synced: 0, days_failed: 0, api_calls: apiCalls, duration_ms: Date.now() - startedAt, warnings };
  }

  // (3) ONE metric-aggregate over the whole span, interval=day → per-day revenue
  // buckets. Never call the aggregate per-day. Span is min..max of the day set
  // (daysToSync is priority-ordered, not date-ordered, so compute explicitly).
  const sortedDates = [...daysToSync].sort();
  const spanStart = sortedDates[0];
  const spanEnd = sortedDates[sortedDates.length - 1];
  const { start: aggStart, end: aggEnd } = dayRangeISO(spanStart, spanEnd);
  const revByDay = new Map<string, { total: number; order_count: number }>();
  try {
    const agg = await aggregateMetric({ metricId: placedId, start: aggStart, end: aggEnd, measurements: ["sum_value", "count"], interval: "day", timezone });
    apiCalls++;
    const dates = agg.dates ?? [];
    for (let i = 0; i < dates.length; i++) {
      const ymd = dates[i].slice(0, 10);
      let total = 0;
      let count = 0;
      for (const g of agg.data) {
        total += g.measurements.sum_value?.[i] ?? 0;
        count += g.measurements.count?.[i] ?? 0;
      }
      revByDay.set(ymd, { total, order_count: count });
    }
  } catch (e) {
    warnings.push(`Revenue aggregate failed for ${spanStart}..${spanEnd} — days written with 0 total revenue: ${e instanceof Error ? e.message : e}`);
  }

  // (4) Per-day flow + campaign values reports (sequential, date order). A single
  // day failing records a warning and is skipped (stays missing → retried next
  // run) rather than aborting the whole sync.
  const campaignIdsSeen = new Set<string>();
  let consecutiveRateLimits = 0;
  for (let i = 0; i < daysToSync.length; i++) {
    const date = daysToSync[i];
    if (i > 0) await sleep(PER_DAY_DELAY_MS); // pace to respect the steady-state quota
    const { start, end } = dayRangeISO(date, date);
    try {
      const flowReport = await flowValuesReport({ start, end, conversionMetricId: placedId });
      apiCalls++;
      const campaignReport = await campaignValuesReport({ start, end, conversionMetricId: placedId });
      apiCalls++;
      consecutiveRateLimits = 0;
      if (flowReport.truncated) warnings.push(`${date}: flow report hit the page cap — revenue may be understated.`);
      if (campaignReport.truncated) warnings.push(`${date}: campaign report hit the page cap — revenue may be understated.`);

      const flows = foldFlows(flowReport.results);
      const campaigns = foldCampaigns(campaignReport.results);
      for (const c of campaigns) campaignIdsSeen.add(c.campaign_id);

      const snapshot: DaySnapshot = {
        date,
        synced_at: new Date().toISOString(),
        frozen: isFrozen(date),
        revenue: revByDay.get(date) ?? { total: 0, order_count: 0 },
        flows,
        campaigns,
      };
      writeDay(snapshot);
      daysSynced++;
    } catch (e) {
      daysFailed++;
      warnings.push(`${date}: sync failed, will retry next run — ${e instanceof Error ? e.message : e}`);
      if (isRateLimit(e)) {
        consecutiveRateLimits++;
        if (consecutiveRateLimits >= MAX_CONSECUTIVE_RATE_LIMITS) {
          const remaining = daysToSync.length - 1 - i;
          warnings.push(`Aborted early after ${consecutiveRateLimits} consecutive rate-limit errors; ${remaining} day(s) left for the next run. Klaviyo's values-report quota is exhausted — space out runs.`);
          break;
        }
      }
    }
  }

  // (5) Refresh dimensions once per run. Flow names/statuses; campaign metadata
  // for ids seen in the synced days that we don't already have; draft + scheduled
  // lists. Campaign metadata accumulates across runs so old names stay resolvable.
  const existing = readDimensions();
  const dims: Dimensions = { ...existing, timezone, synced_at: new Date().toISOString() };
  try {
    const flowList = await listFlows();
    apiCalls++;
    dims.flows = flowList.map<FlowDim>((f) => ({ flow_id: f.id, name: f.name, status: f.status }));

    const known = new Map(existing.campaigns.map((c) => [c.campaign_id, c]));
    const missingMetaIds = [...campaignIdsSeen].filter((id) => !known.has(id));
    if (missingMetaIds.length) {
      const fetched = await fetchCampaignsByIds(missingMetaIds);
      apiCalls++;
      for (const c of fetched) known.set(c.id, toCampaignDim(c));
    }
    dims.campaigns = [...known.values()];

    const draftRes = await fetchCampaignsByStatus("Draft");
    apiCalls++;
    const scheduledRes = await fetchCampaignsByStatus("Scheduled");
    apiCalls++;
    if (draftRes.truncated) warnings.push("More draft campaigns exist than shown (showing the 100 most recent).");
    if (scheduledRes.truncated) warnings.push("More scheduled campaigns exist than shown (showing the 100 most recent).");
    dims.draft = draftRes.campaigns.map(toCampaignDim);
    dims.scheduled = scheduledRes.campaigns.map(toCampaignDim).sort((a, b) => (a.send_time || "").localeCompare(b.send_time || ""));

    writeDimensions(dims);
  } catch (e) {
    warnings.push(`Dimensions refresh failed (names/statuses may be stale): ${e instanceof Error ? e.message : e}`);
    // Still persist timezone/synced_at + any campaign metadata we had.
    writeDimensions(dims);
  }

  const summary: SyncSummary = { days_synced: daysSynced, days_failed: daysFailed, api_calls: apiCalls, duration_ms: Date.now() - startedAt, warnings };
  console.log(`[metrics/sync] ${spanStart}..${spanEnd} synced=${daysSynced} failed=${daysFailed} calls=${apiCalls} ${summary.duration_ms}ms`);
  return summary;
}
