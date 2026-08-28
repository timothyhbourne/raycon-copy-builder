import type { GeneratedCampaign, GeneratedSection } from "./schemas";

// Naming a campaign that was never named (spec: CAMPAIGN_NAMING_FIX_SPEC.md §3a).
//
// A campaign saved from a blank canvas with no name landed in the library as a
// blank row: `title: briefInput.campaign_name` with no fallback, rendered raw. Two
// of them were indistinguishable, and the rename control — which worked — was an
// empty underline with no placeholder, so it could not be found.
//
// The fix that matters is not the placeholder, it is never creating the unnamed
// entry in the first place. By the time a campaign is finalised the copy itself
// says what it is, so derive the name from that rather than asking again.
//
// Pure: no I/O, no clock except the date the caller passes.

/** Roughly a header's worth. Long enough to be recognisable in a list, short
 * enough not to wrap a browse card to three lines. */
export const MAX_DERIVED_NAME = 60;

/** The headline a section actually SHOWS. `elements.Headline` mirrors the chosen
 * slate candidate, but prefer the explicit slate metadata when present so a
 * derived name can never come from one of the candidates the writer rejected. */
function shownHeadline(section: GeneratedSection): string {
  if (section.headline_variants?.length) {
    const pick = section.headline_variants[section.headline_selected ?? 0] ?? section.headline_variants[0];
    if (pick?.text?.trim()) return pick.text.trim();
  }
  const raw = (section.elements as Record<string, unknown>)?.Headline;
  return typeof raw === "string" ? raw.trim() : "";
}

/** Collapse whitespace and trim to the cap on a word boundary where possible. */
export function tidyName(s: string, max = MAX_DERIVED_NAME): string {
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  // Only break on a word if that leaves something substantial; otherwise hard-cut.
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

/**
 * A name for a campaign whose writer never gave it one.
 *
 * Order matters: the Headline is what a reader sees first and what the writer
 * spent the most on, so it identifies the campaign better than anything else on
 * the canvas. The first subject line is the next best answer. The dated fallback
 * exists so this function ALWAYS returns something usable — a blank library row is
 * the bug, and returning "" here would just move it.
 */
export function deriveCampaignName(
  campaign: GeneratedCampaign | null | undefined,
  todayYMD: string,
): string {
  for (const section of campaign?.sections ?? []) {
    const headline = shownHeadline(section);
    if (headline) return tidyName(headline);
  }
  const subject = campaign?.meta?.subject_lines?.find((s) => s?.trim());
  if (subject) return tidyName(subject);
  return `Untitled — ${todayYMD}`;
}

/**
 * The name to persist. Returns the writer's own name untouched whenever they gave
 * one — deriving over a real name would be the opposite of helpful.
 */
export function resolveCampaignName(
  name: string | null | undefined,
  campaign: GeneratedCampaign | null | undefined,
  todayYMD: string,
): string {
  const given = (name ?? "").trim();
  return given || deriveCampaignName(campaign, todayYMD);
}

/** Display text for a possibly-empty title. The library browser shows this in
 * muted italic so a fallback never reads as a real name. */
export const UNTITLED_LABEL = "Untitled campaign";

export function displayTitle(title: string | null | undefined): { text: string; isFallback: boolean } {
  const t = (title ?? "").trim();
  return t ? { text: t, isFallback: false } : { text: UNTITLED_LABEL, isFallback: true };
}
