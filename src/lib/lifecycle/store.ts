import path from "path";
import { getAdapter } from "../storage";

// Fitted-values store (Phase 2, §8-C). The Python BG/NBD + Gamma-Gamma worker
// (worker/lifecycle/) writes per-customer statistically-fitted P(alive) and
// predicted CLV here; the serving layer reads them and injects P(alive) into the
// model via scoreProfile's `fittedPAlive` seam. Absent → the model uses its
// Phase-1 proxy, so this is purely additive.
//
// One JSON blob behind the shared storage seam (file locally, Upstash Redis in
// prod), keyed by Klaviyo profile id. `owned_products` are the raw line-item
// identifiers the worker saw in this customer's Placed Order events (the source
// of truth for product-affinity OWNERSHIP, §8-D); the serving layer resolves
// them to catalogue categories. Shape:
//   { "<profileId>": { "p_alive": 0.87, "predicted_clv": 312.4,
//                      "owned_products": ["The Everyday Earbuds"], "fitted_at": "..." } }

const DATA_ROOT = path.join(process.cwd(), "data");
const STORE_KEY = "lifecycle-fitted.json";
const CUSTOMERS_KEY = "lifecycle-customers.json";
const store = getAdapter(DATA_ROOT, "lifecycle");

export interface FittedValue {
  p_alive?: number | null;
  predicted_clv?: number | null;
  owned_products?: string[] | null;
  fitted_at?: string | null;
}
export type FittedMap = Record<string, FittedValue>;

/** Read the fitted map. Missing/corrupt → {} (the model falls back to the proxy). */
export async function readFittedValues(): Promise<FittedMap> {
  const raw = await store.read(STORE_KEY);
  if (raw == null) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as FittedMap) : {};
  } catch {
    return {};
  }
}

/** Write the fitted map (used by a seed/import of the worker's output). */
export async function writeFittedValues(map: FittedMap): Promise<void> {
  await store.write(STORE_KEY, JSON.stringify(map, null, 2));
}

// --- Order-derived customer facts (master spec §3.1, P0/P1) -----------------
// The direct replacement for Klaviyo's stale `expected_date_of_next_order`.
// Produced by ingesting Shopify order line-items (scripts/ingest-orders.ts over
// shopify_orders_l24m.csv, or a nightly Shopify pull) into per-customer RFM
// facts, keyed by LOWERCASED EMAIL — the join key to Klaviyo profiles. The
// serving layer joins these onto profiles and derives the true `daysPastReorder`
// (= today − (lastOrderDate + cadence)) instead of trusting the stale field.

export interface CustomerFacts {
  /** Distinct valid orders (Frequency). */
  orderCount: number;
  /** ISO date (YYYY-MM-DD) of the customer's most recent valid order. */
  lastOrderDate: string;
  /** ISO date of the customer's first valid order. */
  firstOrderDate: string;
  /** Mean days between this customer's distinct order dates; null when < 2 orders. */
  avgDaysBetweenOrders: number | null;
  /** 24-month net sales (Σ Total sales), the Monetary axis. */
  monetary: number;
  /** Catalogue SKU ids owned, from order line-items (source of truth for affinity). */
  ownedProductIds: string[];
  /** Catalogue category labels owned (denormalized for convenience). */
  ownedCategories: string[];
}
export type CustomerFactsMap = Record<string, CustomerFacts>;

/** Read the order-facts map (email → facts). Missing/corrupt → {}. */
export async function readCustomerFacts(): Promise<CustomerFactsMap> {
  const raw = await store.read(CUSTOMERS_KEY);
  if (raw == null) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as CustomerFactsMap) : {};
  } catch {
    return {};
  }
}

/** Write the order-facts map (used by the ingestion script). */
export async function writeCustomerFacts(map: CustomerFactsMap): Promise<void> {
  await store.write(CUSTOMERS_KEY, JSON.stringify(map));
}
