import type { AudienceRef } from "./planner-types";

// Comparing the BRIEF against what was BUILT (spec: PLANNER_AUDIENCE_BRIEF_SPEC
// §5.3). This is the reason the two fields are separate at all.
//
// A handover workflow's main failure mode is a campaign built against the wrong
// audience, and today that is invisible: the sync overwrites the intent with the
// reality and shows one set of chips, so nobody can tell the difference. Catching
// it before send is worth more than the picker.
//
// Pure and exhaustively tested — a wrong "matches the brief" is worse than no
// check at all, because it would be believed.

export type AudienceMatchVerdict = "match" | "differs" | "unknown";

export interface AudienceDiff {
  verdict: AudienceMatchVerdict;
  /** In the brief's include list but not built. */
  missing_included: AudienceRef[];
  /** Built but not asked for. */
  extra_included: AudienceRef[];
  /** In the brief's exclude list but not excluded in Klaviyo. The dangerous one:
   * a missed exclusion means someone got an email they were meant not to. */
  missing_excluded: AudienceRef[];
  /** Excluded in Klaviyo but not in the brief. */
  extra_excluded: AudienceRef[];
  /** One sentence naming the difference precisely, or "" when they match. */
  summary: string;
}

export interface AudienceSets {
  included: AudienceRef[];
  excluded: AudienceRef[];
}

/**
 * Identity for comparison. Klaviyo ids are the real basis — `AudienceRef` already
 * carries them, which is what makes this possible — but a legacy hand-typed entry
 * has `id: ""`, so those fall back to a normalised name. Without that fallback an
 * old row would report every audience as both missing and extra.
 */
export function audienceKey(a: AudienceRef): string {
  const id = (a.id ?? "").trim();
  if (id) return `id:${id}`;
  return `name:${(a.name ?? "").trim().toLowerCase()}`;
}

function difference(a: AudienceRef[], b: AudienceRef[]): AudienceRef[] {
  const bKeys = new Set(b.map(audienceKey));
  const seen = new Set<string>();
  const out: AudienceRef[] = [];
  for (const item of a) {
    const k = audienceKey(item);
    if (bKeys.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

const names = (list: AudienceRef[]): string =>
  list.map((a) => a.name?.trim() || a.id || "(unnamed)").join(", ");

/**
 * Compare a brief against what Klaviyo says was built.
 *
 * `unknown` when there is nothing to compare — no campaign linked yet, or no brief
 * written. It deliberately does NOT report "match" for two empty sets: silence
 * about an unwritten brief would read as approval of it.
 */
export function compareAudiences(
  planned: AudienceSets | null | undefined,
  actual: AudienceSets | null | undefined,
): AudienceDiff {
  const empty: AudienceDiff = {
    verdict: "unknown",
    missing_included: [], extra_included: [], missing_excluded: [], extra_excluded: [],
    summary: "",
  };
  if (!planned || !actual) return empty;

  const plannedIn = planned.included ?? [];
  const plannedEx = planned.excluded ?? [];
  const actualIn = actual.included ?? [];
  const actualEx = actual.excluded ?? [];

  // Nothing on either side of the include lists → there is no comparison to make.
  if (!plannedIn.length && !actualIn.length && !plannedEx.length && !actualEx.length) return empty;
  if (!plannedIn.length && !plannedEx.length) return empty;   // no brief to check against

  const diff: AudienceDiff = {
    verdict: "match",
    missing_included: difference(plannedIn, actualIn),
    extra_included: difference(actualIn, plannedIn),
    missing_excluded: difference(plannedEx, actualEx),
    extra_excluded: difference(actualEx, plannedEx),
    summary: "",
  };

  const parts: string[] = [];
  // Ordered by how much each one matters: a missed exclusion mails people who were
  // meant to be left out, so it leads.
  if (diff.missing_excluded.length) parts.push(`missing exclusion: ${names(diff.missing_excluded)}`);
  if (diff.missing_included.length) parts.push(`brief asked for ${names(diff.missing_included)}, not built`);
  if (diff.extra_included.length) parts.push(`built with ${names(diff.extra_included)}, not in the brief`);
  if (diff.extra_excluded.length) parts.push(`also excluded ${names(diff.extra_excluded)}`);

  if (parts.length) {
    diff.verdict = "differs";
    diff.summary = `${parts.join("; ")}.`;
  }
  return diff;
}
