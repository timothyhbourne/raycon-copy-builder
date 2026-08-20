import { describe, it, expect } from "vitest";
import { elementsFromCampaign, elementsFromSection, elementsFromBody } from "./extract";
import type { GeneratedCampaign, GeneratedSection } from "../schemas";

function section(over: Partial<GeneratedSection> = {}): GeneratedSection {
  return { id: "s1", type: "header", elements: {}, ...over };
}

describe("elementsFromSection", () => {
  it("records each kind under its own kind, not folded together", () => {
    // The constructions index folds Subheader into "headlines" and Closing Line
    // into "taglines", losing the element kind. The corpus keeps them distinct so a
    // tagline is only ever compared to another tagline (spec §2.3).
    const els = elementsFromSection(section({
      type: "body",
      elements: {
        Headline: "Motion Never Stops",
        Tagline: "The Fitness Earbuds, 20% off",
        Subheader: "A battery that keeps you going",
        CTA: "Shop the Sale",
        "Closing Line": "This price disappears Sunday.",
        "Body Copy": "Here's the deal. And it's a good one.",
      },
    }));
    const kinds = els.map((e) => e.kind).sort();
    expect(kinds).toEqual(["closing", "cta", "headline", "opener", "subheader", "tagline"]);
    // The opener is the FIRST sentence, not the whole block.
    expect(els.find((e) => e.kind === "opener")!.text).toBe("Here's the deal.");
  });

  it("marks the chosen slate candidate and only that one", () => {
    const els = elementsFromSection(section({
      headline_variants: [
        { pattern: "idiom_remix", text: "Summer Just Got Louder", tagline: "20% off sitewide" },
        { pattern: "rhyme", text: "Fit That Won't Quit", tagline: "20% off Fitness" },
      ],
      headline_selected: 1,
      elements: { Headline: "Fit That Won't Quit", Tagline: "20% off Fitness" },
    }));
    const headlines = els.filter((e) => e.kind === "headline");
    expect(headlines).toHaveLength(2);
    expect(headlines.find((h) => h.text === "Fit That Won't Quit")!.was_selected).toBe(true);
    expect(headlines.find((h) => h.text === "Summer Just Got Louder")!.was_selected).toBe(false);
    // The tagline that shipped is marked too, since the pair travels together.
    expect(els.find((e) => e.kind === "tagline" && e.text === "20% off Fitness")!.was_selected).toBe(true);
  });

  it("honours the writer's declared pattern over the classifier", () => {
    const els = elementsFromSection(section({
      headline_variants: [{ pattern: "bold_claim", text: "Motion Never Stops" }],
      headline_selected: 0,
      elements: { Headline: "Motion Never Stops" },
    }));
    expect(els.find((e) => e.kind === "headline")!.signature.pattern).toBe("bold_claim");
  });

  it("records a canvas edit made after the pick, because that is what ships", () => {
    const els = elementsFromSection(section({
      headline_variants: [{ pattern: "rhyme", text: "Fit That Won't Quit", tagline: "20% off" }],
      headline_selected: 0,
      elements: { Headline: "Fit That Never Quits", Tagline: "20% off" },
    }));
    const selected = els.filter((e) => e.kind === "headline" && e.was_selected).map((e) => e.text);
    expect(selected).toContain("Fit That Never Quits");
  });

  it("never records a Review — it is real customer text, exempt from every check", () => {
    const els = elementsFromSection(section({
      type: "product_card_review",
      elements: { "Product Name": "Fitness Earbuds", "One-Liner": "No-budge fit", Review: "These are great — Jordan M." },
    }));
    expect(els.some((e) => e.text.includes("Jordan M."))).toBe(false);
    expect(els.some((e) => e.kind === "one_liner")).toBe(true);
  });

  it("scopes product one-liners to their SKU", () => {
    const els = elementsFromSection(
      section({ type: "product_card", elements: { "Product Name": "Fitness Earbuds", "One-Liner": "No-budge fit" } }),
      { id: "s1", type: "product_card", product_slug: "e55" },
    );
    expect(els.find((e) => e.kind === "one_liner")!.product_slug).toBe("e55");
  });
});

describe("elementsFromCampaign", () => {
  const campaign: GeneratedCampaign = {
    meta: {
      subject_lines: ["Direct one", "Playful one", "Curious one"],
      preview_texts: ["Preview one", "Preview two", "Preview three"],
      subject_selected: 2,
    },
    sections: [section({ elements: { Headline: "Motion Never Stops" } })],
  };

  it("marks the subject line that shipped, and defaults the preview to the first", () => {
    const els = elementsFromCampaign(campaign);
    const subjects = els.filter((e) => e.kind === "subject");
    expect(subjects.filter((s) => s.was_selected).map((s) => s.text)).toEqual(["Curious one"]);
    const previews = els.filter((e) => e.kind === "preview");
    expect(previews.filter((p) => p.was_selected).map((p) => p.text)).toEqual(["Preview one"]);
  });

  it("gives every element a computed signature", () => {
    for (const el of elementsFromCampaign(campaign)) {
      expect(el.signature.template.length).toBeGreaterThan(0);
    }
  });
});

describe("elementsFromBody (legacy flat entries)", () => {
  it("reads the heading blocks a doc-sourced library entry uses", () => {
    const els = elementsFromBody([
      "# Subject Line", "30% off ends tonight", "",
      "# Headline", "Motion Never Stops", "",
      "# Tagline", "The Fitness Earbuds, 20% off", "",
      "# Products", "Fitness Earbuds: No-budge fit", "",
    ].join("\n"));
    expect(els.map((e) => e.kind).sort()).toEqual(["headline", "one_liner", "subject", "tagline"]);
    expect(els.find((e) => e.kind === "one_liner")!.text).toBe("No-budge fit");
  });

  it("returns nothing for an empty body", () => {
    expect(elementsFromBody("")).toEqual([]);
  });
});
