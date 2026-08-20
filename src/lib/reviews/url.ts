// Fetching a real review from a URL, in tiers. Spec:
// docs/REVIEWS_MODULE_SPEC.md §4.1.
//
// "Fetch reviews from any URL" is a much bigger problem than it sounds, so this is
// built in four explicit tiers and the UI is told which one a URL falls into:
//
//   storefront — our own product page. Resolve the handle, reuse fetchProductReviews.
//   judgeme    — any Judge.me shop. The existing parser works as-is.
//   generic    — any other page. Fetch, strip to text, LLM EXTRACTION (never
//                writing), then verify every quote appears verbatim in the source.
//   blocked    — Amazon, Best Buy and friends. Deliberately NOT built: scraping
//                them breaches their terms, they block server fetches, and the
//                reviews carry licensing constraints. Routed to manual entry.
//
// Whatever the tier, the review has to clear the SAME eligibility and positivity
// screens as a SKU-sourced one (isEligibleReview + llmPositivityScreen). A URL is
// a different door into the same house, not a softer standard.

import { getAnthropic, FAST_MODEL } from "@/lib/anthropic";
import { classifyReviewUrl, isFetchableUrl } from "./url-tiers";
import {
  fetchProductReviews, parseJudgeMeReviews, isEligibleReview, llmPositivityScreen,
  decodeAndStrip, sanitizeAuthor, FETCH_TIMEOUT_MS,
  type ProductReview, type ParsedReview,
} from "./fetch";

// Re-exported so server code has a single import for "everything about review
// URLs"; the definitions live in the client-safe module.
export { classifyReviewUrl, isFetchableUrl } from "./url-tiers";
export type { ReviewUrlTier, ReviewUrlClassification } from "./url-tiers";
import type { ReviewUrlTier } from "./url-tiers";

const MAX_HTML_BYTES = 2_000_000;

/** Bounded fetch: https only, 8s, size-capped, and the FINAL url is re-checked so a
 * redirect can't land us somewhere private. */
async function fetchHtml(url: URL): Promise<{ html: string; finalUrl: string } | { error: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html,application/xhtml+xml,*/*" },
      cache: "no-store",
      redirect: "follow",
    });
    if (!res.ok) return { error: `That page returned HTTP ${res.status}.` };
    const finalCheck = isFetchableUrl(res.url);
    if (!finalCheck.ok) return { error: "That URL redirected somewhere we won't fetch." };
    const type = res.headers.get("content-type") ?? "";
    if (type && !/text\/html|application\/xhtml/i.test(type)) {
      return { error: `That URL isn't an HTML page (${type.split(";")[0]}).` };
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_HTML_BYTES) return { error: "That page is too large to read." };
    return { html: new TextDecoder().decode(buf), finalUrl: res.url };
  } catch {
    return { error: "Couldn't reach that page." };
  } finally {
    clearTimeout(t);
  }
}

/** Page text, for extraction. Script/style/nav stripped, then tags. */
function pageText(html: string): string {
  return decodeAndStrip(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " "),
  );
}

/** Normalised for verbatim comparison: quotes/dashes/whitespace vary between the
 * raw HTML and anything a model echoes back, and none of that is a difference in
 * what the customer said. */
function normalizeForVerify(s: string): string {
  return (s || "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** One candidate span as the extractor reports it. */
export interface ExtractedQuote {
  text?: unknown;
  author?: unknown;
  rating?: unknown;
}

/**
 * THE verification, and the reason an LLM is safe on this path: a quote is kept
 * only if it appears VERBATIM in the source text (modulo quote/dash/whitespace
 * style, which is not a difference in what the customer said). Anything else is
 * DROPPED, never repaired — a hallucinated review cannot survive this, and a
 * "helpfully" tidied real one is treated as hallucinated, which is the correct
 * side to err on.
 *
 * Pure, so it can be tested without a network or a model.
 */
export function verifyExtractedQuotes(quotes: ExtractedQuote[], sourceText: string): ParsedReview[] {
  const haystack = normalizeForVerify(sourceText);
  const out: ParsedReview[] = [];
  if (!haystack) return out;
  for (const q of quotes) {
    const quote = typeof q.text === "string" ? q.text.trim() : "";
    if (!quote) continue;
    const needle = normalizeForVerify(quote);
    // A one-word "quote" would match almost any page; require something that could
    // actually be a sentence before treating a substring hit as evidence.
    if (needle.length < 20) continue;
    if (!haystack.includes(needle)) {
      console.warn(`[reviews] dropped an extracted quote that is not verbatim in the source page: "${quote.slice(0, 60)}…"`);
      continue;
    }
    const rating = typeof q.rating === "number" && q.rating >= 1 && q.rating <= 5 ? q.rating : undefined;
    out.push({ text: quote, author: sanitizeAuthor(typeof q.author === "string" ? q.author : undefined), rating });
  }
  return out;
}

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["quotes"],
  properties: {
    quotes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: {
          text: { type: "string" },
          author: { type: "string" },
          rating: { type: "number" },
        },
      },
    },
  },
} as const;

