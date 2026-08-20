// URL tier classification for review sources — the CLIENT-SAFE half.
// Spec: docs/REVIEWS_MODULE_SPEC.md §4.1.
//
// Split out of ./url.ts on purpose: the slot editor in SectionBuilder needs to tell
// the writer what a URL will do BEFORE they commit to it, and SectionBuilder is a
// client component. ./url.ts reaches ./fetch.ts, which uses `fs`, so importing the
// classifier from there would drag Node's filesystem module into the browser bundle.
// Nothing in this file touches the network or the filesystem.

import { PRODUCT_CATEGORIES, getProductHandle, getProductName } from "@/lib/products";

export type ReviewUrlTier = "storefront" | "judgeme" | "generic" | "blocked";

export interface ReviewUrlClassification {
  tier: ReviewUrlTier;
  host: string;
  /** storefront tier: the SKU the URL resolves to. */
  product_id?: string;
  /** Human-readable explanation, shown in the slot editor. */
  note: string;
}

/** Hosts we will not scrape. Terms-of-service and licensing before engineering. */
const BLOCKED_HOSTS = [
  "amazon.", "bestbuy.", "walmart.", "target.", "costco.", "ebay.",
  "bhphotovideo.", "newegg.", "argos.", "currys.", "reddit.", "facebook.",
  "instagram.", "tiktok.", "x.com", "twitter.",
];

const STOREFRONT = (process.env.RAYCON_STOREFRONT || "https://rayconglobal.com")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

/**
 * Private / link-local / loopback targets an SSRF would aim at. Written as explicit
 * prefix and suffix tests rather than one anchored alternation: `^(127\.|…)$` looks
 * right and matches nothing, because each alternative then has to match the WHOLE
 * host — "127.0.0.1" sails straight through it.
 */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (h === "localhost" || h === "::1" || h === "0.0.0.0" || h === "[::1]") return true;
  if (/\.(internal|local|localhost|home\.arpa)$/.test(h)) return true;
  // IPv4 private + loopback + link-local (169.254 covers cloud metadata).
  if (/^(127|10)\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  // IPv6 loopback / link-local / unique-local.
  if (/^(::1|fe[89ab][0-9a-f]:|f[cd][0-9a-f]{2}:)/.test(h)) return true;
  return false;
}

/** https only, public host only. The same posture as the storefront fetch, applied
 * to a URL that now comes from user input. */
export function isFetchableUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "That isn't a valid URL." };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "Only https URLs are fetched." };
  if (isPrivateHost(url.hostname)) return { ok: false, reason: "That host isn't publicly reachable." };
  if (url.username || url.password) return { ok: false, reason: "Credentials in a URL aren't accepted." };
  return { ok: true, url };
}

/** Our own product pages: /products/<handle> → the SKU with that handle. */
function storefrontProductId(url: URL): string | undefined {
  const m = url.pathname.match(/\/products\/([^/?#]+)/);
  if (!m) return undefined;
  const handle = decodeURIComponent(m[1]).toLowerCase();
  for (const category of PRODUCT_CATEGORIES) {
    for (const p of category.products) {
      if ((getProductHandle(p.id) ?? "").toLowerCase() === handle) return p.id;
    }
  }
  return undefined;
}

/**
 * Which tier a URL falls into. Cheap and synchronous — the judgeme tier is only
 * confirmed once the HTML is in hand (a shop using Judge.me is not detectable from
 * the hostname), so a non-storefront, non-blocked URL classifies as `generic` and
 * fetchReviewFromUrl upgrades it if it finds the widget.
 */
export function classifyReviewUrl(raw: string): ReviewUrlClassification | { error: string } {
  const check = isFetchableUrl(raw);
  if (!check.ok) return { error: check.reason };
  const host = check.url.hostname.toLowerCase();

  if (BLOCKED_HOSTS.some((b) => host.includes(b))) {
    return {
      tier: "blocked", host,
      note: "This site's terms don't permit scraping its reviews. Paste the review text in manually instead.",
    };
  }
  if (host === STOREFRONT || host === `www.${STOREFRONT}` || host.endsWith(`.${STOREFRONT}`)) {
    const product_id = storefrontProductId(check.url);
    return product_id
      ? { tier: "storefront", host, product_id, note: `Our own product page — pulls the same reviews as selecting ${getProductName(product_id)}.` }
      : { tier: "generic", host, note: "Our storefront, but not a product page — will be read as a generic page." };
  }
  return { tier: "generic", host, note: "Not a known review platform — quotes are extracted and verified verbatim against the page." };
}
