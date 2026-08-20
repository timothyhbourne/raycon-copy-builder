// L5 EVALUATE — the recursion.
// Spec: docs/RECURSIVE_LEARNING_FRAMEWORK_SPEC.md §2.4 (L5), §2.7, §4.
//
// PURE (the store wrapper lives in ./store, the runner in the /api/learning route).
//
// Without L5 the system accumulates guidance and never retires any, which is how a
// learning loop turns into a superstition engine. Each evaluation asks one question
// of every claim the PERFORMANCE block has been asserting: did it survive contact
// with the next batch of sends?
//
//   replicated        → the association is still the strongest in its dimension
//   failed            → it is not, any more
//   insufficient_data → the dimension no longer has enough evidence to judge it.
//                       NOT a failure: absence of evidence retires nothing.
//
// One failure weakens a claim (it stops being injected). Two consecutive failures
// retire it, and the retirement is logged with its date so a human can see what the
// system stopped believing and when.

import type { DimensionAgg } from "../copy-performance";
import { MIN_N } from "../copy-performance";
import { topPerDimension } from "../performance-memory";
import type { GuidanceClaim, GuidanceCheck, GuidanceLedger } from "./ledger-types";
import { FAILURES_TO_RETIRE } from "./ledger-types";

/** Stable identity for an association, so the same belief is tracked over time
 * rather than re-asserted as a new one every week. */
export function claimId(dimension: string, value: string): string {
  return `${dimension}:${value}`;
}

/**
 * Claims that must NOT reach the prompt: anything weakened or retired. This is the
 * whole mechanism by which L5 feeds back into L4 — the performance block never has
 * to know why, it just gets a suppression set.
 */
export function suppressedClaimKeys(ledger: GuidanceLedger): Set<string> {
  return new Set(ledger.claims.filter((c) => c.status !== "active").map((c) => c.id));
}

/** The assertion in words. Effect-level only: an angle, a stage, a structural
 * choice — never a construction or a line of copy (§2.1). */
export function claimSentence(dimensionLabel: string, value: string): string {
  return `${value.replace(/_/g, " ")} (${dimensionLabel.toLowerCase()}) has earned the most revenue-per-recipient in its dimension.`;
}

/** The dimensions the ledger tracks: the same effect-level set the prompt block
 * draws on. */
const TRACKED_DIMS = ["angle", "conceit_architecture", "includes_reviews", "send_stage", "campaign_type"];

export interface EvaluateOpts {
  /** ISO timestamp for this evaluation. Passed in, never read from the clock, so
   * the function stays pure and testable. */
  now: string;
  /** The window the aggregates were computed over. */
  range: { start: string; end: string };
  basis: "platform" | "northbeam";
  minN?: number;
}

/**
 * Re-check every claim against fresh aggregates, then assert whatever is newly
 * well-evidenced. Returns a NEW ledger; never mutates the input.
 */
export function evaluateLedger(
  previous: GuidanceLedger,
  aggregates: DimensionAgg[],
  opts: EvaluateOpts,
): GuidanceLedger {
  const minN = opts.minN ?? MIN_N;
  const current = topPerDimension(aggregates, TRACKED_DIMS, minN);
  const currentById = new Map(current.map((s) => [claimId(s.dimension, s.value), s]));
  const byDimension = new Map(aggregates.map((a) => [a.dimension, a]));

  const claims: GuidanceClaim[] = previous.claims.map((claim) => {
    const agg = byDimension.get(claim.dimension);
    const bucket = agg?.values.find((v) => v.value === claim.value);

    // Can we even judge it? A dimension that lost its spread, or a value that fell
    // below minN, is unjudgeable — which is different from wrong.
    if (!agg || !agg.spread.eligible || !bucket || bucket.n < minN) {
      const check: GuidanceCheck = {
        checked_at: opts.now,
        outcome: "insufficient_data",
        n: bucket?.n ?? 0,
        pooled_rpr: bucket?.pooled_rpr ?? null,
        note: !agg
          ? "dimension absent from this window"
          : !agg.spread.eligible
            ? "within-group scatter now exceeds the between-group gap"
            : "sample fell below the minimum",
      };
      return {
        ...claim,
        last_checked: opts.now,
        checks: claim.checks + 1,
        history: [...claim.history, check],
      };
    }

    const stillTop = currentById.has(claim.id);
    const check: GuidanceCheck = {
      checked_at: opts.now,
      outcome: stillTop ? "replicated" : "failed",
      n: bucket.n,
      pooled_rpr: bucket.pooled_rpr,
      ...(stillTop ? {} : { note: `no longer the strongest value in ${claim.dimension}` }),
    };

    if (stillTop) {
      // A revived claim is honest: if an association is well-evidenced again, saying
      // so beats blacklisting it forever because of an old quiet spell. The revival
      // is in the history either way.
      return {
        ...claim,
        status: "active",
        failures: 0,
        replications: claim.replications + 1,
        checks: claim.checks + 1,
        last_checked: opts.now,
        n: bucket.n,
        pooled_rpr: bucket.pooled_rpr,
        range: opts.range,
        history: [...claim.history, check],
      };
    }

    const failures = claim.failures + 1;
    return {
      ...claim,
      status: failures >= FAILURES_TO_RETIRE ? "retired" : "weakened",
      failures,
      checks: claim.checks + 1,
      last_checked: opts.now,
      history: [...claim.history, check],
    };
  });

  // Newly well-evidenced associations.
  const known = new Set(claims.map((c) => c.id));
  for (const signal of current) {
    const id = claimId(signal.dimension, signal.value);
    if (known.has(id)) continue;
    claims.push({
      id,
      dimension: signal.dimension,
      dimension_label: signal.dimLabel,
      value: signal.value,
      claim: claimSentence(signal.dimLabel, signal.value),
      n: signal.n,
      pooled_rpr: signal.rpr,
      range: opts.range,
      basis: opts.basis,
      status: "active",
      first_asserted: opts.now,
      last_checked: opts.now,
      checks: 1,
      replications: 1,
      failures: 0,
      history: [{ checked_at: opts.now, outcome: "replicated", n: signal.n, pooled_rpr: signal.rpr, note: "first asserted" }],
    });
  }

  return { claims, evaluated_at: opts.now };
}
