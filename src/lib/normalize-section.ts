import type { SectionElements, ProductInGrid, HeadlineVariant } from "./schemas";
import { autoFixMechanical } from "./hard-rules-check";

// Collapse the model's SLATE elements into the plain shapes the rest of the app
// expects, keeping the candidates alongside so the writer can pick.
//
// Two elements are slates (docs/RECURSIVE_LEARNING_FRAMEWORK_SPEC.md §1.3):
//
//   Subheader — an array of 3 option strings.
//   Headline  — an array of 4 objects {pattern, text, tagline?}, one per named
//               headline pattern, each carrying the tagline that pays IT off.
//
// The headline used to be the ONLY high-stakes element with no visible slate: the
// prompt asked for four candidates "internally" and one string came back, so
// nobody could pick and nothing recorded what was considered. The elements that
// produce visible slates produce noticeably more variety than the one that did
// not — and the headline carries the whole hook.
//
// In both cases elements.<key> mirrors the SELECTED candidate, so every
// downstream consumer (canvas, hard-rules gate, library body, planner copy view)
// keeps seeing a plain string.

export interface NormalizedSection {
  elements: SectionElements;
  subheader_variants?: string[];
  subheader_selected?: number;
  headline_variants?: HeadlineVariant[];
  headline_selected?: number;
}

// Slate candidates get the punctuation autofix here rather than at each caller.
// The mirrored element is scrubbed by the streaming client, so without this the
// candidate the writer picks could carry an em dash the visible line never had.
// autoFixMechanical is pure string math and idempotent, so double-scrubbing on the
// streaming path is harmless.
const clean = (s: string) => autoFixMechanical(s.trim());

function cleanStrings(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((x) => typeof x === "string")) return null;
  const cleaned = (value as string[]).map(clean).filter(Boolean);
  return cleaned.length ? cleaned : null;
}

/**
 * Read a headline slate. Tolerant on purpose: the model may return bare strings
 * instead of objects, or omit a pattern label. A slate that can't be read at all
 * falls back to the plain-string path rather than losing the headline.
 */
function cleanHeadlineVariants(value: unknown): HeadlineVariant[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const out: HeadlineVariant[] = [];
  for (const raw of value) {
    if (typeof raw === "string") {
      const text = clean(raw);
      if (text) out.push({ pattern: "unclassified", text });
      continue;
    }
    if (!raw || typeof raw !== "object") continue;
    const o = raw as { pattern?: unknown; text?: unknown; headline?: unknown; tagline?: unknown };
    const text = typeof o.text === "string" ? clean(o.text) : typeof o.headline === "string" ? clean(o.headline) : "";
    if (!text) continue;
    const tagline = typeof o.tagline === "string" ? clean(o.tagline) : "";
    out.push({
      pattern: typeof o.pattern === "string" && o.pattern.trim() ? o.pattern.trim() : "unclassified",
      text,
      ...(tagline ? { tagline } : {}),
    });
  }
  return out.length ? out : null;
}

/**
 * Normalize one raw parsed section's elements. Falls back gracefully at every
 * step: a plain-string Subheader or Headline, a single-item array, or a missing
 * element all produce no picker.
 */
export function normalizeSectionElements(
  rawElements: Record<string, unknown> | null | undefined,
): NormalizedSection {
  const elements: SectionElements = {};
  let subheaderVariants: string[] | undefined;
  let headlineVariants: HeadlineVariant[] | undefined;

  for (const [key, value] of Object.entries(rawElements ?? {})) {
    if (key === "Subheader") {
      const cleaned = cleanStrings(value);
      if (cleaned) {
        subheaderVariants = cleaned;
        elements["Subheader"] = cleaned[0];
        continue;
      }
    }
    if (key === "Headline") {
      const cleaned = Array.isArray(value) ? cleanHeadlineVariants(value) : null;
      if (cleaned) {
        headlineVariants = cleaned;
        elements["Headline"] = cleaned[0].text;
        // The pair travels together: seed the Tagline from the leading candidate.
        // A standalone "Tagline" key later in this same loop still wins, which is
        // what we want when the model emitted both.
        if (cleaned[0].tagline && elements["Tagline"] === undefined) elements["Tagline"] = cleaned[0].tagline;
        continue;
      }
    }
    elements[key] = value as string | ProductInGrid[];
  }

  // A section that lists Tagline but got its taglines inside the slate has no
  // standalone key — mirror the selected one in so the element renders.
  if (headlineVariants?.[0]?.tagline && !elements["Tagline"]) {
    elements["Tagline"] = headlineVariants[0].tagline;
  }

  return {
    elements,
    ...(subheaderVariants && subheaderVariants.length > 1
      ? { subheader_variants: subheaderVariants, subheader_selected: 0 }
      : {}),
    ...(headlineVariants && headlineVariants.length > 1
      ? { headline_variants: headlineVariants, headline_selected: 0 }
      : {}),
  };
}
