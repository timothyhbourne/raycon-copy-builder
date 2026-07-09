import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Two-tier response cache keyed by date range (L1 in-memory + L2 on-disk).
// Klaviyo's report endpoints are slow and rate-limited; re-running the same range
// within the TTL should be instant, and the L2 disk copy lets warm loads survive
// process restarts (the L1 Map alone never shares across serverless workers).
// NOTE: BOTH tiers are an interim measure. Step 4 replaces them with the daily
// metrics store (reads never touch Klaviyo), at which point this cache is deleted.
const CACHE_TTL_MS = 10 * 60 * 1000;
const overviewCache = new Map<string, { ts: number; data: unknown }>();

interface CacheEntry { ts: number; data: unknown }
const DISK_CACHE_DIR = path.join(process.cwd(), "data/cache/overview");
function diskCachePath(key: string): string { return path.join(DISK_CACHE_DIR, `${key}.json`); }
function readDiskCache(key: string): CacheEntry | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(diskCachePath(key), "utf8"));
    if (parsed && typeof parsed.ts === "number") return parsed as CacheEntry;
  } catch { /* missing/corrupt → no entry */ }
  return null;
}
function writeDiskCache(key: string, entry: CacheEntry): void {
  try {
    fs.mkdirSync(DISK_CACHE_DIR, { recursive: true });
    fs.writeFileSync(diskCachePath(key), JSON.stringify(entry), "utf8");
  } catch { /* read-only FS (e.g. Vercel) → memory-only, never crash the read */ }
}
// Newest of L1/L2 (any age); hydrates L1 from a newer disk copy. null if neither.
function newestCacheEntry(key: string): CacheEntry | null {
  const l1 = overviewCache.get(key) ?? null;
  const l2 = readDiskCache(key);
  const entry = !l1 ? l2 : !l2 ? l1 : l2.ts > l1.ts ? l2 : l1;
  if (entry && (!l1 || entry.ts > l1.ts)) overviewCache.set(key, entry);
  return entry;
}

import {
  aggregateMetric,
  campaignValuesReport,
  dayRangeISO,
  fetchCampaignsByIds,
  fetchCampaignsByStatus,
  flowValuesReport,
  flowValuesReportRaw,
  getAccountTimezone,
  listFlows,
  resolvePlacedOrderMetric,
  sumArray,
} from "@/lib/klaviyo";

interface FlowRow {
  flow_id: string;
  name: string;
  status?: string;
  recipients: number;
  opens: number;
  clicks: number;
  revenue: number;
  revenue_per_recipient: number;
}

interface CampaignRow {
  campaign_id: string;
  name: string;
  status?: string;
  send_time: string | null;
  recipients: number;
  opens: number;
  clicks: number;
  revenue: number;
  revenue_per_recipient: number;
}

interface CampaignMeta {
  campaign_id: string;
  name: string;
  status: string;
  send_time: string | null;
  audience_count: number;
}

