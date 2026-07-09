import {
  aggregateMetric,
  campaignSeriesReport,
  dayRangeISO,
  fetchCampaignsByIds,
  fetchCampaignsByStatus,
  flowSeriesReport,
  listFlows,
  getAccountTimezone,
  resolvePlacedOrderMetric,
  type KlaviyoCampaign,
  type SeriesResult,
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
// QUOTA MATH (why this uses SERIES reports, not per-day values reports):
// Klaviyo's reporting endpoints share a tight quota — burst 1/s, steady 2/min,
// 225 calls/day. The previous design made 2 values-report calls PER DAY (28 for
// a 14-day window every run), which exhausted the steady quota after the first
// few calls and could never finish; a 30-min cron would also blow the daily cap.
// A series report with interval=daily returns per-day stats for every flow /
// campaign across the WHOLE timeframe in one call, so a full run is:
//   1 metric-aggregate (separate, generous quota)
//   1 flow-series + 1 campaign-series (+pagination pages, usually 0-2 extra)
//   occasional dimension calls (campaigns/flows lists — separate quotas)
// That's ~2-4 reporting calls per run: hourly cron ≈ 48-96/day, inside the 225 cap.
//
// The attribution-trailing trick still applies: a conversion can land days after
// a send, so the trailing RESYNC_WINDOW_DAYS are re-written every run and older
// days are frozen (synced once, never again). With series reports the window
// costs nothing extra — it's inside the same single timeframe.

export const RESYNC_WINDOW_DAYS = 14;
const DEFAULT_BACKFILL_DAYS = 60;
// One series call covers the whole span, so the cap is about response size and
// serverless time, not call count.
const MAX_SPAN_DAYS = 90;

export interface SyncSummary {
  days_synced: number;
  days_failed: number;
  api_calls: number;
  duration_ms: number;
  warnings: string[];
  coalesced?: boolean; // true when this call piggybacked on an already-running sync
}

// ---------------------------------------------------------------------------
// In-flight guard. The logs showed overlapping sync runs (UI "Sync now" + the
// overview's missing-days trigger + cron can all fire together), which doubles
// pressure on the 2/min reporting quota. Concurrent callers now coalesce into
// the one running sync and receive its summary. Per-process, which matches the
// single-instance deployment the file store assumes.
// ---------------------------------------------------------------------------
let inFlight: Promise<SyncSummary> | null = null;

export function syncMetrics(opts: { backfillDays?: number } = {}): Promise<SyncSummary> {
  if (inFlight) {
    return inFlight.then((s) => ({ ...s, coalesced: true }));
  }
  inFlight = doSync(opts).finally(() => { inFlight = null; });
  return inFlight;
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

// Fold one series result row (stat arrays aligned to date buckets) into the
// per-day accumulator. Rows are per id×channel; multiple rows for the same id
// accumulate. Days with all-zero stats are skipped to keep snapshots small.
function foldSeriesRow(
  perDay: Map<string, Map<string, { recipients: number; opens: number; clicks: number; revenue: number }>>,
  dates: string[],
  id: string,
  stats: Record<string, number[]>
): void {
  for (let i = 0; i < dates.length; i++) {
    const recipients = stats.recipients?.[i] ?? 0;
    const opens = stats.opens_unique?.[i] ?? 0;
    const clicks = stats.clicks_unique?.[i] ?? 0;
    const revenue = stats.conversion_value?.[i] ?? 0;
    if (!recipients && !opens && !clicks && !revenue) continue;
    const day = perDay.get(dates[i]) ?? new Map();
    const cur = day.get(id) ?? { recipients: 0, opens: 0, clicks: 0, revenue: 0 };
    cur.recipients += recipients;
    cur.opens += opens;
    cur.clicks += clicks;
    cur.revenue += revenue;
    day.set(id, cur);
    perDay.set(dates[i], day);
  }
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

async function doSync(opts: { backfillDays?: number } = {}): Promise<SyncSummary> {
  const startedAt = Date.now();
  const warnings: string[] = [];
  let apiCalls = 0;
  let daysSynced = 0;
  let daysFailed = 0;

  const backfillDays = opts.backfillDays ?? DEFAULT_BACKFILL_DAYS;

  // (1) Timezone + pinned conversion metric (no /metrics/ scan — pinned id).
  const timezone = await getAccountTimezone();
  apiCalls++; // one call on a cold process; cached afterwards
  const metric = await resolvePlacedOrderMetric();
  const placedId = metric.id;

  const today = todayInTz(timezone);
  const windowStart = addDays(today, -(RESYNC_WINDOW_DAYS - 1)); // oldest non-frozen day
  const isFrozen = (date: string) => date < windowStart;

  // (2) The span: trailing window (always re-synced) plus any never-synced days
  // within the backfill horizon. One series call covers the whole span, so we
  // take the min start and cap the total length.
  const synced = new Set(listSyncedDates());
  const backfillStart = addDays(today, -backfillDays);
  const missing = eachDay(backfillStart, today).filter((d) => !synced.has(d));
  const oldestNeeded = missing.length ? (missing[0] < windowStart ? missing[0] : windowStart) : windowStart;
  const spanStartUncapped = oldestNeeded;
  const spanStart = eachDay(spanStartUncapped, today).length > MAX_SPAN_DAYS
    ? addDays(today, -(MAX_SPAN_DAYS - 1))
    : spanStartUncapped;
  if (spanStart !== spanStartUncapped) {
    warnings.push(`Span capped at ${MAX_SPAN_DAYS} days (${spanStart}..${today}); older days sync on later runs.`);
  }
  const spanDates = eachDay(spanStart, today);
  // Days this run intends to (re)write: unfrozen days + frozen days with no snapshot.
  const daysToWrite = spanDates.filter((d) => !isFrozen(d) || !synced.has(d));
  if (daysToWrite.length === 0) {
    return { days_synced: 0, days_failed: 0, api_calls: apiCalls, duration_ms: Date.now() - startedAt, warnings };
  }

  const { start, end } = dayRangeISO(spanStart, today);

  // (3) ONE metric-aggregate over the span, interval=day → per-day revenue.
  const revByDay = new Map<string, { total: number; order_count: number }>();
  try {
    const agg = await aggregateMetric({ metricId: placedId, start, end, measurements: ["sum_value", "count"], interval: "day", timezone });
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
    warnings.push(`Revenue aggregate failed for ${spanStart}..${today} — days written with 0 total revenue: ${e instanceof Error ? e.message : e}`);
  }

  // (4) ONE flow-series + ONE campaign-series call for the whole span. If either
  // fails the run records the failure and writes nothing (a partial snapshot —
  // flows without campaigns — would read as a real day of zero campaign revenue).
  let flowSeries: Awaited<ReturnType<typeof flowSeriesReport>>;
  let campaignSeries: Awaited<ReturnType<typeof campaignSeriesReport>>;
  try {
    flowSeries = await flowSeriesReport({ start, end, conversionMetricId: placedId });
    apiCalls++;
    campaignSeries = await campaignSeriesReport({ start, end, conversionMetricId: placedId });
    apiCalls++;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warnings.push(`Series report failed — no days written this run, will retry next run: ${msg}`);
    const summary: SyncSummary = { days_synced: 0, days_failed: daysToWrite.length, api_calls: apiCalls, duration_ms: Date.now() - startedAt, warnings };
    console.log(`[metrics/sync] ${spanStart}..${today} synced=0 failed=${summary.days_failed} calls=${apiCalls} ${summary.duration_ms}ms (series failure)`);
    return summary;
  }
  if (flowSeries.truncated) warnings.push("Flow series hit the page cap — some flows may be missing.");
  if (campaignSeries.truncated) warnings.push("Campaign series hit the page cap — some campaigns may be missing.");

  // date_times → YMD bucket labels. Buckets are account-timezone day boundaries;
  // the leading 10 chars of the ISO datetime are the day label in that timezone.
  const flowDates = flowSeries.dateTimes.map((d) => d.slice(0, 10));
  const campaignDates = campaignSeries.dateTimes.map((d) => d.slice(0, 10));
  if (flowDates.length === 0 && flowSeries.results.length > 0) {
    warnings.push("Flow series returned results but no date_times — check API response shape.");
  }

  const flowsPerDay = new Map<string, Map<string, { recipients: number; opens: number; clicks: number; revenue: number }>>();
  for (const r of flowSeries.results as SeriesResult<{ flow_id?: string }>[]) {
    if (r.groupings.flow_id) foldSeriesRow(flowsPerDay, flowDates, r.groupings.flow_id, r.statistics);
  }
  const campaignsPerDay = new Map<string, Map<string, { recipients: number; opens: number; clicks: number; revenue: number }>>();
  for (const r of campaignSeries.results as SeriesResult<{ campaign_id?: string }>[]) {
    if (r.groupings.campaign_id) foldSeriesRow(campaignsPerDay, campaignDates, r.groupings.campaign_id, r.statistics);
  }

  // (5) Write snapshots. Every day in the span gets a file (a day with no
  // activity is a legitimate zero day — writing it marks it synced so backfill
  // doesn't re-request it forever).
  const campaignIdsSeen = new Set<string>();
  for (const date of daysToWrite) {
    const flows: DayFlowStat[] = [...(flowsPerDay.get(date) ?? new Map()).entries()]
      .map(([flow_id, s]) => ({ flow_id, ...s }));
    const campaigns: DayCampaignStat[] = [...(campaignsPerDay.get(date) ?? new Map()).entries()]
      .map(([campaign_id, s]) => ({ campaign_id, ...s }));
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
  }

  // Campaign ids from already-frozen days may still lack metadata (e.g. dims file
  // was lost); include ids from any day we saw in this span's series data.
  for (const [, day] of campaignsPerDay) for (const id of day.keys()) campaignIdsSeen.add(id);

  // (6) Refresh dimensions once per run (flows/campaigns lists — separate, more
  // generous quotas than the reporting endpoints).
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
    writeDimensions(dims); // still persist timezone/synced_at + whatever we had
  }

  const summary: SyncSummary = { days_synced: daysSynced, days_failed: daysFailed, api_calls: apiCalls, duration_ms: Date.now() - startedAt, warnings };
  console.log(`[metrics/sync] ${spanStart}..${today} synced=${daysSynced} failed=${daysFailed} calls=${apiCalls} ${summary.duration_ms}ms`);
  return summary;
}
