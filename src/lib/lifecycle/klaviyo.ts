import type { LifecycleInput } from "./model";

// Adapter: a Klaviyo profile's predictive_analytics + engagement/created dates +
// interest properties → the scalar LifecycleInput the model consumes (see
// lifecycle_scoring_model_spec.md §3/§4, §8-D). Kept structural (not tied to the
// Klaviyo SDK types) so the model layer stays decoupled and testable. Everything
// is derived relative to a caller-supplied `now`, so scoring is deterministic.
//
// OWNERSHIP is NOT read here: the LuhenE account has no ownership property and an
// empty catalog, so `ownedProductIds` is derived from Placed Order line-items by
// the worker/serving layer and left empty by this adapter. What this adapter DOES
// read from properties is the sparse Audio / Home / PS-Interest signal, which
// represents interest (not ownership) and is used only as a fallback (§8-D).
//
// Phase-1 caveat (§6.3): expected_date_of_next_order is stale for some profiles
// (it drove the false "Ray is 448 days overdue"). The engagement guardrail in the
// model protects against this; Phase 2 (§8-C, approved) replaces `eno` with true
// last-order dates from ingested Placed Order events + a fitted BG/NBD P(alive).

const DAY_MS = 86_400_000;

// Sparse profile properties that flag INTEREST (not ownership). Any that are
// present-and-truthy become fallback interest labels.
export const DEFAULT_INTEREST_KEYS = ["Audio", "Home", "PS - Interest"];

// Only the fields we read — a profile from the Klaviyo Profiles API.
export interface KlaviyoProfileLike {
  attributes?: {
    email?: string | null;
    created?: string | null;
    last_event_date?: string | null;
    properties?: Record<string, unknown> | null;
    predictive_analytics?: {
      historic_number_of_orders?: number | null;
      historic_clv?: number | null;
      predicted_clv?: number | null;
      total_clv?: number | null;
      churn_probability?: number | null;
      expected_date_of_next_order?: string | null;
      average_days_between_orders?: number | null;
    } | null;
  } | null;
}

export interface AdapterOptions {
  /** Interest-property keys to read as fallback signal (default DEFAULT_INTEREST_KEYS). */
  interestKeys?: string[];
}

// Whole days from an ISO timestamp to `now` (positive = in the past). null when
// the timestamp is missing or unparseable.
function daysSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / DAY_MS);
}

function num(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function truthy(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return /^(true|yes|1|y)$/i.test(v.trim());
  return false;
}

/** Fallback interest labels: the interest-property keys that are present-and-truthy. */
export function extractInterests(
  properties: Record<string, unknown> | null | undefined,
  keys: string[] = DEFAULT_INTEREST_KEYS,
): string[] {
  if (!properties) return [];
  return keys.filter((k) => truthy(properties[k]));
}

/**
 * Map a Klaviyo profile to a LifecycleInput. `now` is the reference instant
 * (defaults to Date.now(); pass a fixed value in tests / batch runs). Ownership
 * is left empty here — the serving layer fills `ownedProductIds` from order-
 * derived data before scoring.
 */
export function klaviyoProfileToLifecycleInput(
  profile: KlaviyoProfileLike,
  now: number = Date.now(),
  opts: AdapterOptions = {},
): LifecycleInput {
  const attrs = profile.attributes ?? {};
  const pa = attrs.predictive_analytics ?? {};

  const ageDays = daysSince(attrs.created, now) ?? 0;
  const engagementRecencyDays = daysSince(attrs.last_event_date, now);
  const daysPastExpectedReorder = daysSince(pa.expected_date_of_next_order, now);

  // total_clv is preferred (historic + predicted); fall back to historic.
  const clv = num(pa.total_clv) ?? num(pa.historic_clv);

  return {
    orderCount: num(pa.historic_number_of_orders) ?? 0,
    ageDays,
    engagementRecencyDays,
    clv,
    daysPastExpectedReorder,
    avgDaysBetweenOrders: num(pa.average_days_between_orders),
    churnProbability: num(pa.churn_probability),
    ownedProductIds: [], // filled by the serving layer from order line-items
    interests: extractInterests(attrs.properties, opts.interestKeys),
  };
}
