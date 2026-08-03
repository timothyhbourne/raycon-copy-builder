import type { RangeOverview } from "./measure";
import type { FlowRow, CampaignRow } from "@/app/dashboard/types";

// Deterministic fact pack for the dashboard briefing (spec: DASHBOARD_BRIEFING_
// SPEC §4). PURE + unit-tested. The model receives ONLY a BriefingFacts object
// and narrates it — it never computes or invents a number. Every figure the
// prose might state must be a field here. Ratio guards mirror weekly.ts: a bad
// denominator yields null (never 0 / Infinity / NaN), so "no comparison" is
// distinguishable from "0% change".

export type ChannelScope = "email" | "sms" | "all";

// --- ratio / delta guards (weekly.ts semantics) ---
export function safeDiv(n: number, d: number | null | undefined): number | null {
  if (d == null || !(d > 0)) return null;
  const v = n / d;
  return Number.isFinite(v) ? v : null;
}
/** Fractional change cur vs prior; null when prior is missing or ≤ 0. */
export function pctChange(cur: number | null | undefined, prior: number | null | undefined): number | null {
  if (cur == null || prior == null || !(prior > 0)) return null;
  const v = (cur - prior) / prior;
  return Number.isFinite(v) ? v : null;
}

// --- YMD date math (UTC, avoids tz drift) ---
const DAY = 86_400_000;
function parseYMD(ymd: string): number { return Date.parse(`${ymd}T00:00:00.000Z`); }
function toYMD(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }
export function dayCount(start: string, end: string): number {
  const s = parseYMD(start), e = parseYMD(end);
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0;
  return Math.round((e - s) / DAY) + 1;
}
/** The immediately-preceding window of equal length (spec §3). */
export function priorWindow(start: string, end: string): { start: string; end: string } {
  const len = dayCount(start, end);
  const priorEnd = parseYMD(start) - DAY;
  const priorStart = priorEnd - (len - 1) * DAY;
  return { start: toYMD(priorStart), end: toYMD(priorEnd) };
}

export interface PerfItem {
  name: string;
  revenue: number;
  rpr: number | null;
  recipients: number;
}
export interface DeltaFacts {
  total_revenue_pct: number | null;
  attributed_pct: number | null;
  flow_revenue_pct: number | null;
  campaign_revenue_pct: number | null;
  program_rpr_pct: number | null;
}
export interface BriefingFacts {
  channel: ChannelScope;
  range: { start: string; end: string; days: number; label: string };
  prior_range: { start: string; end: string; days: number; label: string } | null;
  comparison_available: boolean;
  revenue: {
    total: number;
    attributed: number;
    order_count: number;
    flow_revenue: number;
    campaign_revenue: number;
    flow_share_pct: number | null;
    campaign_share_pct: number | null;
  };
  program_rpr: number | null;
  deltas: DeltaFacts;
  top_campaigns_by_revenue: PerfItem[];
  top_campaigns_by_rpr: PerfItem[];
  weakest_campaign: PerfItem | null;
  top_flows_by_revenue: PerfItem[];
  concentration: { top_campaign_share_pct: number | null; top3_campaign_share_pct: number | null };
  volume: { sent: number; scheduled: number; draft: number };
  low_data: boolean;
  warnings: string[];
}

/** A range has "low data" when there are very few sends — the model must not
 * over-read averages built on 1–2 campaigns. */
export const LOW_DATA_SENT_THRESHOLD = 3;

const campaignItem = (c: CampaignRow): PerfItem => ({ name: c.name, revenue: c.revenue, rpr: c.revenue_per_recipient, recipients: c.recipients });
const flowItem = (f: FlowRow): PerfItem => ({ name: f.name, revenue: f.revenue, rpr: f.revenue_per_recipient, recipients: f.recipients });

/** Total recipients across the program (campaigns + flows) — the program-RPR denominator. */
function totalRecipients(o: RangeOverview): number {
  const c = o.campaigns.reduce((s, x) => s + (x.recipients || 0), 0);
  const f = o.flows.reduce((s, x) => s + (x.recipients || 0), 0);
  return c + f;
}
function programRpr(o: RangeOverview): number | null {
  return safeDiv(o.revenue.attributed, totalRecipients(o));
}