interface Totals { recipients: number; opens: number; clicks: number; revenue: number }

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const startYMD = searchParams.get("start");
    const endYMD = searchParams.get("end");
    const debug = searchParams.get("debug") === "1";
    const nocache = searchParams.get("nocache") === "1";
    if (!startYMD || !endYMD) {
      return NextResponse.json({ error: "start and end query params required (YYYY-MM-DD)" }, { status: 400 });
    }

    const cacheKey = `${startYMD}_${endYMD}`;
    // Stale-while-revalidate: serve a fresh hit instantly; serve an expired hit
    // immediately tagged `stale: true` (the UI paints it, then refetches with
    // nocache=1 in the background and swaps in the fresh result).
    if (!debug && !nocache) {
      const entry = newestCacheEntry(cacheKey);
      if (entry) {
        return NextResponse.json({
          ...(entry.data as Record<string, unknown>),
          served_from_cache: new Date(entry.ts).toISOString(),
          cache_age_seconds: Math.round((Date.now() - entry.ts) / 1000),
          stale: Date.now() - entry.ts >= CACHE_TTL_MS,
        });
      }
    }

    const warnings: string[] = [];

    // Step 0 instrumentation: time every external call so we can prove where the
    // 20–60s goes and verify the win after the rearchitecture. `timed` records
    // wall-time per label; the `timings_ms` map is exposed under ?debug=1 and the
    // total is always console.logged.
    const timings: Record<string, number> = {};
    const t0 = Date.now();
    const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      const s = Date.now();
      try { return await fn(); } finally { timings[label] = Date.now() - s; }
    };

    // Timezone + conversion metric first. The metric is PINNED (env/default), so
    // this is now O(1) — no /metrics/ scan — and never raises the old
    // "multiple Placed Order metrics" ambiguity warning.
    const timezone = await timed("timezone", () => getAccountTimezone());
    const metric = await timed("metric", () => resolvePlacedOrderMetric());
    const placedId = metric.id;
    if (metric.ambiguous) {
      const list = metric.candidates
        .map((c) => `${c.integrationKey || c.integrationName || "unknown"}:${c.id}`)
        .join(", ");
      warnings.push(`Multiple "Placed Order" metrics found (${list}). Using ${placedId}.`);
    }

    const { start, end } = dayRangeISO(startYMD, endYMD);

    // Step 1: parallelize across DIFFERENT endpoint families. Klaviyo throttles
    // per family, so these three groups run concurrently while each stays
    // sequential internally — total ≈ max(groups) instead of sum(all). If 429s
    // appear in testing, collapse to fewer groups (reports together, metadata
    // parallel).
    //   A: metric-aggregate
    //   B: flow values report → flows list
    //   C: campaign values report → campaign metadata (active ids) → drafts → scheduled
    const [totalAgg, flowGroup, campaignGroup] = await Promise.all([
      timed("aggregate", () => aggregateMetric({
        metricId: placedId, start, end, measurements: ["sum_value", "count"], timezone,
      })),
      (async () => {
        const flowReport = await timed("flow_report", () => flowValuesReport({ start, end, conversionMetricId: placedId }));
        const flowList = await timed("flows_list", () => listFlows());
        return { flowReport, flowList };
      })(),
      (async () => {
        const campaignReport = await timed("campaign_report", () => campaignValuesReport({ start, end, conversionMetricId: placedId }));
        // Aggregate by campaign_id inside this family so metadata is fetched only
        // for the active ids (that call must chain after the report here).
        const byCampaign = new Map<string, Totals>();
        for (const r of campaignReport.results) {
          const id = r.groupings.campaign_id;
          if (!id) continue;
          const cur = byCampaign.get(id) ?? { recipients: 0, opens: 0, clicks: 0, revenue: 0 };
          cur.recipients += r.statistics.recipients ?? 0;
          cur.opens += r.statistics.opens_unique ?? r.statistics.opens ?? 0;
          cur.clicks += r.statistics.clicks_unique ?? r.statistics.clicks ?? 0;
          cur.revenue += r.statistics.conversion_value ?? 0;
          byCampaign.set(id, cur);
        }
        const activeCampaignIds: string[] = [];
        for (const [id, t] of byCampaign) if (t.recipients > 0 || t.revenue > 0) activeCampaignIds.push(id);
        const activeCampaignMeta = activeCampaignIds.length ? await timed("campaign_meta", () => fetchCampaignsByIds(activeCampaignIds)) : [];
        const draftRes = await timed("drafts", () => fetchCampaignsByStatus("Draft"));
        const scheduledRes = await timed("scheduled", () => fetchCampaignsByStatus("Scheduled"));
        return { campaignReport, byCampaign, activeCampaignIds, activeCampaignMeta, draftRes, scheduledRes };
      })(),
    ]);

    const { flowReport, flowList } = flowGroup;
    const { campaignReport, byCampaign, activeCampaignIds, activeCampaignMeta, draftRes, scheduledRes } = campaignGroup;
    const flowResults = flowReport.results;
    const campaignResults = campaignReport.results;

    // Truncation → warnings (never drop silently).
    if (flowReport.truncated) warnings.push("Flow values report hit the page cap — some flows may be missing. Revenue understated.");
    if (campaignReport.truncated) warnings.push("Campaign values report hit the page cap — some campaigns may be missing. Revenue understated.");
    if (draftRes.truncated) warnings.push("More draft campaigns exist than shown (showing the 100 most recent).");
    if (scheduledRes.truncated) warnings.push("More scheduled campaigns exist than shown (showing the 100 most recent).");

    // Headline totals are computed from the FULL report results, before any
    // row-level activity filtering, so filtering idle rows never changes them.
    const total = totalAgg.data.reduce((acc, g) => acc + sumArray(g.measurements.sum_value), 0);
    const orderCount = totalAgg.data.reduce((acc, g) => acc + sumArray(g.measurements.count), 0);
    const attributedFromFlows = flowResults.reduce((acc, r) => acc + (r.statistics.conversion_value ?? 0), 0);
    const attributedFromCampaigns = campaignResults.reduce((acc, r) => acc + (r.statistics.conversion_value ?? 0), 0);
    const attributed = attributedFromFlows + attributedFromCampaigns;

    // ---- Flow rows: build from the (activity-scoped) report, join names, and
    // keep only flows with real activity. Idle flows no longer render. ----
    const byFlow = new Map<string, Totals>();
    for (const r of flowResults) {
      const id = r.groupings.flow_id;
      if (!id) continue;
      const cur = byFlow.get(id) ?? { recipients: 0, opens: 0, clicks: 0, revenue: 0 };
      cur.recipients += r.statistics.recipients ?? 0;
      cur.opens += r.statistics.opens_unique ?? r.statistics.opens ?? 0;
      cur.clicks += r.statistics.clicks_unique ?? r.statistics.clicks ?? 0;
      cur.revenue += r.statistics.conversion_value ?? 0;
      byFlow.set(id, cur);
    }
    const flowMeta = new Map(flowList.map((f) => [f.id, f]));
    const flowRows: FlowRow[] = [];
    for (const [id, t] of byFlow) {
      if (t.recipients <= 0 && t.revenue <= 0) continue; // only rows with activity
      const meta = flowMeta.get(id);
      flowRows.push({
        flow_id: id,
        name: meta?.name ?? `(unknown flow ${id})`,
        status: meta?.status,
        recipients: t.recipients,
        opens: t.opens,
        clicks: t.clicks,
        revenue: t.revenue,
        revenue_per_recipient: t.recipients > 0 ? t.revenue / t.recipients : 0,
      });
    }
    flowRows.sort((a, b) => b.revenue - a.revenue);

    // ---- Campaign rows: byCampaign/activeCampaignIds computed in group C above;
    // join the metadata we already fetched for the active ids. ----
    const campaignMetaById = new Map(activeCampaignMeta.map((c) => [c.id, c]));
    const campaignRows: CampaignRow[] = [];
    for (const id of activeCampaignIds) {
      const t = byCampaign.get(id)!;
      const meta = campaignMetaById.get(id);
      campaignRows.push({
        campaign_id: id,
        name: meta?.name ?? `(unknown campaign ${id})`,
        status: meta?.status,
        send_time: meta?.send_time ?? null,
        recipients: t.recipients,
        opens: t.opens,
        clicks: t.clicks,
        revenue: t.revenue,
        revenue_per_recipient: t.recipients > 0 ? t.revenue / t.recipients : 0,
      });
    }
    campaignRows.sort((a, b) => b.revenue - a.revenue);

    // ---- Status subsections: Draft / Scheduled fetched by status in group C.
    // Sent = the active-in-range campaigns we already have metadata for, so it
    // lines up with the performance table above. ----
    const toMeta = (c: (typeof activeCampaignMeta)[number]): CampaignMeta => ({
      campaign_id: c.id,
      name: c.name,
      status: c.status,
      send_time: c.send_time ?? c.strategy_datetime ?? null,
      audience_count: c.audience_count,
    });
    const draft = draftRes.campaigns.map(toMeta);
    const scheduled = scheduledRes.campaigns
      .map(toMeta)
      .sort((a, b) => (a.send_time || "").localeCompare(b.send_time || ""));
    const sent = activeCampaignMeta
      .map(toMeta)
      .sort((a, b) => (b.send_time || "").localeCompare(a.send_time || ""));

    timings.total = Date.now() - t0;
    console.log(`[klaviyo/overview] ${startYMD}..${endYMD} total ${timings.total}ms`, timings);

    const response: Record<string, unknown> = {
      revenue: {
        total,
        attributed,
        attributed_from_flows: attributedFromFlows,
        attributed_from_campaigns: attributedFromCampaigns,
        order_count: orderCount,
      },
      flows: flowRows,
      campaigns: campaignRows,
      campaign_status: { draft, scheduled, sent },
      warnings,
      range: { start: startYMD, end: endYMD },
    };
    if (!debug) {
      const entry = { ts: Date.now(), data: response };
      overviewCache.set(cacheKey, entry); // L1
      writeDiskCache(cacheKey, entry);    // L2 (survives process restarts)
    }

    if (debug) {
      const flowRaw = await flowValuesReportRaw({ start, end, conversionMetricId: placedId });
      response.debug = {
        timings_ms: timings,
        resolved_conversion_metric_id: placedId,
        conversion_metric_source: metric.source, // "env" | "default" | "auto"
        conversion_metric_pinned: metric.source !== "auto",
        conversion_metric_ambiguous: metric.ambiguous,
        account_timezone: timezone,
        channel_filter: "equals(send_channel,'email') (both flows and campaigns)",
        window: { start, end, note: "naive-local ISO, interpreted in account_timezone" },
        flow_report_row_count: flowResults.length,
        flow_rows_with_activity: flowRows.length,
        flow_report_truncated: flowReport.truncated,
        campaign_report_row_count: campaignResults.length,
        campaign_rows_with_activity: campaignRows.length,
        active_campaign_meta_fetched: activeCampaignMeta.length,
        draft_count: draft.length,
        scheduled_count: scheduled.length,
        attributed_reconciliation: {
          from_flows: attributedFromFlows,
          from_campaigns: attributedFromCampaigns,
          sum: attributedFromFlows + attributedFromCampaigns,
          attributed,
          matches: Math.abs(attributedFromFlows + attributedFromCampaigns - attributed) < 0.01,
        },
        flow_report_raw_response: flowRaw,
        campaign_report_first_3: campaignResults.slice(0, 3),
      };
    }
    return NextResponse.json(response);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[klaviyo/overview]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
