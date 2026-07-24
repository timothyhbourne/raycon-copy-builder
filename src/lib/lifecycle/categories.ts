// Coarse product categories for the lifecycle engine, taken from the Shopify
// export's "Product type at time of sale" field (master spec §2). This is the
// OWNERSHIP taxonomy used for replenishment-first affinity and cross-sell — it is
// intentionally coarser than the marketing catalogue in ../products.ts (which
// drives per-SKU copy). Both are legitimate; the engine reasons at this level.

// Payment statuses that count as a valid, owned purchase (master spec §2).
// `refunded` is treated as not-owned; voided/expired/authorized/pending excluded.
export const VALID_PAYMENT_STATUSES = new Set([
  "paid",
  "partially_paid",
  "partially_refunded",
]);

// Substrings that mark a NON-product line (warranty, shipping add-ons, cashback,
// software/subscriptions) — excluded from ownership (master spec §2).
const NON_PRODUCT_KEYWORDS = [
  "delivery guarantee",
  "shipping protection",
  "extend", // Extend protection plans
  "clyde", // clyde/Extend protection plans
  "protection plan",
  "fondue cashback",
  "software",
  "subscription",
];

// The four standalone HARDWARE categories — the basis for "owns exactly 1
// hardware category" cross-sell headroom (master spec §2). Accessories / Home /
// Speaker / Spare Parts are attach/peripheral, not standalone hardware.
export const HARDWARE_CATEGORIES = ["Earbuds", "Headphones", "Power Tech", "Audio"] as const;
export type HardwareCategory = (typeof HARDWARE_CATEGORIES)[number];

/**
 * Normalize a raw "Product type at time of sale" to a coarse ownership category,
 * or null when the line is a non-product (warranty/shipping/cashback/etc.) or
 * blank — those never count toward ownership.
 */
export function normalizeCategory(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const low = s.toLowerCase();
  if (NON_PRODUCT_KEYWORDS.some((k) => low.includes(k))) return null;
  return s;
}

/** Whether a coarse category is one of the standalone hardware categories. */
export function isHardware(category: string): boolean {
  return (HARDWARE_CATEGORIES as readonly string[]).includes(category);
}
