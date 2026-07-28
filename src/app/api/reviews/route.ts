import { NextRequest, NextResponse } from "next/server";
import { fetchProductReviews } from "@/lib/reviews/fetch";
import { VALID_PRODUCT_IDS } from "@/lib/products";

// Real product reviews for a SKU. Reads the data/reviews/<id>.json cache and
// fetches (then caches) on a miss. `?refresh=1` forces a re-fetch (bypasses the
// cache) so the team can re-pull. Never fabricates: an empty array means no real
// review was found, and the caller leaves the Review element empty + flagged.
//
//   GET /api/reviews?product=E25[&limit=3][&refresh=1]
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const product = (searchParams.get("product") || "").trim();
  if (!product || !VALID_PRODUCT_IDS.has(product)) {
    return NextResponse.json({ error: `Unknown or missing product SKU "${product}".` }, { status: 400 });
  }
  const limit = Number(searchParams.get("limit")) || 3;
  const refresh = searchParams.get("refresh") === "1";
  try {
    const reviews = await fetchProductReviews(product, { limit, refresh });
    return NextResponse.json({ product, count: reviews.length, reviews });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Review fetch failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
