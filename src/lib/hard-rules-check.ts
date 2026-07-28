// Deterministic hard-rules gate. The model is one line of defense; this is the
// other. Pure string math, no deps, no I/O. Runs on generated copy before it is
// shown or saved (see /api/hard-rules-check) and is also used to scrub em dashes
// out of the reference library at prompt-assembly time (see data.ts).
//
// The single source of truth for WHY each rule exists is data/copy-system.md.
// This file enforces only the mechanically checkable subset. Judgment calls
// (clever inversions, defensive framing, "speak to the reader") stay with the
// model's self-check.

import { PRODUCT_NAME_BY_ID } from "@/lib/products";

export type CheckKind =
  | "subject"
  | "preview"
  | "headline"
  | "tagline"
  | "subheader"
  | "body"
  | "one_liner"
  | "closing"
  | "cta"
  | "product_name" // product-card Product Name — must match the catalogue exactly
  | "review" // real customer text — exempt from all copy scans
  | "generic";

export interface HardRuleElement {
  id: string;
  kind: CheckKind;
  text: string;
}

export interface Violation {
  rule: string;
  detail: string;
  fixable: boolean; // true if autoFixMechanical() resolves it
}

export interface ElementResult {
  id: string;
  kind: CheckKind;
  violations: Violation[];
}

export interface HardRuleReport {
  ok: boolean;
  elements: ElementResult[];
  emailLevel: Violation[]; // rules that span the whole email (e.g. exclamation budget)
}

// --- Ban lists (mirror data/copy-system.md RULES) -------------------------

export const BANNED_PHRASES = [
  "makes sense",
  "just works",
  "just gets it",
  "built for real life",
  "does what you need it to do",
];

export const BANNED_HYPE = [
  "elevate",
  "next-level",
  "game-changer",
  "game changing",
  "revolutionary",
  "unleash",
  "unlock the power of",
  "take it to the next level",
  "seamless",
  "effortless",
  "curated",
  "must-have",
  "behold",
  "look no further",
  "we're excited to announce",
  "we're thrilled to introduce",
  "mind-blowing",
];

// AI heading clichés — the stock phrasings a language model reaches for first.
// Especially for subheaders/taglines, but flagged everywhere (real customer
// reviews are exempt: see the `review` kind skip in checkHardRules). Literal,
// case-insensitive substring match; curly apostrophes normalized to straight.
export const BANNED_HEADING_CLICHES = [
  "real people, real results",
  "real people, real reviews",
  "real results",
  "say hello to",
  "say goodbye to",
  "meet your new",
  "experience the difference",
  "discover the difference",
  "hear the difference",
  "feel the difference",
  "because you deserve",
  "it's time to",
  "the future of",
  "reimagined",
  "perfected",
  "sound that moves you",
  "music to your ears",
  "everything you need, nothing you don't",
  "just got better",
  "turn up the",
  "life, but better",
];

// Templated clichés (the "[x]"/"[y]" ones from the ban list) as patterns.
const HEADING_CLICHE_PATTERNS: RegExp[] = [
  /the\s+.+\s+you'?ve\s+been\s+waiting\s+for/i,     // the [x] you've been waiting for
  /say\s+(hello|goodbye)\s+to/i,
  /(experience|discover|hear|feel)\s+the\s+difference/i,
  /\b\w+,\s+(reimagined|perfected|elevated|reinvented)\b/i, // [x], elevated
  /where\s+.+\s+meets\s+.+/i,                        // where [x] meets [y]
  /the\s+only\s+.+\s+you'?ll\s+ever\s+need/i,        // the only [x] you'll ever need
];

// Char / word caps by element kind (mirror the RULES length-cap table).
const CAPS: Partial<Record<CheckKind, { chars?: number; maxWords?: number; minWords?: number }>> = {
  subject: { chars: 50 },
  preview: { chars: 90 },
  headline: { minWords: 3, maxWords: 5 },
  tagline: { maxWords: 10 },
  // These mirror the Length caps table in data/copy-system.md (the canonical
  // source). Keep them in sync — the prompt no longer restates the numbers.
  subheader: { maxWords: 10 },
  closing: { maxWords: 12 },
  cta: { maxWords: 4 },
};

// Catalogue product names (lowercased) — a product-card Product Name must be one
// of these exactly; anything else is model-coined drift (e.g. "Everyday Pro
// Earbuds") and gets flagged.
const CATALOGUE_NAMES = new Set(Object.values(PRODUCT_NAME_BY_ID).map((n) => n.toLowerCase()));

