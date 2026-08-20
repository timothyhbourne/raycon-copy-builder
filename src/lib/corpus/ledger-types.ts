// L5 EVALUATE — the guidance ledger's types.
// Spec: docs/RECURSIVE_LEARNING_FRAMEWORK_SPEC.md §2.4 (L5), §2.7 (Log what the
// system believes), §4.
//
// L5 is what makes the framework recursive rather than merely incremental. Without
// it the system accumulates guidance and never retires any, which is how a
// learning loop turns into a superstition engine. Each evaluation asks: of the
// associations the PERFORMANCE block asserted, which survived contact with the
// next batch of sends?
//
// Pure types — safe to import from client or server.

export type ClaimStatus =
  /** Replicating: eligible for injection into the PERFORMANCE block. */
  | "active"
  /** Failed its last check once. Still recorded, no longer injected. */
  | "weakened"
  /** Failed twice. Dropped, with the drop logged so a human can see what the
   * system stopped believing and when. */
  | "retired";

export type CheckOutcome = "replicated" | "failed" | "insufficient_data";

export interface GuidanceCheck {
  checked_at: string;
  outcome: CheckOutcome;
  /** Sample size in the window this check looked at. */
  n: number;
  pooled_rpr: number | null;
  note?: string;
}

export interface GuidanceClaim {
  /** Stable: `${dimension}:${value}`, so the same association is tracked across
   * evaluations rather than re-asserted as a new belief each week. */
  id: string;
  dimension: string;
  dimension_label: string;
  value: string;
  /** The human-readable assertion, e.g. "urgency-led angles earn the most
   * revenue-per-recipient". Never names or quotes a line of copy (§2.1). */
  claim: string;
  /** Sample size and window the claim was FIRST asserted on. Every claim in the
   * ledger carries its n and its date range (§4). */
  n: number;
  pooled_rpr: number;
  range: { start: string; end: string };
  basis: "platform" | "northbeam";
  status: ClaimStatus;
  first_asserted: string;
  last_checked: string;
  checks: number;
  replications: number;
  failures: number;
  history: GuidanceCheck[];
}

export interface GuidanceLedger {
  claims: GuidanceClaim[];
  evaluated_at: string | null;
}

export const EMPTY_LEDGER: GuidanceLedger = { claims: [], evaluated_at: null };

/** Two consecutive failures retire a claim. One failure only weakens it — a
 * single quiet fortnight is not evidence that an association was never real. */
export const FAILURES_TO_RETIRE = 2;

/** Claims eligible to reach the prompt: replicating, and never a retired or
 * weakened one. */
export function activeClaims(ledger: GuidanceLedger): GuidanceClaim[] {
  return ledger.claims.filter((c) => c.status === "active");
}
