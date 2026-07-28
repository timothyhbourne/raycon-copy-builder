// Shared Campaign Planner types. Pure types only (no fs/server imports) so this
// module is safe to import from both server (lib/planner.ts, API routes) and
// client (planner page).
//
// A planner row is ONE planned campaign. It is a DIFFERENT concept from the local
// email-copy SavedCampaign (lib/campaigns.ts) — do not conflate them.

export type PlannerChannel = "email" | "sms";
// Scheduling-state model. "Sent" is DERIVED (see isEffectivelySent), not stored —
// a row is effectively sent once it is scheduled and its planned send time has
// passed. Legacy statuses migrate on read (see lib/planner.ts). The "scheduled"
// label is channel-dependent (Klaviyo for email, Postscript for sms) — use
// statusLabel(status, channel) for display.
export type PlannerStatus = "writing_brief" | "ready_for_design" | "scheduled" | "cancelled";
export type OfferType = "evergreen" | "promo";

export const PLANNER_STATUSES: PlannerStatus[] = ["writing_brief", "ready_for_design", "scheduled", "cancelled"];
export const PLANNER_CHANNELS: PlannerChannel[] = ["email", "sms"];

// Channel-agnostic fallback labels. Prefer statusLabel(status, channel) so the
// scheduled state names the right platform.
export const PLANNER_STATUS_LABELS: Record<PlannerStatus, string> = {
  writing_brief: "Writing brief",
  ready_for_design: "Ready for design",
  scheduled: "Scheduled",
  cancelled: "Cancelled",
};

// Display label; the "scheduled" state names the platform for the row's channel.
export function statusLabel(status: PlannerStatus, channel: PlannerChannel): string {
  if (status === "scheduled") return channel === "sms" ? "Scheduled in Postscript" : "Scheduled in Klaviyo";
  return PLANNER_STATUS_LABELS[status];
}

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
  /** DEPRECATED (2026-07-23): Postscript's public API has no campaign endpoints
   * (see docs/SMS_PLANNER_NB_LINK_AND_MANUAL_METRICS_SPEC.md) — this id linked
   * to nothing. Kept for saved-row compatibility; hidden in the UI. */
  postscript_campaign_id?: string;
  /** Northbeam-reported campaign name (utm_campaign) — the join key for the NB
   * revenue match. SMS rows set it via the picker; email rows default to the
   * linked Klaviyo campaign name at sync time (this field, when set, wins). */
  northbeam_campaign_name?: string;
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
  // Northbeam 1-day-click / clicks-only (northbeam_custom) / cash revenue for this campaign, matched
  // by the linked platform campaign's name (utm_campaign). Distinct from the
  // platform-reported `revenue` above. null = no data / no name match yet.
  northbeam_revenue?: number | null;
  northbeam_synced_at?: string | null;
  // --- Manual platform metrics (SMS rows: Postscript UI numbers, typed in) ---
  // "manual" marks the platform-metric fields (recipients/click/revenue/rpr) as
  // human-entered; the sync route then never overwrites them. A future CSV
  // importer writes "postscript_csv". NB revenue is separate and keeps syncing.
  metrics_source?: "manual" | "postscript_csv" | null;
  metrics_entered_at?: string | null;
  /** True when revenue_per_recipient was manually overridden (Tim sometimes has
   * the platform's own figure). False/absent = derived from revenue/recipients;
   * clearing the override re-derives. */
  rpr_override?: boolean;
  // --- Bookkeeping ---
  created_at: string;
  updated_at: string;
}

// The four manually-enterable platform metrics for SMS rows (PATCH
// /api/planner/manual-metrics). All optional — a PATCH carries only what
// changed. `null` clears a value (empty ≠ 0; zero is a real entered value).
export interface ManualMetricsPatch {
  recipients?: number | null;
  click_rate?: number | null;             // 0..1 fraction, same as synced email rows
  revenue?: number | null;
  revenue_per_recipient?: number | null;  // number = manual override; null = clear override → re-derive
}

// The metrics half a sync writes back onto a row. The Northbeam fields are
// optional: they're written by an independent pass (see the sync route) that may
// run separately from — or fail without taking down — the Klaviyo/Postscript
// write, so writeSyncedMetrics accepts a Partial of this.
export interface SyncedMetrics {
  recipients: number | null;
  open_rate: number | null;
  click_rate: number | null;
  revenue: number | null;
  revenue_per_recipient: number | null;
  metrics_synced_at: string;
  northbeam_revenue?: number | null;
  northbeam_synced_at?: string | null;
}

// "Sent" is derived, never stored: a row counts as effectively sent once it is
// scheduled in Klaviyo and its planned send time is in the past. Use this instead
// of a status === "sent" check anywhere sent-ness matters (table filter, etc.).
export function isEffectivelySent(row: PlannerRow): boolean {
  return row.status === "scheduled" && new Date(row.planned_send_at).getTime() < Date.now();
}

// Per-row sync outcome so the UI can explain exactly why a row did/didn't sync.
// "sms_manual" is informational, not an error: SMS platform metrics are manual
// entry (Postscript's public API has no campaign/analytics endpoints).
export type SyncReason = "matched" | "not_linked" | "not_sent_yet" | "no_activity_in_window" | "sms_manual" | "northbeam_unmatched";
export interface SyncResult {
  id: string;
  name: string;
  matched: boolean;
  reason: SyncReason;
}
