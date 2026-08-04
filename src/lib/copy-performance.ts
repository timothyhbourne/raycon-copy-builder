import type { PlannerRow } from "./planner-types";
import type { SavedCampaign, LibraryCampaign, SectionSpec } from "./schemas";

// Copy Performance — "What actually works" (spec: COPY_PERFORMANCE_SPEC.md).
// PURE join + aggregation over stores that already exist: a planner row links
// written copy (SavedCampaign / LibraryCampaign) to the sent campaign's synced
// metrics. This module does the transformation + statistics only; the route
// (src/app/api/copy-performance/route.ts) does the store I/O and hands resolved
// inputs in. No fs / network here — it's client-safe and unit-tested.

export type RevenueBasis = "platform" | "northbeam";
export type ChannelFilter = "email" | "sms" | "all";
export type AttributionSource = "saved" | "library" | "unattributed";

/** Below this sample size a dimension value is "directional only" (spec §9). */
export const MIN_N = 3;

/** Copy attributes we correlate against revenue. Undefined = not knowable for
 * this record's attribution source (library carries fewer than saved). */
export interface CopyAttributes {
  campaign_type?: string;
  angle?: string;
  conceit_architecture?: string;
  send_stage?: string;
  urgency?: number;
  occasion_kind?: "promo_calendar" | "occasion" | "none";
  offer_type?: string;
  audience?: string;
  structure_signature?: string;
  includes_reviews?: boolean;
  includes_product_grid?: boolean;
  includes_product_card_review?: boolean;
}

export interface PerformanceRecord {
  row_id: string;
  name: string;
  channel: "email" | "sms";
  send_date: string | null;
  recipients: number | null;
  /** Platform (Klaviyo) revenue-per-recipient. */
  rpr: number | null;
  revenue: number | null;
  northbeam_revenue: number | null;
  northbeam_rpr: number | null;
  open_rate: number | null;
  click_rate: number | null;
  metrics_synced_at: string | null;
  metrics_source: string | null;
  attributes: CopyAttributes;
  attribution_source: AttributionSource;
}

export interface DimensionValueAgg {
  value: string;
  n: number;
  mean_rpr: number;
  median_rpr: number;
  total_revenue: number;
  total_recipients: number;
  low_confidence: boolean;
}
export interface DimensionAgg {
  dimension: string;
  label: string;
  values: DimensionValueAgg[];
}
export interface Coverage {
  sent_count: number;
  attributed_count: number;
  attributed_coverage: number; // 0..1
  unattributed_revenue: number; // platform basis — the broadest "$ not attributed"
}
export interface CopyPerformanceResult {
  records: PerformanceRecord[];
  aggregates: DimensionAgg[];
  coverage: Coverage;
  range: { start: string; end: string };
  basis: RevenueBasis;
  channel: ChannelFilter;
}

// ---- structure signature --------------------------------------------------
export function structureInfo(sections: SectionSpec[] | undefined): {
  structure_signature?: string;
  includes_reviews?: boolean;
  includes_product_grid?: boolean;
  includes_product_card_review?: boolean;
} {
  if (!sections || !sections.length) return {};
  const types = sections.map((s) => s.type);
  return {
    structure_signature: types.join("→"),
    includes_reviews: types.includes("reviews"),
    includes_product_grid: types.includes("product_grid"),
    includes_product_card_review: types.includes("product_card_review"),
  };
}

// ---- attribute extraction -------------------------------------------------
export function attributesFromSaved(c: SavedCampaign, row: PlannerRow): CopyAttributes {
  const occasion_kind = c.promotion_id ? "promo_calendar" : c.occasion ? "occasion" : "none";
  return {
    campaign_type: c.campaign_type,
    angle: c.angle,
    conceit_architecture: c.chosen_conceit?.architecture,
    send_stage: c.send_stage,
    urgency: c.urgency,
    occasion_kind,
    offer_type: row.offer_type,
    audience: c.audience,
    ...structureInfo(c.section_structure),
  };
}

export function attributesFromLibrary(c: LibraryCampaign, row: PlannerRow): CopyAttributes {
  return {
    campaign_type: c.campaign_type,
    audience: c.audience,
    offer_type: row.offer_type,
    ...structureInfo(c.structured?.section_structure),
  };
}

// ---- record building ------------------------------------------------------
function num(n: number | null | undefined): number | null {
  return typeof n === "number" && !Number.isNaN(n) ? n : null;
}
/** Platform RPR: prefer the row's stored/overridden value, else derive. */
function platformRpr(row: PlannerRow): number | null {
  const stored = num(row.revenue_per_recipient);
  if (stored != null) return stored;
  const rev = num(row.revenue);
  const rec = num(row.recipients);
  return rev != null && rec != null && rec > 0 ? rev / rec : null;
}

