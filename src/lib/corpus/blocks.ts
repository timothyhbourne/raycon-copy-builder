// L4 INJECT — the prompt blocks built from the corpus.
// Spec: docs/RECURSIVE_LEARNING_FRAMEWORK_SPEC.md §2.4 (L4), §2.6.
//
// PURE: every function takes resolved records and returns a string. No fs, no
// network, no store — so all of it is unit-testable, and the route stays the only
// place that touches I/O.
//
// THE DESIGN RULE THIS FILE EXISTS TO ENFORCE (§2.1): attraction operates on
// EFFECT, repulsion operates on FORM. Nothing in this file may rank, select or
// recommend a construction because it performed well. The reference sampler below
// deliberately never reads `record.performance` — the moment it does, the system
// starts manufacturing the staleness the whole framework is meant to remove.
// Performance lives in src/lib/performance-memory.ts and speaks only about
// angles, stages and structure.
//
// Every block returns "" when there is not enough signal. Generation must never
// block or degrade because the corpus is thin (§2.7, Fail open).

import { HEADLINE_PATTERNS, describeSignature, signatureSimilarity } from "./signature";
import type { HeadlinePattern } from "./signature";
import type { CorpusRecord, CorpusElement } from "./types";
import { TIER_LABELS, bySendDateDesc } from "./types";

/** How many approved sends the form budget looks back over. */
export const FORM_BUDGET_WINDOW = 8;
/** Below this many counted sends the budget states the distribution but bans
 * nothing — with 3 sends in the window, "over-represented" means nothing. */
const MIN_BUDGET_SENDS = 4;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Records that WENT OUT or WILL go out: the sends a reader sees. Drafts are
 * excluded from the budget (they were never approved) but still repel lexically. */
export function approvedSends(records: CorpusRecord[]): CorpusRecord[] {
  return records.filter((r) => r.tier === "shipped" || r.tier === "approved").sort(bySendDateDesc);
}

/** The headline that shipped (or will) for a record: the selected slate
 * candidate, else the only headline present. */
export function shippedHeadline(record: CorpusRecord): CorpusElement | null {
  const headlines = record.elements.filter((e) => e.kind === "headline");
  if (!headlines.length) return null;
  return headlines.find((h) => h.was_selected) ?? headlines[0];
}

function shippedOf(record: CorpusRecord, kind: CorpusElement["kind"]): CorpusElement | null {
  const of = record.elements.filter((e) => e.kind === kind);
  if (!of.length) return null;
  return of.find((e) => e.was_selected) ?? of[0];
}

// ---------------------------------------------------------------------------
// FORM BUDGET (§2.3) — pattern quotas, applied BEFORE generation
// ---------------------------------------------------------------------------
export interface FormBudget {
  /** How many sends were actually counted. */
  counted: number;
  window: number;
  counts: Record<HeadlinePattern, number>;
  /** Patterns used more than their fair share of the window. */
  over_used: HeadlinePattern[];
  /** Patterns the next send should reach for first. */
  reach_for: HeadlinePattern[];
}

/**
 * Count the headline pattern of each of the last `window` approved sends. One
 * count per send: a campaign has one hero headline, so a campaign with three
 * header sections must not vote three times.
 */
export function computeFormBudget(records: CorpusRecord[], window = FORM_BUDGET_WINDOW): FormBudget {
  const counts = Object.fromEntries(HEADLINE_PATTERNS.map((p) => [p, 0])) as Record<HeadlinePattern, number>;
  let counted = 0;
  // The window is the last N sends that HAD a classified headline. Counting sends
  // without one (every SMS, for a start) would let them eat slots and quietly
  // shrink the sample the quotas are computed from.
  const withHeadline = approvedSends(records).filter((r) => {
    const pattern = shippedHeadline(r)?.signature.pattern;
    return pattern !== undefined && pattern !== "unclassified";
  });
  for (const record of withHeadline.slice(0, window)) {
    counts[shippedHeadline(record)!.signature.pattern] += 1;
    counted += 1;
  }
  const fairShare = counted / HEADLINE_PATTERNS.length;
  // Strictly greater than the fair share, so an even spread bans nothing and the
  // budget can never ban every pattern.
  const over_used = counted >= MIN_BUDGET_SENDS
    ? HEADLINE_PATTERNS.filter((p) => counts[p] > fairShare)
    : [];
  const min = Math.min(...HEADLINE_PATTERNS.map((p) => counts[p]));
  const reach_for = HEADLINE_PATTERNS.filter((p) => counts[p] === min);
  return { counted, window, counts, over_used, reach_for };
}

