import {
  aggregateMetric, campaignValuesReport, dayRangeISO, fetchCampaignsByIds, fetchCampaignsByStatus,
  flowSeriesReport, getAccountTimezone, listFlows, resolvePlacedOrderMetric, sumArray,
  seriesBucketYMD, seriesRangeISO, MAX_DAILY_SERIES_DAYS,
} from "./klaviyo";
import {
  addYmdDays, attributionDays, clearProgress, clearSnapshot, emptyStats, mergeSnapshot,
  readProgress, readSnapshot, writeProgress, writeSnapshot, ymdInTz,
  type CampaignMetaRow, type CampaignSnapshotRow, type DayTotalRow, type FlowDayRow, type FlowMetaRow,
  type KlaviyoSnapshot, type Stats,
} from "./klaviyo-snapshot";
import { todayYMDInTz, zonedMidnightUtc } from "./cache-ttl";
import { isBlocked, MIN_SPACING_MS } from "./klaviyo-limiter";
import { syncAudiences } from "./klaviyo-audiences";

// The snapshot's writer (spec: KLAVIYO_RATE_LIMIT_SPEC §3.1, §3.4).
//
// COST, measured live on this account 2026-08-25 rather than assumed:
//   campaign-values, any window        1 page  = 1 reporting call
//   flow-series, daily, 60-day window  4 pages = 4 reporting calls
//   metric-aggregates, daily buckets   0 reporting calls (3/s, 60/min, no cap)
//
// So a full 60-day refresh is 5 reporting calls — 2.2% of the 225/day cap — and an
// incremental one is 1. Against the old behaviour (2+ calls per uncached date
// range, and a flow report that could never finish) this is the whole fix.
//
// Every reporting page waits for the limiter, which paces them 31s apart. That
// makes a run take MINUTES by design, which is longer than a serverless
// invocation: hence the STEP BUDGET. A run does as much as fits, persists what it
// got, and reports what is left; the next run continues. Correct after any number
// of partial runs, because merging is idempotent (see mergeSnapshot).

/** MEASURED 2026-08-29: 9 pages of segments + 27 of lists = 36 sequential
 * requests, 17.5s. Used to reserve time for the audiences step rather than
 * discovering the cost as a function timeout. */
const AUDIENCE_CATALOGUE_MS = 20_000;

export type SyncMode = "full" | "incremental";

/** What a step declares about its own cost, for the budget check below. */
export interface StepCost {
  reporting: boolean;
  /** Wall clock the step needs before it is worth starting. Omit for a step whose
   * work is a single call. */
  needMs?: number;
}

/**
 * How long a step needs before it is worth STARTING.
 *
 * Pure and separately tested because getting this wrong does not fail loudly — it
 * starts work that cannot finish, and the function is killed mid-flight with a
 * FUNCTION_INVOCATION_TIMEOUT and no step result. That has already happened once
 * in production, so the arithmetic is tested rather than eyeballed.
 */
export function stepNeedMs(unit: StepCost, slotWaitMs: number): number {
  if (unit.needMs != null) return unit.needMs;
  return unit.reporting ? slotWaitMs + 8_000 : 8_000;
}

export interface SyncStepResult {
  step: string;
  ok: boolean;
  detail: string;
  pages?: number;
}

export interface SyncResult {
  mode: SyncMode;
  window: { start: string; end: string };
  steps: SyncStepResult[];
  completed: boolean;
  /** Steps not attempted because the time budget ran out or the breaker is open. */
  remaining: string[];
  reporting_calls: number;
  snapshot_synced_at: string | null;
  blocked: { blocked: boolean; forS: number };
  warnings: string[];
}

