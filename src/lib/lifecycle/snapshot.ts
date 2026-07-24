import path from "path";
import { getAdapter } from "../storage";
import { readCustomerFacts, type CustomerFactsMap } from "./store";
import seedSnapshot from "./snapshot.seed.json";

// Lifecycle snapshot store + recompute (see lifecycle_inapp_build_brief.md).
//
// The /lifecycle screen reads ONE precomputed blob (`snapshot.json`) so it paints
// instantly — mirroring the dashboard's sync→store→read pattern. The daily
// `POST /api/lifecycle/sync` recomputes this blob from the per-customer order-
// facts store (scripts/ingest-orders.ts → data/lifecycle-customers.json). Until
// that store exists, the read falls back to the bundled seed (real sizes computed
// offline from 24 months of Shopify orders) so management sees live numbers now.

const DATA_ROOT = path.join(process.cwd(), "data");
const SNAPSHOT_KEY = "snapshot.json";
const store = getAdapter(DATA_ROOT, "lifecycle");

// ---- types (per the brief) -------------------------------------------------
export interface LifecycleCohort {
  id: string;
  title: string;
  color: string;
  size: number;
  assumed_response: number;
  aov: number;
  modeled_revenue: number;
  rule: string;
  why: string;
  pills: string[];
  recommendation: { message: string; offer: string };
  klaviyo_segment: string;
}
export interface OverviewBand {
  key: string;
  label: string;
  count: number;
  pct: number;
  color: string;
}
export interface OverviewTile {
  label: string;
  count: number;
  sub: string;
  color: string;
}
export interface LifecycleSnapshot {
  generated_at: string;
  source: "seed" | "worker";
  model_version: string;
  currency: string;
  aov_basis: number;
  assumptions: string;
  total_audience: number;
  overview: { bands: OverviewBand[]; tiles: OverviewTile[] };
  insight_next_best_product: { return_rate_pct: number; items: { label: string; pct: number }[] };
  cohorts: LifecycleCohort[];
  secondary_segments: { label: string; size: number; rule: string }[];
}

export const SEED_SNAPSHOT: LifecycleSnapshot = seedSnapshot as LifecycleSnapshot;

// ---- cohort catalog: presentation + activation + an executable predicate ----
// The static per-cohort fields mirror the seed; sizes + modeled_revenue are
// recomputed by sync from real per-customer facts. Predicates run on the derived
// signals below (days_since_last_order etc.), NOT the raw store, so the rule and
// the code can't drift.

/** Per-customer signals the cohort rules read. Derived from CustomerFacts. */
export interface DerivedCustomer {
  email: string;
  orderCount: number;
  daysSinceLastOrder: number;
  daysSinceFirstOrder: number;
  monetary: number;
  ownsEarbuds: boolean;
  ownsHeadphones: boolean;
  ownsPowerTech: boolean;
}

type CohortStatic = Omit<LifecycleCohort, "size" | "modeled_revenue">;
interface CohortDef {
  meta: CohortStatic;
  match: (c: DerivedCustomer) => boolean;
}

