import type { GeneratedCampaign, GeneratedSection, ProductInGrid, SectionSpec, SectionType } from "./schemas";
import { sectionElementNames } from "./schemas";
import { nanoid } from "./nanoid";

// Canvas section mutations — insert, delete, move, reorder — as PURE functions.
// Spec: docs/BLANK_CANVAS_AND_SECTION_INSERT_SPEC.md §4.
//
// WHY THIS FILE EXISTS. A section's spec (its USP slot plan, grid dimensions,
// product binding, removed elements) used to be resolved BY POSITION:
//
//     const spec = sectionStructure[i] ?? sectionStructure.find(s => s.type === section.type);
//
// while insertion only ever pushed into `campaign.sections` and never touched
// `sectionStructure`. So inserting anywhere except the end shifted every later
// index by one, silently and wrongly: a 5-slot usps section rendered 3 slots, a
// product_card_review fetched reviews for another card's SKU, a grid took another
// section's column count, and regenerate-element posted a mismatched spec.
//
// The fix is to make the spec a property of the SECTION, not of its position:
// `SectionSpec.id === GeneratedSection.id`, resolved by id, with every mutation
// updating both arrays in one operation. A blank canvas is entirely inserted
// sections, so this went from an edge case to the default case.
//
// Everything here is pure and total: no state, no I/O, no throwing. The canvas
// state is passed in and a new one comes back.

export interface CanvasSections {
  campaign: GeneratedCampaign;
  sectionStructure: SectionSpec[];
}

/** The spec describing a section. By ID — there is deliberately no positional or
 * type-based fallback, because those are what produced silently-wrong specs. A
 * section with no spec renders from its raw type catalogue, which is correct. */
export function specForSection(
  sectionStructure: SectionSpec[],
  section: Pick<GeneratedSection, "id">,
): SectionSpec | undefined {
  return sectionStructure.find((s) => s.id === section.id);
}

/** A blank product for a grid cell. */
function blankProduct(): ProductInGrid {
  return { name: "", image_direction: "", one_liner: "", cta: "" };
}

/**
 * Empty elements for a new section, derived from its SPEC rather than from the
 * raw type catalogue — so a bundle gets the element list its layout template
 * actually calls for, in the right order (a `unified` bundle is Bundle Name,
 * Subheader, USP 1…n, CTA — not the base catalogue's three keys with the USPs
 * appended after the CTA), and a usps section gets one slot per planned USP.
 *
 * `Products` is seeded as an ARRAY sized to the grid, because the canvas renders a
 * grid editor for an array and a plain text input for a string. Seeding it as ""
 * gave a freshly inserted grid a text box where its product cells belong.
 */
function emptyElements(spec: SectionSpec): GeneratedSection["elements"] {
  const elements: GeneratedSection["elements"] = {};
  for (const name of sectionElementNames(spec)) {
    if (name === "Products") {
      const cells = Math.max(1, (spec.grid_cols ?? 2) * (spec.grid_rows ?? 2));
      elements[name] = Array.from({ length: cells }, blankProduct);
    } else {
      elements[name] = "";
    }
  }
  return elements;
}

/**
 * A new section and its spec, sharing one id. `specPatch` carries the
 * configuration the picker collected for types that need it (grid dimensions,
 * bundle mode/template/products, a product binding).
 */
export function newSection(
  type: SectionType,
  specPatch: Partial<SectionSpec> = {},
): { section: GeneratedSection; spec: SectionSpec } {
  const id = nanoid();
  const spec: SectionSpec = { ...specPatch, id, type };
  return { section: { id, type, elements: emptyElements(spec) }, spec };
}

/**
 * Insert a section at `index` (0 = above the first section, length = append).
 * The index is clamped, so an out-of-range value appends rather than throwing.
 */
export function insertAt(
  state: CanvasSections,
  index: number,
  type: SectionType,
  specPatch: Partial<SectionSpec> = {},
): CanvasSections & { insertedId: string } {
  const { section, spec } = newSection(type, specPatch);
  const sections = [...state.campaign.sections];
  const at = Math.max(0, Math.min(index, sections.length));
  sections.splice(at, 0, section);

  // The structure is kept in the same order as the sections so that anything
  // still reading it positionally (the generation prompt builds its section list
  // from it) sees the same order the reader sees.
  const structure = [...state.sectionStructure];
  const structureAt = Math.max(0, Math.min(at, structure.length));
  structure.splice(structureAt, 0, spec);

  return {
    campaign: { ...state.campaign, sections },
    sectionStructure: structure,
    insertedId: section.id,
  };
}

/** Insert directly after the section with id `afterId`. Appends if it's gone. */
export function insertAfterId(
  state: CanvasSections,
  afterId: string,
  type: SectionType,
  specPatch: Partial<SectionSpec> = {},
): CanvasSections & { insertedId: string } {
  const idx = state.campaign.sections.findIndex((s) => s.id === afterId);
  return insertAt(state, idx === -1 ? state.campaign.sections.length : idx + 1, type, specPatch);
}

