import {
  aggregateMetric,
  campaignValuesReport,
  dayRangeISO,
  fetchCampaignsByIds,
  fetchCampaignsByStatus,
  flowValuesReport,
  getAccountTimezone,
  listFlows,
  resolvePlacedOrderMetric,
  sumArray,
  type CampaignValuesResult,
  type FlowValuesResult,
  type KlaviyoCampaign,
} from "./klaviyo";
import type { OverviewData, FlowRow, CampaignRow, CampaignMeta } from "@/app/dashboard/types";

// Shared LIVE range aggregation (spec: MEASUREMENT_LIVE_FETCH_SPEC / DASHBOARD_
// BRIEFING_SPEC §3). Extracted from the measure route so BOTH the route and the
// briefing route compute a range the same way — no duplicated aggregation. Makes
// ~3 sequential Klaviyo reporting calls for exactly the range + best-effort
// metadata. Throws on upstream failure; callers map that to a friendly response.
//
// Returns everything in OverviewData EXCEPT `fetched_at` (that's stamped by the
// client when it caches a range; the briefing doesn't need it).
export type RangeOverview = Omit<OverviewData, "fetched_at">;

type Stat = { recipients: number; opens: number; clicks: number; revenue: number };

// Values reports return one row per id×send_channel; fold to per-id totals.
// opens/clicks prefer the *_unique variants.
function foldStat(target: Map<string, Stat>, id: string | undefined, s: FlowValuesResult["statistics"]): void {
  if (!id) return;
  const cur = target.get(id) ?? { recipients: 0, opens: 0, clicks: 0, revenue: 0 };
  cur.recipients += s.recipients ?? 0;
  cur.opens += s.opens_unique ?? s.opens ?? 0;
  cur.clicks += s.clicks_unique ?? s.clicks ?? 0;
  cur.revenue += s.conversion_value ?? 0;
  target.set(id, cur);
}

const rpr = (revenue: number, recipients: number) => (recipients > 0 ? revenue / recipients : 0);

/** True when an error message looks like a Klaviyo rate-limit (429). Callers use
 * it to surface a friendly "try again" instead of a raw 500. */
export function isRateLimited(msg: string): boolean {
  return /429|rate.?limit|too many requests/i.test(msg);
}

export async function fetchRangeOverview(startYMD: string, endYMD: string): Promise<RangeOverview> {
  const warnings: string[] = [];

  const timezone = await getAccountTimezone();
  const { id: placedId } = await resolvePlacedOrderMetric();
  const { start, end } = dayRangeISO(startYMD, endYMD);

  // ---- The 3 reporting calls, SEQUENTIAL (friendly to the ~1/s burst quota) ----
  const agg = await aggregateMetric({ metricId: placedId, start, end, measurements: ["sum_value", "count"], timezone });
  let total = 0;
  let orderCount = 0;
  for (const g of agg.data) {
    total += sumArray(g.measurements.sum_value);
    orderCount += sumArray(g.measurements.count);
  }

  const flowReport = await flowValuesReport({ start, end, conversionMetricId: placedId });
  if (flowReport.truncated) warnings.push("Flow values report hit the page cap — some flows may be missing.");
  const flowTotals = new Map<string, Stat>();
  for (const r of flowReport.results as FlowValuesResult[]) foldStat(flowTotals, r.groupings.flow_id, r.statistics);

  const campaignReport = await campaignValuesReport({ start, end, conversionMetricId: placedId });
  if (campaignReport.truncated) warnings.push("Campaign values report hit the page cap — some campaigns may be missing.");
  const campaignTotals = new Map<string, Stat>();
  for (const r of campaignReport.results as CampaignValuesResult[]) foldStat(campaignTotals, r.groupings.campaign_id, r.statistics);

  // ---- Metadata / list calls (best-effort; a hiccup never blocks revenue) ----
  let flowMeta = new Map<string, { id: string; name: string; status?: string }>();
  let campaignMeta = new Map<string, KlaviyoCampaign>();
  let draft: CampaignMeta[] = [];
  let scheduled: CampaignMeta[] = [];
  const toMeta = (c: KlaviyoCampaign): CampaignMeta => ({
    campaign_id: c.id, name: c.name, status: c.status,
    send_time: c.send_time ?? c.strategy_datetime ?? null, audience_count: c.audience_count,
  });
  try {
    const flowList = await listFlows();
    flowMeta = new Map(flowList.map((f) => [f.id, f]));

    const campaignIds = [...campaignTotals.keys()];
    const fetched = campaignIds.length ? await fetchCampaignsByIds(campaignIds) : [];
    campaignMeta = new Map<string, KlaviyoCampaign>(fetched.map((c) => [c.id, c]));

    const draftRes = await fetchCampaignsByStatus("Draft");
    const scheduledRes = await fetchCampaignsByStatus("Scheduled");
    if (draftRes.truncated) warnings.push("More draft campaigns exist than shown (showing the 100 most recent).");
    if (scheduledRes.truncated) warnings.push("More scheduled campaigns exist than shown (showing the 100 most recent).");
    draft = draftRes.campaigns.map(toMeta);
    scheduled = scheduledRes.campaigns.map(toMeta).sort((a, b) => (a.send_time || "").localeCompare(b.send_time || ""));
  } catch (e) {
    warnings.push(`Campaign/flow names couldn't be loaded this fetch (${e instanceof Error ? e.message : e}) — revenue is complete; some names may show as unknown.`);
  }

  // ---- Fold into the dashboard shape ----
  let attributedFromFlows = 0;
  const flowRows: FlowRow[] = [];
  for (const [id, t] of flowTotals) {
    attributedFromFlows += t.revenue;
    if (t.recipients <= 0 && t.revenue <= 0) continue;
    const meta = flowMeta.get(id);
    flowRows.push({
      flow_id: id, name: meta?.name ?? `(unknown flow ${id})`, status: meta?.status,
      recipients: t.recipients, opens: t.opens, clicks: t.clicks, revenue: t.revenue,
      revenue_per_recipient: rpr(t.revenue, t.recipients),
    });
  }
  flowRows.sort((a, b) => b.revenue - a.revenue);

  let attributedFromCampaigns = 0;
  const campaignRows: CampaignRow[] = [];
  for (const [id, t] of campaignTotals) {
    attributedFromCampaigns += t.revenue;
    if (t.recipients <= 0 && t.revenue <= 0) continue;
    const meta = campaignMeta.get(id);
    campaignRows.push({
      campaign_id: id, name: meta?.name ?? `(unknown campaign ${id})`, status: meta?.status,
      send_time: meta?.send_time ?? meta?.strategy_datetime ?? null,
      recipients: t.recipients, opens: t.opens, clicks: t.clicks, revenue: t.revenue,
      revenue_per_recipient: rpr(t.revenue, t.recipients),
    });
  }
  campaignRows.sort((a, b) => b.revenue - a.revenue);

  const attributed = attributedFromFlows + attributedFromCampaigns;

  const sent: CampaignMeta[] = campaignRows.map((c) => {
    const meta = campaignMeta.get(c.campaign_id);
    return {
      campaign_id: c.campaign_id, name: c.name, status: meta?.status ?? c.status ?? "",
      send_time: c.send_time, audience_count: meta?.audience_count ?? 0,
    };
  }).sort((a, b) => (b.send_time || "").localeCompare(a.send_time || ""));

  return {
    revenue: {
      total, attributed,
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
}
