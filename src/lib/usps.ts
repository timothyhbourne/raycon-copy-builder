import { getProductUspsDoc, getCompanyUspsDoc } from "./data";
import { productUspSchema, companyUspSchema, uspBankSchema } from "./validation/schemas";

/**
 * USP banks — the verified selling points behind a `usps` section.
 *
 * WHY THIS IS A SEPARATE FILE FROM products.md: the product catalogue is injected
 * WHOLESALE into every prompt (see buildSystemBlocks). Putting ~150 USP lines there
 * would put every product's USPs in context on every generation, which is exactly
 * how features from the wrong product leak into a USPs section. These banks are
 * parsed here and injected PER SECTION, scoped to the bound product.
 *
 * Both documents are bundled static content read through src/lib/data.ts — never
 * written at runtime, so they are intentionally exempt from the storage seam
 * (ARCHITECTURE_REMEDIATION_SPEC §3.3).
 */

export interface ProductUsp {
  /** Short bold label, e.g. "40 hour total battery". */
  label: string;
  /** One-sentence, benefit-led claim. */
  benefit: string;
  /** Filter tags: fit, battery, sound, durability, comfort, controls, connectivity, awareness, design, value. */
  tags: string[];
  /** Marked `[unverified]` in the source doc — EXCLUDED from prompts by the accessors. */
  unverified?: boolean;
}

export interface CompanyUsp extends ProductUsp {
  /** The `## ` group this entry sits under, e.g. "Returns and guarantee". */
  theme: string;
}

/** One product's block, with its provenance, as authored in data/product-usps.md. */
export interface UspBank {
  sku: string;
  name: string;
  source: string;
  verified: string;
  usps: ProductUsp[];
}

// One line per malformed block/bullet — never a throw. A hand-edited doc with one
// bad bullet must still yield every good bullet around it.
function warnBad(what: string, detail: string): void {
  console.warn(`[usps] skipped malformed ${what}: ${detail.slice(0, 200)}`);
}

/** Strip fenced code blocks so the format example in each doc's header — which
 * itself contains `## SKU — Product Name` — is never parsed as a real block. */
function stripFences(md: string): string {
  return md.replace(/^```[\s\S]*?^```/gm, "");
}

/** Trailing tag groups, e.g. "…keeps going. `[battery]` `[value]`" or "`[fit] [comfort]`". */
const TRAILING_TAGS = /\s*`((?:\[[a-z_]+\]\s*)+)`\s*$/;

/**
 * Parse one bullet line into a USP. Returns null (with a warning) when the line
 * isn't a `- **Label:** benefit` bullet or is missing either half.
 */
function parseBullet(line: string, context: string): ProductUsp | null {
  const m = line.match(/^-\s+\*\*(.+?):\*\*\s*(.*)$/);
  if (!m) return null; // not a USP bullet at all (e.g. a prose bullet) — silent
  const label = m[1].trim();
  let rest = m[2].trim();

  // Tag groups are stripped from the end one group at a time, so both
  // "`[a]` `[b]`" and "`[a] [b]`" collect identically. Groups are consumed
  // right-to-left, so the GROUP list is reversed at the end — reversing the flat
  // tag list instead would scramble the order within each group.
  const groups: string[][] = [];
  for (;;) {
    const t = rest.match(TRAILING_TAGS);
    if (!t) break;
    groups.push([...t[1].matchAll(/\[([a-z_]+)\]/g)].map((m2) => m2[1]));
    rest = rest.slice(0, t.index).trim();
  }
  const tags = groups.reverse().flat();

  const unverified = tags.includes("unverified");
  const candidate: ProductUsp = {
    label,
    benefit: rest,
    tags: tags.filter((t) => t !== "unverified"),
    ...(unverified ? { unverified: true } : {}),
  };

  const res = productUspSchema.safeParse(candidate);
  if (!res.success) {
    warnBad(`USP in ${context}`, `"${line.trim()}" — ${res.error.message}`);
    return null;
  }
  return candidate;
}

/**
 * Split a doc into `## ` blocks. Continuation lines (an indented wrap of the
 * previous bullet) are folded back onto their bullet before parsing, so a USP may
 * be hard-wrapped in the source without changing what the parser sees.
 */