export const COHORT_CATALOG: CohortDef[] = [
  {
    meta: {
      id: "reorder_due_earbuds",
      title: "Reorder-Due · Earbuds replenishment",
      color: "#d99b00",
      assumed_response: 0.08,
      aov: 85,
      rule: "owns 'Earbuds' AND days_since_last_order BETWEEN 60 AND 150",
      why: "Bought earbuds 60–150 days ago and haven't returned — entering the reorder window (median reorder = 94 days). Highest-intent, time-sensitive.",
      pills: ["owns: Earbuds", "no order 60–150d", "peak reorder window"],
      recommendation: {
        message: "\"Time for a fresh pair\" — upgrade to the latest earbuds, or restock ear tips.",
        offer: "15% off next earbuds, or free Memory-Foam ear tips with purchase.",
      },
      klaviyo_segment: "[Lifecycle] Reorder-Due · Earbuds",
    },
    match: (c) => c.ownsEarbuds && c.daysSinceLastOrder >= 60 && c.daysSinceLastOrder <= 150,
  },
  {
    meta: {
      id: "atrisk_overdue_earbuds",
      title: "At-Risk · Earbuds reorder overdue",
      color: "#f97316",
      assumed_response: 0.04,
      aov: 85,
      rule: "owns 'Earbuds' AND days_since_last_order BETWEEN 151 AND 300",
      why: "Past their typical reorder point (151–300 days) with no return — slipping, but recoverable with a nudge now.",
      pills: ["owns: Earbuds", "overdue 151–300d"],
      recommendation: {
        message: "\"We saved your spot\" — reminder + social proof / reviews.",
        offer: "20% off to come back.",
      },
      klaviyo_segment: "[Lifecycle] At-Risk · Earbuds overdue",
    },
    match: (c) => c.ownsEarbuds && c.daysSinceLastOrder >= 151 && c.daysSinceLastOrder <= 300,
  },
  {
    meta: {
      id: "winback_lapsed",
      title: "Win-Back · lapsed 6–12 months",
      color: "#ef4444",
      assumed_response: 0.015,
      aov: 85,
      rule: "days_since_last_order BETWEEN 181 AND 365",
      why: "Last purchase 181–365 days ago. Reachable and brand-aware — classic escalating win-back.",
      pills: ["last order 181–365d"],
      recommendation: {
        message: "\"We miss you\" win-back series (2–3 touches).",
        offer: "Escalating code: 25% → 30%.",
      },
      klaviyo_segment: "[Lifecycle] Win-Back · 6–12mo",
    },
    match: (c) => c.daysSinceLastOrder >= 181 && c.daysSinceLastOrder <= 365,
  },
  {
    meta: {
      id: "crosssell_headphones",
      title: "Cross-Sell · Earbuds → Headphones",
      color: "#3b82f6",
      assumed_response: 0.03,
      aov: 85,
      rule: "owns 'Earbuds' AND NOT owns 'Headphones' AND days_since_last_order <= 120",
      why: "Recent earbuds buyers (≤120d) who don't own headphones — warm, with a clear next-best product.",
      pills: ["owns: Earbuds", "missing: Headphones", "recent buyer"],
      recommendation: {
        message: "\"Complete your setup\" — headphones for home/travel.",
        offer: "Bundle discount on headphones.",
      },
      klaviyo_segment: "[Lifecycle] Cross-Sell · Earbuds→Headphones",
    },
    match: (c) => c.ownsEarbuds && !c.ownsHeadphones && c.daysSinceLastOrder <= 120,
  },
  {
    meta: {
      id: "new_customer_2nd",
      title: "New Customer · 2nd-order nudge",
      color: "#16a34a",
      assumed_response: 0.06,
      aov: 85,
      rule: "order_count = 1 AND days_since_first_order <= 45",
      why: "First order in the last 45 days. The biggest lever since 83% never buy twice — win the second order now.",
      pills: ["1 order · ≤45d"],
      recommendation: {
        message: "Onboarding + \"made for your earbuds\" accessories.",
        offer: "Accessory bundle; low/no discount.",
      },
      klaviyo_segment: "[Lifecycle] New Customer · 2nd-order",
    },
    match: (c) => c.orderCount === 1 && c.daysSinceFirstOrder <= 45,
  },
];

// Overview distribution bands (by purchase recency), tile definitions, and the
// next-best-product insight are structural population facts — the colors/labels
// come from the seed; sync recomputes the counts.
const BAND_DEFS = [
  { key: "active", label: "Active (≤90d)", color: "#16a34a", match: (d: number) => d <= 90 },
  { key: "reorder", label: "Reorder window (91–180d)", color: "#d99b00", match: (d: number) => d >= 91 && d <= 180 },
  { key: "atrisk", label: "At-Risk / Win-Back (181–365d)", color: "#f97316", match: (d: number) => d >= 181 && d <= 365 },
  { key: "dormant", label: "Dormant (>365d)", color: "#8b93a3", match: (d: number) => d > 365 },
];

const HIGH_VALUE_REPEAT_MIN = 173; // p90 24-mo net sales (master spec §2)

// Next-best-product mix is a structural finding (order-sequence analysis from the
// full base, master spec §2) — carried as a constant since the facts store keeps
// owned categories, not purchase order. Kept in sync with the seed.
const INSIGHT_NEXT_BEST = SEED_SNAPSHOT.insight_next_best_product;

// ---- derive + compute ------------------------------------------------------
const DAY_MS = 86_400_000;
const daysSinceISODate = (isoDate: string, now: number): number => {
  const t = Date.parse(`${isoDate}T00:00:00Z`);
  return Number.isNaN(t) ? 0 : Math.floor((now - t) / DAY_MS);
};

export function deriveCustomers(facts: CustomerFactsMap, now: number): DerivedCustomer[] {
  const out: DerivedCustomer[] = [];
  for (const [email, f] of Object.entries(facts)) {
    out.push({
      email,
      orderCount: f.orderCount,
      daysSinceLastOrder: daysSinceISODate(f.lastOrderDate, now),
      daysSinceFirstOrder: daysSinceISODate(f.firstOrderDate, now),
      monetary: f.monetary,
      ownsEarbuds: f.ownedCategories.includes("Earbuds"),
      ownsHeadphones: f.ownedCategories.includes("Headphones"),
      ownsPowerTech: f.ownedCategories.includes("Power Tech"),
    });
  }
  return out;
}

