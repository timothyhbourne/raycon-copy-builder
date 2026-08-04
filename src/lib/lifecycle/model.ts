import { PRODUCT_CATEGORIES } from "../products";

// Raycon Lifecycle Scoring Model (see lifecycle_engine_master_spec.md; the older
// lifecycle_scoring_model_spec.md remains valid background).
//
// Two INDEPENDENT axes, never collapsed into one score:
//   • Purchase   → P(active), a transparent decay proxy for BG/NBD P(alive).
//                  Decides the lifecycle STAGE (Kanban column).
//   • Engagement → days since last_event_date. Decides reachability + suppression,
//                  and acts as a GUARDRAIL so an actively-engaging customer is
//                  never mislabeled dead (the "Ray" case, §6).
//
// Klaviyo's native churn_probability is NOT used to drive any stage — it is
// saturated on this account (median 0.99) and carries almost no signal. It is
// surfaced only as a raw reference badge.
//
// Resolved open decisions (§8): (A) "Churning" is split into Win-Back (still
// engaged) and VIP Reactivation (high-value, overdue, still reachable — Ray);
// (B) cutoffs/windows confirmed as below; (D) product-affinity cross-sell is
// driven by OWNERSHIP from order line-items (not a profile property — LuhenE has
// none), with the sparse Audio/Home/PS-Interest properties as fallback signal.
// (C) Phase 2 replaces the P(active) proxy with
// a fitted BG/NBD P(alive) + Gamma-Gamma CLV — the model accepts an injected
// fitted value via scoreProfile()'s opts so the stage/badge logic is unchanged
// when that lands.

// --- tunable constants (master spec §3.3, §9 — real-data corrected) ----------
// Repurchase cadence for one-time-buyer fallback. Was 420 (a bad estimate);
// corrected to the measured 1st→2nd-order median of ~95d from
// shopify_orders_l24m.csv (median 1st→2nd = 94d; overall inter-order median 118d).
export const POPULATION_MEDIAN_CADENCE_DAYS = 95;
// High-value gate. Was $265 (~97th pctl — excluded ~95% of buyers). Corrected to
// the 24-mo net-sales p75 of $119. NB the model gates on Klaviyo lifetime
// `total_clv`; recompute this against the Klaviyo CLV p75 to stay apples-to-apples
// (master spec §3.3 caveat).
export const HIGH_VALUE_CLV = 119;

// P(active) → stage cutoffs (§3): >=0.80 live · 0.50–0.80 at-risk ·
// 0.20–0.50 churning · <0.20 purchase-gone.
export const P_ACTIVE_LIVE = 0.8;
export const P_ACTIVE_AT_RISK = 0.5;
export const P_ACTIVE_GONE = 0.2;

// Engagement windows in days (§4): reachable / warm / sunset boundaries.
export const ENGAGE_FRESH = 45;
export const ENGAGE_WARM = 90;
export const ENGAGE_COOL = 180;
export const ENGAGE_SUNSET = 365;

// ---------------------------------------------------------------------------

export type LifecycleStage =
  | "suppression_ready"
  | "lead_non_buyer"
  | "new_customer"
  | "lapsed_dormant"
  | "win_back"          // §8-A: the "still engaged" churning population
  | "vip_reactivation"  // §8-A: high-value, overdue, still reachable (priority)
  | "at_risk"
  | "upsell_ready"
  | "active_on_track"
  | "unknown";

// Human labels for the Kanban columns (§4, §8-A).
export const STAGE_LABELS: Record<LifecycleStage, string> = {
  suppression_ready: "Suppression-Ready",
  lead_non_buyer: "Lead / Non-Buyer",
  new_customer: "New Customer",
  lapsed_dormant: "Lapsed / Dormant",
  win_back: "Win-Back",
  vip_reactivation: "VIP Reactivation",
  at_risk: "At-Risk (Disengaging)",
  upsell_ready: "Upsell-Ready",
  active_on_track: "Active / On-Track",
  unknown: "Unknown (no signals)",
};

// Kanban column order, left → right (healthiest/growth on the left, sunset on
// the right). The serving layer renders columns in this order.
export const STAGE_ORDER: LifecycleStage[] = [
  "new_customer",
  "active_on_track",
  "upsell_ready",
  "at_risk",
  "win_back",
  "vip_reactivation",
  "lapsed_dormant",
  "suppression_ready",
  "lead_non_buyer",
  "unknown",
];