export interface SyncOpts {
  mode?: SyncMode;
  /** Discard the stored snapshot before syncing. For an alignment/shape change:
   * merging preserves rows, so a corrected run must be able to start clean. */
  reset?: boolean;
  /** How many days back to cover. Defaults to 60 (one daily-series window). */
  days?: number;
  /** Wall-clock budget. A serverless caller passes ~30s; a script passes hours. */
  budgetMs?: number;
  /**
   * Most steps to run in ONE invocation. The route passes 1.
   *
   * A budget check between steps is not enough on serverless: a single step can
   * overrun on its own (a reporting step waits up to ~31s for its slot, on top of
   * whatever the cheap steps before it took) and the whole function is then killed
   * with FUNCTION_INVOCATION_TIMEOUT — which also kills the after() hand-off, so
   * the chain stops dead. One step per invocation makes a hop's cost bounded by
   * the slowest SINGLE step rather than the sum.
   */
  maxSteps?: number;
  /** How long a reporting page may wait for its limiter slot. Short on serverless:
   * a refused claim is cheap because the next hop simply tries again. */
  slotWaitMs?: number;
  /** Pages to fetch per step per invocation. The route passes 1: each page needs
   * its own 31s pacing slot, so a 4-page report cannot finish in one 60s function
   * however the budget is arranged. The cursor carries it across hops. */
  maxPagesPerStep?: number;
  /** Progress line sink — the script prints these, the route logs them. */
  log?: (line: string) => void;
}

/** Default snapshot depth. 60 days is one daily-series window (Klaviyo rejects a
 * daily interval beyond that), and it covers month-to-date plus the
 * period-over-period comparisons the dashboard actually offers. */
export const DEFAULT_SNAPSHOT_DAYS = 60;

const noop = () => {};

/** Zip a series report's aligned arrays into per-day rows. */
function seriesToDays(
  dateTimes: string[],
  results: { groupings: { flow_id?: string }; statistics: Record<string, number[]> }[],
): FlowDayRow[] {
  // Several message rows can share a flow on the same day; fold them together.
  const byKey = new Map<string, FlowDayRow>();
  // The label IS the account-tz day (stamped "+00:00"). Converting it as an
  // instant shifted every flow day one day earlier — see seriesBucketYMD.
  const ymds = dateTimes.map(seriesBucketYMD);

  for (const r of results) {
    const flowId = r.groupings.flow_id;
    if (!flowId) continue;
    for (let i = 0; i < ymds.length; i++) {
      const ymd = ymds[i];
      const stats: Partial<Stats> = {
        recipients: r.statistics.recipients?.[i] ?? 0,
        delivered: r.statistics.delivered?.[i] ?? 0,
        opens_unique: r.statistics.opens_unique?.[i] ?? 0,
        clicks_unique: r.statistics.clicks_unique?.[i] ?? 0,
        conversion_value: r.statistics.conversion_value?.[i] ?? 0,
        conversions: r.statistics.conversions?.[i] ?? 0,
        unsubscribes: r.statistics.unsubscribes?.[i] ?? 0,
        spam_complaints: r.statistics.spam_complaints?.[i] ?? 0,
        bounced: r.statistics.bounced?.[i] ?? 0,
      };
      // Skip empty days so the snapshot doesn't carry tens of thousands of zeros.
      const any = Object.values(stats).some((v) => (v ?? 0) !== 0);
      const key = `${flowId}|${ymd}`;
      const cur = byKey.get(key);
      if (!any && !cur) continue;
      const merged = cur ? { ...cur } : { flow_id: flowId, ymd, stats: emptyStats() };
      merged.stats = {
        recipients: merged.stats.recipients + (stats.recipients ?? 0),
        delivered: merged.stats.delivered + (stats.delivered ?? 0),
        opens_unique: merged.stats.opens_unique + (stats.opens_unique ?? 0),
        clicks_unique: merged.stats.clicks_unique + (stats.clicks_unique ?? 0),
        conversion_value: merged.stats.conversion_value + (stats.conversion_value ?? 0),
        conversions: merged.stats.conversions + (stats.conversions ?? 0),
        unsubscribes: merged.stats.unsubscribes + (stats.unsubscribes ?? 0),
        spam_complaints: merged.stats.spam_complaints + (stats.spam_complaints ?? 0),
        bounced: merged.stats.bounced + (stats.bounced ?? 0),
      };
      byKey.set(key, merged);
    }
  }
  return [...byKey.values()];
}

/** Split a window into chunks Klaviyo will accept for a daily interval. */
export function dailyChunks(start: string, end: string, maxDays = MAX_DAILY_SERIES_DAYS): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  let cursor = start;
  while (cursor <= end) {
    const chunkEnd = [addYmdDays(cursor, maxDays - 1), end].sort()[0];
    out.push({ start: cursor, end: chunkEnd });
    cursor = addYmdDays(chunkEnd, 1);
  }
  return out;
}

