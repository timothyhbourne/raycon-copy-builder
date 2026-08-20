import { aggregate, MIN_N, type PerformanceRecord, type DimensionAgg, type RevenueBasis } from "./copy-performance";

// The ATTRACTION half of the recursive learning framework — the PERFORMANCE block
// (docs/RECURSIVE_LEARNING_FRAMEWORK_SPEC.md §2.1, §2.6.4, §2.7).
//
// PURE — no fs/network (it receives resolved records, mirroring copy-performance.ts).
// Turns measured performance into a short, low-authority nudge for the generator,
// built ONLY from well-evidenced signal. It states associations, never causes,
// never dollar figures, and explicitly yields to brand rules, the user's
// instructions, and the anti-repetition guidance.
//
// THE RULE THIS FILE MUST NEVER BREAK (§2.1):
//
//   Performance guidance may name angles, stages, structural choices and offer
//   framing. It may NEVER name or quote a specific headline, tagline, subject line
//   or phrasing as a thing to emulate.
//
// Attraction operates on EFFECT; repulsion operates on FORM. The moment this block
// learns "idiom-remix headlines earn more" and starts asking for idiom remixes, it
// is manufacturing the staleness the framework exists to remove. Construction lives
// on the repulsion side (src/lib/corpus/blocks.ts), always, no matter how well it
// performed. The only copy-identifying string permitted below is a campaign NAME,
// which is a label for a send, not a line to copy.
//
// Three guards, all of which must hold before a word of this reaches a prompt:
//   1. MIN_ATTRIBUTED_SENDS — enough measured sends to say anything at all.
//   2. n >= minN per dimension value — enough sends behind each claim.
//   3. spread.eligible — the between-group difference beats the within-group
//      scatter, so the ranking is not noise (copy-performance.ts DimensionSpread).

/** Below this many attributed sends there's nothing trustworthy to say. */
export const MIN_ATTRIBUTED_SENDS = 5;
/** Guidance reflects current reality, not ancient sends. */
export const LOOKBACK_DAYS = 180;
const MAX_WORDS = 170;

// The copy dimensions we surface as guidance. Every one of them is an EFFECT-level
// or structural choice — never a construction. campaign_type is only meaningful
// account-wide (when scoping BY campaign_type it's constant), so it's dropped in
// scoped mode.
const KEY_DIMS_ACCOUNT = ["angle", "conceit_architecture", "includes_reviews", "send_stage", "campaign_type"];
const KEY_DIMS_SCOPED = ["angle", "conceit_architecture", "includes_reviews", "send_stage"];

function basisRpr(r: PerformanceRecord, basis: RevenueBasis): number | null {
  return basis === "platform" ? r.rpr : r.northbeam_rpr;
}

export interface Signal {
  dimension: string;
  dimLabel: string;
  value: string;
  n: number;
  /** Recipient-weighted pooled RPR. Never rendered into the prompt — it decides
   * ordering, and it is what the guidance ledger records. */
  rpr: number;
}

/** Dimensions whose ranking survived the dispersion test. */
function eligibleAggs(aggs: DimensionAgg[], keys: string[]): DimensionAgg[] {
  return aggs.filter((agg) => keys.includes(agg.dimension) && agg.spread.eligible);
}

/** Per eligible dimension, its best value at n >= minN. */
export function topPerDimension(aggs: DimensionAgg[], keys: string[], minN: number): Signal[] {
  const out: Signal[] = [];
  for (const agg of eligibleAggs(aggs, keys)) {
    const eligible = agg.values.filter((v) => v.n >= minN);
    if (!eligible.length) continue;
    const best = eligible[0]; // aggregate() sorts values by pooled_rpr desc
    out.push({ dimension: agg.dimension, dimLabel: agg.label, value: best.value, n: best.n, rpr: best.pooled_rpr });
  }
  return out.sort((a, b) => b.rpr - a.rpr);
}

/** Per eligible dimension, its weakest value at n >= minN (needs a spread to call
 * one "weaker"). */