export function buildBriefingFacts(
  current: RangeOverview,
  prior: RangeOverview | null,
  channel: ChannelScope = "all",
): BriefingFacts {
  const cur = current;
  const { start, end } = cur.range;
  const days = dayCount(start, end);

  const flowRevenue = cur.revenue.attributed_from_flows;
  const campaignRevenue = cur.revenue.attributed_from_campaigns;
  const attributed = cur.revenue.attributed;

  // Campaigns ranked by revenue (top 3) and by RPR (meaningful recipients only).
  const byRevenue = [...cur.campaigns].sort((a, b) => b.revenue - a.revenue);
  const byRpr = cur.campaigns
    .filter((c) => c.recipients > 0 && c.revenue_per_recipient != null)
    .sort((a, b) => (b.revenue_per_recipient) - (a.revenue_per_recipient));

  // Weakest sent campaign: meaningful recipients, RPR below the range's campaign
  // average — only when there's enough to compare against.
  const withRecipients = cur.campaigns.filter((c) => c.recipients > 0);
  const avgCampaignRpr = withRecipients.length
    ? withRecipients.reduce((s, c) => s + c.revenue_per_recipient, 0) / withRecipients.length
    : null;
  let weakest: PerfItem | null = null;
  if (withRecipients.length >= 2 && avgCampaignRpr != null) {
    const lowest = [...withRecipients].sort((a, b) => a.revenue_per_recipient - b.revenue_per_recipient)[0];
    if (lowest.revenue_per_recipient < avgCampaignRpr) weakest = campaignItem(lowest);
  }

  const top1 = byRevenue[0]?.revenue ?? 0;
  const top3 = byRevenue.slice(0, 3).reduce((s, c) => s + c.revenue, 0);

  const priorRange = prior
    ? { ...prior.range, days: dayCount(prior.range.start, prior.range.end), label: `${prior.range.start} → ${prior.range.end}` }
    : null;

  return {
    channel,
    range: { start, end, days, label: `${start} → ${end}` },
    prior_range: priorRange,
    comparison_available: prior != null,
    revenue: {
      total: cur.revenue.total,
      attributed,
      order_count: cur.revenue.order_count,
      flow_revenue: flowRevenue,
      campaign_revenue: campaignRevenue,
      flow_share_pct: safeDiv(flowRevenue, attributed),
      campaign_share_pct: safeDiv(campaignRevenue, attributed),
    },
    program_rpr: programRpr(cur),
    deltas: {
      total_revenue_pct: pctChange(cur.revenue.total, prior?.revenue.total),
      attributed_pct: pctChange(attributed, prior?.revenue.attributed),
      flow_revenue_pct: pctChange(flowRevenue, prior?.revenue.attributed_from_flows),
      campaign_revenue_pct: pctChange(campaignRevenue, prior?.revenue.attributed_from_campaigns),
      program_rpr_pct: pctChange(programRpr(cur), prior ? programRpr(prior) : null),
    },
    top_campaigns_by_revenue: byRevenue.slice(0, 3).map(campaignItem),
    top_campaigns_by_rpr: byRpr.slice(0, 3).map(campaignItem),
    weakest_campaign: weakest,
    top_flows_by_revenue: [...cur.flows].sort((a, b) => b.revenue - a.revenue).slice(0, 3).map(flowItem),
    concentration: {
      top_campaign_share_pct: safeDiv(top1, attributed),
      top3_campaign_share_pct: safeDiv(top3, attributed),
    },
    volume: {
      sent: cur.campaign_status.sent.length,
      scheduled: cur.campaign_status.scheduled.length,
      draft: cur.campaign_status.draft.length,
    },
    low_data: cur.campaign_status.sent.length < LOW_DATA_SENT_THRESHOLD,
    warnings: cur.warnings ?? [],
  };
}
