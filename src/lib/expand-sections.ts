import type { SectionSpec } from "./schemas";
import { nanoid } from "./nanoid";

/**
 * Expand product_card sections so each card maps to exactly one selected product.
 *
 * Behaviour:
 * - If there are no product_card sections, return the structure unchanged.
 * - If there are no selected products, return the structure unchanged.
 * - If the user added FEWER product_card sections than selected products,
 *   pad with extra cards at the same position to reach one card per product.
 *   (Most common case: user added 1 card, selected 3 products → 3 cards.)
 * - If the user added MORE product_card sections than selected products,
 *   trim the extras so we never run out of products to assign.
 * - Each resulting product_card section gets a `product_slug` assigning it to
 *   one product from products_featured, in order.
 *
 * Sections of other types are left untouched and keep their relative order.
 */
export function expandProductCardSections(
  structure: SectionSpec[],
  productsFeatured: string[]
): SectionSpec[] {
  const cardCount = structure.filter((s) => s.type === "product_card").length;
  if (cardCount === 0 || productsFeatured.length === 0) return structure;

  const targetCount = productsFeatured.length;

  // Walk through, assigning product slugs to existing product_card sections
  // in order. Once we run out of products, drop extra cards.
  let cursor = 0;
  const out: SectionSpec[] = [];
  let firstCardPosition = -1;

  for (let i = 0; i < structure.length; i++) {
    const s = structure[i];
    if (s.type !== "product_card") {
      out.push(s);
      continue;
    }
    if (firstCardPosition === -1) firstCardPosition = out.length;
    if (cursor >= targetCount) {
      // More cards than products — trim
      continue;
    }
    out.push({ ...s, product_slug: productsFeatured[cursor] });
    cursor++;
  }

  // If we still have unassigned products, pad with extra cards at the position
  // where the first existing card lived (keeps the cards together).
  while (cursor < targetCount) {
    const newCard: SectionSpec = {
      id: nanoid(),
      type: "product_card",
      product_slug: productsFeatured[cursor],
    };
    // Splice in after the previously-inserted cards to keep order
    out.splice(firstCardPosition + cursor, 0, newCard);
    cursor++;
  }

  return out;
}
