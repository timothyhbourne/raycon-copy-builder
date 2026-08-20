import { describe, it, expect } from "vitest";
import {
  insertAt, insertAfterId, removeSection, moveSection, reorderSections,
  patchSpec, updateSection, specForSection, newSection, alignSpecIds,
  type CanvasSections,
} from "./campaign-sections";
import { sectionElementNames } from "./schemas";
import type { GeneratedSection, SectionSpec, SectionType } from "./schemas";

// Build a canvas where every spec id already matches its section id — the
// invariant the whole module exists to maintain.
function canvas(specs: (Partial<SectionSpec> & { type: SectionType })[]): CanvasSections {
  const sections: GeneratedSection[] = [];
  const sectionStructure: SectionSpec[] = [];
  specs.forEach((spec, i) => {
    const id = `s${i + 1}`;
    sections.push({ id, type: spec.type, elements: {} });
    sectionStructure.push({ ...spec, id, type: spec.type });
  });
  return { campaign: { meta: { subject_lines: [], preview_texts: [] }, sections }, sectionStructure };
}

const ids = (s: CanvasSections) => s.campaign.sections.map((x) => x.id);
const specIds = (s: CanvasSections) => s.sectionStructure.map((x) => x.id);
const types = (s: CanvasSections) => s.campaign.sections.map((x) => x.type);

/** The invariant: same length, same order, matching ids, matching types. */
function expectAligned(state: CanvasSections) {
  expect(specIds(state)).toEqual(ids(state));
  for (const section of state.campaign.sections) {
    expect(specForSection(state.sectionStructure, section)?.type).toBe(section.type);
  }
}

describe("newSection", () => {
  it("gives the section and its spec one shared id", () => {
    const { section, spec } = newSection("body");
    expect(spec.id).toBe(section.id);
    expect(spec.type).toBe("body");
  });

  it("seeds empty elements from the catalogue", () => {
    const { section } = newSection("header");
    expect(Object.keys(section.elements)).toEqual(["Headline", "Tagline", "CTA"]);
    expect(Object.values(section.elements).every((v) => v === "")).toBe(true);
  });

  it("seeds a bundle's elements from its LAYOUT, in the right order", () => {
    // The base catalogue is only ["Bundle Name","Subheader","CTA"], so seeding from
    // it left the per-product USPs to be appended after the CTA by the renderer.
    const { section } = newSection("bundle", {
      bundle_template: "unified",
      bundle_products: ["e55", "h20"],
    });
    expect(Object.keys(section.elements)).toEqual(["Bundle Name", "Subheader", "USP 1", "USP 2", "CTA"]);
  });

  it("seeds a usps section with one slot per planned USP", () => {
    const { section } = newSection("usps", {
      usp_slots: [{ source: "product" }, { source: "product" }, { source: "company" }, { source: "company" }],
    });
    expect(Object.keys(section.elements).filter((k) => k.startsWith("USP "))).toHaveLength(4);
  });

  it("seeds a grid's Products as an ARRAY sized to the grid", () => {
    // A string here renders a text box where the product cells belong.
    const { section } = newSection("product_grid", { grid_cols: 3, grid_rows: 2 });
    const products = section.elements["Products"];
    expect(Array.isArray(products)).toBe(true);
    expect(products).toHaveLength(6);
    expect(products?.[0]).toEqual({ name: "", image_direction: "", one_liner: "", cta: "" });
  });

  it("carries the picker's configuration onto the spec but never lets it forge the id", () => {
    const { section, spec } = newSection("product_grid", { grid_cols: 3, grid_rows: 2, id: "hacked" });
    expect(spec.grid_cols).toBe(3);
    expect(spec.id).toBe(section.id);
  });
});

