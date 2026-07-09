// Shared Campaign Planner types. Pure types only (no fs/server imports) so this
// module is safe to import from both server (lib/planner.ts, API routes) and
// client (planner page).
//
// A planner row is ONE planned campaign. It is a DIFFERENT concept from the local
// email-copy SavedCampaign (lib/campaigns.ts) — do not conflate them.

export type PlannerChannel = "email" | "sms";
// Scheduling-state model. "Sent" is DERIVED (see isEffectivelySent), not stored —
// a row is effectively sent once it is scheduled in Klaviyo and its planned send
// time has passed. Legacy statuses migrate on read (see lib/planner.ts).
export type PlannerStatus = "writing_brief" | "planned" | "scheduled_in_klaviyo" | "cancelled";
export type OfferType = "evergreen" | "promo";

export const PLANNER_STATUSES: PlannerStatus[] = ["writing_brief", "planned", "scheduled_in_klaviyo", "cancelled"];
export const PLANNER_CHANNELS: PlannerChannel[] = ["email", "sms"];

// Human-facing labels for each status.
export const PLANNER_STATUS_LABELS: Record<PlannerStatus, string> = {
  writing_brief: "Writing brief",
  planned: "Planned",
  scheduled_in_klaviyo: "Scheduled in Klaviyo",
  cancelled: "Cancelled",
};

// Raycon's standing offer. Evergreen campaigns use this and carry no promo code.
export const EVERGREEN_OFFER = "20% off";

// An audience is a real Klaviyo segment or list (picked, not free-typed). Legacy
// free-typed entries backfill to { id: "", name, type: "segment" } on read.
export interface AudienceRef {
  id: string;
  name: string;
  type: "segment" | "list";
}

export interface PlannerRow {
  id: string;
  name: string;
  channel: PlannerChannel;
  // --- Human-entered plan fields ---
  offer_type: OfferType;
  offer: string;
  promo_code?: string;
  planned_send_at: string; // ISO datetime — drives the calendar
  status: PlannerStatus;
  audience_included: AudienceRef[];
  audience_excluded: AudienceRef[];
  notes: string; // freeform notes / learnings
  // --- Link keys to pull metrics ---
  klaviyo_campaign_id?: string;
  postscript_campaign_id?: string;
  // Real platform send time captured when the campaign is linked via the picker.
  // Drives the metrics window + syncability so it can't miss the actual send.
  klaviyo_send_time?: string | null;
  postscript_send_time?: string | null;
  // --- Copy Builder link (Planner ↔ Copy Builder) ---
  // Set when a Copy Builder campaign has been written for this planned send.
  copy_campaign_id?: string;          // SavedCampaign id in /generated
  copy_status?: "draft" | "final";    // mirrors the saved campaign's status
  copy_linked_at?: string | null;     // ISO, last time copy was linked/updated
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

// "Sent" is derived, never stored: a row counts as effectively sent once it is
// scheduled in Klaviyo and its planned send time is in the past. Use this instead
// of a status === "sent" check anywhere sent-ness matters (table filter, etc.).
export function isEffectivelySent(row: PlannerRow): boolean {
  return row.status === "scheduled_in_klaviyo" && new Date(row.planned_send_at).getTime() < Date.now();
}

// Per-row sync outcome so the UI can explain exactly why a row did/didn't sync.
export type SyncReason = "matched" | "not_linked" | "not_sent_yet" | "no_activity_in_window" | "postscript_not_connected";
export interface SyncResult {
  id: string;
  name: string;
  matched: boolean;
  reason: SyncReason;
}
