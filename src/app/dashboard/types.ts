// Shared dashboard types. The /api/klaviyo/measure payload is fetched live per
// range in the dashboard layout, cached per session, and consumed by both the
// flows and campaigns child pages.

export interface RevenueData {
  total: number;
  attributed: number;
  attributed_from_flows: number;
  attributed_from_campaigns: number;
  order_count: number;
}

export interface FlowRow {
  flow_id: string;
  name: string;
  status?: string;
  recipients: number;
  opens: number;
  clicks: number;
  revenue: number;
  revenue_per_recipient: number;
}

export interface CampaignRow {
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

export interface CampaignMeta {
  campaign_id: string;
  name: string;
  status: string;
  send_time: string | null;
  audience_count: number;
}

export interface CampaignStatus {
  draft: CampaignMeta[];
  scheduled: CampaignMeta[];
  sent: CampaignMeta[];
}

export interface OverviewData {
  revenue: RevenueData;
  flows: FlowRow[];
  campaigns: CampaignRow[];
  campaign_status: CampaignStatus;
  warnings: string[];
  range: { start: string; end: string };
  // Live-on-demand freshness: the server-side cache's fetch time (ANALYTICS_RATE_
  // LIMIT_SPEC §6 — always show staleness). ISO string.
  fetched_at: string;
  // True when served past TTL or from cache during a Klaviyo throttle — the
  // numbers are the last known figures, not a fresh pull.
  stale?: boolean;
}
