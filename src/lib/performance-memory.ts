import { aggregate, MIN_N, type PerformanceRecord, type DimensionAgg, type RevenueBasis } from "./copy-performance";

// The "learning loop" block (spec: LEARNING_LOOP_SPEC §3). PURE — no fs/network
// (it receives resolved records, mirroring copy-performance.ts). Turns measured
// performance into a short, low-authority nudge for the generator, built ONLY
// from well-evidenced signal (n >= MIN_N). It states associations, never causes,
// never dollar figures, and explicitly yields to brand rules, the user's
// instructions, and the anti-repetition/variety guidance.

/** Below this many attributed sends there's nothing trustworthy to say. */
export const MIN_ATTRIBUTED_SENDS = 5;
/** Guidance reflects current reality, not ancient sends. */
export const LOOKBACK_DAYS = 180;
const MAX_WORDS = 150;

// The copy dimensions we surface as guidance. campaign_type is only meaningful
// account-wide (when scoping BY campaign_type it's constant), so it's dropped in
// scoped mode.
const KEY_DIMS_ACCOUNT = ["angle", "conceit_architecture", "includes_reviews", "send_stage", "campaign_type"];
const KEY_DIMS_SCOPED = ["angle", "conceit_architecture", "includes_reviews", "send_stage"];

function basisRpr(r: PerformanceRecord, basis: RevenueBasis): number | null {
  return basis === "platform" ? r.rpr : r.northbeam_rpr;
}

interface Signal { dimLabel: string; value: string; n: number; rpr: number }

/** Per key dimension, its best (or worst) value with n >= minN. */
function topPerDimension(aggs: DimensionAgg[], keys: string[], minN: number): Signal[] {
  const out: Signal[] = [];
  for (const agg of aggs) {
    if (!keys.includes(agg.dimension)) continue;
    const eligible = agg.values.filter((v) => v.n >= minN);
    if (!eligible.length) continue;
    const best = eligible[0]; // aggregate() already sorts values by mean_rpr desc
    out.push({ dimLabel: agg.label, value: best.value, n: best.n, rpr: best.mean_rpr });
  }
  return out.sort((a, b) => b.rpr - a.rpr);
}
function weakPerDimension(aggs: DimensionAgg[], keys: string[], minN: number): Signal[] {
  const out: Signal[] = [];
  for (const agg of aggs) {
    if (!keys.includes(agg.dimension)) continue;
    const eligible = agg.values.filter((v) => v.n >= minN);
    if (eligible.length < 2) continue; // need a spread to call one "weaker"
    const worst = eligible[eligible.length - 1];
    const best = eligible[0];
    if (worst.mean_rpr < best.mean_rpr) out.push({ dimLabel: agg.label, value: worst.value, n: worst.n, rpr: worst.mean_rpr });
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
}

/**
 * Build the performance block. Returns "" when there isn't enough trustworthy
 * signal (fail-open: generation proceeds with no block). Never contains dollar
 * figures; sample sizes are stated; scope is labeled.
 */
export function buildPerformanceBlock(records: PerformanceRecord[], opts: PerformanceBlockOpts = {}): string {
  const basis = opts.basis ?? "platform";
  const minN = opts.minN ?? MIN_N;

  // Attributed sends that carry the chosen revenue basis.
  const attributed = records.filter((r) => r.attribution_source !== "unattributed" && basisRpr(r, basis) != null);
  if (attributed.length < MIN_ATTRIBUTED_SENDS) return "";

  // Prefer type-scoped guidance; fall back to account-wide when the scoped
  // sample is too thin to say anything at n >= minN.
  const scopedRecords = opts.campaignType
    ? attributed.filter((r) => r.attributes.campaign_type === opts.campaignType)
    : [];
  const scopedAggs = aggregate(scopedRecords, basis, minN).aggregates;
  const scopedTop = topPerDimension(scopedAggs, KEY_DIMS_SCOPED, minN);

  const useScoped = opts.campaignType != null && scopedTop.length > 0;
  const scopeRecords = useScoped ? scopedRecords : attributed;
  const keys = useScoped ? KEY_DIMS_SCOPED : KEY_DIMS_ACCOUNT;
  const aggs = useScoped ? scopedAggs : aggregate(attributed, basis, minN).aggregates;

  const lean = topPerDimension(aggs, keys, minN).slice(0, 3);
  if (!lean.length) return ""; // nothing at n >= minN → nothing worth saying

  const weak = weakPerDimension(aggs, keys, minN)
    .filter((w) => !lean.some((l) => l.dimLabel === w.dimLabel && l.value === w.value))
    .slice(0, 2);

  // 1–2 revenue-proven reference campaigns (concrete examples, not aggregate
  // claims — individual sends are allowed below MIN_N).
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

  const header = `PERFORMANCE CONTEXT — what has earned the most revenue-per-recipient on this account (${scopeLabel}; ${n} attributed ${opts.channelLabel ?? "email"} sends in the last ${LOOKBACK_DAYS} days). This is CONTEXT, not a command: it ranks below the brand rules and the user's instructions above, describes association (not cause), and must never be quoted into the email as a claim.`;
  const leanLine = `Lean toward (strongest here): ${lean.map(fmt).join("; ")}.`;
  const weakLine = weak.length ? `Has underperformed here (not banned — just weaker): ${weak.map(fmt).join("; ")}.` : null;
  const refsLine = refs.length ? `Revenue-proven references worth studying: ${refs.join(", ")}.` : null;
  const guardLine = `Do NOT let this flatten variety — the anti-repetition guidance still governs. If this conflicts with the "avoid repeating" guidance, follow variety, not optimization.`;

  // Assemble, then enforce the word cap by dropping the lowest-value optional
  // lines first (references, then the weaker signal). Header, lean signal, and
  // the variety guardrail are never dropped.
  const assemble = (withRefs: boolean, withWeak: boolean) =>
    [header, leanLine, withWeak ? weakLine : null, withRefs ? refsLine : null, guardLine].filter(Boolean).join("\n");

  let block = assemble(true, true);
  if (wordCount(block) > MAX_WORDS) block = assemble(false, true);
  if (wordCount(block) > MAX_WORDS) block = assemble(false, false);
  return block;
}
