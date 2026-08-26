import { ratesOf, sliceRange, type KlaviyoSnapshot } from "./klaviyo-slice";
import type { OverviewData, FlowRow, CampaignRow, CampaignMeta } from "@/app/dashboard/types";

// Snapshot slice -> the dashboard's shape. PURE, and importing only the pure
// slice module, so the BROWSER can run it: the dashboard fetches the snapshot
// once and computes every subsequent range locally, which is what makes a
// date-range change cost no round trip at all
// (docs/KLAVIYO_RATE_LIMIT_SPEC.md §3.1, §4).

export type RangeOverview = Omit<OverviewData, "fetched_at">;

/** Fold a snapshot slice into the dashboard's shape. Pure. */
export function overviewFromSnapshot(snap: KlaviyoSnapshot, startYMD: string, endYMD: string): RangeOverview {
  const slice = sliceRange(snap, startYMD, endYMD);
  const warnings = [...snap.warnings];

  if (!slice.covered) {
    const first = slice.missing_days[0];
    const last = slice.missing_days[slice.missing_days.length - 1];
    // Say it rather than quietly returning a smaller number: a partial revenue
    // figure that looks complete is worse than a stated gap.
    warnings.push(
      slice.missing_days.length === 1
        ? `No data loaded for ${first} — the figures below exclude it.`
        : `No data loaded for ${slice.missing_days.length} day(s) in this range (${first} to ${last}) — the figures below exclude them. The snapshot covers ${snap.window.start} to ${snap.window.end}.`,
    );
  }

  const flows: FlowRow[] = slice.flows
    .filter((f) => f.stats.recipients > 0 || f.stats.conversion_value > 0)
    .map((f) => {
      const r = ratesOf(f.stats);
      return {
        flow_id: f.id, name: f.name, status: f.status,
        recipients: f.stats.recipients, delivered: f.stats.delivered,
        opens: f.stats.opens_unique, clicks: f.stats.clicks_unique,
        revenue: f.stats.conversion_value,
        revenue_per_recipient: r.revenue_per_recipient,
        open_rate: r.open_rate, click_rate: r.click_rate,
        unsubscribe_rate: r.unsubscribe_rate, spam_rate: r.spam_rate, bounce_rate: r.bounce_rate,
        unsubscribes: f.stats.unsubscribes, spam_complaints: f.stats.spam_complaints, bounced: f.stats.bounced,
      };
    });

  const campaigns: CampaignRow[] = slice.campaigns
    .filter((c) => c.stats.recipients > 0 || c.stats.conversion_value > 0)
    .map((c) => {
      const r = ratesOf(c.stats);
      return {
        campaign_id: c.id, name: c.name, status: c.status, send_time: c.send_time ?? null,
        recipients: c.stats.recipients, delivered: c.stats.delivered,
        opens: c.stats.opens_unique, clicks: c.stats.clicks_unique,
        revenue: c.stats.conversion_value,
        revenue_per_recipient: r.revenue_per_recipient,
        open_rate: r.open_rate, click_rate: r.click_rate,
        unsubscribe_rate: r.unsubscribe_rate, spam_rate: r.spam_rate, bounce_rate: r.bounce_rate,
        unsubscribes: c.stats.unsubscribes, spam_complaints: c.stats.spam_complaints, bounced: c.stats.bounced,
      };
    });

  const attributedFromFlows = slice.flows.reduce((n, f) => n + f.stats.conversion_value, 0);
  const attributedFromCampaigns = slice.campaigns.reduce((n, c) => n + c.stats.conversion_value, 0);

  const sent: CampaignMeta[] = campaigns.map((c) => ({
    campaign_id: c.campaign_id, name: c.name, status: c.status ?? "",
    send_time: c.send_time, audience_count: 0,
  })).sort((a, b) => (b.send_time || "").localeCompare(a.send_time || ""));

  return {
    revenue: {
      total: slice.total_revenue,
      attributed: attributedFromFlows + attributedFromCampaigns,
      attributed_from_flows: attributedFromFlows,
      attributed_from_campaigns: attributedFromCampaigns,
      order_count: slice.order_count,
    },
    flows,
    campaigns,
    campaign_status: {
      draft: snap.draft.map((d) => ({ ...d })),
      scheduled: snap.scheduled.map((s) => ({ ...s })),
      sent,
    },
    warnings,
    range: { start: startYMD, end: endYMD },
  };
}

