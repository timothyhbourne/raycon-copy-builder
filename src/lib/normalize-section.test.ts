import { describe, it, expect } from "vitest";
import { normalizeSectionElements } from "./normalize-section";

describe("normalizeSectionElements — subheader slate", () => {
  it("lifts 3 options out and mirrors the first", () => {
    const out = normalizeSectionElements({ Subheader: ["a", "b", "c"], CTA: "Shop Now" });
    expect(out.elements.Subheader).toBe("a");
    expect(out.subheader_variants).toEqual(["a", "b", "c"]);
    expect(out.subheader_selected).toBe(0);
    expect(out.elements.CTA).toBe("Shop Now");
  });

  it("produces no picker for a plain string or a single option", () => {
    expect(normalizeSectionElements({ Subheader: "just one" }).subheader_variants).toBeUndefined();
    expect(normalizeSectionElements({ Subheader: ["only"] }).subheader_variants).toBeUndefined();
    expect(normalizeSectionElements({ Subheader: ["only"] }).elements.Subheader).toBe("only");
  });
});

describe("normalizeSectionElements — headline slate", () => {
  const slate = [
    { pattern: "idiom_remix", text: "Summer Just Got Louder", tagline: "20% off sitewide" },
    { pattern: "product_truth", text: "Motion Never Stops", tagline: "The Fitness Earbuds, 20% off" },
    { pattern: "rhyme", text: "Fit That Won't Quit", tagline: "20% off Fitness Open Earbuds" },
    { pattern: "bold_claim", text: "Best Part of Working Out", tagline: "Fitness Earbuds are 20% off" },
  ];

  it("keeps all four candidates and mirrors the leading pair", () => {
    const out = normalizeSectionElements({ Headline: slate, CTA: "Shop Now" });
    expect(out.headline_variants).toHaveLength(4);
    expect(out.headline_selected).toBe(0);
    expect(out.elements.Headline).toBe("Summer Just Got Louder");
    // The pair travels together: the Tagline element comes from the same candidate.
    expect(out.elements.Tagline).toBe("20% off sitewide");
  });

  it("keeps the pattern labels, so the writer chooses between constructions", () => {
    const out = normalizeSectionElements({ Headline: slate });
    expect(out.headline_variants?.map((v) => v.pattern)).toEqual([
      "idiom_remix", "product_truth", "rhyme", "bold_claim",
    ]);
  });

  it("lets a standalone Tagline key win when the model emitted both", () => {
    const out = normalizeSectionElements({ Headline: slate, Tagline: "hand-written tagline" });
    expect(out.elements.Tagline).toBe("hand-written tagline");
  });

  it("tolerates bare strings instead of labelled candidates", () => {
    const out = normalizeSectionElements({ Headline: ["One", "Two", "Three", "Four"] });
    expect(out.headline_variants).toHaveLength(4);
    expect(out.headline_variants?.[0]).toEqual({ pattern: "unclassified", text: "One" });
    expect(out.elements.Headline).toBe("One");
  });

  it("accepts `headline` as the text key", () => {
    const out = normalizeSectionElements({ Headline: [{ pattern: "rhyme", headline: "Fit That Won't Quit" }, { text: "Second" }] });
    expect(out.elements.Headline).toBe("Fit That Won't Quit");
    expect(out.headline_variants).toHaveLength(2);
  });

  it("falls back to a plain headline rather than losing it", () => {
    const out = normalizeSectionElements({ Headline: "Motion Never Stops" });
    expect(out.elements.Headline).toBe("Motion Never Stops");
    expect(out.headline_variants).toBeUndefined();
  });

  it("produces no picker for a one-candidate slate but keeps the line", () => {
    const out = normalizeSectionElements({ Headline: [{ pattern: "rhyme", text: "Fit That Won't Quit", tagline: "30% off" }] });
    expect(out.headline_variants).toBeUndefined();
    expect(out.elements.Headline).toBe("Fit That Won't Quit");
    expect(out.elements.Tagline).toBe("30% off");
  });

  it("drops empty candidates and survives junk", () => {
    const out = normalizeSectionElements({ Headline: [{ text: "  " }, null, 7, { text: "Real" }] });
    expect(out.headline_variants).toBeUndefined();
    expect(out.elements.Headline).toBe("Real");
  });

  it("passes product grids through untouched", () => {
    const products = [{ name: "A", image_direction: "d", one_liner: "o", cta: "c" }];
    const out = normalizeSectionElements({ Products: products });
    expect(out.elements.Products).toBe(products);
  });
});

describe("normalizeSectionElements — mechanical scrub", () => {
  it("scrubs banned punctuation out of every candidate, not just the visible one", () => {
    const out = normalizeSectionElements({
      Headline: [
        { pattern: "idiom_remix", text: "Summer Just Got Louder", tagline: "20% off" },
        { pattern: "rhyme", text: "Fit That Won't Quit — really", tagline: "30% off — today" },
      ],
      Subheader: ["A battery that keeps you going", "Comfort — all day", "Sound that lasts"],
    });
    expect(out.headline_variants?.[1].text).not.toContain("—");
    expect(out.headline_variants?.[1].tagline).not.toContain("—");
    expect(out.subheader_variants?.[1]).not.toContain("—");
  });
});
