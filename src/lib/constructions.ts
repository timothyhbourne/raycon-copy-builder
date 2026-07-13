import fs from "fs";
import path from "path";
import type { LibraryCampaign, ProductInGrid } from "./schemas";
import { getProductSlugByName } from "./products";

// Precomputed construction index: a compact record of every reusable
// construction in the library, so generation can be told what NOT to echo
// without ever re-reading full past campaigns. Updated incrementally on
// finalize/delete, rebuildable from scratch via scripts/index-constructions.ts.
const INDEX_PATH = path.join(process.cwd(), "data", "constructions-index.json");

// Which construction family each element maps into. The fixed shape has eight
// buckets; six element kinds are folded in so nothing is lost:
//   headlines    ← Headline + selected Subheader variant
//   taglines     ← Tagline + Closing Line
//   body_openers ← first sentence of each Body Copy / Body element
//   one_liners   ← product one-liners, keyed by product slug
export interface CampaignConstructions {
  date: string;
  campaign_type: string;
  title: string;
  conceit: string;
  subject_lines: string[];
  preview_texts: string[];
  headlines: string[];
  taglines: string[];
  body_openers: string[];
  one_liners: Record<string, string[]>;
  // Finalized SMS variant texts (from the SMS copy builder), so SMS generation
  // can be told what NOT to echo. Absent on email-only campaign entries.
  sms?: string[];
}

export interface ConstructionsIndex {
  version: number;
  campaigns: Record<string, CampaignConstructions>;
}

const EMPTY_INDEX: ConstructionsIndex = { version: 1, campaigns: {} };

// ---------------------------------------------------------------------------
// Read / write (defensive per the repo's store idiom — a corrupt file is
// treated as empty, then overwritten on the next update/backfill).
// ---------------------------------------------------------------------------
export function readIndex(): ConstructionsIndex {
  try {
    if (!fs.existsSync(INDEX_PATH)) return { ...EMPTY_INDEX, campaigns: {} };
    const parsed = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object" || typeof parsed.campaigns !== "object") {
      return { ...EMPTY_INDEX, campaigns: {} };
    }
    return { version: parsed.version ?? 1, campaigns: parsed.campaigns ?? {} };
  } catch {
    return { ...EMPTY_INDEX, campaigns: {} };
  }
}

