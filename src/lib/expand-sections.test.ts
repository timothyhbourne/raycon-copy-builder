import { describe, it, expect } from "vitest";
import { expandProductCardSections, expandUspSections } from "./expand-sections";
import type { SectionSpec } from "./schemas";
import { sectionElementNames } from "./schemas";

const summarize = (sections: SectionSpec[]) =>
  sections.map((s) => `${s.type}:${s.product_slug ?? "-"}`);

describe("expandProductCardSections", () => {
  it("keeps BOTH a product_card_review and a product_card for a single featured product", () => {
    // Regression: extra Auto cards used to be silently dropped, so users couldn't
    // place a product_card_review AND a product_card for the same product.
    const out = expandProductCardSections(
      [
        { id: "h", type: "header" },
        { id: "c1", type: "product_card_review" },
        { id: "c2", type: "product_card" },
        { id: "f", type: "footer_cta" },
      ],
      ["prodA"]
    );
    expect(summarize(out)).toEqual([
      "header:-",
      "product_card_review:prodA",
      "product_card:prodA",
      "footer_cta:-",
    ]);
  });

  it("spreads distinct featured products across Auto cards when there are enough", () => {
    const out = expandProductCardSections(
      [
        { id: "c1", type: "product_card_review" },
        { id: "c2", type: "product_card" },
      ],
      ["prodA", "prodB"]
    );
    expect(summarize(out)).toEqual(["product_card_review:prodA", "product_card:prodB"]);
  });

  it("cycles reused products when Auto cards outnumber featured products", () => {
    const out = expandProductCardSections(
      [
        { id: "c1", type: "product_card" },
        { id: "c2", type: "product_card_review" },
        { id: "c3", type: "product_card" },
      ],
      ["prodA", "prodB"]
    );
    expect(summarize(out)).toEqual([
      "product_card:prodA",
      "product_card_review:prodB",
      "product_card:prodA",
    ]);
  });

  it("pads extra product_card sections when there are fewer cards than products", () => {
    const out = expandProductCardSections(
      [{ id: "c1", type: "product_card" }],
      ["prodA", "prodB", "prodC"]
    );
    expect(summarize(out)).toEqual([
      "product_card:prodA",
      "product_card:prodB",
      "product_card:prodC",
    ]);
  });

  it("honors a valid manual pick and keeps a second Auto card alongside it", () => {
    const out = expandProductCardSections(
      [
        { id: "c1", type: "product_card_review", product_slug: "prodA" },
        { id: "c2", type: "product_card" },
      ],
      ["prodA"]
    );
    expect(summarize(out)).toEqual(["product_card_review:prodA", "product_card:prodA"]);
  });

  it("leaves the structure unchanged when there are no featured products", () => {
    const input: SectionSpec[] = [
      { id: "c1", type: "product_card" },
      { id: "c2", type: "product_card_review" },
    ];
    expect(expandProductCardSections(input, [])).toEqual(input);
  });
});

const slots = (sections: SectionSpec[]) =>
  sections.find((s) => s.type === "usps")?.usp_slots?.map((x) => `${x.source}:${x.product_slug ?? "-"}`);

