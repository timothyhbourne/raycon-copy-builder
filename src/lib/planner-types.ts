// Shared Campaign Planner types. Pure types only (no fs/server imports) so this
// module is safe to import from both server (lib/planner.ts, API routes) and
// client (dashboard planner page).
//
// A planner row is ONE planned campaign. It is a DIFFERENT concept from the local
// email-copy SavedCampaign (lib/campaigns.ts) — do not conflate them.

export type PlannerChannel = "email" | "sms";
export type PlannerStatus = "idea" | "draft" | "scheduled" | "sent" | "cancelled";

export const PLANNER_STATUSES: PlannerStatus[] = ["idea", "draft", "scheduled", "sent", "cancelled"];
export const PLANNER_CHANNELS: PlannerChannel[] = ["email", "sms"];

export interface PlannerRow {
  id: string;
  name: string;
  channel: PlannerChannel;
  // --- Human-entered plan fields ---
  offer: string;
  promo_code?: string;
  planned_send_at: string; // ISO datetime — drives the calendar
  status: PlannerStatus;
  audience_included: string[];
  audience_excluded: string[];
  notes: string; // freeform notes / learnings
  // --- Link keys to pull metrics ---
  klaviyo_campaign_id?: string;
  postscript_campaign_id?: string;
  // --- Synced, read-only (filled when linked & sent). null = no data yet. ---
  // open_rate is intentionally null for SMS (no opens on SMS) — never 0.
  recipients?: number | null;
  open_rate?: number | null;
  click_rate?: number | null;
  revenue?: number | null;
  revenue_per_recipient?: number | null;
  metrics_synced_at?: string | null;
  // --- Bookkeeping ---
  created_at: string;
  updated_at: string;
}

// The metrics half a sync writes back onto a row.
export interface SyncedMetrics {
  recipients: number | null;
  open_rate: number | null;
  click_rate: number | null;
  revenue: number | null;
  revenue_per_recipient: number | null;
  metrics_synced_at: string;
}