function writeIndex(index: ConstructionsIndex): void {
  const dir = path.dirname(INDEX_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------
function firstSentence(text: string): string {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  const m = t.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : t).trim();
}

function pushOneLiner(map: Record<string, string[]>, key: string, value: string) {
  const v = (value || "").trim();
  if (!key || !v) return;
  (map[key] ??= []).push(v);
}

function extractFromStructured(entry: LibraryCampaign): CampaignConstructions | null {
  const cam = entry.structured?.campaign;
  if (!cam) return null;
  const struct = entry.structured?.section_structure ?? [];
  const specById = new Map(struct.map((s) => [s.id, s]));

  const subject_lines = (cam.meta?.subject_lines ?? []).filter(Boolean);
  const preview_texts = (cam.meta?.preview_texts ?? []).filter(Boolean);
  const headlines: string[] = [];
  const taglines: string[] = [];
  const body_openers: string[] = [];
  const one_liners: Record<string, string[]> = {};

  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

  for (const section of cam.sections ?? []) {
    const el = section.elements ?? {};
    if (str(el["Headline"])) headlines.push(str(el["Headline"]));
    // Selected Subheader variant (elements.Subheader already mirrors it).
    if (str(el["Subheader"])) headlines.push(str(el["Subheader"]));
    if (str(el["Tagline"])) taglines.push(str(el["Tagline"]));
    if (str(el["Closing Line"])) taglines.push(str(el["Closing Line"]));
    const body = str(el["Body Copy"]) || str(el["Body"]);
    if (body) body_openers.push(firstSentence(body));

    if (section.type === "product_card") {
      const oneLiner = str(el["One-Liner"]);
      if (oneLiner) {
        const spec = specById.get(section.id);
        const key = spec?.product_slug
          || getProductSlugByName(str(el["Product Name"]))
          || str(el["Product Name"]).toLowerCase();
        pushOneLiner(one_liners, key, oneLiner);
      }
    }
    const products = el["Products"];
    if (Array.isArray(products)) {
      for (const p of products as ProductInGrid[]) {
        if (!p?.one_liner) continue;
        const key = getProductSlugByName(p.name || "") || (p.name || "").toLowerCase();
        pushOneLiner(one_liners, key, p.one_liner);
      }
    }
  }

  if (!subject_lines.length && !headlines.length && !body_openers.length && !Object.keys(one_liners).length) {
    return null;
  }
  return {
    date: entry.date,
    campaign_type: entry.campaign_type,
    title: entry.title || entry.id,
    conceit: entry.conceit || "",
    subject_lines,
    preview_texts,
    headlines,
    taglines,
    body_openers,
    one_liners,
  };
}

// Legacy flat-body entries (doc/design-sourced, no structured snapshot): parse
// the same "# Heading" block split used elsewhere. Best-effort — one-liner
// slugs are unavailable, so grid/card lines fall back to their product name.
function extractFromBody(entry: LibraryCampaign): CampaignConstructions | null {
  const body = entry.body || "";
  if (!body.trim()) return null;
  const blocks = body.split(/\n(?=# )/).filter(Boolean);
  const linesOf = (heading: string): string[] => {
    const b = blocks.find((bl) => bl.match(/^# (.+)/)?.[1]?.trim() === heading);
    if (!b) return [];
    return b.replace(/^# .+\n?/, "").split("\n").map((l) => l.trim()).filter(Boolean);
  };

  const subject_lines = linesOf("Subject Line");
  const preview_texts = linesOf("Preview Text");
  const headlines = [...linesOf("Headline"), ...linesOf("Subheader")];
  const taglines = [...linesOf("Tagline"), ...linesOf("Closing Line")];
  const bodyLines = linesOf("Body Copy").length ? linesOf("Body Copy") : linesOf("Body");
  const body_openers = bodyLines.length ? [firstSentence(bodyLines.join(" "))] : [];

  const one_liners: Record<string, string[]> = {};
  // Product one-liners are written as "Name: one_liner" under a "# Products" or
  // "# One-Liner" heading in campaignToLibraryBody's flat form.
  for (const heading of ["Products", "One-Liner"]) {
    for (const line of linesOf(heading)) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        const name = line.slice(0, idx).trim();
        const val = line.slice(idx + 1).trim();
        const key = getProductSlugByName(name) || name.toLowerCase();
        pushOneLiner(one_liners, key, val);
      }
    }
  }

  if (!subject_lines.length && !headlines.length && !body_openers.length && !Object.keys(one_liners).length) {
    return null;
  }
  return {
    date: entry.date,
    campaign_type: entry.campaign_type,
    title: entry.title || entry.id,
    conceit: entry.conceit || "",
    subject_lines,
    preview_texts,
    headlines,
    taglines,
    body_openers,
    one_liners,
  };
}

export function extractConstructions(entry: LibraryCampaign): CampaignConstructions | null {
  try {
    return extractFromStructured(entry) ?? extractFromBody(entry);
  } catch {
    return null; // skip silently on failure
  }
}

// ---------------------------------------------------------------------------
// Incremental maintenance
// ---------------------------------------------------------------------------
export function updateCampaign(entry: LibraryCampaign): void {
  const extracted = extractConstructions(entry);
  if (!extracted) return;
  const index = readIndex();
  index.campaigns[entry.id] = extracted;
  writeIndex(index);
}

export function removeCampaign(id: string): void {
  const index = readIndex();
  if (index.campaigns[id]) {
    delete index.campaigns[id];
    writeIndex(index);
  }
}

// ---------------------------------------------------------------------------
// Step 2 — bounded prompt slices
// ---------------------------------------------------------------------------
const AVOID_FRAMING =
  "RECENTLY USED CONSTRUCTIONS — lines below were already sent. Do not reuse their headline shapes, subject constructions, opening moves, or product one-liner phrasings. Same voice, different build:";

const AVOID_MAX_LINES = 80;
const AVOID_MAX_BYTES = 6000;

interface AvoidOpts {
  productsFeatured?: string[];
  campaignType?: string;
  excludeId?: string;
}

// Campaigns newest-first, excluding the one being (re)written.
function sortedCampaigns(index: ConstructionsIndex, excludeId?: string): [string, CampaignConstructions][] {
  return Object.entries(index.campaigns)
    .filter(([id]) => id !== excludeId)
    .sort((a, b) => (b[1].date || "").localeCompare(a[1].date || ""));
}

export function buildAvoidBlock(opts: AvoidOpts = {}): string {
  const index = readIndex();
  const campaigns = sortedCampaigns(index, opts.excludeId);
  if (!campaigns.length) return "";

  const lines: string[] = [];

  // 1. Recency — 8 most recent campaigns.
  const recency: string[] = [];
  for (const [, c] of campaigns.slice(0, 8)) {
    const parts = [
      c.headlines.length ? `headlines: ${c.headlines.slice(0, 3).join(" | ")}` : "",
      c.subject_lines.length ? `subjects: ${c.subject_lines.join(" | ")}` : "",
      c.body_openers[0] ? `opened: "${c.body_openers[0]}"` : "",
    ].filter(Boolean).join("; ");
    if (parts) recency.push(`- ${c.date} "${c.title}": ${parts}`);
  }
  if (recency.length) {
    lines.push("[Recent campaigns]");
    lines.push(...recency);
  }

  // 2. Product-scoped — every one-liner recorded for each featured product
  //    (cap 20 per product, newest kept).
  const productLines: string[] = [];
  for (const slug of opts.productsFeatured ?? []) {
    const collected: string[] = [];
    for (const [, c] of campaigns) {
      const ols = c.one_liners[slug] ?? c.one_liners[slug?.toLowerCase?.()];
      if (ols?.length) collected.push(...ols);
      if (collected.length >= 20) break;
    }
    if (collected.length) {
      productLines.push(`[One-liners already used for ${slug}]`);
      productLines.push(...collected.slice(0, 20).map((o) => `- ${o}`));
    }
  }
  if (productLines.length) lines.push(...productLines);

  // 3. Type-scoped — subject lines from the 5 most recent same-type campaigns.
  if (opts.campaignType) {
    const typeSubjects: string[] = [];
    for (const [, c] of campaigns.filter(([, c]) => c.campaign_type === opts.campaignType).slice(0, 5)) {
      for (const s of c.subject_lines) typeSubjects.push(`- ${s}`);
    }
    if (typeSubjects.length) {
      lines.push(`[Recent ${opts.campaignType} subject lines]`);
      lines.push(...typeSubjects);
    }
  }

  if (!lines.length) return "";

  // Hard cap: ~80 lines / 6KB, truncate oldest/lowest-priority first (the tail).
  const header = AVOID_FRAMING;
  while (
    lines.length > AVOID_MAX_LINES ||
    (header + "\n" + lines.join("\n")).length > AVOID_MAX_BYTES
  ) {
    if (!lines.length) break;
    lines.pop();
  }
  if (!lines.length) return "";

  return `${header}\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// SMS constructions — recorded from finalized SMS campaigns (their own ids),
// injected as a recency slice so SMS variants stop repeating too.
// ---------------------------------------------------------------------------
export function recordSms(entry: {
  id: string;
  date: string;
  campaign_type: string;
  title: string;
  lines: string[];
}): void {
  const lines = entry.lines.map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return;
  const index = readIndex();
  const existing = index.campaigns[entry.id];
  if (existing) {
    existing.sms = lines;
  } else {
    index.campaigns[entry.id] = {
      date: entry.date,
      campaign_type: entry.campaign_type,
      title: entry.title,
      conceit: "",
      subject_lines: [],
      preview_texts: [],
      headlines: [],
      taglines: [],
      body_openers: [],
      one_liners: {},
      sms: lines,
    };
  }
  writeIndex(index);
}

const SMS_AVOID_FRAMING =
  "RECENTLY SENT SMS — these exact messages already went out. Do not reuse their opening moves, offer phrasings, or sign-offs. Same voice, different build:";

// Bounded avoid block for SMS generation: SMS lines from the most recent
// campaigns that have them, newest-first, capped for prompt size.
export function buildSmsAvoidBlock(limit = 15, excludeId?: string): string {
  const campaigns = sortedCampaigns(readIndex(), excludeId);
  const lines: string[] = [];
  for (const [, c] of campaigns) {
    for (const s of c.sms ?? []) {
      lines.push(`- ${s}`);
      if (lines.length >= limit) break;
    }
    if (lines.length >= limit) break;
  }
  if (!lines.length) return "";
  return `${SMS_AVOID_FRAMING}\n${lines.join("\n")}`;
}

// Past conceit names, newest-first, for the conceit step (conceits should also
// stop repeating). Bounded to `limit`.
export function recentConceits(limit = 12, excludeId?: string): { name: string; date: string; campaign_type: string }[] {
  return sortedCampaigns(readIndex(), excludeId)
    .map(([, c]) => ({ name: c.conceit, date: c.date, campaign_type: c.campaign_type }))
    .filter((c) => c.name)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Step 3a — similarity (pure, lexical)
// ---------------------------------------------------------------------------
function normalize(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function trigrams(s: string): Set<string> {
  const t = normalize(s).replace(/\s/g, " ");
  const grams = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) grams.add(t.slice(i, i + 3));
  return grams;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Lexical similarity in [0,1]. Character-trigram Jaccard, plus token-set
 * containment for short strings (≤6 tokens), taking the max of the two.
 * Sanity: "all-day comfort" vs "comfort all day long" scores high (shared
 * tokens); "30% off ends tonight" vs "the classic still got it" scores low.
 */
export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const tri = jaccard(trigrams(a), trigrams(b));

  const ta = na.split(" ").filter(Boolean);
  const tb = nb.split(" ").filter(Boolean);
  let containment = 0;
  if (ta.length <= 6 || tb.length <= 6) {
    const setA = new Set(ta);
    const setB = new Set(tb);
    let inter = 0;
    for (const t of setA) if (setB.has(t)) inter++;
    containment = inter / Math.min(setA.size, setB.size);
  }

  return Math.max(tri, containment);
}

// ---------------------------------------------------------------------------
// Step 3b — repetition scan (in-memory, synchronous)
// ---------------------------------------------------------------------------
export type CheckKind = "headline" | "subject" | "preview" | "one_liner" | "opener";

export interface CheckElement {
  id: string;
  kind: CheckKind;
  text: string;
  product?: string;
}

export interface CheckMatch {
  id: string;
  match_text: string;
  match_campaign_title: string;
  match_date: string;
  score: number;
}

const SIMILARITY_THRESHOLD = 0.65;

// The index field each element kind is scanned against.
function fieldFor(kind: CheckKind): keyof CampaignConstructions {
  switch (kind) {
    case "subject": return "subject_lines";
    case "preview": return "preview_texts";
    case "opener": return "body_openers";
    case "headline": return "headlines";
    case "one_liner": return "one_liners";
  }
}

export function checkRepetition(elements: CheckElement[], excludeId?: string): CheckMatch[] {
  const index = readIndex();
  const campaigns = Object.entries(index.campaigns).filter(([id]) => id !== excludeId);
  const out: CheckMatch[] = [];

  for (const el of elements) {
    const text = (el.text || "").trim();
    if (!text) continue;
    let best: CheckMatch | null = null;

    for (const [, c] of campaigns) {
      let candidates: string[] = [];
      if (el.kind === "one_liner") {
        if (el.product) {
          candidates = c.one_liners[el.product] ?? c.one_liners[el.product.toLowerCase()] ?? [];
        } else {
          candidates = Object.values(c.one_liners).flat();
        }
      } else {
        candidates = (c[fieldFor(el.kind)] as string[]) ?? [];
      }
      for (const cand of candidates) {
        const score = similarity(text, cand);
        if (score >= SIMILARITY_THRESHOLD && (!best || score > best.score)) {
          best = { id: el.id, match_text: cand, match_campaign_title: c.title, match_date: c.date, score };
        }
      }
    }
    if (best) out.push(best);
  }
  return out;
}
