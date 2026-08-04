// Real customer reviews for a product, for the reviews / product_card_review
// sections. NEVER fabricated — if none qualify the caller leaves the Review
// element empty and flags it (a hard rule).
//
// Source (discovered + verified 2026-07-22): Raycon's storefront
// (rayconglobal.com) renders reviews with the **Judge.me** Shopify app
// extension, which SERVER-RENDERS them into the product page HTML — a plain
// server fetch of `/products/<handle>` sees them (no JS/auth/token). We parse the
// per-review `jdgm-rev` blocks (each carries data-score, data-content date,
// data-product-url, data-review-language, jdgm-rev__author, jdgm-rev__body).
//
// Only the FIRST page (~5 reviews) is server-rendered. When those are too short,
// low-rated, or mixed to yield an eligible review, we page deeper through
// Judge.me's public `reviews_for_widget` endpoint, which returns the SAME
// `jdgm-rev` markup (verified live 2026-07-22 — it is not empty for this shop;
// the widget's own paginator uses it). That is what keeps products like E95,
// whose first page is all short/negative reviews, from coming back empty.
//
// Eligibility (v2): a review must be substantive + 4–5★ + in English + about
// THIS product (its block's data-product-url matches the fetched handle, so we
// never pull "recommended products" snippets) + pass a negative-signal
// pre-filter + pass an LLM positivity screen (wholly positive, no disparagement
// or unfavorable comparison of any Raycon product). Survivors are ranked
// newest-first and cached to data/reviews/<productId>.json (curated files win).

import fs from "fs";
import path from "path";
import { getProductHandle, getProductName, PRODUCT_NAME_BY_ID } from "@/lib/products";
import { getAnthropic, FAST_MODEL } from "@/lib/anthropic";

export interface ProductReview {
  text: string;
  rating?: number;
  author?: string;
  date?: string; // ISO yyyy-mm-dd
}

const CACHE_DIR = path.join(process.cwd(), "data", "reviews");
const SHOP_STOREFRONT = process.env.RAYCON_STOREFRONT || "https://rayconglobal.com";
const FETCH_TIMEOUT_MS = 8000;

function safeId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id);
}

// STORAGE DECISION (remediation §3.2, reviews cache = engineer's call): this
// cache is intentionally NOT on the Redis storage seam. data/reviews/<id>.json
// files are committed, curated seed content (read-only, §3.3-exempt) and are the
// primary source; the runtime write below is only a best-effort optimisation to
// avoid re-fetching. On Vercel's read-only FS the write no-ops, which merely
// forces a live re-fetch next time — a graceful degradation, not data loss. That
// tradeoff isn't worth a Redis round-trip on the reviews hot path, so it stays fs.
function readCache(productId: string): ProductReview[] | null {
  try {
    const raw = fs.readFileSync(path.join(CACHE_DIR, `${productId}.json`), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ProductReview[]) : null;
  } catch {
    return null;
  }
}

function writeCache(productId: string, reviews: ProductReview[]): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, `${productId}.json`), JSON.stringify(reviews, null, 2));
  } catch {
    /* read-only FS (e.g. serverless) — cache best-effort only; see note above */
  }
}

