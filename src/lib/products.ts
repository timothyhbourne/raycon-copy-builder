// `handle` is the Shopify storefront handle (from data/products.md), used to
// resolve a product's page + review data (see lib/reviews/fetch.ts). Products
// without a known handle (some accessories) simply have no fetchable reviews.
export interface CatalogueProduct { id: string; name: string; handle?: string }

export const PRODUCT_CATEGORIES: { label: string; products: CatalogueProduct[] }[] = [
  {
    label: "Open Audio",
    products: [
      { id: "O15", name: "Essential Open Earbuds", handle: "essential-open-earbuds" },
      { id: "O25", name: "Fitness Open Earbuds", handle: "fitness-open-earbuds" },
      { id: "O55", name: "Everyday Clip Earbuds", handle: "everyday-clip-earbuds" },
      { id: "B42", name: "Bone Conduction Headphones", handle: "bone-conduction-headphones" },
    ],
  },
  {
    label: "Earbuds",
    products: [
      { id: "E25", name: "Everyday Earbuds", handle: "the-everyday-earbuds" },
      { id: "E45", name: "Fitness Earbuds", handle: "the-fitness-earbuds" },
      { id: "E60", name: "Sleep Earbuds", handle: "sleep-earbuds" },
      { id: "E75", name: "Impact Earbuds", handle: "the-impact-earbuds" },
      { id: "E95", name: "Pro Earbuds", handle: "pro-earbuds" },
    ],
  },
  {
    label: "Headphones",
    products: [
      { id: "H10", name: "Essential Headphones", handle: "essential-headphones" },
      // NB: the storefront handle is NOT "everyday-headphones" (404) — it is
      // "the-everyday-h20-headphones" (verified live 2026-07-22).
      { id: "H20", name: "Everyday Headphones", handle: "the-everyday-h20-headphones" },
      { id: "H41", name: "Fitness Headphones", handle: "the-fitness-headphones" },
    ],
  },
  {
    label: "AI Notetaker",
    products: [
      { id: "NOTETAKER", name: "AI Notetaker", handle: "raycon-ai-notetaker" },
    ],
  },
  {
    label: "Fast Charging",
    products: [
      { id: "RACSPN3",  name: "Magic Spin Cable (3 ft)" },
      { id: "RACSPN6",  name: "Magic Spin Cable (6 ft)" },
      { id: "RACSPN10", name: "Magic Spin Cable (10 ft)" },
      { id: "ADAPTER45", name: "Magic Travel Adapter (45W)", handle: "magic-travel-adapter-45w" },
    ],
  },
];

export const PRODUCT_NAME_BY_ID: Record<string, string> = Object.fromEntries(
  PRODUCT_CATEGORIES.flatMap((cat) => cat.products.map((p) => [p.id, p.name]))
);

const PRODUCT_HANDLE_BY_ID: Record<string, string> = Object.fromEntries(
  PRODUCT_CATEGORIES.flatMap((cat) => cat.products.filter((p) => p.handle).map((p) => [p.id, p.handle as string]))
);

export const VALID_PRODUCT_IDS = new Set(Object.keys(PRODUCT_NAME_BY_ID));

export function getProductName(id: string): string {
  return PRODUCT_NAME_BY_ID[id] ?? id;
}

/** The Shopify storefront handle for a SKU, or null if none is known. */
export function getProductHandle(id: string): string | null {
  return PRODUCT_HANDLE_BY_ID[id] ?? null;
}

// Normalize a product name for fuzzy matching: lowercase, drop a leading "the",
// strip punctuation, collapse whitespace. "The Everyday Earbuds Classic" and
// "Everyday Earbuds" both reduce toward the same catalogue anchor.
function normalizeProductName(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const NORMALIZED_NAME_TO_ID: { norm: string; id: string }[] = PRODUCT_CATEGORIES
  .flatMap((cat) => cat.products.map((p) => ({ norm: normalizeProductName(p.name), id: p.id })))
  // longest catalogue name first so the most specific prefix wins
  .sort((a, b) => b.norm.length - a.norm.length);

/**
 * Best-effort resolve a free-text product name (as it appears in library copy,
 * e.g. "The Everyday Earbuds Classic") to its catalogue slug. Exact normalized
 * match first, then the longest catalogue name that prefixes the input. Returns
 * null when nothing plausibly matches — callers fall back to the raw name.
 */
export function getProductSlugByName(name: string): string | null {
  const norm = normalizeProductName(name);
  if (!norm) return null;
  const exact = NORMALIZED_NAME_TO_ID.find((e) => e.norm === norm);
  if (exact) return exact.id;
  const prefix = NORMALIZED_NAME_TO_ID.find((e) => norm.startsWith(e.norm) || e.norm.startsWith(norm));
  return prefix ? prefix.id : null;
}

/** The catalogue category label a SKU belongs to, or null if unknown. */
export function categoryOfCatalogueId(id: string): string | null {
  for (const cat of PRODUCT_CATEGORIES) {
    if (cat.products.some((p) => p.id === id)) return cat.label;
  }
  return null;
}

const ID_BY_HANDLE: Record<string, string> = Object.fromEntries(
  PRODUCT_CATEGORIES.flatMap((cat) => cat.products.filter((p) => p.handle).map((p) => [p.handle as string, p.id])),
);

/**
 * Resolve a raw order line-item identifier — a catalogue SKU id, a Shopify
 * storefront handle, or a product name (as it appears in a Placed Order /
 * Ordered Product event) — to its catalogue SKU id. null when nothing matches
 * (the caller drops it). This is how order-derived OWNERSHIP maps to the
 * catalogue for product-affinity cross-sell.
 */
export function resolveCatalogueId(identifier: string): string | null {
  const s = (identifier || "").trim();
  if (!s) return null;
  if (VALID_PRODUCT_IDS.has(s)) return s;
  if (ID_BY_HANDLE[s]) return ID_BY_HANDLE[s];
  return getProductSlugByName(s);
}
