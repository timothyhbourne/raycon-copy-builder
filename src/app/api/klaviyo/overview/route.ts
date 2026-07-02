import { NextRequest, NextResponse } from "next/server";

// In-memory cache keyed by date range. Klaviyo's report endpoints are slow and
// rate-limited; re-running the same range within 10 minutes is the common path
// and should be instant. TTL is short enough that data feels current.
// LIMITATION: this Map lives in one process. It does NOT share across serverless
// workers, and a fresh Klaviyo send won't invalidate it — a normal Load within
// the TTL can serve slightly stale data. "Force refresh" (nocache=1) always
// bypasses it. A distributed cache is out of scope for now.
const CACHE_TTL_MS = 10 * 60 * 1000;
const overviewCache = new Map<string, { ts: number; data: unknown }>();

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
    if (!debug && !nocache) {
      const cached = overviewCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
        return NextResponse.json({
          ...(cached.data as Record<string, unknown>),
          served_from_cache: new Date(cached.ts).toISOString(),
          cache_age_seconds: Math.round((Date.now() - cached.ts) / 1000),
        });
      }
    }

    const warnings: string[] = [];

    // Timezone + conversion metric first. The metric is PINNED (env/default), so
    // this is now O(1) — no /metrics/ scan — and never raises the old
    // "multiple Placed Order metrics" ambiguity warning.
    const timezone = await getAccountTimezone();
    const metric = await resolvePlacedOrderMetric();
    const placedId = metric.id;
    if (metric.ambiguous) {
      const list = metric.candidates
        .map((c) => `${c.integrationKey || c.integrationName || "unknown"}:${c.id}`)
        .join(", ");
      warnings.push(`Multiple "Placed Order" metrics found (${list}). Using ${placedId}.`);
    }

    const { start, end } = dayRangeISO(startYMD, endYMD);

    // Sequential — Klaviyo report endpoints are 1 req/sec burst; fan-out just hits
    // the throttle. Order: aggregate, flow report, campaign report, then metadata.
    const totalAgg = await aggregateMetric({
      metricId: placedId,
      start,
      end,
      measurements: ["sum_value", "count"],
      timezone, // same TZ basis as the values-report timeframe
    });
    const flowReport = await flowValuesReport({ start, end, conversionMetricId: placedId });
    const campaignReport = await campaignValuesReport({ start, end, conversionMetricId: placedId });
    const flowList = await listFlows();

    const flowResults = flowReport.results;
    const campaignResults = campaignReport.results;

    // Truncation → warnings (never drop silently).
    if (flowReport.truncated) warnings.push("Flow values report hit the page cap — some flows may be missing. Revenue understated.");
    if (campaignReport.truncated) warnings.push("Campaign values report hit the page cap — some campaigns may be missing. Revenue understated.");

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

    // ---- Campaign rows: aggregate the report by campaign_id, keep only rows
    // with activity, then fetch metadata for JUST those ids. ----
    const byCampaign = new Map<string, Totals>();
    for (const r of campaignResults) {
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
    for (const [id, t] of byCampaign) {
      if (t.recipients > 0 || t.revenue > 0) activeCampaignIds.push(id);
    }

    // Metadata only for the active campaigns (sent, in range) — one call per ~50.
    const activeCampaignMeta = activeCampaignIds.length ? await fetchCampaignsByIds(activeCampaignIds) : [];
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

    // ---- Status subsections: Draft / Scheduled fetched by status (not date-
    // bound, small pages). Sent = the active-in-range campaigns we already have
    // metadata for, so it lines up with the performance table above. ----
    const toMeta = (c: (typeof activeCampaignMeta)[number]): CampaignMeta => ({
      campaign_id: c.id,
      name: c.name,
      status: c.status,
      send_time: c.send_time ?? c.strategy_datetime ?? null,
      audience_count: c.audience_count,
    });
    const draftRes = await fetchCampaignsByStatus("Draft");
    const scheduledRes = await fetchCampaignsByStatus("Scheduled");
    if (draftRes.truncated) warnings.push("More draft campaigns exist than shown (showing the 100 most recent).");
    if (scheduledRes.truncated) warnings.push("More scheduled campaigns exist than shown (showing the 100 most recent).");

    const draft = draftRes.campaigns.map(toMeta);
    const scheduled = scheduledRes.campaigns
      .map(toMeta)
      .sort((a, b) => (a.send_time || "").localeCompare(b.send_time || ""));
    const sent = activeCampaignMeta
      .map(toMeta)
      .sort((a, b) => (b.send_time || "").localeCompare(a.send_time || ""));

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
      overviewCache.set(cacheKey, { ts: Date.now(), data: response });
    }

    if (debug) {
      const flowRaw = await flowValuesReportRaw({ start, end, conversionMetricId: placedId });
      response.debug = {
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
