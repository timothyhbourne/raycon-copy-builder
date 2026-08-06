import { describe, it, expect } from "vitest";
import { regenerateSectionUserPrompt } from "./regenerate-section";
import type {
  ExpandedBrief, Conceit, SectionSpec, GeneratedSection, GeneratedCampaign,
} from "../schemas";

const brief: ExpandedBrief = {
  headline_thesis: "t", audience_mindset: "m", key_message: "k",
  tonal_direction: "d", structural_notes: "n", rewritten_hero_angle: "h",
  campaign_type: "promo", audience: "all", products_featured: ["O25"],
};
const conceit: Conceit = { id: "c", name: "Name", description: "Desc" };

const section = (elements: Record<string, string>): GeneratedSection =>
  ({ id: "u", type: "usps", elements });

const campaign: GeneratedCampaign = {
  meta: { subject_lines: [], preview_texts: [] },
  sections: [section({ "USP 1": "one", "USP 2": "two", "USP 3": "three" })],
};

const prompt = (spec: Partial<SectionSpec>, elements: Record<string, string>) =>
  regenerateSectionUserPrompt(
    brief, conceit,
    { id: "u", type: "usps", ...spec, current_content: section(elements) },
    campaign, "", []
  );

describe("regenerateSectionUserPrompt — USPs", () => {
  it("describes the slot plan and injects only the bound product's bank", () => {
    const out = prompt(
      { usp_slots: [{ source: "product", product_slug: "O25" }, { source: "company" }] },
      { "USP 1": "one", "USP 2": "two" }
    );
    expect(out).toContain("PRODUCT USP for Fitness Open Earbuds (SKU O25)");
    expect(out).toContain("Available USPs for O25");
    expect(out).toContain("Verified company USP bank");
    expect(out).not.toContain("Available USPs for E60");
  });

  it("says how many USPs the section actually has", () => {
    const out = prompt(
      { usp_slots: Array.from({ length: 4 }, () => ({ source: "product" as const, product_slug: "O25" })) },
      { "USP 1": "a", "USP 2": "b", "USP 3": "c", "USP 4": "d" }
    );
    expect(out).toContain("these 4 USPs are a planned SET");
    expect(out.match(/Available USPs for O25/g)).toHaveLength(1);
    expect(out).toContain("Same bank as USP 1 above");
  });

  it("omits a removed Subheader from the output shape and drops the variants rule", () => {
    const out = prompt(
      { usp_slots: [{ source: "product", product_slug: "O25" }, { source: "company" }], removed_elements: ["Subheader"] },
      { "USP 1": "one", "USP 2": "two" }
    );
    // Assert against the returned JSON shape block, not the whole prompt (the
    // instructions legitimately mention "Subheader" while telling the model NOT
    // to add one back).
    const shape = out.slice(out.indexOf("Return JSON in this shape:"));
    expect(shape).not.toContain("Subheader");
    expect(out).not.toContain("SUBHEADER VARIANTS");
    expect(shape).toContain(`"USP 1": "..."`);
    expect(shape).toContain(`"USP 2": "..."`);
    expect(shape).toContain(`"CTA": "..."`);
  });

  it("keeps the Subheader variants rule when the section has one", () => {
    const out = prompt(
      { usp_slots: [{ source: "product", product_slug: "O25" }, { source: "company" }] },
      { Subheader: "s", "USP 1": "one", "USP 2": "two" }
    );
    expect(out).toContain("SUBHEADER VARIANTS");
    expect(out).toContain(`"Subheader": ["option 1", "option 2", "option 3"]`);
  });

  it("falls back to the generic note when the section has no slot plan", () => {
    const out = prompt({}, { "USP 1": "one", "USP 2": "two", "USP 3": "three" });
    expect(out).toContain("the USPs are a planned SET");
    expect(out).not.toContain("Available USPs for");
    expect(out).toContain("never invent free shipping, free returns, or a warranty the data does not state");
  });

  it("tells the model to return exactly the listed keys and add nothing back", () => {
    const out = prompt({ removed_elements: ["CTA"] }, { "USP 1": "one" });
    expect(out).toContain("Return EXACTLY the element keys shown in the output shape below");
    const shape = out.slice(out.indexOf("Return JSON in this shape:"));
    expect(shape).not.toContain(`"CTA"`);
  });
});