/**
 * The FORM BUDGET block. Note what it does NOT say: it never bans a pattern from
 * the slate. The slate is four candidates, one per pattern, because that is what
 * makes the writer's choice a real one (§1.3) — the budget governs which pattern
 * gets the DEFAULT slot, since the default is what ships when nobody intervenes.
 * That is the difference between forcing rotation and shrinking the writer's
 * options.
 */
export function formBudgetBlock(budget: FormBudget): string {
  if (!budget.counted) return "";
  const distribution = HEADLINE_PATTERNS.map((p) => `${p} ×${budget.counts[p]}`).join(", ");
  const lines = [
    `FORM BUDGET — the last ${budget.counted} approved send${budget.counted === 1 ? "" : "s"} used these headline patterns: ${distribution}.`,
  ];
  if (budget.over_used.length) {
    lines.push(
      `Over-used right now: ${budget.over_used.join(", ")}. Do NOT make ${budget.over_used.length === 1 ? "it" : "any of them"} the FIRST (default) headline candidate in this send.`,
    );
  }
  lines.push(
    `Lead the headline slate with ${budget.reach_for.join(" or ")} — the pattern${budget.reach_for.length === 1 ? "" : "s"} this account has under-used.`,
  );
  lines.push(
    `Still draft one candidate per pattern: this is a rotation rule for the default, not permission to write fewer candidates. It constrains CONSTRUCTION, never quality, and every hard rule still applies.`,
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// IN-FLIGHT + FORM repulsion (§2.2, §2.3, §2.6.3)
// ---------------------------------------------------------------------------
const IN_FLIGHT_MAX = 6;
const FORM_MAX = 10;

/**
 * The two things the lexical avoid block in src/lib/constructions.ts structurally
 * cannot say:
 *
 *  1. IN FLIGHT — copy approved and scheduled but not yet sent. Previously
 *     invisible to generation, which meant nothing stopped today's send echoing a
 *     headline going out on Thursday. This is the most dangerous gap in the old
 *     setup and the highest-value half of this block.
 *  2. CONSTRUCTIONS IN USE — the SHAPE of recent headlines, not their words. A
 *     reader does not experience repetition lexically; they experience it as
 *     "these all sound the same".
 */
export function inFlightBlock(records: CorpusRecord[], opts: { excludeId?: string } = {}): string {
  const sends = approvedSends(records).filter((r) => r.id !== opts.excludeId);
  if (!sends.length) return "";

  const sections: string[] = [];

  const inFlight = sends.filter((r) => r.tier === "approved").slice(0, IN_FLIGHT_MAX);
  if (inFlight.length) {
    const lines = inFlight.map((r) => {
      const parts = [
        shippedHeadline(r)?.text ? `headline: "${shippedHeadline(r)!.text}"` : "",
        shippedOf(r, "tagline")?.text ? `tagline: "${shippedOf(r, "tagline")!.text}"` : "",
        shippedOf(r, "subject")?.text ? `subject: "${shippedOf(r, "subject")!.text}"` : "",
      ].filter(Boolean).join("; ");
      const when = (r.sent_at ?? r.approved_at ?? "").slice(0, 10);
      return parts ? `- ${when || "scheduled"} "${r.title}" (${TIER_LABELS[r.tier]}): ${parts}` : "";
    }).filter(Boolean);
    if (lines.length) {
      sections.push(
        [
          "ALREADY APPROVED AND SCHEDULED, NOT YET SENT — the reader will see these within days, so an echo here reads as a duplicate send. Repel from them at least as hard as from copy already out:",
          ...lines,
        ].join("\n"),
      );
    }
  }

  // Form-level: describe the construction, never re-quote the line (the lexical
  // block already carries the words).
  const forms = new Map<string, number>();
  for (const record of sends.slice(0, FORM_MAX)) {
    const headline = shippedHeadline(record);
    if (!headline || headline.signature.pattern === "unclassified") continue;
    const desc = describeSignature(headline.signature);
    forms.set(desc, (forms.get(desc) ?? 0) + 1);
  }
  if (forms.size) {
    const lines = [...forms.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([desc, n]) => `- ${desc}${n > 1 ? ` (used ${n}×)` : ""}`);
    sections.push(
      [
        "HEADLINE CONSTRUCTIONS ALREADY IN USE — these are SHAPES, not words. Writing a fresh line in one of these shapes still reads as repetition to a subscriber (\"Motion Never Stops\" and \"Sound Never Quits\" share no words and are the same headline). Build differently:",
        ...lines,
      ].join("\n"),
    );
  }

  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// ROTATING REFERENCE SAMPLE (§2.6.1)
// ---------------------------------------------------------------------------
export interface ReferenceBrief {
  campaign_type?: string;
  audience?: string;
  occasion?: string;
  products_featured?: string[];
}

/** Relevance to the brief. Deliberately performance-blind — see the file header. */
function relevance(record: CorpusRecord, brief: ReferenceBrief): number {
  let score = 0;
  if (brief.campaign_type && record.campaign_type === brief.campaign_type) score += 3;
  if (brief.audience && record.audience === brief.audience) score += 2;
  const wanted = new Set(brief.products_featured ?? []);
  if (wanted.size && record.products_featured.some((p) => wanted.has(p))) score += 2;
  const occasion = (brief.occasion ?? "").trim().toLowerCase();
  if (occasion && (record.occasion ?? "").toLowerCase().includes(occasion)) score += 1;
  return score;
}

/**
 * Pick 4–6 Tier-A campaigns: relevance-ranked, then greedily de-duplicated by
 * FORM so the sample is not four instances of one pattern, then rotated so two
 * consecutive generations of the same brief do not see the same examples.
 *
 * Rotation is the point. The frozen 11-row table in data/copy-system.md is
 * described to the model as the ceiling ("match this, not your own idea of
 * playful"), so the model correctly regresses to the mean of eleven lines. A
 * rotating sample of real sends removes the ceiling without loosening a single
 * rule.
 */
export function selectReferenceSample(
  records: CorpusRecord[],
  brief: ReferenceBrief,
  opts: { size?: number; rotation?: number; excludeId?: string } = {},
): CorpusRecord[] {
  const size = opts.size ?? 5;
  const eligible = records
    .filter((r) => r.tier === "shipped" && r.id !== opts.excludeId && shippedHeadline(r))
    .sort((a, b) => {
      const d = relevance(b, brief) - relevance(a, brief);
      return d !== 0 ? d : bySendDateDesc(a, b);
    });
  if (eligible.length <= 1) return eligible;

  // Rotate the ranked list so the window moves between generations, then walk it
  // cyclically. With N eligible records the sample changes every generation until
  // the cursor laps.
  const offset = ((opts.rotation ?? 0) % eligible.length + eligible.length) % eligible.length;
  const ordered = [...eligible.slice(offset), ...eligible.slice(0, offset)];

  const picked: CorpusRecord[] = [];
  const tooSimilar = (candidate: CorpusRecord) => {
    const sig = shippedHeadline(candidate)?.signature;
    if (!sig) return true;
    return picked.some((p) => {
      const other = shippedHeadline(p)?.signature;
      return other ? signatureSimilarity(sig, other) >= 0.5 : false;
    });
  };
  for (const candidate of ordered) {
    if (picked.length >= size) break;
    if (!tooSimilar(candidate)) picked.push(candidate);
  }
  // Diversity is a preference, not a cap: if the filter starved the sample, top it
  // up in rank order.
  for (const candidate of ordered) {
    if (picked.length >= Math.min(size, 4)) break;
    if (!picked.includes(candidate)) picked.push(candidate);
  }
  return picked;
}

/** Render the rotating reference set. Supersedes the frozen 11-row register
 * anchor when it is non-empty; the table stays as the fallback for a thin corpus. */
export function referenceBlock(sample: CorpusRecord[]): string {
  if (!sample.length) return "";
  const lines = sample.map((r) => {
    const headline = shippedHeadline(r)?.text ?? "";
    const tagline = shippedOf(r, "tagline")?.text ?? "";
    const subject = shippedOf(r, "subject")?.text ?? "";
    const when = (r.sent_at ?? "").slice(0, 10);
    const pattern = shippedHeadline(r)?.signature.pattern;
    const bits = [
      headline ? `HEADLINE: "${headline}"` : "",
      tagline ? `TAGLINE: "${tagline}"` : "",
      subject ? `SUBJECT: "${subject}"` : "",
    ].filter(Boolean).join("  ·  ");
    return `- ${when || r.title} (${r.campaign_type}${pattern && pattern !== "unclassified" ? `, ${pattern}` : ""}): ${bits}`;
  });
  return [
    "SHIPPED REGISTER ANCHOR (rotating sample of real sends, chosen for relevance to this brief and deliberately varied in construction). This REPLACES the 11-row canonical table for this send: match the register and confidence of these lines, and do not treat any fixed list as the ceiling of what the voice can do.",
    ...lines,
    "These are register evidence, NOT templates. Reusing one of these constructions with new words is the failure mode this block exists to prevent — see the constructions-in-use list.",
  ].join("\n");
}