/** Recompute the whole snapshot from the per-customer order-facts store. Pure. */
export function computeSnapshot(facts: CustomerFactsMap, nowISO: string): LifecycleSnapshot {
  const now = Date.parse(nowISO);
  const customers = deriveCustomers(facts, now);
  const total = customers.length;

  const cohorts: LifecycleCohort[] = COHORT_CATALOG.map(({ meta, match }) => {
    const size = customers.reduce((n, c) => (match(c) ? n + 1 : n), 0);
    return { ...meta, size, modeled_revenue: Math.round(size * meta.assumed_response * meta.aov) };
  }).sort((a, b) => b.modeled_revenue - a.modeled_revenue);

  const bands: OverviewBand[] = BAND_DEFS.map((b) => {
    const count = customers.reduce((n, c) => (b.match(c.daysSinceLastOrder) ? n + 1 : n), 0);
    return { key: b.key, label: b.label, count, pct: total ? Math.round((count / total) * 1000) / 10 : 0, color: b.color };
  });

  const countWhere = (pred: (c: DerivedCustomer) => boolean) => customers.reduce((n, c) => (pred(c) ? n + 1 : n), 0);
  const newCustomers = countWhere((c) => c.orderCount === 1 && c.daysSinceFirstOrder <= 45);
  const reorderDue = countWhere((c) => c.ownsEarbuds && c.daysSinceLastOrder >= 60 && c.daysSinceLastOrder <= 150);
  const highValueRepeat = countWhere((c) => c.orderCount >= 2 && c.monetary >= HIGH_VALUE_REPEAT_MIN);
  const suppression = countWhere((c) => c.daysSinceLastOrder > 365);
  const crossPowerTech = countWhere((c) => c.ownsEarbuds && !c.ownsPowerTech && c.daysSinceLastOrder <= 120);

  const tiles: OverviewTile[] = [
    { label: "New Customers", count: newCustomers, sub: "1st order ≤45d · win the 2nd", color: "#3b82f6" },
    { label: "Reorder-Due (Earbuds)", count: reorderDue, sub: "60–150d window", color: "#d99b00" },
    { label: "High-Value Repeat", count: highValueRepeat, sub: "2+ orders · ≥$173 spend", color: "#16a34a" },
    { label: "Suppression Watch", count: suppression, sub: ">365d · protect deliverability", color: "#b91c1c" },
  ];

  return {
    generated_at: nowISO,
    source: "worker",
    model_version: SEED_SNAPSHOT.model_version,
    currency: "USD",
    aov_basis: SEED_SNAPSHOT.aov_basis,
    assumptions: SEED_SNAPSHOT.assumptions,
    total_audience: total,
    overview: { bands, tiles },
    insight_next_best_product: INSIGHT_NEXT_BEST,
    cohorts,
    secondary_segments: [
      { label: "Cross-Sell · Earbuds→Power Tech", size: crossPowerTech, rule: "owns Earbuds AND NOT Power Tech AND recency<=120d" },
      { label: "High-Value Repeat (upsell)", size: highValueRepeat, rule: "order_count>=2 AND monetary>=173" },
      { label: "Suppression watch", size: suppression, rule: "engagement_recency>365d (or purchase recency>365d proxy)" },
    ],
  };
}

/** The member emails of one cohort, from the facts store (CSV export / list push). */
export function cohortMemberEmails(facts: CustomerFactsMap, id: string, now: number): string[] {
  const def = COHORT_CATALOG.find((d) => d.meta.id === id);
  if (!def) return [];
  return deriveCustomers(facts, now)
    .filter((c) => def.match(c))
    .map((c) => c.email);
}

export function isKnownCohort(id: string): boolean {
  return COHORT_CATALOG.some((d) => d.meta.id === id);
}

// ---- store read/write ------------------------------------------------------
/** Read the snapshot; fall back to the bundled seed so the page is always live. */
export async function readSnapshot(): Promise<LifecycleSnapshot> {
  const raw = await store.read(SNAPSHOT_KEY);
  if (raw != null) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as LifecycleSnapshot;
    } catch {
      /* fall through to seed */
    }
  }
  return SEED_SNAPSHOT;
}

export async function writeSnapshot(snapshot: LifecycleSnapshot): Promise<void> {
  await store.write(SNAPSHOT_KEY, JSON.stringify(snapshot));
}

/** True once the per-customer order-facts store has data (members/sync possible). */
export async function hasCustomerFacts(): Promise<boolean> {
  const facts = await readCustomerFacts();
  return Object.keys(facts).length > 0;
}