export function weakPerDimension(aggs: DimensionAgg[], keys: string[], minN: number): Signal[] {
  const out: Signal[] = [];
  for (const agg of eligibleAggs(aggs, keys)) {
    const eligible = agg.values.filter((v) => v.n >= minN);
    if (eligible.length < 2) continue;
    const worst = eligible[eligible.length - 1];
    const best = eligible[0];
    if (worst.pooled_rpr < best.pooled_rpr) {
      out.push({ dimension: agg.dimension, dimLabel: agg.label, value: worst.value, n: worst.n, rpr: worst.pooled_rpr });
    }
  }
  return out.sort((a, b) => a.rpr - b.rpr);
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export interface PerformanceBlockOpts {
  basis?: RevenueBasis;
  minN?: number;
  /** For scoping guidance to the brief's own campaign type. */
  campaignType?: string;
  channelLabel?: "email" | "sms";
  /** Claims the guidance ledger has weakened or retired (`${dimension}:${value}`).
   * L5's whole purpose: an association that stopped replicating stops being
   * asserted (§2.4). */
  suppressed?: Set<string>;
}

/** What the block asserted, so L5 can check later whether it held. */
export interface PerformanceGuidance {
  block: string;
  signals: Signal[];
  basis: RevenueBasis;
  scope: string;
  n: number;
}

/**
 * Build the performance guidance. Returns an empty block when there isn't enough
 * trustworthy signal (fail-open: generation proceeds with no block). Never contains
 * dollar figures; sample sizes are stated; scope is labeled.
 */
export function buildPerformanceGuidance(
  records: PerformanceRecord[],
  opts: PerformanceBlockOpts = {},
): PerformanceGuidance {
  const basis = opts.basis ?? "platform";
  const minN = opts.minN ?? MIN_N;
  const empty: PerformanceGuidance = { block: "", signals: [], basis, scope: "", n: 0 };

  // Attributed sends that carry the chosen revenue basis.
  const attributed = records.filter((r) => r.attribution_source !== "unattributed" && basisRpr(r, basis) != null);
  if (attributed.length < MIN_ATTRIBUTED_SENDS) return empty;

  // Prefer type-scoped guidance; fall back to account-wide when the scoped sample
  // is too thin to say anything at n >= minN.
  const scopedRecords = opts.campaignType
    ? attributed.filter((r) => r.attributes.campaign_type === opts.campaignType)
    : [];
  const scopedAggs = aggregate(scopedRecords, basis, minN).aggregates;
  const scopedTop = topPerDimension(scopedAggs, KEY_DIMS_SCOPED, minN);

  const useScoped = opts.campaignType != null && scopedTop.length > 0;
  const scopeRecords = useScoped ? scopedRecords : attributed;
  const keys = useScoped ? KEY_DIMS_SCOPED : KEY_DIMS_ACCOUNT;
  const aggs = useScoped ? scopedAggs : aggregate(attributed, basis, minN).aggregates;

  const suppressed = opts.suppressed ?? new Set<string>();
  const notSuppressed = (s: Signal) => !suppressed.has(`${s.dimension}:${s.value}`);

  const lean = topPerDimension(aggs, keys, minN).filter(notSuppressed).slice(0, 3);
  if (!lean.length) return empty; // nothing eligible → nothing worth saying

  const weak = weakPerDimension(aggs, keys, minN)
    .filter(notSuppressed)
    .filter((w) => !lean.some((l) => l.dimLabel === w.dimLabel && l.value === w.value))
    .slice(0, 2);

  // 1–2 revenue-proven reference campaigns, named by CAMPAIGN NAME and tagged with
  // their angle/architecture. A name is a label for a send; it is not a line of
  // copy, so this stays inside the never-quote-copy rule.
  const refs = [...scopeRecords]
    .filter((r) => r.attributes.angle || r.attributes.conceit_architecture)
    .sort((a, b) => (basisRpr(b, basis) ?? 0) - (basisRpr(a, basis) ?? 0))
    .slice(0, 2)
    .map((r) => {
      const tag = [r.attributes.conceit_architecture, r.attributes.angle].filter(Boolean)[0];
      return `"${r.name}"${tag ? ` (${tag.replace(/_/g, " ")})` : ""}`;
    });

  const scopeLabel = useScoped
    ? `for ${String(opts.campaignType).replace(/_/g, " ")} campaigns`
    : "across all campaign types";
  const n = scopeRecords.length;
  const fmt = (s: Signal) => `${s.value.replace(/_/g, " ")} (${s.dimLabel.toLowerCase()}, across ${s.n} sends)`;

  const header = `PERFORMANCE CONTEXT — what has earned the most revenue-per-recipient on this account (${scopeLabel}; ${n} attributed ${opts.channelLabel ?? "email"} sends in the last ${LOOKBACK_DAYS} days, recipient-weighted). This is CONTEXT, not a command: it ranks below the brand rules and the user's instructions above, describes association (not cause), and must never be quoted into the email as a claim.`;
  const leanLine = `Lean toward (strongest here): ${lean.map(fmt).join("; ")}.`;
  const weakLine = weak.length ? `Has underperformed here (not banned — just weaker): ${weak.map(fmt).join("; ")}.` : null;
  const refsLine = refs.length ? `Revenue-proven references worth studying for their ANGLE and STRUCTURE: ${refs.join(", ")}.` : null;
  const scopeGuard = `These are ANGLES, STAGES and STRUCTURAL choices only. Nothing here says anything about which headline construction, phrasing or wording to use — that is governed entirely by the form budget and the anti-repetition guidance above.`;
  const guardLine = `Do NOT let this flatten variety. If this conflicts with the "avoid repeating" guidance or the form budget, follow variety, not optimization.`;

  // Assemble, then enforce the word cap by dropping the lowest-value optional
  // lines first (references, then the weaker signal). Header, lean signal, and both
  // guardrails are never dropped.
  const assemble = (withRefs: boolean, withWeak: boolean) =>
    [header, leanLine, withWeak ? weakLine : null, withRefs ? refsLine : null, scopeGuard, guardLine]
      .filter(Boolean).join("\n");

  let block = assemble(true, true);
  if (wordCount(block) > MAX_WORDS) block = assemble(false, true);
  if (wordCount(block) > MAX_WORDS) block = assemble(false, false);
  return { block, signals: lean, basis, scope: scopeLabel, n };
}

/** Convenience for callers that only want the prompt text. */
export function buildPerformanceBlock(records: PerformanceRecord[], opts: PerformanceBlockOpts = {}): string {
  return buildPerformanceGuidance(records, opts).block;
}