export async function syncKlaviyoSnapshot(opts: SyncOpts = {}): Promise<SyncResult> {
  const log = opts.log ?? noop;
  const maxSteps = opts.maxSteps ?? Number.POSITIVE_INFINITY;
  const slotWaitMs = opts.slotWaitMs ?? MIN_SPACING_MS + 5_000;
  const mode: SyncMode = opts.mode ?? "incremental";
  const budgetMs = opts.budgetMs ?? 50_000;
  const deadline = Date.now() + budgetMs;
  const steps: SyncStepResult[] = [];
  const warnings: string[] = [];
  let reportingCalls = 0;

  const tz = await getAccountTimezone();
  const today = todayYMDInTz(tz);
  const { id: metricId } = await resolvePlacedOrderMetric();
  if (opts.reset) {
    await clearSnapshot();
    await clearProgress();
    log("reset: existing snapshot discarded");
  }
  const prev = opts.reset ? null : await readSnapshot();

  const depth = opts.days ?? DEFAULT_SNAPSHOT_DAYS;
  // A full run covers the whole depth. An incremental one covers only what
  // Klaviyo may still revise — plus a day of margin — because everything older is
  // already sealed and re-fetching it would be pure waste (§3.4).
  const windowDays = mode === "full" ? depth : attributionDays() + 2;
  const start = addYmdDays(today, -(windowDays - 1));
  const end = today;
  log(`mode=${mode} window=${start}..${end} tz=${tz} budget=${Math.round(budgetMs / 1000)}s`);

  const blockedAtStart = await isBlocked();
  if (blockedAtStart.blocked) {
    return {
      mode, window: { start, end }, steps,
      completed: false,
      remaining: ["all"],
      reporting_calls: 0,
      snapshot_synced_at: prev?.synced_at ?? null,
      blocked: blockedAtStart,
      warnings: [`Klaviyo reporting is throttled for another ${blockedAtStart.forS}s — nothing was fetched.`],
    };
  }

  // What a previous hop already paid for. Skipping those is the difference
  // between a chain that converges and one that re-buys the same pages forever.
  const progressKey = `${mode}:${start}..${end}`;
  const progress = opts.reset ? null : await readProgress(progressKey);
  const done = new Set(progress?.done ?? []);
  // Where each part-way-through report left off. A step is only "done" once its
  // cursor comes back null.
  const cursors: Record<string, string> = { ...(progress?.cursors ?? {}) };
  if (done.size) log(`resuming: ${done.size} step(s) already done (${[...done].join(", ")})`);

  // Each planned unit of work. Reporting steps are the expensive ones; the rest
  // are on endpoints with no daily cap.
  // `needMs` is how much wall clock the step needs before it is worth STARTING.
  // Most steps are a single call and the 8s default covers them; a step that does
  // sequential work has to declare its real cost or the budget check waves it
  // through with seconds left and the whole function times out.
  const plan: { name: string; reporting: boolean; needMs?: number; run: () => Promise<SyncStepResult> }[] = [];
  // Steps that returned rows but still have pages left. They must NOT be marked
  // done, or the remaining pages are never fetched.
  const partial = new Set<string>();

  let campaignRows: CampaignSnapshotRow[] | undefined;
  let flowDayRows: FlowDayRow[] = [];
  let dayTotals: DayTotalRow[] | undefined;
  let flowMeta: FlowMetaRow[] | undefined;
  let draft: CampaignMetaRow[] | undefined;
  let scheduled: CampaignMetaRow[] | undefined;

  // ---- 1. day totals (metric-aggregates: cheap tier, no daily cap) ----
  plan.push({
    name: "day_totals",
    reporting: false,
    run: async () => {
      // Zoned bounds, not naive ones: metric-aggregates buckets in `tz` but reads
      // a naive filter datetime as UTC, which made the first day a 4-hour sliver
      // and truncated the last (verified live — see zonedMidnightUtc).
      const agg = await aggregateMetric({
        metricId,
        start: zonedMidnightUtc(start, tz),
        end: zonedMidnightUtc(addYmdDays(end, 1), tz),
        measurements: ["sum_value", "count"], interval: "day", timezone: tz,
      });
      const buckets = agg.dates ?? [];
      const totals = new Map<string, DayTotalRow>();
      for (const g of agg.data) {
        for (let i = 0; i < buckets.length; i++) {
          const ymd = ymdInTz(buckets[i], tz) ?? buckets[i].slice(0, 10);
          const cur = totals.get(ymd) ?? { ymd, revenue: 0, orders: 0 };
          cur.revenue += g.measurements.sum_value?.[i] ?? 0;
          cur.orders += g.measurements.count?.[i] ?? 0;
          totals.set(ymd, cur);
        }
      }
      // No buckets at all (a flat response) → fall back to one lump on `end`, so
      // the range still has a total rather than a silent zero.
      if (!buckets.length) {
        let revenue = 0, orders = 0;
        for (const g of agg.data) { revenue += sumArray(g.measurements.sum_value); orders += sumArray(g.measurements.count); }
        if (revenue || orders) totals.set(end, { ymd: end, revenue, orders });
        warnings.push("Klaviyo returned no daily buckets for total revenue; the range total is attributed to its last day.");
      }
      dayTotals = [...totals.values()];
      return { step: "day_totals", ok: true, detail: `${dayTotals.length} days, ${dayTotals.reduce((n, d) => n + d.revenue, 0).toFixed(2)} revenue` };
    },
  });

  // ---- 2. campaign values (1 reporting call) ----
  plan.push({
    name: "campaigns",
    reporting: true,
    run: async () => {
      // Deliberately keeps dayRangeISO's day-after end. Whether the values
      // timeframe is inclusive is untested for campaigns, and the asymmetry is
      // safe in exactly one direction: each row is placed on a day by its OWN
      // send_time, so an extra day of rows is filtered out by the slice, while a
      // missing day would silently lose revenue.
      const { start: s, end: e } = dayRangeISO(start, end);
      const res = await campaignValuesReport({
        start: s, end: e, conversionMetricId: metricId,
        day: today, waitMs: slotWaitMs,
        startUrl: cursors["campaigns"],
        maxPages: opts.maxPagesPerStep,
        onProgress: (p, rows) => log(`  campaigns page ${p}: ${rows} rows`),
      });
      if (!res.ok) return { step: "campaigns", ok: false, detail: res.reason, pages: res.pages };
      reportingCalls += res.pages;
      if (res.nextUrl) {
        cursors["campaigns"] = res.nextUrl;
        partial.add("campaigns");
      } else {
        delete cursors["campaigns"];
      }
      if (res.truncated) warnings.push("Campaign values report hit the page cap — some campaigns may be missing.");

      // Fold the per-message rows to per-campaign.
      const byId = new Map<string, Stats>();
      for (const r of res.results) {
        const id = r.groupings.campaign_id;
        if (!id) continue;
        const cur = byId.get(id) ?? emptyStats();
        byId.set(id, {
          recipients: cur.recipients + (r.statistics.recipients ?? 0),
          delivered: cur.delivered + (r.statistics.delivered ?? 0),
          opens_unique: cur.opens_unique + (r.statistics.opens_unique ?? r.statistics.opens ?? 0),
          clicks_unique: cur.clicks_unique + (r.statistics.clicks_unique ?? r.statistics.clicks ?? 0),
          conversion_value: cur.conversion_value + (r.statistics.conversion_value ?? 0),
          conversions: cur.conversions + (r.statistics.conversions ?? 0),
          unsubscribes: cur.unsubscribes + (r.statistics.unsubscribes ?? 0),
          spam_complaints: cur.spam_complaints + (r.statistics.spam_complaints ?? 0),
          bounced: cur.bounced + (r.statistics.bounced ?? 0),
        });
      }

      // The report does NOT carry campaign_details on this revision — verified
      // live on 2026-04-15 and 2026-07-15, contrary to the spec's §1(c). So names,
      // status and send times still come from GET /campaigns, which is a different,
      // far looser tier (10/s, 150/min, NO daily cap) and costs us no headroom.
      let meta = new Map<string, { name: string; status: string; send_time: string | null; strategy_datetime?: string | null; audience_count: number }>();
      const ids = [...byId.keys()];
      if (ids.length) {
        try {
          const fetched = await fetchCampaignsByIds(ids);
          meta = new Map(fetched.map((c) => [c.id, {
            name: c.name, status: c.status, send_time: c.send_time ?? null,
            strategy_datetime: c.strategy_datetime ?? null, audience_count: c.audience_count ?? 0,
          }]));
        } catch (e) {
          warnings.push(`Campaign names couldn't be loaded (${e instanceof Error ? e.message : e}); revenue is complete.`);
        }
      }

      campaignRows = ids.map((id) => {
        const m = meta.get(id);
        const sendTime = m?.send_time ?? m?.strategy_datetime ?? null;
        const sendYmd = ymdInTz(sendTime, tz);
        return {
          campaign_id: id,
          send_ymd: sendYmd,
          send_time: sendTime,
          name: m?.name ?? `(unknown campaign ${id})`,
          status: m?.status ?? "",
          audience_count: m?.audience_count ?? 0,
          stats: byId.get(id)!,
          final: false,   // mergeSnapshot seals it against today
        };
      });
      const undated = campaignRows.filter((c) => !c.send_ymd).length;
      if (undated) warnings.push(`${undated} campaign(s) had revenue but no send time, so they can't be placed on a day.`);
      return { step: "campaigns", ok: true, pages: res.pages, detail: `${campaignRows.length} campaigns, ${campaignRows.reduce((n, c) => n + c.stats.conversion_value, 0).toFixed(2)} revenue` };
    },
  });

  // ---- 3. flow dailies, one step per 60-day chunk (4 reporting calls each) ----
  for (const chunk of dailyChunks(start, end)) {
    plan.push({
      name: `flows:${chunk.start}..${chunk.end}`,
      reporting: true,
      run: async () => {
        // Series end is INCLUSIVE, so send the last day itself — sending the day
        // after produced a phantom trailing bucket.
        const { start: s, end: e } = seriesRangeISO(chunk.start, chunk.end);
        const stepName = `flows:${chunk.start}..${chunk.end}`;
        const res = await flowSeriesReport({
          start: s, end: e, conversionMetricId: metricId,
          day: today, waitMs: slotWaitMs,
          startUrl: cursors[stepName],
          maxPages: opts.maxPagesPerStep,
          onProgress: (p, rows) => log(`  flows ${chunk.start} page ${p}: ${rows} rows`),
        });
        if (!res.ok) return { step: `flows:${chunk.start}`, ok: false, detail: res.reason, pages: res.pages };
        reportingCalls += res.pages;
        if (res.nextUrl) {
          cursors[stepName] = res.nextUrl;
          partial.add(stepName);
        } else {
          delete cursors[stepName];
        }
        if (res.report.truncated) warnings.push("Flow series report hit the page cap — some flows may be missing.");
        const rows = seriesToDays(res.report.dateTimes, res.report.results);
        flowDayRows = flowDayRows.concat(rows);
        return { step: `flows:${chunk.start}`, ok: true, pages: res.pages, detail: `${rows.length} flow-days over ${res.report.dateTimes.length} buckets` };
      },
    });
  }

  // ---- 4. the audience catalogue for the planner's brief picker ----
  // Folded in here rather than taking its own cron slot: Hobby allows two and both
  // are in use (docs/PLANNER_AUDIENCE_BRIEF_SPEC.md §4). Cheap tier (75/s, no daily
  // cap), so it never touches the reporting limiter — but it IS ~36 sequential
  // requests, hence its own step with its own budget.
  plan.push({
    name: "audiences",
    reporting: false,
    // The catalogue is ~36 sequential requests / ~17.5s MEASURED, and it must
    // finish once started (a half-written catalogue silently hides audiences).
    // Reserve for that plus room to write and respond, or don't start.
    needMs: AUDIENCE_CATALOGUE_MS + 6_000,
    run: async () => {
      const r = await syncAudiences({
        withSizes: true,
        // Segment sizes are throttled to ~1/s, so the size pass takes whatever is
        // left AFTER the catalogue, never a fixed 20s that could push the function
        // past its limit. It resumes across nights, so coverage grows instead of
        // blocking the step.
        sizeBudgetMs: Math.max(0, deadline - Date.now() - AUDIENCE_CATALOGUE_MS - 4_000),
        log: (l) => log(`  audiences: ${l}`),
      });
      const notes = [`${r.audiences} audiences (${r.segments} segments, ${r.lists} lists)`, `${r.sized} sized`];
      if (r.truncated) warnings.push("The Klaviyo audience list hit its page cap — some segments or lists are missing from the picker.");
      if (!r.size_pass_complete) notes.push("size pass continues next run");
      return { step: "audiences", ok: true, detail: notes.join(", ") };
    },
  });

  // ---- 5. metadata (GET endpoints: 3–10/s, no daily cap) ----
  plan.push({
    name: "metadata",
    reporting: false,
    run: async () => {
      const parts: string[] = [];
      try {
        const flows = await listFlows();
        flowMeta = flows.map((f) => ({ id: f.id, name: f.name, status: f.status }));
        parts.push(`${flowMeta.length} flows`);
      } catch (e) {
        warnings.push(`Flow names couldn't be loaded (${e instanceof Error ? e.message : e}).`);
      }
      const toMeta = (c: { id: string; name: string; status: string; send_time?: string | null; strategy_datetime?: string | null; audience_count?: number }): CampaignMetaRow => ({
        campaign_id: c.id, name: c.name, status: c.status,
        send_time: c.send_time ?? c.strategy_datetime ?? null, audience_count: c.audience_count ?? 0,
      });
      try {
        const d = await fetchCampaignsByStatus("Draft");
        draft = d.campaigns.map(toMeta);
        if (d.truncated) warnings.push("More draft campaigns exist than shown (showing the 100 most recent).");
        const sc = await fetchCampaignsByStatus("Scheduled");
        scheduled = sc.campaigns.map(toMeta).sort((a, b) => (a.send_time || "").localeCompare(b.send_time || ""));
        if (sc.truncated) warnings.push("More scheduled campaigns exist than shown (showing the 100 most recent).");
        parts.push(`${draft.length} draft, ${scheduled.length} scheduled`);
      } catch (e) {
        warnings.push(`Draft/scheduled campaigns couldn't be loaded (${e instanceof Error ? e.message : e}).`);
      }
      return { step: "metadata", ok: true, detail: parts.join(", ") || "nothing loaded" };
    },
  });

  // ---- run the plan against the budget ----
  const remaining: string[] = [];
  let ran = 0;
  for (const unit of plan) {
    if (done.has(unit.name)) { steps.push({ step: unit.name, ok: true, detail: "already done this window" }); continue; }
    // Out of step budget for this invocation: leave it for the next hop.
    if (ran >= maxSteps) { remaining.push(unit.name); continue; }
    // A reporting step needs room for its slot wait plus the call; anything else is
    // fast. Reserve rather than starting work we would have to abandon.
    const need = stepNeedMs(unit, slotWaitMs);
    if (Date.now() + need > deadline) { remaining.push(unit.name); continue; }
    ran++;
    try {
      const r = await unit.run();
      steps.push(r);
      log(`${r.ok ? "ok  " : "FAIL"} ${r.step}: ${r.detail}`);
      if (r.ok && !partial.has(unit.name)) done.add(unit.name);
      else remaining.push(unit.name);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      steps.push({ step: unit.name, ok: false, detail });
      log(`FAIL ${unit.name}: ${detail}`);
      remaining.push(unit.name);
    }
  }

  // Persist whatever we got. A partial run still improves the snapshot, and
  // merging is idempotent, so the next run picks up the rest.
  let snapshot: KlaviyoSnapshot | null = prev;
  const gotSomething = campaignRows || flowDayRows.length || dayTotals || flowMeta || draft || scheduled;
  if (gotSomething) {
    snapshot = mergeSnapshot(prev, {
      window: { start, end }, timezone: tz, todayYmd: today,
      campaigns: campaignRows, flow_days: flowDayRows, day_totals: dayTotals,
      flow_meta: flowMeta, draft, scheduled,
      warnings: [...new Set([...(prev?.warnings ?? []).filter(() => false), ...warnings])],
    });
    await writeSnapshot(snapshot);
    log(`snapshot written: ${snapshot.campaigns.length} campaigns, ${snapshot.flow_days.length} flow-days, ${snapshot.day_totals.length} day totals, window ${snapshot.window.start}..${snapshot.window.end}`);
  }

  // Persist progress so the next hop skips what this one paid for; clear it once
  // the window is fully covered, so tomorrow starts fresh.
  if (remaining.length === 0) await clearProgress();
  else await writeProgress(progressKey, [...done], cursors);

  return {
    mode,
    window: { start, end },
    steps,
    completed: remaining.length === 0,
    remaining,
    reporting_calls: reportingCalls,
    snapshot_synced_at: snapshot?.synced_at ?? null,
    blocked: await isBlocked(),
    warnings,
  };
}