export function toRecord(
  row: PlannerRow,
  attribution: { source: "saved" | "library"; attributes: CopyAttributes } | null,
): PerformanceRecord {
  const recipients = num(row.recipients);
  const nbRev = num(row.northbeam_revenue);
  return {
    row_id: row.id,
    name: row.name,
    channel: row.channel,
    send_date: row.klaviyo_send_time ?? row.planned_send_at ?? null,
    recipients,
    rpr: platformRpr(row),
    revenue: num(row.revenue),
    northbeam_revenue: nbRev,
    northbeam_rpr: nbRev != null && recipients != null && recipients > 0 ? nbRev / recipients : null,
    open_rate: num(row.open_rate),
    click_rate: num(row.click_rate),
    metrics_synced_at: row.metrics_synced_at ?? null,
    metrics_source: row.metrics_source ?? null,
    attributes: attribution?.attributes ?? {},
    attribution_source: attribution?.source ?? "unattributed",
  };
}

// ---- aggregation ----------------------------------------------------------
function rprForBasis(r: PerformanceRecord, basis: RevenueBasis): number | null {
  return basis === "platform" ? r.rpr : r.northbeam_rpr;
}
function revenueForBasis(r: PerformanceRecord, basis: RevenueBasis): number | null {
  return basis === "platform" ? r.revenue : r.northbeam_revenue;
}
function median(sorted: number[]): number {
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The dimensions we correlate (spec §5). Each maps a record to a display value
 * (undefined → the record doesn't contribute to that dimension). Shared with the
 * page so labels/keys never drift. */
export const DIMENSIONS: { key: string; label: string; get: (r: PerformanceRecord) => string | undefined }[] = [
  { key: "angle", label: "Angle", get: (r) => r.attributes.angle },
  { key: "conceit_architecture", label: "Conceit architecture", get: (r) => r.attributes.conceit_architecture },
  { key: "campaign_type", label: "Campaign type", get: (r) => r.attributes.campaign_type },
  { key: "includes_reviews", label: "Includes reviews", get: (r) => r.attributes.includes_reviews === undefined ? undefined : r.attributes.includes_reviews ? "With reviews" : "Without reviews" },
  { key: "send_stage", label: "Send stage", get: (r) => r.attributes.send_stage },
  { key: "urgency", label: "Urgency tier", get: (r) => (r.attributes.urgency == null ? undefined : `Tier ${r.attributes.urgency}`) },
  { key: "offer_type", label: "Offer type", get: (r) => r.attributes.offer_type },
  { key: "audience", label: "Audience", get: (r) => r.attributes.audience },
];

/** The insight-panel dimensions the page surfaces prominently (spec §8.2). */
export const PANEL_DIMENSIONS = ["angle", "conceit_architecture", "campaign_type", "includes_reviews", "send_stage"];

export function aggregate(
  records: PerformanceRecord[],
  basis: RevenueBasis,
  minN: number = MIN_N,
): { aggregates: DimensionAgg[]; coverage: Coverage } {
  const attributed = records.filter((r) => r.attribution_source !== "unattributed");

  const aggregates: DimensionAgg[] = DIMENSIONS.map(({ key, label, get }) => {
    // value → the record RPRs / revenue / recipients that carry the chosen basis.
    const buckets = new Map<string, { rprs: number[]; revenue: number; recipients: number }>();
    for (const r of attributed) {
      const value = get(r);
      const rpr = rprForBasis(r, basis);
      if (value === undefined || rpr == null) continue; // no attribute or no data on this basis
      const b = buckets.get(value) ?? { rprs: [], revenue: 0, recipients: 0 };
      b.rprs.push(rpr);
      b.revenue += revenueForBasis(r, basis) ?? 0;
      b.recipients += r.recipients ?? 0;
      buckets.set(value, b);
    }
    const values: DimensionValueAgg[] = [...buckets.entries()].map(([value, b]) => {
      const sorted = [...b.rprs].sort((x, y) => x - y);
      const mean = b.rprs.reduce((s, x) => s + x, 0) / b.rprs.length;
      return {
        value, n: b.rprs.length,
        mean_rpr: mean, median_rpr: median(sorted),
        total_revenue: b.revenue, total_recipients: b.recipients,
        low_confidence: b.rprs.length < minN,
      };
    }).sort((a, z) => z.mean_rpr - a.mean_rpr);
    return { dimension: key, label, values };
  });

  const attributedCount = attributed.length;
  const sentCount = records.length;
  const unattributedRevenue = records
    .filter((r) => r.attribution_source === "unattributed")
    .reduce((s, r) => s + (r.revenue ?? 0), 0);

  return {
    aggregates,
    coverage: {
      sent_count: sentCount,
      attributed_count: attributedCount,
      attributed_coverage: sentCount > 0 ? attributedCount / sentCount : 0,
      unattributed_revenue: unattributedRevenue,
    },
  };
}
