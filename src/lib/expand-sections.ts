import type { SectionSpec, UspSlot } from "./schemas";
import { isProductCardType, uspSlotsOf } from "./schemas";
import { nanoid } from "./nanoid";

/**
 * Expand product-card sections (product_card and product_card_review) so each
 * card maps to exactly one selected product.
 *
 * Behaviour:
 * - If there are no product-card sections, return the structure unchanged.
 * - If there are no selected products, return the structure unchanged.
 * - MANUAL picks win: a card whose `product_slug` the user already set (to a
 *   still-selected product) keeps it. Auto cards (no slug, or a stale slug for a
 *   deselected product) are assigned from the products not already claimed by a
 *   manual pick, in order — so a manually-picked product is never double-assigned.
 * - If the user added FEWER cards than selected products, pad with extra
 *   product_card sections (kept together) so each still-unclaimed product gets one.
 * - If the user added MORE Auto cards than remaining products, the extras REUSE
 *   featured products (cycling in order) rather than being dropped — so a user can
 *   deliberately place, say, a product_card_review AND a product_card for the same
 *   single featured product and keep both.
 *
 * Sections of other types are left untouched and keep their relative order.
 */
export function expandProductCardSections(
  structure: SectionSpec[],
  productsFeatured: string[]
): SectionSpec[] {
  const cardCount = structure.filter((s) => isProductCardType(s.type)).length;
  if (cardCount === 0 || productsFeatured.length === 0) return structure;

  const featured = new Set(productsFeatured);
  // Products already claimed by a valid manual pick — excluded from the auto queue.
  const manuallyClaimed = new Set(
    structure
      .filter((s) => isProductCardType(s.type) && s.product_slug && featured.has(s.product_slug))
      .map((s) => s.product_slug as string)
  );
  // Auto queue: featured products not manually claimed, in selection order.
  const autoQueue = productsFeatured.filter((p) => !manuallyClaimed.has(p));

  const out: SectionSpec[] = [];
  let firstCardPosition = -1;
  // When Auto cards outnumber featured products, reuse products by cycling.
  let reuseIdx = 0;

  for (const s of structure) {
    if (!isProductCardType(s.type)) {
      out.push(s);
      continue;
    }
    if (firstCardPosition === -1) firstCardPosition = out.length;
    // Honor a valid manual pick as-is.
    if (s.product_slug && featured.has(s.product_slug)) {
      out.push(s);
      continue;
    }
    // Auto (unset or stale slug): assign the next unclaimed product. When the
    // queue is exhausted the user has added more cards than products on purpose
    // — reuse featured products in order rather than dropping the card.
    const next = autoQueue.shift();
    const slug = next ?? productsFeatured[reuseIdx++ % productsFeatured.length];
    out.push({ ...s, product_slug: slug });
  }

  // Any products still unclaimed → pad with extra cards near the first card so
  // the cards stay grouped. (Padded cards default to product_card.)
  let padOffset = out.filter((s) => isProductCardType(s.type)).length;
  while (autoQueue.length > 0) {
    const slug = autoQueue.shift() as string;
    const newCard: SectionSpec = { id: nanoid(), type: "product_card", product_slug: slug };
    out.splice(firstCardPosition + padOffset, 0, newCard);
    padOffset++;
  }

  return out;
}

/**
 * Resolve every product-sourced USP slot to a concrete SKU before generation —
 * the USP-section equivalent of expandProductCardSections().
 *
 * A slot with no `product_slug` is "Auto": it resolves to the hero product, else
 * the first entry of products_featured. Without this the model has no product
 * binding for a USPs section at all and guesses, which is the whole reason USPs
 * used to come out describing the wrong product.
 *
 * Also NORMALISES the section: a legacy section with no `usp_slots` is written
 * out as an explicit 3-slot product plan, so every downstream consumer reads one
 * shape. Company-sourced slots never carry a product_slug (any stale one is
 * dropped). A slot naming a product that is no longer featured falls back to
 * Auto rather than injecting a bank for a product the email doesn't sell.
 */
export function expandUspSections(
  structure: SectionSpec[],
  productsFeatured: string[],
  heroProductSlug?: string
): SectionSpec[] {
  if (!structure.some((s) => s.type === "usps")) return structure;

  const featured = new Set(productsFeatured);
  const auto =
    (heroProductSlug && featured.has(heroProductSlug) ? heroProductSlug : undefined)
    ?? productsFeatured[0];

  return structure.map((s) => {
    if (s.type !== "usps") return s;
    const usp_slots: UspSlot[] = uspSlotsOf(s).map((slot) => {
      if (slot.source === "company") {
        // Never carry a product binding on a company slot.
        const { product_slug: _drop, ...rest } = slot;
        void _drop;
        return { ...rest, source: "company" as const };
      }
      const manual = slot.product_slug && featured.has(slot.product_slug) ? slot.product_slug : undefined;
      const resolved = manual ?? auto;
      return resolved ? { ...slot, product_slug: resolved } : { ...slot, product_slug: undefined };
    });
    return { ...s, usp_slots };
  });
}
