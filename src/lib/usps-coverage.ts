/**
 * Which SKUs have a USP bank in data/product-usps.md, as a plain client-safe
 * constant.
 *
 * WHY THIS EXISTS: src/lib/usps.ts parses the markdown through src/lib/data.ts,
 * which uses `fs` — so it cannot be imported by a "use client" component. The
 * Section Structure builder needs this one bit of the data (to warn "no USPs
 * recorded for this product") while the user is still configuring the section.
 *
 * DRIFT GUARD: `npm run verify:usps` fails if this list and the parsed banks
 * disagree, so adding a product bank without updating this list is caught before
 * it ships. Keep them in sync.
 */
export const SKUS_WITH_USP_BANK: readonly string[] = [
  "O15", "O25", "O55", "B42",
  "E25", "E26", "E45", "E60", "E75", "E95",
  "H10", "H20", "H41",
  "NOTETAKER",
  "RACSPN3", "RACSPN6", "RACSPN10", "ADAPTER45",
];

const BANK_SET = new Set(SKUS_WITH_USP_BANK);

/** True when the SKU has an authored USP bank. Safe to call on the client. */
export function hasUspBank(sku: string | undefined): boolean {
  return !!sku && BANK_SET.has(sku.toUpperCase());
}
