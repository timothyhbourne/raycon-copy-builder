import type { ProductReview } from "./fetch";
import { fetchProductReviewsWithOrigin } from "./fetch";
import { fetchReviewsFromUrl } from "./url";
import { getProductName } from "@/lib/products";
import type { ReviewProvenance, ReviewSlot, SectionSpec } from "@/lib/schemas";
import { reviewSlotsOf, sectionElementNames } from "@/lib/schemas";

// Resolve the real review for every slot of every `reviews` section in a brief,
// before generation. Spec: docs/REVIEWS_MODULE_SPEC.md §5.2 point 1.
//
// Server-only (it fetches). The model is then handed each slot's real text, or an
// explicit instruction to leave that slot empty — and whatever it returns is checked
// against what was resolved here (see ./provenance).

export interface ResolvedReview {
  text: string;
  provenance: ReviewProvenance;
}

/** A slot that could not be filled, for the review_gaps stream event. */
export interface ReviewGap {
  section_id: string;
  slot: number;
  /** Why it's empty, in words the writer can act on. */
  reason: string;
}

/** The review text as it ships: the customer's words plus their first name, which
 * is how the existing product-card path formats it. */
function withAuthor(r: ProductReview): string {
  return r.author ? `${r.text} — ${r.author}` : r.text;
}

async function resolveSlot(
  slot: ReviewSlot,
  fallbackProduct: string | undefined,
  used: Set<string>,
): Promise<{ review?: ResolvedReview; reason?: string }> {
  // MANUAL always wins and is never fetched over — the writer typed it.
  if (slot.source === "manual") {
    const text = (slot.manual_text ?? "").trim();
    if (!text) return { reason: "Manual slot with no text pasted in yet." };
    const full = slot.manual_author ? `${text} — ${slot.manual_author}` : text;
    return {
      review: {
        text: full,
        provenance: { origin: "manual", ...(slot.manual_author ? { author: slot.manual_author } : {}) },
      },
    };
  }

  if (slot.source === "url") {
    const url = (slot.source_url ?? "").trim();
    if (!url) return { reason: "URL slot with no URL set." };
    const result = await fetchReviewsFromUrl(url, {
      limit: 3,
      productName: fallbackProduct ? getProductName(fallbackProduct) : undefined,
    });
    const pick = result.reviews.find((r) => !used.has(withAuthor(r)));
    if (!pick) return { reason: result.error || `No usable review found at ${url}.` };
    return {
      review: {
        text: withAuthor(pick),
        provenance: {
          origin: "fetched",
          source_url: result.source_url,
          fetched_at: new Date().toISOString(),
          ...(pick.author ? { author: pick.author } : {}),
          ...(pick.rating != null ? { rating: pick.rating } : {}),
        },
      },
    };
  }

  // PRODUCT: the slot's SKU, else the campaign's hero / first featured product.
  const sku = slot.product_slug || fallbackProduct;
  if (!sku) return { reason: "No product bound to this slot and no featured product to fall back on." };
  // Ask for several so sibling slots can each take a DIFFERENT review — the same
  // reason the canvas's refresh control skips reviews already on screen.
  const { reviews, origin } = await fetchProductReviewsWithOrigin(sku, { limit: 6 });
  const pick = reviews.find((r) => !used.has(withAuthor(r)));
  if (!pick) {
    return {
      reason: reviews.length
        ? `Every eligible ${getProductName(sku)} review is already used by another slot.`
        : `No eligible review found for ${getProductName(sku)}.`,
    };
  }
  return {
    review: {
      text: withAuthor(pick),
      provenance: {
        origin,
        fetched_at: new Date().toISOString(),
        ...(pick.author ? { author: pick.author } : {}),
        ...(pick.rating != null ? { rating: pick.rating } : {}),
      },
    },
  };
}

export interface ResolvedSectionReviews {
  /** Slot text per section id, in slot order — what the prompt is given. */
  textBySection: Record<string, string[]>;
  /** Every resolved review, flattened: the verified set the strip checks against. */
  verified: ResolvedReview[];
  /** Provenance per section id, keyed by element name, for the client to attach. */
  provenanceBySection: Record<string, Record<string, ReviewProvenance>>;
  gaps: ReviewGap[];
}

/**
 * Resolve every `reviews` section's slots. Sections are resolved in parallel;
 * slots WITHIN a section run in sequence, because each one has to see what its
 * siblings already took (three slots pulling the same product must not all land on
 * the same review).
 */
export async function resolveSectionReviews(
  sectionStructure: SectionSpec[],
  fallbackProduct?: string,
): Promise<ResolvedSectionReviews> {
  const reviewSections = sectionStructure.filter((s) => s.type === "reviews");
  const out: ResolvedSectionReviews = { textBySection: {}, verified: [], provenanceBySection: {}, gaps: [] };
  if (!reviewSections.length) return out;

  await Promise.all(reviewSections.map(async (spec) => {
    const slots = reviewSlotsOf(spec);
    const elementNames = sectionElementNames(spec).filter((e) => /^Review \d+$/.test(e));
    const texts: string[] = [];
    const provenance: Record<string, ReviewProvenance> = {};
    const used = new Set<string>();

    for (let i = 0; i < slots.length; i++) {
      let resolved: { review?: ResolvedReview; reason?: string };
      try {
        resolved = await resolveSlot(slots[i], fallbackProduct, used);
      } catch (e) {
        resolved = { reason: e instanceof Error ? e.message : "Review lookup failed." };
      }
      if (resolved.review) {
        texts[i] = resolved.review.text;
        used.add(resolved.review.text);
        out.verified.push(resolved.review);
        const name = elementNames[i];
        if (name) provenance[name] = resolved.review.provenance;
      } else {
        texts[i] = "";
        out.gaps.push({ section_id: spec.id, slot: i + 1, reason: resolved.reason ?? "No review available." });
      }
    }
    out.textBySection[spec.id] = texts;
    if (Object.keys(provenance).length) out.provenanceBySection[spec.id] = provenance;
  }));

  return out;
}
