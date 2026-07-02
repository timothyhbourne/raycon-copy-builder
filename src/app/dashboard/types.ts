// Shared dashboard types. The /api/klaviyo/overview payload is fetched once in
// the dashboard layout and consumed by both the flows and campaigns child pages.

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
  served_from_cache?: string;
  cache_age_seconds?: number;
}