// Scalar inputs to the model. The Klaviyo adapter (./klaviyo) derives these from
// a profile's predictive_analytics + last_event_date + created + properties,
// relative to a reference "now". Nulls are first-class: ~48% of contacts are
// non-buyers and several predictive fields are frequently absent.
export interface LifecycleInput {
  /** n — historic order count. */
  orderCount: number;
  /** age — days since the profile was created. */
  ageDays: number;
  /** R_e — days since last engagement (last_event_date). null = never engaged / unknown. */
  engagementRecencyDays: number | null;
  /** total_CLV. null = unknown. */
  clv: number | null;
  /** today − expected_date_of_next_order, in days. null = no reorder estimate (eno absent). */
  daysPastExpectedReorder: number | null;
  /** customer's own average days between orders. null → population-median fallback. */
  avgDaysBetweenOrders: number | null;
  /** Klaviyo churn_probability, reference only. null = unknown. */
  churnProbability: number | null;
  /** Catalogue SKU ids the customer OWNS — the source of truth for product-
   * affinity cross-sell (§8-D). Derived from Placed Order / Ordered Product
   * event line-items (via the fitted store / worker), NOT a profile property
   * (the LuhenE account has no ownership property and an empty catalog). */
  ownedProductIds: string[];
  /** FALLBACK interest signal from sparse profile properties (Audio / Home /
   * PS - Interest). Represents interest, not ownership — used only when no
   * order-derived ownership is known (§8-D). */
  interests: string[];
}

export interface LifecycleScore {
  stage: LifecycleStage;
  stageLabel: string;
  /** P(active) in [0,1], or null when no reorder signal is available. */
  pActive: number | null;
  /** Whether pActive came from the Phase-1 proxy or an injected fitted P(alive). */
  pActiveSource: "proxy" | "fitted" | "none";
  /** Non-exclusive card overlays (§5). */
  badges: string[];
  /** Category labels the customer already owns (§8-D), from order line-items. */
  ownedCategories: string[];
  /** Category labels to cross-sell (owns none of) — empty when ownership unknown. */
  upsellCategories: string[];
  /** Fallback interest labels (profile properties) when ownership is unknown. */
  interests: string[];
}

/** Optional Phase-2 hook (§8-C): a statistically-fitted P(alive) that overrides
 * the Phase-1 proxy, keeping every downstream rule identical. */
export interface ScoreOptions {
  /** Fitted BG/NBD P(alive), if available for this customer. */
  fittedPAlive?: number | null;
}

/**
 * P(active) — the Phase-1 proxy for BG/NBD P(alive) (§3).
 *
 *   cycles_overdue = max(0, days_past_expected_reorder) / cadence
 *   P(active)      = 0.5 ^ cycles_overdue      (half-life = one purchase cycle)
 *
 * On cadence (or not yet due) → 1.0; one cycle overdue → 0.50; two → 0.25.
 * cadence falls back to the population median when the customer's own is unknown
 * (one-time buyers). Returns null when there is no reorder estimate at all —
 * the stage assignment then falls back to engagement-recency bands.
 */
export function pActive(input: LifecycleInput): number | null {
  if (input.daysPastExpectedReorder == null) return null;
  const cadence =
    input.avgDaysBetweenOrders && input.avgDaysBetweenOrders > 0
      ? input.avgDaysBetweenOrders
      : POPULATION_MEDIAN_CADENCE_DAYS;
  const cyclesOverdue = Math.max(0, input.daysPastExpectedReorder) / cadence;
  return Math.pow(0.5, cyclesOverdue);
}

/** Product-affinity split (§8-D): which categories the customer owns vs. the
 * ones to cross-sell. Only meaningful when owned SKUs are known. */
export function productAffinity(ownedProductIds: string[]): { ownedCategories: string[]; upsellCategories: string[] } {
  const owned = new Set(ownedProductIds);
  const ownedCategories: string[] = [];
  const upsellCategories: string[] = [];
  for (const cat of PRODUCT_CATEGORIES) {
    if (cat.products.some((p) => owned.has(p.id))) ownedCategories.push(cat.label);
    else upsellCategories.push(cat.label);
  }
  // No known ownership → we can't claim anything to cross-sell.
  if (ownedCategories.length === 0) return { ownedCategories: [], upsellCategories: [] };
  return { ownedCategories, upsellCategories };
}

// The churning region splits into VIP Reactivation vs Win-Back (§8-A). A
// high-value, still-reachable customer is the priority reactivation (Ray);
// everyone else in the churning band is a standard win-back.
function churningColumn(input: LifecycleInput): LifecycleStage {
  const Re = input.engagementRecencyDays;
  const highValue = input.clv != null && input.clv >= HIGH_VALUE_CLV;
  const reachable = Re != null && Re <= ENGAGE_COOL;
  return highValue && reachable ? "vip_reactivation" : "win_back";
}

/**
 * Assign the lifecycle stage (§4). Rules are evaluated top-to-bottom,
 * first-match-wins, exactly as tabulated in the spec. The engagement guardrail
 * (180 < R_e ≤ 365 → Lapsed regardless of purchase signal) sits between rule 3
 * and rule 4. When P(active) is not computable (cadence/reorder data missing),
 * stages fall back to engagement-recency bands (45 / 90 / 180 / 365).
 */
