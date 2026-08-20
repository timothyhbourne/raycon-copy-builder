// Form-level repetition scan (§2.3). The counterpart to the lexical scan in
// src/lib/constructions.ts: keep both, run both, either can flag.
//
//   lexical  catches "Summer Just Got Louder" vs "Fall Just Got Louder"
//   form     catches "Motion Never Stops" vs "Sound Never Quits"
//
// The scan itself is PURE (records in, matches out). Only scanCorpusForms() reads
// the store.

import { signatureSimilarity, formSignature, describeSignature, FORM_SIMILARITY_THRESHOLD } from "./signature";
import type { ElementKind } from "./signature";
import type { CorpusRecord, CorpusTier } from "./types";
import { TIER_LABELS } from "./types";
import { corpusForGeneration } from "./ingest";

/** Which element kinds are checked against which. A tagline is only repetitive
 * against another tagline; a headline against another headline. */
export interface FormCheckElement {
  id: string;
  kind: ElementKind;
  text: string;
  product?: string;
}

export interface FormMatch {
  id: string;
  match_text: string;
  match_campaign_title: string;
  match_date: string;
  score: number;
  /** Why it flagged, so the UI can say "same construction" rather than implying
   * the words are shared. */
  reason: "form";
  /** The shared construction, in words a human can act on. */
  construction: string;
  tier: CorpusTier;
}

/**
 * Tier weighting (§2.2). Drafted copy was written in the app and possibly
 * rejected and abandoned; it still repels, but it should not carry the same
 * authority as copy that went to 400,000 people. Scaling the score is how "at
 * reduced weight" is expressed against a fixed threshold.
 */
const TIER_WEIGHT: Record<CorpusTier, number> = {
  shipped: 1,
  approved: 1,
  drafted: 0.85,
};

export function scanForms(
  elements: FormCheckElement[],
  records: CorpusRecord[],
  opts: { excludeId?: string; threshold?: number } = {},
): FormMatch[] {
  const threshold = opts.threshold ?? FORM_SIMILARITY_THRESHOLD;
  const pool = records.filter((r) => r.id !== opts.excludeId);
  if (!pool.length) return [];

  const out: FormMatch[] = [];
  for (const element of elements) {
    const text = (element.text || "").trim();
    if (!text) continue;
    const sig = formSignature(text);
    if (!sig.template) continue;

    let best: FormMatch | null = null;
    for (const record of pool) {
      const date = (record.sent_at ?? record.approved_at ?? "").slice(0, 10);
      for (const candidate of record.elements) {
        if (candidate.kind !== element.kind) continue;
        // A near-verbatim repeat is the lexical checker's job; flagging it here as
        // well would double-report the same problem.
        if (candidate.text.trim().toLowerCase() === text.toLowerCase()) continue;
        const score = signatureSimilarity(sig, candidate.signature) * TIER_WEIGHT[record.tier];
        if (score < threshold) continue;
        if (best && score <= best.score) continue;
        best = {
          id: element.id,
          match_text: candidate.text,
          match_campaign_title: `${record.title} (${TIER_LABELS[record.tier]})`,
          match_date: date,
          score,
          reason: "form",
          construction: describeSignature(candidate.signature),
          tier: record.tier,
        };
      }
    }
    if (best) out.push(best);
  }
  return out;
}

/** Store-reading wrapper used by /api/check-repetition. Fails open. */
export async function scanCorpusForms(
  elements: FormCheckElement[],
  excludeId?: string,
): Promise<FormMatch[]> {
  try {
    const corpus = await corpusForGeneration();
    return scanForms(elements, corpus.records, { excludeId });
  } catch (e) {
    console.warn(`[corpus] form scan skipped: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}
