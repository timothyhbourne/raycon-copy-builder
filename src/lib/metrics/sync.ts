import {
  aggregateMetric,
  campaignValuesReport,
  dayRangeISO,
  fetchCampaignsByIds,
  fetchCampaignsByStatus,
  flowSeriesReport,
  listFlows,
  getAccountTimezone,
  resolvePlacedOrderMetric,
  type CampaignValuesResult,
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
// QUOTA MATH (why this run is ~4 reporting calls, not 2-per-day):
// Klaviyo's reporting endpoints share a tight quota — burst 1/s, steady 2/min,
// 225 calls/day. The original design made 2 values-report calls PER DAY (28 for
// a 14-day window every run), which exhausted the steady quota after the first
// few calls and could never finish. This version instead makes, per run:
//   1 metric-aggregate over the whole span (separate, generous quota)
//   1 flow-series report, interval=daily — per-day stats for ALL flows in 1 call
//   1 campaign-values report over the whole span — totals per campaign in 1 call
//   (+ campaign metadata / dimension calls on their own, separate quotas)
//
// CAMPAIGN DAY-BUCKETING: /campaign-series-reports/ 404s on this account /
// revision (verified 2026-07-09), so campaigns can't use a daily series like
// flows do. Instead: campaigns are point-in-time sends, so ONE values report
// over the span gives per-campaign totals, and each campaign's totals are
// written onto its SEND DATE (from campaign metadata, in the account timezone).
// While a campaign is inside the trailing resync window its totals get
// re-fetched every run (trailing conversions keep accruing); once its send date
// freezes, its numbers are final. This matches how the old live dashboard
// attributed campaign stats (values report over the visible range).
//
// The attribution-trailing trick: a conversion can land days after a send, so
// the trailing RESYNC_WINDOW_DAYS are re-written every run and older days are
// frozen (synced once, never again).

export const RESYNC_WINDOW_DAYS = 14;
const DEFAULT_BACKFILL_DAYS = 60;
// One series/values call covers the whole span, so the cap is about response
// size and serverless time, not call count.
const MAX_SPAN_DAYS = 90;

export interface SyncSummary {
  days_synced: number;
  days_failed: number;
  api_calls: number;
  duration_ms: number;
  warnings: string[];
  coalesced?: boolean; // true when this call piggybacked on an already-running sync
}

export interface SyncOptions {
  backfillDays?: number;
  // Explicit range mode: sync exactly these days (historical ranges the
  // today-anchored backfill can never reach, e.g. "compare to January").
  rangeStart?: string; // YYYY-MM-DD
  rangeEnd?: string;   // YYYY-MM-DD
}

// ---------------------------------------------------------------------------
// Concurrency control. UI "Sync now", the overview's missing-days trigger, and
// the cron can all fire together, which doubles pressure on the 2/min reporting
// quota. Identical requests coalesce into the one already running/queued;
// DIFFERENT requests (e.g. a January range arriving while the default window
// sync runs) queue behind it instead of being silently swallowed — that
// swallowing is exactly what made "Sync now" on a custom range do nothing.
// Per-process, which matches the single-instance deployment the store assumes.
// ---------------------------------------------------------------------------
const pendingByKey = new Map<string, Promise<SyncSummary>>();
let syncChain: Promise<unknown> = Promise.resolve();

export function syncMetrics(opts: SyncOptions = {}): Promise<SyncSummary> {
  const key = JSON.stringify([opts.backfillDays ?? null, opts.rangeStart ?? null, opts.rangeEnd ?? null]);
  const existing = pendingByKey.get(key);
  if (existing) return existing.then((s) => ({ ...s, coalesced: true }));
  const run: Promise<SyncSummary> = syncChain.then(() => doSync(opts));
  pendingByKey.set(key, run);
  syncChain = run.catch(() => { /* keep the chain alive after a failed run */ });
  void run.finally(() => pendingByKey.delete(key));
  return run;
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// A date's YYYY-MM-DD label in the given IANA timezone.
function ymdInTz(dateISO: string, tz: string): string | null {
  const d = new Date(dateISO);
  if (isNaN(d.getTime())) return null;
  try {
    return d.toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

// "Today" in the account timezone so day buckets line up with Klaviyo's.
function todayInTz(tz: string): string {
  return ymdInTz(new Date().toISOString(), tz) ?? new Date().toISOString().slice(0, 10);
}

type Stat = { recipients: number; opens: number; clicks: number; revenue: number };

// Fold one flow-series result row (stat arrays aligned to date buckets) into the
// per-day accumulator. Rows are per id×channel; multiple rows for the same id
// accumulate. Days with all-zero stats are skipped to keep snapshots small.
function foldSeriesRow(
  perDay: Map<string, Map<string, Stat>>,
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
    const day = perDay.get(dates[i]) ?? new Map<string, Stat>();
    const cur = day.get(id) ?? { recipients: 0, opens: 0, clicks: 0, revenue: 0 };
    cur.recipients += recipients;
    cur.opens += opens;
    cur.clicks += clicks;
    cur.revenue += revenue;
    day.set(id, cur);
    perDay.set(dates[i], day);
  }
}

// Fold campaign values-report rows (one per id×channel) into per-id totals.
function foldCampaignTotals(results: CampaignValuesResult[]): Map<string, Stat> {
  const by = new Map<string, Stat>();
  for (const r of results) {
    const id = r.groupings.campaign_id;
    if (!id) continue;
    const cur = by.get(id) ?? { recipients: 0, opens: 0, clicks: 0, revenue: 0 };
    cur.recipients += r.statistics.recipients ?? 0;
    cur.opens += r.statistics.opens_unique ?? r.statistics.opens ?? 0;
    cur.clicks += r.statistics.clicks_unique ?? r.statistics.clicks ?? 0;
    cur.revenue += r.statistics.conversion_value ?? 0;
    by.set(id, cur);
  }
  return by;
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

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

async function doSync(opts: SyncOptions = {}): Promise<SyncSummary> {
  const startedAt = Date.now();
  const warnings: string[] = [];
  let apiCalls = 0;
  let daysSynced = 0;

  const backfillDays = opts.backfillDays ?? DEFAULT_BACKFILL_DAYS;

  // (1) Timezone + pinned conversion metric (no /metrics/ scan — pinned id).
  const timezone = await getAccountTimezone();
  apiCalls++; // one call on a cold process; cached afterwards
  const metric = await resolvePlacedOrderMetric();
  const placedId = metric.id;

  const today = todayInTz(timezone);
  const windowStart = addDays(today, -(RESYNC_WINDOW_DAYS - 1)); // oldest non-frozen day
  const isFrozen = (date: string) => date < windowStart;
  const synced = new Set(listSyncedDates());

  // (2) The span this run fetches, in one of two modes:
  //
  //  RANGE mode (rangeStart/rangeEnd set): sync exactly the requested days.
  //  This is how historical ranges get filled — the default mode is anchored at
  //  today and capped, so a range like last January is unreachable by backfill
  //  and MUST be requested explicitly. All days in the range are (re)written;
  //  historical days are marked frozen immediately (synced once, final).
  //
  //  DEFAULT mode: trailing resync window (always re-fetched) plus any
  //  never-synced days within the backfill horizon.
  let spanStart: string;
  let spanEnd: string;
  const rangeMode = YMD_RE.test(opts.rangeStart ?? "") && YMD_RE.test(opts.rangeEnd ?? "");
  if (rangeMode) {
    spanStart = opts.rangeStart!;
    spanEnd = opts.rangeEnd! > today ? today : opts.rangeEnd!;
    if (spanStart > spanEnd) {
      warnings.push(`Invalid range ${opts.rangeStart}..${opts.rangeEnd} — nothing to sync.`);
      return { days_synced: 0, days_failed: 0, api_calls: apiCalls, duration_ms: Date.now() - startedAt, warnings };
    }
    if (eachDay(spanStart, spanEnd).length > MAX_SPAN_DAYS) {
      // Keep the START (the user is filling history oldest-first); later chunks
      // re-trigger naturally while their days remain missing.
      spanEnd = addDays(spanStart, MAX_SPAN_DAYS - 1);
      warnings.push(`Range capped at ${MAX_SPAN_DAYS} days per run (${spanStart}..${spanEnd}); request again for the rest.`);
    }
  } else {
    spanEnd = today;
    const backfillStart = addDays(today, -backfillDays);
    const missing = eachDay(backfillStart, today).filter((d) => !synced.has(d));
    const oldestNeeded = missing.length ? (missing[0] < windowStart ? missing[0] : windowStart) : windowStart;
    spanStart = eachDay(oldestNeeded, today).length > MAX_SPAN_DAYS
      ? addDays(today, -(MAX_SPAN_DAYS - 1))
      : oldestNeeded;
    if (spanStart !== oldestNeeded) {
      warnings.push(`Span capped at ${MAX_SPAN_DAYS} days (${spanStart}..${today}); older days sync on later runs.`);
    }
  }

  const spanDates = eachDay(spanStart, spanEnd);
  // Days this run (re)writes. Range mode: everything requested (idempotent —
  // the data for the whole span is already in hand). Default mode: unfrozen
  // days + frozen days with no snapshot.
  const daysToWrite = rangeMode ? spanDates : spanDates.filter((d) => !isFrozen(d) || !synced.has(d));
  if (daysToWrite.length === 0) {
    return { days_synced: 0, days_failed: 0, api_calls: apiCalls, duration_ms: Date.now() - startedAt, warnings };
  }

  const { start, end } = dayRangeISO(spanStart, spanEnd);

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
    warnings.push(`Revenue aggregate failed for ${spanStart}..${spanEnd} — days written with 0 total revenue: ${e instanceof Error ? e.message : e}`);
  }

  // (4) Flow series (per-day, 1 call) + campaign values (per-campaign totals,
  // 1 call). If either fails the run writes nothing — a partial snapshot (flows
  // without campaigns) would read as a real day with zero campaign revenue.
  let flowSeries: Awaited<ReturnType<typeof flowSeriesReport>>;
  let campaignTotals: Map<string, Stat>;
  try {
    flowSeries = await flowSeriesReport({ start, end, conversionMetricId: placedId });
    apiCalls++;
    const campaignReport = await campaignValuesReport({ start, end, conversionMetricId: placedId });
    apiCalls++;
    if (campaignReport.truncated) warnings.push("Campaign values report hit the page cap — some campaigns may be missing.");
    campaignTotals = foldCampaignTotals(campaignReport.results);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warnings.push(`Report fetch failed — no days written this run, will retry next run: ${msg}`);
    const summary: SyncSummary = { days_synced: 0, days_failed: daysToWrite.length, api_calls: apiCalls, duration_ms: Date.now() - startedAt, warnings };
    console.log(`[metrics/sync] ${spanStart}..${spanEnd} synced=0 failed=${summary.days_failed} calls=${apiCalls} ${summary.duration_ms}ms (report failure)`);
    return summary;
  }
  if (flowSeries.truncated) warnings.push("Flow series hit the page cap — some flows may be missing.");

  // Flow buckets: date_times → YMD labels (account-timezone day boundaries).
  const flowDates = flowSeries.dateTimes.map((d) => d.slice(0, 10));
  if (flowDates.length === 0 && flowSeries.results.length > 0) {
    warnings.push("Flow series returned results but no date_times — check API response shape.");
  }
  const flowsPerDay = new Map<string, Map<string, Stat>>();
  for (const r of flowSeries.results as SeriesResult<{ flow_id?: string }>[]) {
    if (r.groupings.flow_id) foldSeriesRow(flowsPerDay, flowDates, r.groupings.flow_id, r.statistics);
  }

  // (5) Campaign metadata (need send_time to bucket totals onto the send date).
  // Reuse anything dimensions already knows; fetch only the unknown ids. This
  // metadata also feeds the dimensions refresh below — fetched once, used twice.
  const existing = readDimensions();
  const knownMeta = new Map(existing.campaigns.map((c) => [c.campaign_id, c]));
  const unknownIds = [...campaignTotals.keys()].filter((id) => !knownMeta.get(id)?.send_time);
  if (unknownIds.length) {
    try {
      const fetched = await fetchCampaignsByIds(unknownIds);
      apiCalls++;
      for (const c of fetched) knownMeta.set(c.id, toCampaignDim(c));
    } catch (e) {
      warnings.push(`Campaign metadata fetch failed — ${unknownIds.length} campaign(s) skipped this run: ${e instanceof Error ? e.message : e}`);
    }
  }

  const campaignsPerDay = new Map<string, Map<string, Stat>>();
  for (const [id, stat] of campaignTotals) {
    const sendTime = knownMeta.get(id)?.send_time;
    const sendDate = sendTime ? ymdInTz(sendTime, timezone) : null;
    if (!sendDate) {
      warnings.push(`Campaign ${id} has stats but no resolvable send date — skipped this run.`);
      continue;
    }
    // Clamp send dates just outside the span (timeframe edges) into the span.
    const bucket = sendDate < spanStart ? spanStart : sendDate > spanEnd ? spanEnd : sendDate;
    const day = campaignsPerDay.get(bucket) ?? new Map<string, Stat>();
    day.set(id, stat);
    campaignsPerDay.set(bucket, day);
  }

  // (6) Write snapshots. Every day in the span gets a file (a day with no
  // activity is a legitimate zero day — writing it marks it synced so backfill
  // doesn't re-request it forever).
  for (const date of daysToWrite) {
    const flows: DayFlowStat[] = [...(flowsPerDay.get(date) ?? new Map<string, Stat>()).entries()]
      .map(([flow_id, s]) => ({ flow_id, ...s }));
    const campaigns: DayCampaignStat[] = [...(campaignsPerDay.get(date) ?? new Map<string, Stat>()).entries()]
      .map(([campaign_id, s]) => ({ campaign_id, ...s }));
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

  // (7) Refresh dimensions once per run (flows/campaigns lists — separate, more
  // generous quotas than the reporting endpoints). Campaign metadata was already
  // merged into knownMeta above.
  const dims: Dimensions = { ...existing, timezone, synced_at: new Date().toISOString() };
  try {
    const flowList = await listFlows();
    apiCalls++;
    dims.flows = flowList.map<FlowDim>((f) => ({ flow_id: f.id, name: f.name, status: f.status }));
    dims.campaigns = [...knownMeta.values()];

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
    dims.campaigns = [...knownMeta.values()];
    writeDimensions(dims); // still persist timezone/synced_at + whatever we had
  }

  const summary: SyncSummary = { days_synced: daysSynced, days_failed: 0, api_calls: apiCalls, duration_ms: Date.now() - startedAt, warnings };
  console.log(`[metrics/sync] ${spanStart}..${spanEnd} synced=${daysSynced} failed=0 calls=${apiCalls} ${summary.duration_ms}ms`);
  return summary;
}