// Urgency tags that cannot stand alone as a headline (they carry no benefit,
// product, or offer). "Last Call On 30% Off" is fine; bare "Last Call" is not.
const URGENCY_TAGS = new Set([
  "last call", "final call", "final hours", "last chance", "time's up", "times up",
  "ends tonight", "closing soon", "hurry", "don't miss out", "dont miss out", "act now",
]);

const EM_EN_DASH = /[—–]/g; // — and –
const TRAILING_ELLIPSIS = /…|\.\.\./g;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/gu;

function wordCount(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Scans a single blob of text for the universal (kind-independent) rules. */
function checkTextUniversal(text: string): Violation[] {
  const v: Violation[] = [];
  const lower = text.toLowerCase();

  if (EM_EN_DASH.test(text)) {
    v.push({ rule: "em-dash", detail: "Contains an em or en dash.", fixable: true });
  }
  if (TRAILING_ELLIPSIS.test(text)) {
    v.push({ rule: "ellipsis", detail: "Contains an ellipsis.", fixable: true });
  }
  if (/!{2,}/.test(text)) {
    v.push({ rule: "stacked-exclamation", detail: 'Contains stacked exclamation points ("!!").', fixable: true });
  }
  if (EMOJI.test(text)) {
    v.push({ rule: "emoji", detail: "Contains emoji.", fixable: false });
  }
  // "Classic" is the retired product name. Word-boundary, case-insensitive.
  if (/\bclassic\b/i.test(text)) {
    v.push({ rule: "retired-name", detail: 'Uses the retired name "Classic".', fixable: false });
  }
  // colon-as-reveal: "word: word" short reveal. Heuristic — flag only mid-line
  // short reveals, not "USE CODE:" callouts.
  if (/[a-z]{3,}:\s+[a-z]/i.test(text) && !/use code|code:/i.test(text)) {
    v.push({ rule: "colon-reveal", detail: "Possible colon-as-reveal construction.", fixable: false });
  }

  for (const p of BANNED_PHRASES) {
    if (lower.includes(p)) v.push({ rule: "banned-phrase", detail: `Banned phrase: "${p}".`, fixable: false });
  }
  for (const h of BANNED_HYPE) {
    if (lower.includes(h)) v.push({ rule: "banned-hype", detail: `Banned hype word: "${h}".`, fixable: false });
  }
  // AI heading clichés (flag-level, not auto-fixable). Normalize curly quotes.
  const clicheHay = lower.replace(/[’‘]/g, "'");
  const textNorm = text.replace(/[’‘]/g, "'");
  for (const c of BANNED_HEADING_CLICHES) {
    if (clicheHay.includes(c)) v.push({ rule: "heading-cliche", detail: `AI heading cliché: "${c}".`, fixable: false });
  }
  for (const re of HEADING_CLICHE_PATTERNS) {
    if (re.test(textNorm)) v.push({ rule: "heading-cliche", detail: `AI heading cliché pattern (${re.source}).`, fixable: false });
  }
  return v;
}

function checkCaps(kind: CheckKind, text: string): Violation[] {
  const v: Violation[] = [];
  const cap = CAPS[kind];
  if (!cap) return v;
  const t = text.trim();
  if (cap.chars !== undefined && t.length >= cap.chars) {
    v.push({ rule: "length-cap", detail: `${kind} is ${t.length} chars (cap ${cap.chars}).`, fixable: false });
  }
  if (cap.maxWords !== undefined) {
    const w = wordCount(t);
    if (w > cap.maxWords) v.push({ rule: "length-cap", detail: `${kind} is ${w} words (max ${cap.maxWords}).`, fixable: false });
  }
  if (cap.minWords !== undefined) {
    const w = wordCount(t);
    if (w > 0 && w < cap.minWords) v.push({ rule: "length-cap", detail: `${kind} is ${w} words (min ${cap.minWords}).`, fixable: false });
  }
  return v;
}

function checkKindSpecific(kind: CheckKind, text: string): Violation[] {
  const v: Violation[] = [];
  if (kind === "one_liner") {
    // Offer mechanics must not live in a product one-liner.
    if (/\d{1,3}\s*%|\bcode\b|\$\d/i.test(text)) {
      v.push({ rule: "offer-in-one-liner", detail: "Offer mechanics (%, code, or price) in a one-liner.", fixable: false });
    }
  }
  if (kind === "cta") {
    // A discount phrase ("Get 30% Off") is fine, but the promo CODE never lives
    // in a CTA — flag the literal word "code" or a standalone ALL-CAPS
    // alphanumeric token (e.g. COMBO30).
    if (/\bcode\b/i.test(text) || /\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{4,}\b/.test(text)) {
      v.push({ rule: "code-in-cta", detail: "Promo code in a CTA — codes live in body copy, a callout, or the tagline.", fixable: false });
    }
  }
  // A headline that is ONLY an urgency tag says nothing. It must also carry a
  // benefit, a product, or the offer. (This is the "Last Call" failure mode.)
  if (kind === "headline") {
    const bare = text.trim().toLowerCase().replace(/[.!?,;:]+$/g, "").trim();
    if (URGENCY_TAGS.has(bare)) {
      v.push({ rule: "urgency-only-headline", detail: `Headline "${text.trim()}" is only an urgency tag — add the benefit, product, or offer.`, fixable: false });
    }
  }
  // "Pairs" is a unit for ONE earbud/headphone set, never a product count.
  if (/\b(?:two|three|four|five|six|\d+)\s+pairs\b/i.test(text) || /\ball\s+(?:two|three|four|\d+)\s+pairs\b/i.test(text)) {
    v.push({ rule: "pairs-as-count", detail: 'Counts products as "pairs" — use products, styles, or picks.', fixable: false });
  }
  // A hero element must never enumerate the catalogue — the cards already name
  // the products. Two or more catalogue names in a Headline/Tagline/Subheader is
  // a roll-call (e.g. "Pro Earbuds, Essential Headphones, Everyday Headphones").
  if (kind === "headline" || kind === "tagline" || kind === "subheader") {
    const lower = text.toLowerCase();
    let hits = 0;
    for (const name of CATALOGUE_NAMES) {
      if (name.length >= 6 && lower.includes(name)) hits++;
    }
    if (hits >= 2) {
      v.push({ rule: "product-roll-call", detail: `${kind} lists ${hits} product names — lead with the offer or occasion instead.`, fixable: false });
    }
  }
  // The Tagline is ONE sentence (the cap says so); catch a second sentence.
  if (kind === "tagline" && /[.!?]\s+\S/.test(text.trim())) {
    v.push({ rule: "tagline-two-sentences", detail: "Tagline is more than one sentence.", fixable: false });
  }
  if (kind === "product_name") {
    const t = text.trim().toLowerCase();
    if (t && !CATALOGUE_NAMES.has(t)) {
      v.push({ rule: "product-name-drift", detail: `Product Name "${text.trim()}" is not an exact catalogue product name.`, fixable: false });
    }
  }
  return v;
}

/** Full report over a set of generated elements. */
export function checkHardRules(elements: HardRuleElement[]): HardRuleReport {
  const results: ElementResult[] = [];
  let totalExclamations = 0;

  for (const el of elements) {
    // Reviews are real customer text, not our copy — exempt from every scan
    // (banned phrases, structure, length, clichés) and the exclamation budget.
    if (el.kind === "review") continue;
    const text = el.text ?? "";
    totalExclamations += (text.match(/!/g) ?? []).length;
    const violations = [
      ...checkTextUniversal(text),
      ...checkCaps(el.kind, text),
      ...checkKindSpecific(el.kind, text),
    ];
    if (violations.length) results.push({ id: el.id, kind: el.kind, violations });
  }

  const emailLevel: Violation[] = [];
  if (totalExclamations > 2) {
    emailLevel.push({
      rule: "exclamation-budget",
      detail: `${totalExclamations} exclamation points across the email (max 2).`,
      fixable: false,
    });
  }

  return {
    ok: results.length === 0 && emailLevel.length === 0,
    elements: results,
    emailLevel,
  };
}

/**
 * Mechanically repair the always-fixable violations. Used to clean the
 * reference library before it is shown to the model, and offered as a
 * one-click fix on generated copy. Only touches punctuation, never wording.
 */
export function autoFixMechanical(text: string): string {
  return text
    // em/en dash between digits is a range -> hyphen ("15—50%" -> "15-50%")
    .replace(/(\d)\s*[—–]\s*(\d)/g, "$1-$2")
    // spaced em/en dash -> comma ("clean — looks" -> "clean, looks")
    .replace(/\s+[—–]\s+/g, ", ")
    // any remaining em/en dash -> comma
    .replace(/[—–]/g, ", ")
    // trailing ellipsis -> period
    .replace(/\s*(…|\.\.\.)/g, ".")
    // collapse stacked exclamations
    .replace(/!{2,}/g, "!");
}