async function fetchProductPage(handle: string): Promise<{ html: string; finalUrl: string } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${SHOP_STOREFRONT}/products/${handle}`, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html,application/xhtml+xml,*/*" },
      cache: "no-store",
      redirect: "follow",
    });
    if (!res.ok) return null;
    return { html: await res.text(), finalUrl: res.url };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// A substantive review is a sentence or two (not "Great!") and mostly latin.
function isSubstantive(text: string): boolean {
  const t = (text || "").trim();
  if (t.length < 40 || t.length > 600) return false;
  if (!/[.!?]/.test(t)) return false;
  const latin = (t.match(/[a-zA-Z]/g) ?? []).length;
  return latin / t.length > 0.6;
}

// Curated negative-signal pre-filter: drop reviews that hint at a complaint,
// defect, discomfort, comparison, or "used to" story even at a high star rating.
// Err toward dropping — the LLM screen is the finer catch after this.
const NEGATIVE_SIGNALS: RegExp[] = [
  /\bdie[ds]?\b|\bdying\b/i,
  /\bbroke[n]?\b|\bcracked?\b|\bdefect/i,
  /\bstop(?:ped|s)?\b/i,
  /\b(?:would|wouldn'?t|won'?t|didn'?t|does'?nt|doesn'?t)\s+(?:hold|charge|connect|work|stay|pair)/i,
  /\bfell out\b|\bfalls out\b|\bkeep falling\b/i,
  /\buncomfortable\b|\bhurt|\bpain/i,
  /\bdisappoint|\bpoor\b|\bcheap(?:ly)?\b|\bterrible\b|\bawful\b|\bmeh\b/i,
  /\breturn(?:ed|ing)?\b|\brefund/i,
  /\bused to\b|\bthe old ones\b|\bprevious ones?\b|\bunlike\b/i,
  /\bnot as good\b|\bworse\b|\bstopped working\b/i,
];
function hasNegativeSignal(text: string): boolean {
  return NEGATIVE_SIGNALS.some((re) => re.test(text));
}

// First name + optional initial only ("Jordan M." / "William"). Strips surnames
// / anything longer (PII). Empty → undefined.
function sanitizeAuthor(name: string | undefined): string | undefined {
  const n = (name || "").replace(/\s+/g, " ").trim();
  if (!n) return undefined;
  const parts = n.split(" ");
  const first = parts[0].slice(0, 24);
  if (parts.length === 1) return first;
  const initial = parts[1].replace(/[^A-Za-z]/g, "").slice(0, 1);
  return initial ? `${first} ${initial}.` : first;
}

function normDate(raw: string | undefined): string | undefined {
  const m = (raw || "").match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : undefined;
}

// Minimal HTML entity decode + tag strip.
function decodeAndStrip(html: string): string {
  return (html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&(?:#39|#x27|rsquo|lsquo);/g, "'")
    .replace(/&(?:quot|#34|ldquo|rdquo);/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

// How many extra widget pages to walk when page 1 is thin. Bounded so a product
// with no eligible reviews can't spin.
const MAX_REVIEW_PAGES = 6;
const JUDGEME_WIDGET_API = "https://api.judge.me/reviews/reviews_for_widget";

// The Judge.me widget carries the Shopify product id we need to page the API.
function extractWidgetProductId(html: string): string | null {
  const m = html.match(/jdgm-review-widget'\s+data-id='(\d+)'/) || html.match(/jdgm-widget[^>]*data-id='(\d+)'/);
  return m ? m[1] : null;
}

// Fetch one page of reviews from Judge.me's public widget endpoint. Returns the
// embedded HTML (same `jdgm-rev` markup as the product page) or null.
async function fetchWidgetPage(productId: string, page: number): Promise<string | null> {
  const shop = SHOP_STOREFRONT.replace(/^https?:\/\//, "");
  const url = `${JUDGEME_WIDGET_API}?url=${encodeURIComponent(shop)}&shop_domain=${encodeURIComponent(shop)}&platform=shopify&product_id=${encodeURIComponent(productId)}&page=${page}&per_page=5`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { html?: string };
    return typeof json.html === "string" && json.html ? json.html : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

interface ParsedReview extends ProductReview { productUrl?: string; lang?: string }

// Parse per review block (not by zipping separate arrays) so score/body/author/
// date never misalign, and each block's data-product-url is available for
// scoping. Split on the review container class.
function parseJudgeMeReviews(html: string): ParsedReview[] {
  const blocks = html.split(/class='jdgm-rev /).slice(1);
  const out: ParsedReview[] = [];
  for (const block of blocks) {
    const bodyRaw = (block.match(/jdgm-rev__body'>([\s\S]*?)<\/div>/) || [])[1];
    const text = decodeAndStrip(bodyRaw || "");
    if (!text) continue;
    const score = Number((block.match(/data-score='(\d)'/) || [])[1]);
    out.push({
      text,
      rating: Number.isFinite(score) ? score : undefined,
      author: sanitizeAuthor(decodeAndStrip((block.match(/jdgm-rev__author'[^>]*>([^<]{0,60})/) || [])[1] || "")),
      date: normDate((block.match(/jdgm-rev__timestamp[^>]*data-content='([^']*)'/) || [])[1]),
      productUrl: (block.match(/data-product-url='([^']*)'/) || [])[1],
      lang: (block.match(/data-review-language='([^']*)'/) || [])[1],
    });
  }
  return out;
}

// Drop reviews that prominently name a DIFFERENT catalogue product (cross-product
// bleed / unfavorable comparison magnet). Keeps reviews about the featured one.
function namesOtherProduct(text: string, featuredId: string): boolean {
  const featured = getProductName(featuredId).toLowerCase();
  const lower = text.toLowerCase();
  for (const [id, name] of Object.entries(PRODUCT_NAME_BY_ID)) {
    if (id === featuredId) continue;
    const n = name.toLowerCase();
    if (n.length >= 6 && lower.includes(n) && !featured.includes(n)) return true;
  }
  return false;
}

// LLM positivity screen (the reliable catch a keyword list misses). One batched
// FAST_MODEL call: returns the indices that are (a) about THIS product,
// (b) wholly positive, (c) free of any negative statement/comparison about any
// Raycon product. On any error, fall back to the deterministically-filtered set.
async function llmPositivityScreen(reviews: ProductReview[], productName: string): Promise<ProductReview[]> {
  if (reviews.length === 0) return [];
  const list = reviews.map((r, i) => `${i}. "${r.text}"`).join("\n");
  // NOTE: do NOT ask "is this about the product?" — these reviews come from the
  // product's OWN review widget, so that is already guaranteed structurally, and
  // real reviews rarely name the SKU ("love these", "great earbuds"). Asking it
  // made the screen reject everything. Judge SENTIMENT only; cross-product bleed
  // is handled deterministically by namesOtherProduct().
  const prompt = `You are screening real customer reviews of the Raycon "${productName}" for use in a marketing email. Every review below is already known to be for this product.
