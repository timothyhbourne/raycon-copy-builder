import type { SectionType } from "./schemas";

// Display metadata for the section catalogue — labels, one-line descriptions,
// grouping, and which types need configuration before they can be inserted.
// Spec: docs/BLANK_CANVAS_AND_SECTION_INSERT_SPEC.md §3.2.
//
// ONE map, shared by the canvas section picker and the pre-generation
// SectionBuilder, so a type can never be described two ways in two places — and,
// more importantly, so a new SectionType cannot be added without deciding how it
// is presented (the Record is exhaustive, so TypeScript demands an entry).
//
// What is NOT here: the elements each type contains. Those come from
// sectionElementNames() / SECTION_CATALOGUE at render time, so a preview can
// never drift from the real catalogue.

export type SectionGroup = "copy" | "product" | "proof";

export interface SectionMeta {
  label: string;
  description: string;
  group: SectionGroup;
  /** Needs configuration collected BEFORE insertion (grid dimensions, bundle
   * products + layout). The picker advances to a second step for these; without
   * it they would insert as an unrenderable empty shell, which is why they were
   * excluded from the old insert menu entirely. */
  needsConfig?: boolean;
}

export const SECTION_META: Record<SectionType, SectionMeta> = {
  header: {
    label: "Header",
    description: "The hero at the top: a headline hook and the tagline that pays it off.",
    group: "copy",
  },
  body: {
    label: "Body",
    description: "A block of copy — subheader, two to four sentences, a CTA.",
    group: "copy",
  },
  free_form: {
    label: "Free form",
    description: "A general-purpose block you can point at anything.",
    group: "copy",
  },
  cta_bridge: {
    label: "CTA bridge",
    description: "A short nudge between modules: one line and a button.",
    group: "copy",
  },
  footer_cta: {
    label: "Footer CTA",
    description: "The closing line and the last button, at the bottom of the email.",
    group: "copy",
  },
  product_card: {
    label: "Product card",
    description: "One product, its one-liner, and a CTA.",
    group: "product",
  },
  product_card_review: {
    label: "Product card + review",
    description: "A product card with a real customer review attached.",
    group: "product",
  },
  product_grid: {
    label: "Product grid",
    description: "Several products side by side, each with a one-liner and a CTA.",
    group: "product",
    needsConfig: true,
  },
  bundle: {
    label: "Bundle",
    description: "Two or more products sold as one offer, in one of four layouts.",
    group: "product",
    needsConfig: true,
  },
  usps: {
    label: "USPs",
    description: "Two to five benefit lines, each drawn from a verified USP bank.",
    group: "proof",
  },
  reviews: {
    label: "Reviews",
    description: "Real customer reviews, fetched from the storefront — never written.",
    group: "proof",
  },
};

export const SECTION_GROUP_LABELS: Record<SectionGroup, string> = {
  copy: "Copy",
  product: "Product",
  proof: "Proof",
};

/** Group order, and the type order within each group, as the picker shows them. */
export const SECTION_GROUP_ORDER: SectionGroup[] = ["copy", "product", "proof"];

/** Every insertable type, in picker order. This replaces the old INSERTABLE_TYPES
 * list, which omitted product_grid and bundle — leaving `bundle` unreachable from
 * anywhere in the app despite being fully built. */
export const ALL_SECTION_TYPES: SectionType[] = SECTION_GROUP_ORDER.flatMap((group) =>
  (Object.keys(SECTION_META) as SectionType[]).filter((t) => SECTION_META[t].group === group),
);

/**
 * Filter types by a free-text query, matching label, raw type name and
 * description. Empty query returns everything, in picker order.
 */
export function searchSectionTypes(query: string): SectionType[] {
  const q = query.trim().toLowerCase();
  if (!q) return ALL_SECTION_TYPES;
  return ALL_SECTION_TYPES.filter((type) => {
    const meta = SECTION_META[type];
    return (
      meta.label.toLowerCase().includes(q) ||
      type.replace(/_/g, " ").includes(q) ||
      type.includes(q) ||
      meta.description.toLowerCase().includes(q)
    );
  });
}
