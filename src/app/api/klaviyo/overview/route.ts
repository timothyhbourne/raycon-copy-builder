import { NextRequest, NextResponse } from "next/server";

// In-memory cache keyed by date range. Klaviyo's report endpoints are slow and
// rate-limited; re-running the same range within 10 minutes is the common path
// (user opens the dashboard, glances at metrics, opens it again) and should be
// instant. TTL is short enough that data feels current.
const CACHE_TTL_MS = 10 * 60 * 1000;
const overviewCache = new Map<string, { ts: number; data: unknown }>();

import {
  METRIC_NAMES,
  aggregateMetric,
  campaignValuesReport,
  dayRangeISO,
  flowValuesReport,
  flowValuesReportRaw,
  getMetricId,
  listFlows,
  listMetricsByName,
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
        });
      }
    }

    const { start, end } = dayRangeISO(startYMD, endYMD);

    const placedId = await getMetricId(METRIC_NAMES.placedOrder);

    // Sequential — Klaviyo's reports endpoints are 1 req/sec burst, so fan-out
    // just hits the throttle. The klaviyoFetch wrapper handles 429 retry, but
    // the cheapest correct thing is to not trigger 429 in the first place.
    const totalAgg = await aggregateMetric({
      metricId: placedId,
      start,
      end,
      measurements: ["sum_value", "count"],
    });
    const flowResults = await flowValuesReport({ start, end, conversionMetricId: placedId });
    const campaignResults = await campaignValuesReport({ start, end, conversionMetricId: placedId });
    const flowList = await listFlows();

    const total = totalAgg.data.reduce((acc, g) => acc + sumArray(g.measurements.sum_value), 0);
    const orderCount = totalAgg.data.reduce((acc, g) => acc + sumArray(g.measurements.count), 0);

    const attributedFromFlows = flowResults.reduce((acc, r) => acc + (r.statistics.conversion_value ?? 0), 0);
    const attributedFromCampaigns = campaignResults.reduce((acc, r) => acc + (r.statistics.conversion_value ?? 0), 0);
    const attributed = attributedFromFlows + attributedFromCampaigns;

    // Aggregate per-flow rows across channels (email + SMS + push live in one flow).
    interface Totals { recipients: number; opens: number; clicks: number; revenue: number }
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
    const flowIds = new Set<string>([...flowList.map((f) => f.id), ...byFlow.keys()]);
    const rows: FlowRow[] = [];
    for (const id of flowIds) {
      const meta = flowMeta.get(id);
      const t = byFlow.get(id) ?? { recipients: 0, opens: 0, clicks: 0, revenue: 0 };
      rows.push({
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
    rows.sort((a, b) => b.revenue - a.revenue);

    const response: Record<string, unknown> = {
      revenue: {
        total,
        attributed,
        attributed_from_flows: attributedFromFlows,
        attributed_from_campaigns: attributedFromCampaigns,
        order_count: orderCount,
      },
      flows: rows,
      range: { start: startYMD, end: endYMD },
    };
    // Cache the non-debug payload so repeat loads of the same range are instant.
    if (!debug) {
      overviewCache.set(cacheKey, { ts: Date.now(), data: response });
    }

    if (debug) {
      const [flowRaw, placedOrderMetrics] = await Promise.all([
        flowValuesReportRaw({ start, end, conversionMetricId: placedId }),
        listMetricsByName(METRIC_NAMES.placedOrder),
      ]);
      response.debug = {
        used_conversion_metric_id: placedId,
        placed_order_metrics_found: placedOrderMetrics.map((m) => ({
          id: m.id,
          name: m.attributes.name,
          integration: m.attributes.integration,
        })),
        flow_report_row_count: flowResults.length,
        flow_report_raw_response: flowRaw,
        campaign_report_row_count: campaignResults.length,
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
