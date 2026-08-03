import { NextRequest, NextResponse } from "next/server";
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
} from "@/lib/klaviyo";

// LIVE, on-demand measurement (spec: MEASUREMENT_LIVE_FETCH_SPEC.md). Replaces
// the old sync-then-read overview route: no disk snapshot store, no cron, no
// freezing, no per-day bucketing, no coverage gaps. This handler makes
// live Klaviyo calls for EXACTLY the requested range and returns the fully
// aggregated dashboard payload, or a clear error. Completeness or nothing —
// never a partial total. The per-session client cache (dashboard layout) is what
// makes repeat views instant; the first touch of a range is the only slow path.

export const dynamic = "force-dynamic";
export const maxDuration = 60; // headroom for patient rate-limit back-off

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

interface FlowRow {
  flow_id: string; name: string; status?: string;
  recipients: number; opens: number; clicks: number; revenue: number; revenue_per_recipient: number;
}
interface CampaignRow {
  campaign_id: string; name: string; status?: string; send_time: string | null;
  recipients: number; opens: number; clicks: number; revenue: number; revenue_per_recipient: number;
}
interface CampaignMeta {
  campaign_id: string; name: string; status: string; send_time: string | null; audience_count: number;
}
type Stat = { recipients: number; opens: number; clicks: number; revenue: number };

// The Klaviyo values reports return one row per id×send_channel; fold them to
// per-id totals. opens/clicks prefer the *_unique variants (matches the old
// sync engine's folding exactly).
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

// A rate-limit failure gets a friendly, actionable message + 429; anything else
// is a generic 500. Both are honest errors — the UI never shows partial data.
function isRateLimited(msg: string): boolean {
  return /429|rate.?limit|too many requests/i.test(msg);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const startYMD = searchParams.get("start");
  const endYMD = searchParams.get("end");

  if (!startYMD || !endYMD || !YMD_RE.test(startYMD) || !YMD_RE.test(endYMD)) {
    return NextResponse.json({ error: "start and end query params required (YYYY-MM-DD)" }, { status: 400 });
  }
  if (startYMD > endYMD) {
    return NextResponse.json({ error: "start must be on or before end" }, { status: 400 });
  }

  try {
    const warnings: string[] = [];

    // Pinned metric + account timezone (both cached after the first call).
    const timezone = await getAccountTimezone();
    const { id: placedId } = await resolvePlacedOrderMetric();
    const { start, end } = dayRangeISO(startYMD, endYMD);

    // ---- The 3 reporting calls, SEQUENTIAL (friendly to the ~1/s burst quota) ----
    // 1) Range revenue total + order count. No interval needed — we sum every
    //    bucket across every dimension group to get the range total.
    const agg = await aggregateMetric({ metricId: placedId, start, end, measurements: ["sum_value", "count"], timezone });
    let total = 0;
    let orderCount = 0;
    for (const g of agg.data) {
      total += sumArray(g.measurements.sum_value);
      orderCount += sumArray(g.measurements.count);
    }

    // 2) Per-flow totals for the range.
    const flowReport = await flowValuesReport({ start, end, conversionMetricId: placedId });
    if (flowReport.truncated) warnings.push("Flow values report hit the page cap — some flows may be missing.");
    const flowTotals = new Map<string, Stat>();
    for (const r of flowReport.results as FlowValuesResult[]) foldStat(flowTotals, r.groupings.flow_id, r.statistics);

    // 3) Per-campaign totals for the range (straight range totals — no send-date
    //    bucketing, which the per-day store used to need).
    const campaignReport = await campaignValuesReport({ start, end, conversionMetricId: placedId });
    if (campaignReport.truncated) warnings.push("Campaign values report hit the page cap — some campaigns may be missing.");
    const campaignTotals = new Map<string, Stat>();
    for (const r of campaignReport.results as CampaignValuesResult[]) foldStat(campaignTotals, r.groupings.campaign_id, r.statistics);

    // ---- Metadata / list calls (separate, more generous quotas) ----
    // Best-effort: these decorate the revenue rows with names/statuses and fill
    // the draft/scheduled subsections. If they fail, the range still returns
    // complete REVENUE data (rows fall back to "(unknown …)") plus a warning —
    // a metadata hiccup never blocks the numbers.
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

    return NextResponse.json({
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
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[klaviyo/measure]", msg);
    if (isRateLimited(msg)) {
      return NextResponse.json(
        { error: "Klaviyo is rate-limiting us right now — give it a moment and hit Refresh." },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
