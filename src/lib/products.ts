export const PRODUCT_CATEGORIES: { label: string; products: { id: string; name: string }[] }[] = [
  {
    label: "Open Audio",
    products: [
      { id: "O15", name: "Essential Open Earbuds" },
      { id: "O25", name: "Fitness Open Earbuds" },
      { id: "O55", name: "Everyday Clip Earbuds" },
      { id: "B42", name: "Bone Conduction Headphones" },
    ],
  },
  {
    label: "Earbuds",
    products: [
      { id: "E25", name: "Everyday Earbuds" },
      { id: "E45", name: "Fitness Earbuds" },
      { id: "E60", name: "Sleep Earbuds" },
      { id: "E75", name: "Impact Earbuds" },
      { id: "E95", name: "Pro Earbuds" },
    ],
  },
  {
    label: "Headphones",
    products: [
      { id: "H10", name: "Essential Headphones" },
      { id: "H20", name: "Everyday Headphones" },
      { id: "H41", name: "Fitness Headphones" },
    ],
  },
  {
    label: "AI Notetaker",
    products: [
      { id: "NOTETAKER", name: "AI Notetaker" },
    ],
  },
  {
    label: "Fast Charging",
    products: [
      { id: "RACSPN3",  name: "Magic Spin Cable (3 ft)" },
      { id: "RACSPN6",  name: "Magic Spin Cable (6 ft)" },
      { id: "RACSPN10", name: "Magic Spin Cable (10 ft)" },
      { id: "ADAPTER45", name: "Magic Travel Adapter (45W)" },
    ],
  },
];

export const PRODUCT_NAME_BY_ID: Record<string, string> = Object.fromEntries(
  PRODUCT_CATEGORIES.flatMap((cat) => cat.products.map((p) => [p.id, p.name]))
);

export const VALID_PRODUCT_IDS = new Set(Object.keys(PRODUCT_NAME_BY_ID));

export function getProductName(id: string): string {
  return PRODUCT_NAME_BY_ID[id] ?? id;
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
