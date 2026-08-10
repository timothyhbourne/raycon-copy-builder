import type { PlannerRow, PlannerChannel, PlannerStatus } from "@/lib/planner-types";
import { EVERGREEN_OFFER } from "@/lib/planner-types";
import type { ChipTone } from "@/components/ui/Chip";

// Pure formatting helpers, style maps, and shared types for the Planner page,
// split out of page.tsx (mirrors dashboard/format.ts). No JSX here — see
// ./components for the small presentational pieces that consume these.

// Copy Builder link state for a row, resolved against the set of saved copy ids.
export type CopyEntry = "sms" | "unlinked" | "draft" | "final";

// Normalized copy preview from /api/planner/copy.
export interface CopyPreview {
  id: string;
  source: "draft" | "library";
  campaign_name: string;
  updated_at: string;
  subject_lines: string[];
  preview_texts: string[];
  sections: { type: string; fields: Record<string, string> }[];
}

export interface CampaignItem { id: string; name: string; status: string; send_time: string | null }

// Channel signal = an emoji glyph shown before the campaign name.
export const CHANNEL_GLYPH: Record<PlannerChannel, { emoji: string; label: string }> = {
  email: { emoji: "📧", label: "Email" },
  sms: { emoji: "📱", label: "SMS" },
};

// Status-driven pill styling, drawn from the SEMANTIC token tones (§4.4):
// ready_for_design = action/violet, scheduled = success, the rest neutral sunken. `check` prefixes a ✓ glyph; `strike` strikes the
// name. The scheduled label is channel-dependent — see statusLabel().
export const STATUS_STYLE: Record<PlannerStatus, { pill: string; check?: boolean; strike?: boolean }> = {
  writing_brief: { pill: "bg-sunken text-ink-secondary border-line" },
  ready_for_design: { pill: "bg-action-50 text-action-600 border-action-200" },
  scheduled: { pill: "bg-success-50 text-success-600 border-success-200", check: true },
  cancelled: { pill: "bg-sunken text-ink-tertiary border-line", strike: true },
};

export const COPY_TONE: Record<"draft" | "final", ChipTone> = { draft: "warning", final: "success" };

export const money = (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n));
export const int = (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("en-US").format(Math.round(n)));
export const pct = (f: number | null | undefined) => (f == null ? "—" : `${(f * 100).toFixed(1)}%`);
export const rpr = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);
export const fmtDate = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); };
export const fmtDateTime = (iso: string | null) => { if (!iso) return "—"; const d = new Date(iso); return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };
export function isoToLocalInput(iso: string): string { const d = new Date(iso); if (isNaN(d.getTime())) return ""; return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
export function localInputToIso(v: string): string { const d = new Date(v); return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(); }
export function ymdOf(iso: string): string { return (iso || "").slice(0, 10); }

// Table renders offer value and discount code as two separate columns.
export function offerValue(r: PlannerRow): string {
  return r.offer_type === "evergreen" ? EVERGREEN_OFFER : (r.offer || "—");
}
export function discountCode(r: PlannerRow): string | null {
  return r.promo_code || null;
}
// Re-date an ISO to a new YMD, preserving time-of-day.
export function reDate(iso: string, newYmd: string): string {
  const old = new Date(iso);
  const [y, m, d] = newYmd.split("-").map(Number);
  const nd = isNaN(old.getTime()) ? new Date() : new Date(old);
  nd.setFullYear(y, m - 1, d);
  return nd.toISOString();
}

export const microLabel = "t-label";
export const selectCls = "appearance-none text-sm border border-line rounded-sm pl-2.5 pr-7 py-1.5 bg-surface focus:outline-none focus:border-accent transition-colors";
