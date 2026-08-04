import { describe, it, expect } from "vitest";
import { expandProductCardSections } from "./expand-sections";
import type { SectionSpec } from "./schemas";

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