describe("insertAt", () => {
  it("inserts at the top and keeps both arrays aligned", () => {
    const state = insertAt(canvas([{ type: "header" }, { type: "body" }]), 0, "cta_bridge");
    expect(types(state)).toEqual(["cta_bridge", "header", "body"]);
    expectAligned(state);
  });

  it("appends at the end", () => {
    const state = insertAt(canvas([{ type: "header" }]), 1, "footer_cta");
    expect(types(state)).toEqual(["header", "footer_cta"]);
    expectAligned(state);
  });

  it("clamps an out-of-range index instead of losing the section", () => {
    const state = insertAt(canvas([{ type: "header" }]), 99, "body");
    expect(types(state)).toEqual(["header", "body"]);
    expectAligned(state);
  });

  it("reports the id it inserted, so the caller can scroll to it", () => {
    const state = insertAt(canvas([]), 0, "body");
    expect(state.insertedId).toBe(ids(state)[0]);
  });

  it("works on a completely empty canvas", () => {
    const state = insertAt({ campaign: { meta: { subject_lines: [], preview_texts: [] }, sections: [] }, sectionStructure: [] }, 0, "header");
    expect(types(state)).toEqual(["header"]);
    expectAligned(state);
  });
});

describe("insertAfterId", () => {
  it("inserts directly after the named section", () => {
    const state = insertAfterId(canvas([{ type: "header" }, { type: "body" }]), "s1", "usps");
    expect(types(state)).toEqual(["header", "usps", "body"]);
    expectAligned(state);
  });

  it("appends when the anchor is gone", () => {
    const state = insertAfterId(canvas([{ type: "header" }]), "missing", "usps");
    expect(types(state)).toEqual(["header", "usps"]);
    expectAligned(state);
  });
});

// ---------------------------------------------------------------------------
// The regression guards from the spec's acceptance criteria (§6, "Sync"). Every
// one of these produced silently wrong output before this module existed.
// ---------------------------------------------------------------------------
describe("spec/section sync — the bug this module fixes", () => {
  it("keeps a 5-slot usps section at 5 slots when a 3-slot one is inserted above it", () => {
    const before = canvas([
      { type: "header" },
      { type: "usps", usp_slots: [{ source: "product" }, { source: "product" }, { source: "product" }, { source: "company" }, { source: "company" }] },
    ]);
    const fiveSlotId = ids(before)[1];
    const after = insertAt(before, 1, "usps", {
      usp_slots: [{ source: "product" }, { source: "product" }, { source: "product" }],
    });

    const fiveSlotSection = after.campaign.sections.find((s) => s.id === fiveSlotId)!;
    const fiveSlotSpec = specForSection(after.sectionStructure, fiveSlotSection)!;
    expect(sectionElementNames(fiveSlotSpec).filter((e) => e.startsWith("USP "))).toHaveLength(5);

    const insertedSpec = specForSection(after.sectionStructure, { id: after.insertedId })!;
    expect(sectionElementNames(insertedSpec).filter((e) => e.startsWith("USP "))).toHaveLength(3);
  });

  it("keeps a product_card_review pointed at its own SKU when a section is inserted above it", () => {
    const before = canvas([
      { type: "header" },
      { type: "product_card_review", product_slug: "e55" },
    ]);
    const cardId = ids(before)[1];
    const after = insertAt(before, 1, "body");
    const card = after.campaign.sections.find((s) => s.id === cardId)!;
    expect(specForSection(after.sectionStructure, card)?.product_slug).toBe("e55");
  });

  it("keeps grid dimensions with their own grid across an insert", () => {
    const before = canvas([
      { type: "product_grid", grid_cols: 3, grid_rows: 2 },
      { type: "product_grid", grid_cols: 2, grid_rows: 1 },
    ]);
    const [firstId, secondId] = ids(before);
    const after = insertAt(before, 0, "header");
    expect(specForSection(after.sectionStructure, { id: firstId })?.grid_cols).toBe(3);
    expect(specForSection(after.sectionStructure, { id: secondId })?.grid_cols).toBe(2);
  });

  it("does not change any other section's shape on delete", () => {
    const before = canvas([
      { type: "header" },
      { type: "usps", usp_slots: [{ source: "product" }, { source: "product" }, { source: "product" }, { source: "company" }] },
      { type: "product_card", product_slug: "e55" },
    ]);
    const [, uspsId, cardId] = ids(before);
    const after = removeSection(before, "s1");
    expect(specForSection(after.sectionStructure, { id: uspsId })?.usp_slots).toHaveLength(4);
    expect(specForSection(after.sectionStructure, { id: cardId })?.product_slug).toBe("e55");
    expectAligned(after);
  });

  it("keeps every section with its own spec through a drag reorder", () => {
    const before = canvas([
      { type: "header" },
      { type: "usps", usp_slots: [{ source: "company" }, { source: "company" }, { source: "company" }, { source: "company" }, { source: "company" }] },
      { type: "product_card_review", product_slug: "e55" },
      { type: "footer_cta" },
    ]);
    const [headerId, uspsId, cardId] = ids(before);
    // Drag the review card to the top.
    const after = reorderSections(before, 2, 0);
    expect(types(after)).toEqual(["product_card_review", "header", "usps", "footer_cta"]);
    expect(specForSection(after.sectionStructure, { id: cardId })?.product_slug).toBe("e55");
    expect(specForSection(after.sectionStructure, { id: uspsId })?.usp_slots).toHaveLength(5);
    expect(specForSection(after.sectionStructure, { id: headerId })?.type).toBe("header");
    expectAligned(after);
  });
});