export function assignStage(input: LifecycleInput, p: number | null = pActive(input)): LifecycleStage {
  const Re = input.engagementRecencyDays;
  const n = input.orderCount;

  // 1. Suppression-Ready — engagement past the sunset window, or a never-engaged
  //    non-buyer on an aged account.
  if ((Re != null && Re > ENGAGE_SUNSET) || (Re == null && input.ageDays > ENGAGE_SUNSET && n === 0)) {
    return "suppression_ready";
  }
  // 2. Lead / Non-Buyer — subscribed, never purchased.
  if (n === 0) return "lead_non_buyer";
  // 3. New Customer — bought and still inside the onboarding window.
  if (n >= 1 && input.ageDays <= ENGAGE_FRESH) return "new_customer";
  // Engagement guardrail — last-chance win-back regardless of purchase signal.
  if (Re != null && Re > ENGAGE_COOL && Re <= ENGAGE_SUNSET) return "lapsed_dormant";

  // P(active)-driven stages when the purchase axis is computable.
  if (p != null) {
    if (p < P_ACTIVE_GONE) {
      // Purchase-gone. Reachable (engaged ≤45d) → churning region (Win-Back or
      // VIP Reactivation); otherwise → Lapsed / Dormant.
      if (Re != null && Re <= ENGAGE_FRESH) return churningColumn(input);
      return "lapsed_dormant";
    }
    if (p < P_ACTIVE_AT_RISK) return churningColumn(input); // 0.20–0.50
    if (p < P_ACTIVE_LIVE) return "at_risk"; // 0.50–0.80 (≈ one cycle overdue)
    // p >= 0.80 (live). Upsell when a proven repeat buyer of real value is reachable.
    if (n >= 2 && (input.clv ?? 0) >= HIGH_VALUE_CLV && Re != null && Re <= ENGAGE_WARM) {
      return "upsell_ready";
    }
    return "active_on_track";
  }

  // P(active) not computable → engagement-recency band fallback (Re>365 and
  // 180<Re≤365 already returned above).
  if (Re != null) {
    if (Re <= ENGAGE_FRESH) return "active_on_track";
    if (Re <= ENGAGE_WARM) return "at_risk";
    return churningColumn(input); // 90 < Re ≤ 180
  }

  // 9. Unknown — a buyer with no engagement AND no cadence/reorder data.
  return "unknown";
}

/**
 * Non-exclusive card overlays (§5, §8-D), computed from the raw signals and
 * P(active) (independent of the assigned stage). Order is display priority.
 */
export function computeBadges(input: LifecycleInput, p: number | null): string[] {
  const badges: string[] = [];
  const Re = input.engagementRecencyDays;
  const n = input.orderCount;
  const clv = input.clv ?? 0;
  const overdue = input.daysPastExpectedReorder != null && input.daysPastExpectedReorder > 0;
  const highValue = input.clv != null && clv >= HIGH_VALUE_CLV;
  const reachable = Re != null && Re <= ENGAGE_COOL;
  const purchaseLapsed = p != null && p < P_ACTIVE_AT_RISK;

  // VIP at-risk — high value + overdue + still reachable → priority.
  if (highValue && overdue && reachable) badges.push("VIP at-risk");
  if (highValue) badges.push("high value");

  if (n === 1) badges.push("single-purchase");
  else if (n >= 2) badges.push(`repeat x${n}`);

  if (overdue) badges.push(`purchase-overdue ${Math.round(input.daysPastExpectedReorder as number)}d`);

  // Recently re-engaged — engaged ≤30d but purchase-lapsed → win-back in progress.
  if (Re != null && Re <= 30 && purchaseLapsed) badges.push("recently re-engaged");

  // Product-affinity cross-sell (§8-D) — driven by order-derived ownership.
  // When ownership is unknown, fall back to the sparse interest signal.
  const { ownedCategories, upsellCategories } = productAffinity(input.ownedProductIds);
  if (upsellCategories.length) badges.push(`cross-sell: ${upsellCategories.slice(0, 3).join(", ")}`);
  else if (ownedCategories.length === 0 && input.interests.length) {
    badges.push(`interest: ${input.interests.slice(0, 3).join(", ")}`);
  }

  if (Re == null && n >= 1) badges.push("missing engagement data");

  if (input.churnProbability != null) {
    badges.push(`Klaviyo churn (raw) ${input.churnProbability.toFixed(2)}`);
  }

  return badges;
}

/**
 * Score a single profile: stage + P(active) + badges + product affinity.
 * Pass opts.fittedPAlive (§8-C, Phase 2) to override the proxy with a fitted
 * BG/NBD P(alive); the stage/badge logic is identical either way.
 */
export function scoreProfile(input: LifecycleInput, opts: ScoreOptions = {}): LifecycleScore {
  const proxy = pActive(input);
  const p = opts.fittedPAlive != null ? opts.fittedPAlive : proxy;
  const source: LifecycleScore["pActiveSource"] =
    opts.fittedPAlive != null ? "fitted" : proxy != null ? "proxy" : "none";
  const { ownedCategories, upsellCategories } = productAffinity(input.ownedProductIds);
  const stage = assignStage(input, p);
  return {
    stage,
    stageLabel: STAGE_LABELS[stage],
    pActive: p,
    pActiveSource: source,
    badges: computeBadges(input, p),
    ownedCategories,
    upsellCategories,
    interests: input.interests,
  };
}
