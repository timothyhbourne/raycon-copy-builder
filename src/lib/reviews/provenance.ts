import type { GeneratedCampaign, GeneratedSection, ReviewProvenance, SectionElements } from "../schemas";
import { isReviewElement } from "../element-families";

// Provenance: the control that replaces "the model shouldn't invent reviews" (an
// instruction it can ignore) with "a review element without provenance cannot
// ship" (a check). Spec: docs/REVIEWS_MODULE_SPEC.md §5.
//
// PURE — no fs, no network — so the generate route, the rewrite routes, the
// hard-rules gate and the canvas all apply exactly the same rule.
//
// The asymmetry that makes this work: a fetch, a manual paste and the curated cache
// all CREATE a provenance record. Nothing the model writes has one. So "text with
// no matching record" is precisely "text the model made up", with no need to detect
// anything about the writing itself.

/** Compare review text the way a human would: whitespace, curly quotes and dashes
 * are not differences in what the customer said. Attribution suffixes are kept, so
 * swapping the name still counts as a change. */
export function normalizeReviewText(text: string): string {
  return (text || "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** A review as supplied by a verified source, ready to be matched against whatever
 * comes back from the model. */
export interface VerifiedReview {
  text: string;
  provenance: ReviewProvenance;
}

/** Index verified reviews by normalised text. The lookup the strip below uses. */
export function verifiedIndex(reviews: VerifiedReview[]): Map<string, ReviewProvenance> {
  const map = new Map<string, ReviewProvenance>();
  for (const r of reviews) {
    const key = normalizeReviewText(r.text);
    if (key) map.set(key, r.provenance);
  }
  return map;
}

/**
 * Text that already carries provenance on a section — used when REWRITING, where
 * the reviews that were already on the canvas are the verified set. A rewrite may
 * keep them verbatim and may not produce anything else.
 */
export function verifiedFromSection(section: Pick<GeneratedSection, "elements" | "review_provenance">): VerifiedReview[] {
  const out: VerifiedReview[] = [];
  for (const [key, prov] of Object.entries(section.review_provenance ?? {})) {
    if (prov.origin === "unverified") continue;
    const value = section.elements?.[key];
    if (typeof value === "string" && value.trim()) out.push({ text: value, provenance: prov });
  }
  return out;
}

export interface StripResult {
  elements: SectionElements;
  /** Provenance for the review elements that survived, keyed by element name. */
  review_provenance: Record<string, ReviewProvenance>;
  /** Element names whose text was discarded because nothing verified it. */
  stripped: string[];
}

/**
 * THE server-side control. Any Review element whose text does not match a verified
 * review is emptied, and the slot comes back blank.
 *
 * An instruction the model can ignore is not a control; deleting the field is. This
 * runs after generation and after every section rewrite, so the fabrication path is
 * closed even when the prompt is ignored, mis-scoped, or edited later by someone who
 * doesn't know about this rule.
 */
export function stripUnprovenancedReviews(
  elements: SectionElements,
  verified: Map<string, ReviewProvenance>,
): StripResult {
  const out: SectionElements = {};
  const provenance: Record<string, ReviewProvenance> = {};
  const stripped: string[] = [];

  for (const [key, value] of Object.entries(elements ?? {})) {
    if (!isReviewElement(key) || typeof value !== "string") {
      out[key] = value;
      continue;
    }
    const text = value.trim();
    if (!text) { out[key] = ""; continue; }
    const match = verified.get(normalizeReviewText(text));
    if (match) {
      out[key] = text;
      provenance[key] = match;
    } else {
      // Model-written: the slot is returned EMPTY rather than carrying an
      // unattributable claim about a real customer.
      out[key] = "";
      stripped.push(key);
    }
  }
  return { elements: out, review_provenance: provenance, stripped };
}

/** One unverified review on the canvas. */
export interface UnverifiedReview {
  section_id: string;
  section_type: string;
  element: string;
  text: string;
  /** True when a provenance record exists but says "unverified" (as opposed to no
   * record at all). Same outcome; the distinction is only for the message. */
  flagged: boolean;
}

/**
 * Every non-empty Review element on the canvas that nothing verified. This is what
 * blocks Save Final: unlike the rest of the hard-rules report, which is craft
 * advice, an unattributed review is a factual claim about a customer who may not
 * exist, and shipping it is worse than being interrupted.
 */
export function unverifiedReviews(campaign: GeneratedCampaign | null | undefined): UnverifiedReview[] {
  const out: UnverifiedReview[] = [];
  for (const section of campaign?.sections ?? []) {
    for (const [key, value] of Object.entries(section.elements ?? {})) {
      if (!isReviewElement(key) || typeof value !== "string") continue;
      const text = value.trim();
      if (!text) continue;
      const prov = section.review_provenance?.[key];
      if (prov && prov.origin !== "unverified") continue;
      out.push({
        section_id: section.id,
        section_type: section.type,
        element: key,
        text,
        flagged: prov?.origin === "unverified",
      });
    }
  }
  return out;
}

/** A one-line summary for the blocking message, naming the offending slots. */
export function describeUnverified(list: UnverifiedReview[]): string {
  if (!list.length) return "";
  const names = list.map((u) => `${u.section_type.replace(/_/g, " ")} → ${u.element}`);
  const shown = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${shown} (+${names.length - 3} more)` : shown;
}

/**
 * Legacy migration. A campaign saved before provenance existed has real reviews and
 * no records — stamping those "unverified" would retroactively block every saved
 * campaign, so they migrate to `curated`: they came from the curated cache or a
 * writer, which is exactly what that origin means.
 *
 * Applied at the READ boundary (draft / library load), never to fresh generations —
 * a section that has a provenance map is left alone, so a genuinely stripped slot
 * can't be laundered into "curated" by a reload.
 */
export function migrateLegacyProvenance(campaign: GeneratedCampaign): GeneratedCampaign {
  let changed = false;
  const sections = campaign.sections.map((section) => {
    if (section.review_provenance) return section;
    const provenance: Record<string, ReviewProvenance> = {};
    for (const [key, value] of Object.entries(section.elements ?? {})) {
      if (!isReviewElement(key) || typeof value !== "string" || !value.trim()) continue;
      provenance[key] = { origin: "curated" };
    }
    if (!Object.keys(provenance).length) return section;
    changed = true;
    return { ...section, review_provenance: provenance };
  });
  return changed ? { ...campaign, sections } : campaign;
}

/**
 * Apply the strip to ONE line of the generation stream, on its way to the client.
 *
 * The generate route streams the model's JSONL through untouched, so this is where
 * a fabricated review is caught on that path: a section line comes in, its Review
 * elements are checked against what the server actually resolved, and the line goes
 * out with the fakes emptied and the survivors' provenance attached.
 *
 * Deliberately total: a partial, malformed or non-section line is returned
 * unchanged (the client's parser already tolerates those), so the guard can never
 * be the reason a generation fails.
 */
export function guardReviewLine(line: string, verified: Map<string, ReviewProvenance>): {
  line: string;
  stripped: string[];
} {
  if (!line.startsWith("{") || !line.includes('"elements"')) return { line, stripped: [] };
  try {
    const parsed = JSON.parse(line) as { type?: string; elements?: Record<string, unknown> };
    if (!parsed?.type || !parsed.elements) return { line, stripped: [] };
    const hasReview = Object.keys(parsed.elements).some((k) => isReviewElement(k));
    if (!hasReview) return { line, stripped: [] };
    const result = stripUnprovenancedReviews(parsed.elements as SectionElements, verified);
    return {
      // Provenance follows the TEXT, not the slot: if the model put slot 2's review
      // in slot 1, it still matches and still carries its own record.
      line: JSON.stringify({ ...parsed, elements: result.elements, review_provenance: result.review_provenance }),
      stripped: result.stripped,
    };
  } catch {
    return { line, stripped: [] };
  }
}
