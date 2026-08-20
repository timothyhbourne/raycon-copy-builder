// The corpus: every piece of copy the app knows about, tiered by how much
// authority it has earned. Spec: docs/RECURSIVE_LEARNING_FRAMEWORK_SPEC.md §2.2,
// §2.5. Pure types only — safe to import from client or server.

import type { FormSignature, ElementKind } from "./signature";

/**
 * Authority tiers. The approval signal is already in the data model: a PlannerRow
 * at status "scheduled" means a human took that copy and put it into the sending
 * platform (Klaviyo for email, Postscript for SMS). No platform API integration
 * is needed, and SMS is covered by exactly the same mechanism as email.
 *
 *  shipped  — scheduled AND the send date has passed. The ONLY tier that can
 *             carry performance, and the only tier attraction may learn from.
 *  approved — scheduled, send date still in the future. Carries no outcome yet,
 *             and is the single most important thing to repel FROM: nothing
 *             previously stopped today's generation echoing a headline that goes
 *             out on Thursday.
 *  drafted  — written in the app, never reached "scheduled". The WEAKEST signal
 *             in the corpus, and before this framework it was the ONLY signal
 *             (the constructions index is fed on "Save Final", which is not
 *             approval). Repels at reduced weight; never attracts.
 */
export type CorpusTier = "shipped" | "approved" | "drafted";

export const CORPUS_TIERS: CorpusTier[] = ["shipped", "approved", "drafted"];

/** Display label for a tier, used in prompt blocks and the in-app inspector. */
export const TIER_LABELS: Record<CorpusTier, string> = {
  shipped: "shipped",
  approved: "approved, in flight",
  drafted: "draft only",
};

export interface CorpusElement {
  kind: ElementKind;
  text: string;
  signature: FormSignature;
  /** SKU this line is about, for product-scoped repulsion. */
  product_slug?: string;
  /** True when this candidate is the one that actually shipped. Slate elements
   * (headline, subheader, subject, preview) emit several candidates and only one
   * is sent; without this every candidate would enter the corpus equally
   * weighted. Absent on elements that were never a slate. */
  was_selected?: boolean;
}

export interface CorpusPerformance {
  recipients: number | null;
  revenue: number | null;
  rpr: number | null;
  basis: "platform" | "northbeam";
}

export interface CorpusRecord {
  /** The copy record's own id: a SavedCampaign / LibraryCampaign / SmsCampaign id. */
  id: string;
  tier: CorpusTier;
  channel: "email" | "sms";
  platform: "klaviyo" | "postscript" | null;
  planner_row_id: string | null;
  /** Closest thing the planner row carries to an approval timestamp (its last
   * write while scheduled — PlannerRow has no status-change history). null for
   * drafts. */
  approved_at: string | null;
  /** Real platform send time when known, else the planned send time. null while
   * the send is still in the future or unknown. */
  sent_at: string | null;
  /** Campaign metadata kept for relevance scoring of the reference sample. */
  title: string;
  campaign_type: string;
  audience?: string;
  occasion?: string;
  conceit?: string;
  products_featured: string[];
  elements: CorpusElement[];
  /** Tier "shipped" only, and null until metrics land. A shipped record with no
   * metrics stays in the repulsion set and is excluded from attraction — no
   * estimation, no imputation (spec §2.2, Postscript / SMS). */
  performance: CorpusPerformance | null;
  schema_version?: number;
}

export interface Corpus {
  records: CorpusRecord[];
  /** Cursor that rotates the reference sample so two consecutive generations of
   * the same brief do not see the same examples (spec §4). */
  rotation: number;
  built_at: string | null;
}

export const EMPTY_CORPUS: Corpus = { records: [], rotation: 0, built_at: null };

/** Records that may inform attraction: shipped AND measured. */
export function attractionSet(records: CorpusRecord[]): CorpusRecord[] {
  return records.filter((r) => r.tier === "shipped" && r.performance?.rpr != null);
}

/**
 * Below this many measured Tier-A records the performance block stays off
 * entirely and only the repulsion side runs. Repulsion is useful from record one;
 * attraction is not (spec §2.7, Corpus floor).
 */
export const CORPUS_FLOOR = 15;

/** Ordering for "the last N approved sends": newest first by send date. */
export function bySendDateDesc(a: CorpusRecord, b: CorpusRecord): number {
  return (b.sent_at ?? b.approved_at ?? "").localeCompare(a.sent_at ?? a.approved_at ?? "");
}

export type { FormSignature, ElementKind };