function blocksOf(md: string): { heading: string; lines: string[] }[] {
  const out: { heading: string; lines: string[] }[] = [];
  let current: { heading: string; lines: string[] } | null = null;

  for (const raw of stripFences(md).split("\n")) {
    const h = raw.match(/^##\s+(.+?)\s*$/);
    if (h) {
      if (current) out.push(current);
      current = { heading: h[1], lines: [] };
      continue;
    }
    if (!current) continue; // preamble before the first block
    // An indented, non-bullet, non-empty line continues the previous bullet.
    if (/^\s+\S/.test(raw) && !/^\s*-\s/.test(raw) && current.lines.length > 0) {
      current.lines[current.lines.length - 1] += ` ${raw.trim()}`;
      continue;
    }
    current.lines.push(raw);
  }
  if (current) out.push(current);
  return out;
}

function metaOf(lines: string[], key: string): string {
  for (const l of lines) {
    const m = l.match(new RegExp(`^\\*\\*${key}:\\*\\*\\s*(.*)$`));
    if (m) return m[1].trim().replace(/^\*|\*$/g, "").trim();
  }
  return "";
}

// ---------------------------------------------------------------------------
// Product banks
// ---------------------------------------------------------------------------

/**
 * Parse data/product-usps.md into banks keyed by SKU. Pure — the doc is passed in
 * so this is directly unit-testable. Malformed blocks are logged and skipped.
 */
export function parseProductUspBanks(md: string): UspBank[] {
  const out: UspBank[] = [];
  for (const block of blocksOf(md)) {
    // "O25 — Fitness Open Earbuds" (em dash, en dash, or hyphen).
    const [rawSku, ...rest] = block.heading.split(/\s+[—–-]\s+/);
    const sku = (rawSku ?? "").trim().toUpperCase();
    if (!sku) continue;

    const usps: ProductUsp[] = [];
    for (const line of block.lines) {
      const usp = parseBullet(line, sku);
      if (usp) usps.push(usp);
    }
    if (!usps.length) continue; // a heading with no USPs isn't a bank

    const bank: UspBank = {
      sku,
      name: rest.join(" — ").trim(),
      source: metaOf(block.lines, "Source"),
      verified: metaOf(block.lines, "Verified"),
      usps,
    };
    const res = uspBankSchema.safeParse(bank);
    if (!res.success) {
      warnBad(`product USP block "${block.heading}"`, res.error.message);
      continue;
    }
    out.push(bank);
  }
  return out;
}

/** Banks keyed by SKU. The signature the spec calls for; delegates to the block parser. */
export function parseProductUsps(md: string): Record<string, ProductUsp[]> {
  return Object.fromEntries(parseProductUspBanks(md).map((b) => [b.sku, b.usps]));
}

let productBanksCache: UspBank[] | null = null;
function productBanks(): UspBank[] {
  productBanksCache ??= parseProductUspBanks(getProductUspsDoc());
  return productBanksCache;
}

/** Every parsed bank, including unverified entries. For scripts/verify-usps.ts. */
export function getAllProductUspBanks(): UspBank[] {
  return productBanks();
}

/**
 * The USP bank for one SKU, with `[unverified]` entries REMOVED — an unverifiable
 * claim must never reach a prompt. Returns [] when the product has no bank yet.
 */
export function getProductUsps(sku: string): ProductUsp[] {
  const bank = productBanks().find((b) => b.sku === (sku || "").toUpperCase());
  return (bank?.usps ?? []).filter((u) => !u.unverified);
}

// ---------------------------------------------------------------------------
// Company bank
// ---------------------------------------------------------------------------

/** Parse data/company-usps.md. Pure; same skip-don't-throw contract. */
export function parseCompanyUsps(md: string): CompanyUsp[] {
  const out: CompanyUsp[] = [];
  for (const block of blocksOf(md)) {
    const theme = block.heading.trim();
    for (const line of block.lines) {
      const usp = parseBullet(line, theme);
      if (!usp) continue;
      const entry: CompanyUsp = { ...usp, theme };
      const res = companyUspSchema.safeParse(entry);
      if (!res.success) {
        warnBad(`company USP in "${theme}"`, res.error.message);
        continue;
      }
      out.push(entry);
    }
  }
  return out;
}

let companyCache: CompanyUsp[] | null = null;

/** Every parsed company USP, including unverified. For scripts/verify-usps.ts. */
export function getAllCompanyUsps(): CompanyUsp[] {
  companyCache ??= parseCompanyUsps(getCompanyUspsDoc());
  return companyCache;
}

/**
 * The company bank with `[unverified]` entries removed. This is what ends the
 * "never claim free shipping" problem: what's here is verified and sayable,
 * anything absent stays forbidden.
 */
export function getCompanyUsps(): CompanyUsp[] {
  return getAllCompanyUsps().filter((u) => !u.unverified);
}

// ---------------------------------------------------------------------------
// Prompt rendering
// ---------------------------------------------------------------------------

/** One USP as a prompt bullet: "• Label: benefit [tag]". */
export function formatUsp(u: ProductUsp): string {
  const tags = u.tags.length ? ` [${u.tags.join(", ")}]` : "";
  return `• ${u.label}: ${u.benefit}${tags}`;
}