describe("expandUspSections", () => {
  it("leaves a structure with no usps section untouched", () => {
    const input: SectionSpec[] = [{ id: "h", type: "header" }, { id: "b", type: "body" }];
    expect(expandUspSections(input, ["E25"], "E25")).toBe(input);
  });

  it("normalises a legacy section (no usp_slots) to 3 product slots on the hero", () => {
    // Backward compatibility: a campaign saved before the USP system must behave
    // exactly as it did — 3 product-sourced USPs.
    const out = expandUspSections([{ id: "u", type: "usps" }], ["O25", "E25"], "E25");
    expect(slots(out)).toEqual(["product:E25", "product:E25", "product:E25"]);
  });

  it("resolves Auto to the hero product", () => {
    const out = expandUspSections(
      [{ id: "u", type: "usps", usp_slots: [{ source: "product" }, { source: "company" }] }],
      ["O25", "E25"],
      "E25"
    );
    expect(slots(out)).toEqual(["product:E25", "company:-"]);
  });

  it("falls back to the first featured product when there is no hero", () => {
    const out = expandUspSections([{ id: "u", type: "usps" }], ["O25", "E25"]);
    expect(slots(out)).toEqual(["product:O25", "product:O25", "product:O25"]);
  });

  it("falls back to the first featured product when the hero is not featured", () => {
    const out = expandUspSections([{ id: "u", type: "usps" }], ["O25"], "H41");
    expect(slots(out)).toEqual(["product:O25", "product:O25", "product:O25"]);
  });

  it("honors a manual per-slot product pick", () => {
    const out = expandUspSections(
      [{ id: "u", type: "usps", usp_slots: [{ source: "product", product_slug: "O25" }, { source: "product" }] }],
      ["O25", "E25"],
      "E25"
    );
    expect(slots(out)).toEqual(["product:O25", "product:E25"]);
  });

  it("falls back to Auto when a slot names a product that is no longer featured", () => {
    const out = expandUspSections(
      [{ id: "u", type: "usps", usp_slots: [{ source: "product", product_slug: "H41" }] }],
      ["O25", "E25"],
      "E25"
    );
    // Clamped up to the 2-slot minimum, both resolved to the hero.
    expect(slots(out)).toEqual(["product:E25", "product:E25"]);
  });

  it("strips a stale product binding off a company slot", () => {
    const out = expandUspSections(
      [{ id: "u", type: "usps", usp_slots: [{ source: "company", product_slug: "O25" }, { source: "product" }] }],
      ["O25"],
      "O25"
    );
    expect(slots(out)).toEqual(["company:-", "product:O25"]);
  });

  it("leaves product_slug undefined when nothing is featured", () => {
    const out = expandUspSections([{ id: "u", type: "usps" }], []);
    expect(slots(out)).toEqual(["product:-", "product:-", "product:-"]);
  });

  it("clamps a slot list above the maximum down to 5", () => {
    const out = expandUspSections(
      [{ id: "u", type: "usps", usp_slots: Array.from({ length: 8 }, () => ({ source: "product" as const })) }],
      ["O25"]
    );
    expect(out[0].usp_slots).toHaveLength(5);
  });

  it("drives the element list, so 4 slots produce USP 1 through USP 4", () => {
    const out = expandUspSections(
      [{ id: "u", type: "usps", usp_slots: Array.from({ length: 4 }, () => ({ source: "product" as const })) }],
      ["O25"]
    );
    expect(sectionElementNames(out[0])).toEqual([
      "Subheader", "USP 1", "USP 2", "USP 3", "USP 4", "CTA",
    ]);
  });
});

describe("sectionElementNames", () => {
  it("returns the catalogue elements for a legacy usps section", () => {
    expect(sectionElementNames({ type: "usps" })).toEqual([
      "Subheader", "USP 1", "USP 2", "USP 3", "CTA",
    ]);
  });

  it("drops a removed Subheader", () => {
    expect(sectionElementNames({ type: "usps", removed_elements: ["Subheader"] })).toEqual([
      "USP 1", "USP 2", "USP 3", "CTA",
    ]);
  });

  it("drops both Subheader and CTA, leaving only the USPs", () => {
    expect(sectionElementNames({ type: "usps", removed_elements: ["Subheader", "CTA"] })).toEqual([
      "USP 1", "USP 2", "USP 3",
    ]);
  });

  it("ignores a removal that is not allowed for the type", () => {
    // "USP 1" is not in REMOVABLE_ELEMENTS.usps, so the request is a no-op.
    expect(sectionElementNames({ type: "usps", removed_elements: ["USP 1"] })).toEqual([
      "Subheader", "USP 1", "USP 2", "USP 3", "CTA",
    ]);
  });

  it("never lets a removal empty a section", () => {
    expect(sectionElementNames({ type: "cta_bridge", removed_elements: ["Subheader"] })).toEqual(["CTA"]);
  });

  it("keeps optional elements alongside removals", () => {
    expect(sectionElementNames({ type: "body", optional_elements: ["Extra"], removed_elements: ["Subheader"] }))
      .toEqual(["Body Copy", "CTA", "Extra"]);
  });

  it("still resolves bundle elements from the template", () => {
    expect(sectionElementNames({ type: "bundle", bundle_template: "pairing", bundle_products: ["A", "B"] }))
      .toEqual(["Bundle Name", "Subheader", "Pairing Line", "Combined Benefit", "CTA"]);
  });
});