Return ONLY a JSON array of the indices that pass BOTH of:
(a) wholly positive about the product,
(b) contains no complaint, defect, discomfort, return story, or unfavorable comparison of ANY Raycon product or the brand.
A review that is positive but vague ("love these", "great sound") PASSES.
Reviews:
${list}

JSON array of passing indices only, e.g. [0,2]:`;
  try {
    const resp = await getAnthropic().messages.create({
      model: FAST_MODEL,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = resp.content.find((b) => b.type === "text");
    const raw = textBlock && "text" in textBlock ? textBlock.text : "";
    const m = raw.match(/\[[\d,\s]*\]/);
    if (!m) return reviews; // unparseable → keep the deterministically-filtered set
    const idxs = new Set<number>(JSON.parse(m[0]) as number[]);
    return reviews.filter((_, i) => idxs.has(i));
  } catch (e) {
    console.warn("[reviews] positivity screen failed, using deterministic filter only:", e instanceof Error ? e.message : e);
    return reviews;
  }
}

/**
 * Real, eligible reviews for a product SKU, ranked newest-first. Curated cache
 * (data/reviews/<id>.json) wins; otherwise fetch live, screen, and cache.
 * Returns [] when nothing qualifies — the caller must NEVER fabricate a review.
 */
export async function fetchProductReviews(
  productId: string,
  opts?: { limit?: number; refresh?: boolean }
): Promise<ProductReview[]> {
  const limit = Math.max(1, Math.min(opts?.limit ?? 3, 10));
  if (!safeId(productId)) return [];

  if (!opts?.refresh) {
    const cached = readCache(productId);
    if (cached && cached.length) return cached.slice(0, limit);
  }

  const handle = getProductHandle(productId);
  if (!handle) return [];

  const page = await fetchProductPage(handle);
  if (!page) return [];
  // Verify we landed on the right product (no soft-404 / redirect elsewhere).
  if (!page.finalUrl.includes(`/products/${handle}`)) return [];

  // Deterministic eligibility (everything except the LLM positivity screen).
  const passes = (r: ParsedReview) =>
    (!r.productUrl || r.productUrl.endsWith(`/products/${handle}`)) &&
    (!r.lang || r.lang === "en") &&
    isSubstantive(r.text) &&
    (r.rating === undefined || r.rating >= 4) &&
    !hasNegativeSignal(r.text) &&
    !namesOtherProduct(r.text, productId);

  // The product page server-renders only the FIRST page of reviews (~5). When
  // those don't yield enough eligible candidates, page deeper through Judge.me's
  // public widget endpoint, which returns the same `jdgm-rev` markup. This is
  // what makes products whose first page is all short/mixed reviews (e.g. E95)
  // work on the live path instead of coming back empty.
  let parsed = parseJudgeMeReviews(page.html);
  const widgetId = extractWidgetProductId(page.html);
  const want = Math.max(limit, 5);
  for (let pageNum = 2; widgetId && parsed.filter(passes).length < want && pageNum <= MAX_REVIEW_PAGES; pageNum++) {
    const moreHtml = await fetchWidgetPage(widgetId, pageNum);
    if (!moreHtml) break;
    const more = parseJudgeMeReviews(moreHtml);
    if (more.length === 0) break;
    parsed = parsed.concat(more);
  }

  const shortlist = parsed
    .filter(passes)
    // Newest-first among what remains (positivity screen preserves order).
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, want); // screen a few extra so we can fill `limit`

  const screened = await llmPositivityScreen(shortlist, getProductName(productId));
  const top = screened
    .map((r) => ({ text: r.text, rating: r.rating, author: r.author, date: r.date }))
    .slice(0, limit);
  if (top.length) writeCache(productId, top);
  return top;
}
