// L4 INJECT — assemble the learning blocks for one generation.
// Spec: docs/RECURSIVE_LEARNING_FRAMEWORK_SPEC.md §2.4 (L4), §2.6.
//
// The single seam every generation route calls, so /api/generate,
// /api/sms-generate and /api/flows/generate cannot drift apart in what the model
// is shown. Server-only (it reads stores); the block builders themselves are pure
// and live in ./blocks.
//
// FAIL OPEN IS THE CONTRACT. Every block is independently allowed to be empty, and
// this function never throws: if the corpus store is unreachable, generation runs
// with no blocks and slightly worse output, which is the correct trade (§2.7).

import type { LearningBlocks } from "../prompts/generate";
import { computeFormBudget, formBudgetBlock, inFlightBlock, referenceBlock, selectReferenceSample } from "./blocks";
import type { ReferenceBrief } from "./blocks";
import { corpusForGeneration } from "./ingest";
import { nextRotation, readLedger } from "./store";
import { CORPUS_FLOOR, attractionSet } from "./types";
import { resolvePerformanceRecords, ymdDaysAgo } from "../performance-records";
import { buildPerformanceGuidance, LOOKBACK_DAYS } from "../performance-memory";
import { suppressedClaimKeys } from "./ledger";

export interface InjectOpts {
  /** The campaign being rewritten — excluded from its own repulsion set. */
  excludeId?: string;
  /** Scopes the performance block to this campaign type when the scoped sample is
   * thick enough to say anything. */
  campaignType?: string;
  channel?: "email" | "sms";
  /** Rotate the reference sample. Defaults to advancing (and persisting) the
   * corpus cursor, which is what makes two consecutive generations of the same
   * brief see different examples. Pass a number to pin it (tests, debugging). */
  rotation?: number;
  /** Skip the rotating reference sample — the flows brain has its own reference
   * handling and no campaign brief to score relevance against. */
  withReference?: boolean;
}

export interface LearningContext extends LearningBlocks {
  /** Campaign id → authority tier, for tier-weighting the LEXICAL avoid block in
   * src/lib/constructions.ts. The corpus is the one place tiering is decided. */
  tiers: Record<string, "shipped" | "approved" | "drafted">;
  /** What the corpus actually had, for logging and the in-app inspector. */
  diagnostics: {
    records: number;
    measured: number;
    floor: number;
    /** True when there is enough measured Tier-A data for attraction to run. */
    attraction_eligible: boolean;
    reference_ids: string[];
    rotation: number;
    /** Dimension values the block asserted, for the ledger to check later. */
    performance_signals: { dimension: string; value: string; n: number }[];
    /** Claims L5 has weakened or retired, and therefore suppressed here. */
    suppressed: string[];
  };
}

const EMPTY: LearningContext = {
  tiers: {},
  diagnostics: {
    records: 0, measured: 0, floor: CORPUS_FLOOR, attraction_eligible: false,
    reference_ids: [], rotation: 0, performance_signals: [], suppressed: [],
  },
};

export async function buildLearningBlocks(
  brief: ReferenceBrief,
  opts: InjectOpts = {},
): Promise<LearningContext> {
  try {
    const corpus = await corpusForGeneration();
    if (!corpus.records.length) return EMPTY;

    const rotation = opts.rotation ?? (await nextRotation());
    const budget = computeFormBudget(corpus.records);
    const sample = opts.withReference === false
      ? []
      : selectReferenceSample(corpus.records, brief, { rotation, excludeId: opts.excludeId });
    const measured = attractionSet(corpus.records).length;

    // THE CORPUS FLOOR (§2.7). Below ~15 measured Tier-A records the performance
    // block stays off entirely and only the repulsion side runs. Repulsion is
    // useful from record one; attraction is not, and a confident-sounding claim
    // built on four sends is worse than silence because nobody can see it is thin.
    const attractionEligible = measured >= CORPUS_FLOOR;
    let performance: string | undefined;
    let signals: { dimension: string; value: string; n: number }[] = [];
    let suppressed: string[] = [];
    if (attractionEligible) {
      // Suppression comes from L5: an association that stopped replicating stops
      // being asserted, without a human having to notice.
      const ledger = await readLedger().catch(() => null);
      const suppressedKeys = ledger ? suppressedClaimKeys(ledger) : new Set<string>();
      suppressed = [...suppressedKeys];
      const records = await resolvePerformanceRecords({ start: ymdDaysAgo(LOOKBACK_DAYS) });
      const guidance = buildPerformanceGuidance(records, {
        campaignType: opts.campaignType,
        channelLabel: opts.channel ?? "email",
        suppressed: suppressedKeys,
      });
      performance = guidance.block || undefined;
      signals = guidance.signals.map((s) => ({ dimension: s.dimension, value: s.value, n: s.n }));
    }

    return {
      tiers: Object.fromEntries(corpus.records.map((r) => [r.id, r.tier])),
      reference: referenceBlock(sample) || undefined,
      formBudget: formBudgetBlock(budget) || undefined,
      inFlight: inFlightBlock(corpus.records, { excludeId: opts.excludeId }) || undefined,
      performance,
      diagnostics: {
        records: corpus.records.length,
        measured,
        floor: CORPUS_FLOOR,
        attraction_eligible: attractionEligible,
        reference_ids: sample.map((r) => r.id),
        rotation,
        performance_signals: signals,
        suppressed,
      },
    };
  } catch (e) {
    console.warn(`[corpus] learning blocks skipped: ${e instanceof Error ? e.message : String(e)}`);
    return EMPTY;
  }
}
