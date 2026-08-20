import { NextRequest, NextResponse } from "next/server";
import { fetchProductReviewsWithOrigin } from "@/lib/reviews/fetch";
import { fetchReviewsFromUrl, classifyReviewUrl } from "@/lib/reviews/url";
import { VALID_PRODUCT_IDS, getProductName } from "@/lib/products";
import type { ProductReview } from "@/lib/reviews/fetch";
import type { ReviewProvenance } from "@/lib/schemas";

// Real reviews for a Review slot. Two sources, one shape out — every review comes
// back with a PROVENANCE record, because a review element without provenance
// cannot ship (docs/REVIEWS_MODULE_SPEC.md §5).
//
//   GET /api/reviews?product=E25[&limit=3][&refresh=1]
//   GET /api/reviews?url=https://…[&limit=1][&product=E25]   ← for context/naming
//   GET /api/reviews?classify=https://…                      ← tier only, no fetch
//
// Never fabricates. An empty array means no real review qualified, and the caller
// leaves the Review element empty and flagged.
export const dynamic = "force-dynamic";

/** One provenance record per returned review, stamped at the source. */
function provenance(
  r: ProductReview,
  origin: ReviewProvenance["origin"],
  sourceUrl?: string,
): ReviewProvenance {
  return {
    origin,
    ...(sourceUrl ? { source_url: sourceUrl } : {}),
    fetched_at: new Date().toISOString(),
    ...(r.author ? { author: r.author } : {}),
    ...(r.rating != null ? { rating: r.rating } : {}),
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const product = (searchParams.get("product") || "").trim();
  const url = (searchParams.get("url") || "").trim();
  const classify = (searchParams.get("classify") || "").trim();
  const limit = Number(searchParams.get("limit")) || 3;
  const refresh = searchParams.get("refresh") === "1";

  // Tier lookup only: lets the slot editor tell the writer what a URL will do
  // before they commit to it (and warn about the walled gardens).
  if (classify) {
    const result = classifyReviewUrl(classify);
    return "error" in result
      ? NextResponse.json({ error: result.error }, { status: 400 })
      : NextResponse.json(result);
  }

  try {
    if (url) {
      const result = await fetchReviewsFromUrl(url, {
        limit,
        // A SKU is optional here and used only to name the product in the
        // extraction / positivity prompts.
        productName: product && VALID_PRODUCT_IDS.has(product) ? getProductName(product) : undefined,
      });
      return NextResponse.json({
        source: "url",
        tier: result.tier,
        count: result.reviews.length,
        reviews: result.reviews,
        provenance: result.reviews.map((r) => provenance(r, "fetched", result.source_url)),
        ...(result.error ? { error: result.error } : {}),
        ...(result.rejected ? { rejected: result.rejected } : {}),
      });
    }

    if (!product || !VALID_PRODUCT_IDS.has(product)) {
      return NextResponse.json(
        { error: `Unknown or missing product SKU "${product}". Pass ?product=<SKU> or ?url=<page>.` },
        { status: 400 },
      );
    }
    const { reviews, origin } = await fetchProductReviewsWithOrigin(product, { limit, refresh });
    return NextResponse.json({
      source: "product",
      product,
      count: reviews.length,
      reviews,
      provenance: reviews.map((r) => provenance(r, origin)),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Review fetch failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