describe("moveSection", () => {
  it("moves up and down, carrying the spec", () => {
    const start = canvas([{ type: "header" }, { type: "body" }, { type: "footer_cta" }]);
    const up = moveSection(start, "s3", "up");
    expect(types(up)).toEqual(["header", "footer_cta", "body"]);
    expectAligned(up);
    const down = moveSection(up, "s1", "down");
    expect(types(down)).toEqual(["footer_cta", "header", "body"]);
    expectAligned(down);
  });

  it("is a no-op at the edges and for an unknown id", () => {
    const start = canvas([{ type: "header" }, { type: "body" }]);
    expect(moveSection(start, "s1", "up")).toBe(start);
    expect(moveSection(start, "s2", "down")).toBe(start);
    expect(moveSection(start, "nope", "up")).toBe(start);
  });
});

describe("reorderSections", () => {
  it("is a no-op for out-of-range or identical indices", () => {
    const start = canvas([{ type: "header" }, { type: "body" }]);
    expect(reorderSections(start, 0, 0)).toBe(start);
    expect(reorderSections(start, -1, 1)).toBe(start);
    expect(reorderSections(start, 0, 5)).toBe(start);
  });

  it("keeps an orphan spec rather than dropping it", () => {
    const start = canvas([{ type: "header" }, { type: "body" }]);
    const withOrphan: CanvasSections = {
      ...start,
      sectionStructure: [...start.sectionStructure, { id: "orphan", type: "usps" }],
    };
    const after = reorderSections(withOrphan, 0, 1);
    expect(specIds(after)).toEqual(["s2", "s1", "orphan"]);
  });
});

describe("patchSpec / updateSection", () => {
  it("patches one spec and cannot rewrite its id", () => {
    const after = patchSpec(canvas([{ type: "product_grid" }]), "s1", { grid_cols: 4, id: "nope" } as Partial<SectionSpec>);
    expect(after.sectionStructure[0].grid_cols).toBe(4);
    expect(after.sectionStructure[0].id).toBe("s1");
  });

  it("replaces section content without touching the structure", () => {
    const start = canvas([{ type: "body" }]);
    const after = updateSection(start, "s1", { id: "s1", type: "body", elements: { "Body Copy": "hello" } });
    expect(after.campaign.sections[0].elements["Body Copy"]).toBe("hello");
    expect(after.sectionStructure).toBe(start.sectionStructure);
  });
});

