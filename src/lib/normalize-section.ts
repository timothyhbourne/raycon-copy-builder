import type { SectionElements, ProductInGrid } from "./schemas";

/**
 * The model emits the Subheader element as an array of 3 distinct variants
 * (e.g. "Subheader": ["v1", "v2", "v3"]). The rest of the app expects
 * elements.Subheader to be a plain string. This normalizes the raw parsed
 * elements: it lifts the variants out into a separate array and collapses
 * elements.Subheader to the first (default) option.
 *
 * Falls back gracefully: a plain-string Subheader, a single-item array, or a
 * missing Subheader all produce no variant picker (subheader_variants undefined).
 */
export function extractSubheaderVariants(
  rawElements: Record<string, unknown> | null | undefined
): { elements: SectionElements; subheader_variants?: string[]; subheader_selected?: number } {
  const elements: SectionElements = {};
  let variants: string[] | undefined;

  for (const [key, value] of Object.entries(rawElements ?? {})) {
    if (key === "Subheader" && Array.isArray(value) && value.every((x) => typeof x === "string")) {
      const cleaned = (value as string[]).map((s) => s.trim()).filter(Boolean);
      if (cleaned.length > 0) {
        variants = cleaned;
        elements["Subheader"] = cleaned[0];
        continue;
      }
    }
    elements[key] = value as string | ProductInGrid[];
  }

  if (variants && variants.length > 1) {
    return { elements, subheader_variants: variants, subheader_selected: 0 };
  }
  return { elements };
}