/**
 * Tier 3 extraction. The model's job is to LOCATE spans of customer text, never to
 * write one: every returned quote is then checked to appear verbatim in the page
 * text, and anything that doesn't is DROPPED, not repaired. That check is what
 * makes an LLM safe on this path — a hallucinated review cannot survive it.
 */
async function extractQuotes(text: string, productName: string): Promise<ParsedReview[]> {
  const excerpt = text.slice(0, 12_000);
  const prompt = `Below is the visible text of a web page. Find up to 5 passages that are CUSTOMER REVIEWS or first-person testimonials about the product "${productName}" (or an equivalent product).

RULES, absolute:
- Copy each passage EXACTLY as it appears, character for character. Do not fix typos, trim, paraphrase, join sentences from different places, or tidy punctuation.
- If the page contains no customer review text, return an empty array. Never compose, summarise, or invent a review. An empty answer is correct and expected for pages that have none.
- Include the reviewer's name only if the page states it next to the passage.
- Include a star rating only if the page states one.

PAGE TEXT:
${excerpt}`;
  try {
    const res = await getAnthropic().messages.create({
      model: FAST_MODEL,
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: { type: "json_schema", schema: EXTRACTION_SCHEMA } },
    });
    const block = res.content.find((b) => b.type === "text");
    const raw = block && "text" in block ? block.text : "";
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) return [];
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      quotes?: { text?: unknown; author?: unknown; rating?: unknown }[];
    };
    return verifyExtractedQuotes(parsed.quotes ?? [], text);
  } catch (e) {
    console.warn("[reviews] URL extraction failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

export interface UrlReviewResult {
  reviews: ProductReview[];
  tier: ReviewUrlTier;
  /** The URL actually read (after redirects), for provenance. */
  source_url: string;
  error?: string;
  /** How many candidates the verbatim check rejected — worth surfacing, because
   * "the page had reviews but none verified" is a different story from "no reviews". */
  rejected?: number;
}

/**
 * Fetch review(s) from a URL. Returns [] (with a reason) rather than throwing, and
 * never returns text that did not come out of the fetched page.
 */
export async function fetchReviewsFromUrl(
  raw: string,
  opts: { limit?: number; productName?: string } = {},
): Promise<UrlReviewResult> {
  const limit = Math.max(1, Math.min(opts.limit ?? 1, 6));
  const classified = classifyReviewUrl(raw);
  if ("error" in classified) return { reviews: [], tier: "generic", source_url: raw, error: classified.error };
  if (classified.tier === "blocked") {
    return { reviews: [], tier: "blocked", source_url: raw, error: classified.note };
  }

  // Tier 1 — our own product page: no new code path at all, just resolve the SKU.
  if (classified.tier === "storefront" && classified.product_id) {
    const reviews = await fetchProductReviews(classified.product_id, { limit });
    return { reviews, tier: "storefront", source_url: raw };
  }

  const check = isFetchableUrl(raw);
  if (!check.ok) return { reviews: [], tier: classified.tier, source_url: raw, error: check.reason };
  const fetched = await fetchHtml(check.url);
  if ("error" in fetched) return { reviews: [], tier: classified.tier, source_url: raw, error: fetched.error };

  const productName = opts.productName || "the product";

  // Tier 2 — any Judge.me shop. Same markup, same parser.
  if (/jdgm-rev\b|jdgm-review-widget/.test(fetched.html)) {
    const parsed = parseJudgeMeReviews(fetched.html).filter(isEligibleReview);
    const screened = await llmPositivityScreen(parsed, productName);
    return {
      reviews: screened.slice(0, limit).map((r) => ({ text: r.text, rating: r.rating, author: r.author, date: r.date })),
      tier: "judgeme",
      source_url: fetched.finalUrl,
    };
  }

  // Tier 3 — generic page: extract, verify verbatim, then the usual screens.
  const text = pageText(fetched.html);
  const candidates = await extractQuotes(text, productName);
  const eligible = candidates.filter(isEligibleReview);
  const screened = await llmPositivityScreen(eligible, productName);
  return {
    reviews: screened.slice(0, limit).map((r) => ({ text: r.text, rating: r.rating, author: r.author, date: r.date })),
    tier: "generic",
    source_url: fetched.finalUrl,
    rejected: candidates.length - eligible.length,
    error: screened.length ? undefined : "No verifiable customer review was found on that page.",
  };
}