describe("alignSpecIds — migration for records saved before ids meant anything", () => {
  const sections = [
    { id: "sec-a", type: "header" as SectionType },
    { id: "sec-b", type: "usps" as SectionType },
  ];

  it("stamps section ids onto type-matched specs", () => {
    const migrated = alignSpecIds(sections, [
      { id: "s1", type: "header" },
      { id: "s2", type: "usps", usp_slots: [{ source: "company" }, { source: "company" }, { source: "company" }, { source: "company" }] },
    ]);
    expect(migrated.map((s) => s.id)).toEqual(["sec-a", "sec-b"]);
    // The configuration rides along — this is a re-key, not a rebuild.
    expect(migrated[1].usp_slots).toHaveLength(4);
  });

  it("leaves an already-aligned structure untouched", () => {
    const structure: SectionSpec[] = [{ id: "sec-a", type: "header" }, { id: "sec-b", type: "usps" }];
    expect(alignSpecIds(sections, structure)).toBe(structure);
  });

  // The shape real library records are in: a section was deleted on the canvas and
  // its spec was left behind, so there is one spec too many. Discarding every spec
  // over that would lose the whole campaign's slot plans and product bindings.
  it("still pairs what it can when there is an extra trailing spec", () => {
    const migrated = alignSpecIds(sections, [
      { id: "s1", type: "header" },
      { id: "s2", type: "usps", usp_slots: [{ source: "company" }, { source: "company" }, { source: "company" }, { source: "company" }, { source: "company" }] },
      { id: "s3", type: "footer_cta" },
    ]);
    expect(migrated[0].id).toBe("sec-a");
    expect(migrated[1].id).toBe("sec-b");
    expect(migrated[1].usp_slots).toHaveLength(5);
    // The orphan keeps its own id and simply matches no section.
    expect(migrated[2].id).toBe("s3");
  });

  it("pairs around an extra spec in the MIDDLE", () => {
    const migrated = alignSpecIds(sections, [
      { id: "s1", type: "header" },
      { id: "s2", type: "product_card", product_slug: "e55" },
      { id: "s3", type: "usps", usp_slots: [{ source: "product" }, { source: "product" }, { source: "product" }, { source: "product" }] },
    ]);
    expect(migrated.find((s) => s.type === "usps")?.id).toBe("sec-b");
    expect(migrated.find((s) => s.type === "product_card")?.id).toBe("s2");
  });

  it("never forces a spec onto a section of a different type", () => {
    // One spec, wrong type: the section gets no spec and renders from its
    // catalogue, rather than inheriting another section's shape.
    const migrated = alignSpecIds([{ id: "sec-a", type: "header" }], [{ id: "s1", type: "usps" }]);
    expect(migrated[0].id).toBe("s1");
  });

  it("matches repeated types in order", () => {
    const three = [
      { id: "sec-1", type: "product_card" as SectionType },
      { id: "sec-2", type: "product_card" as SectionType },
      { id: "sec-3", type: "product_card" as SectionType },
    ];
    const migrated = alignSpecIds(three, [
      { id: "s1", type: "product_card", product_slug: "a" },
      { id: "s2", type: "product_card", product_slug: "b" },
      { id: "s3", type: "product_card", product_slug: "c" },
    ]);
    expect(migrated.map((s) => [s.id, s.product_slug])).toEqual([
      ["sec-1", "a"], ["sec-2", "b"], ["sec-3", "c"],
    ]);
  });

  it("handles an empty structure or an empty campaign", () => {
    expect(alignSpecIds(sections, [])).toEqual([]);
    expect(alignSpecIds([], [{ id: "s1", type: "header" }])).toEqual([{ id: "s1", type: "header" }]);
  });
});

describe("specForSection", () => {
  it("resolves by id, and returns nothing rather than guessing", () => {
    const state = canvas([{ type: "header" }, { type: "body" }]);
    expect(specForSection(state.sectionStructure, { id: "s2" })?.type).toBe("body");
    // Deliberately NO type-or-position fallback: a wrong spec is worse than none.
    expect(specForSection(state.sectionStructure, { id: "unknown" })).toBeUndefined();
  });
});