/** Remove a section and its spec together, so no other section changes shape. */
export function removeSection(state: CanvasSections, id: string): CanvasSections {
  return {
    campaign: { ...state.campaign, sections: state.campaign.sections.filter((s) => s.id !== id) },
    sectionStructure: state.sectionStructure.filter((s) => s.id !== id),
  };
}

function moveWithin<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Move one section up or down by one, carrying its spec with it. */
export function moveSection(state: CanvasSections, id: string, dir: "up" | "down"): CanvasSections {
  const from = state.campaign.sections.findIndex((s) => s.id === id);
  if (from === -1) return state;
  const to = dir === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= state.campaign.sections.length) return state;
  return reorderSections(state, from, to);
}

/**
 * Move the section at `from` to index `to` (the drag-and-drop case). The
 * structure is reordered by matching ids rather than by the same indices, because
 * the two arrays can legitimately differ in length on a legacy record.
 */
export function reorderSections(state: CanvasSections, from: number, to: number): CanvasSections {
  const sections = state.campaign.sections;
  if (from < 0 || from >= sections.length || to < 0 || to >= sections.length || from === to) return state;
  const nextSections = moveWithin(sections, from, to);
  return {
    campaign: { ...state.campaign, sections: nextSections },
    sectionStructure: reorderStructureToMatch(nextSections, state.sectionStructure),
  };
}

/** Put the structure into the same order as `sections`, keeping any spec that has
 * no matching section at the end rather than dropping it. */
function reorderStructureToMatch(sections: GeneratedSection[], structure: SectionSpec[]): SectionSpec[] {
  const byId = new Map(structure.map((s) => [s.id, s]));
  const ordered: SectionSpec[] = [];
  for (const section of sections) {
    const spec = byId.get(section.id);
    if (spec) { ordered.push(spec); byId.delete(section.id); }
  }
  return [...ordered, ...byId.values()];
}

/** Update one section's spec in place (the picker's config step, or a later edit). */
export function patchSpec(state: CanvasSections, id: string, patch: Partial<SectionSpec>): CanvasSections {
  return {
    ...state,
    sectionStructure: state.sectionStructure.map((s) => (s.id === id ? { ...s, ...patch, id: s.id } : s)),
  };
}

/** Replace one section's content, leaving the structure untouched. */
export function updateSection(state: CanvasSections, id: string, next: GeneratedSection): CanvasSections {
  return {
    ...state,
    campaign: { ...state.campaign, sections: state.campaign.sections.map((s) => (s.id === id ? next : s)) },
  };
}

// ---------------------------------------------------------------------------
// Migration — records written before ids were meaningful
// ---------------------------------------------------------------------------

/**
 * Stamp spec ids to match their sections, for records saved when the two arrays
 * were correlated only by position. Runs at LOAD, so the id invariant holds for
 * everything on the canvas and `specForSection` needs no fallback.
 *
 * The pairing walks both lists in order and matches on TYPE. That handles the
 * shapes real records are actually in — including the common "one more spec than
 * sections" (a section deleted on the canvas never removed its spec, which is the
 * very bug this module exists to end). A spec whose type doesn't line up is
 * skipped rather than forced onto a section: pairing a `usps` spec with a
 * `product_card` section would render the wrong shape, and a section with no spec
 * renders from its type catalogue, which is a correct default.
 *
 * Never throws — read-boundary convention. What it could not pair is logged, since
 * a section quietly losing its 5-USP plan is worth being able to see.
 */
export function alignSpecIds(
  sections: Pick<GeneratedSection, "id" | "type">[],
  structure: SectionSpec[],
  label = "campaign",
): SectionSpec[] {
  if (!structure.length || !sections.length) return structure;

  // Already aligned (everything saved after this change).
  const sectionIds = new Set(sections.map((s) => s.id));
  if (structure.every((spec) => sectionIds.has(spec.id))) return structure;

  const out = [...structure];
  const usedSpec = new Set<number>();
  let cursor = 0;
  let paired = 0;

  for (const section of sections) {
    // Advance to the next unused spec of this section's type.
    let found = -1;
    for (let i = cursor; i < out.length; i++) {
      if (usedSpec.has(i)) continue;
      if (out[i].type === section.type) { found = i; break; }
    }
    if (found === -1) continue;      // no spec for this section — catalogue default
    out[found] = { ...out[found], id: section.id };
    usedSpec.add(found);
    cursor = found + 1;
    paired++;
  }

  if (paired !== sections.length || structure.length !== sections.length) {
    console.warn(
      `[campaign-sections] ${label}: paired ${paired}/${sections.length} sections with ${structure.length} saved specs. ` +
      `Unpaired sections render from their type catalogue.`,
    );
  }
  return out;
}
