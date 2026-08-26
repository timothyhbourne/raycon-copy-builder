import { describe, it, expect } from "vitest";
import { buildSectionList, buildSectionExampleLines, generateUserPrompt } from "./generate";
import { expandUspSections } from "../expand-sections";
import type { SectionSpec } from "../schemas";

// These lock down the CORE fix: a usps section's prompt must contain the bound
// product's USP bank and no other product's, and must describe exactly the
// elements the section actually has.

const uspsSection = (over: Partial<SectionSpec> = {}): SectionSpec[] => [
  { id: "u", type: "usps", ...over },
];

describe("buildSectionList — USP scoping", () => {
  it("injects ONLY the bound product's bank", () => {
    const out = buildSectionList(uspsSection({
      usp_slots: [{ source: "product", product_slug: "O25" }, { source: "product", product_slug: "O25" }],
    }));
    // O25's bank is present…
    expect(out).toContain("Available USPs for O25");
    expect(out).toContain("Multi-angular hook");
    // …and no other product's bank leaked in.
    expect(out).not.toContain("Available USPs for E60");
    expect(out).not.toContain("Ultra-slim profile");   // E60
    expect(out).not.toContain("Stabilizing gel fins"); // E45
  });

  it("names the bound product and forbids referencing any other", () => {
    const out = buildSectionList(uspsSection({
      usp_slots: [{ source: "product", product_slug: "E45" }, { source: "product", product_slug: "E45" }],
    }));
    expect(out).toContain("PRODUCT USP for Fitness Earbuds (SKU E45)");
    expect(out).toContain("This USP must be about this product and no other.");
  });

  it("gives a company slot the company bank and the live offer", () => {
    const out = buildSectionList(
      uspsSection({ usp_slots: [{ source: "company" }, { source: "company" }] }),
      {},
      { offerContext: "30% off sitewide, code GOALS" }
    );
    expect(out).toContain("Verified company USP bank");
    expect(out).toContain("1 year limited warranty");
    expect(out).toContain("Live offer for this campaign: 30% off sitewide, code GOALS");
  });

  it("never gives the live offer to a product slot", () => {
    const out = buildSectionList(
      uspsSection({ usp_slots: [{ source: "product", product_slug: "O25" }, { source: "product", product_slug: "O25" }] }),
      {},
      { offerContext: "30% off sitewide, code GOALS" }
    );
    expect(out).not.toContain("Live offer");
  });

  it("never surfaces an unverified bank entry", () => {
    // "Free returns" is contradicted by the published refund policy and is
    // tagged [unverified] in data/company-usps.md.
    const out = buildSectionList(uspsSection({ usp_slots: [{ source: "company" }, { source: "company" }] }));
    expect(out).not.toContain("Free returns:");
    // E25's multipoint claim is not on the live page.
    const e25 = buildSectionList(uspsSection({
      usp_slots: [{ source: "product", product_slug: "E25" }, { source: "product", product_slug: "E25" }],
    }));
    expect(e25).toContain("Available USPs for E25");
    expect(e25).not.toContain("Multipoint connectivity: Hold a connection");
  });

  it("prints a shared bank once and points later slots at it", () => {
    const out = buildSectionList(uspsSection({
      usp_slots: [
        { source: "product", product_slug: "O25" },
        { source: "product", product_slug: "O25" },
        { source: "product", product_slug: "O25" },
      ],
    }));
    expect(out.match(/Available USPs for O25/g)).toHaveLength(1);
    expect(out).toContain("Same bank as USP 1 above");
  });

  it("carries a per-slot focus into the prompt", () => {
    const out = buildSectionList(uspsSection({
      usp_slots: [
        { source: "product", product_slug: "O25", focus: "lead on battery" },
        { source: "company" },
      ],
    }));
    expect(out).toContain("focus for this USP (from the user): lead on battery");
  });

  it("tells the model to prefer bank entries recent sends did not cover", () => {
    const out = buildSectionList(
      uspsSection({ usp_slots: [{ source: "product", product_slug: "O25" }, { source: "company" }] }),
      {},
      { recentUspsBySlug: { O25: ["A hook that holds through every sprint."] } }
    );
    expect(out).toContain("USPs already sent for this product");
    expect(out).toContain("A hook that holds through every sprint.");
  });

  it("degrades gracefully for a product with no bank", () => {
    const out = buildSectionList(uspsSection({
      usp_slots: [{ source: "product", product_slug: "H90" }, { source: "product", product_slug: "H90" }],
    }));
    expect(out).toContain("No USP bank is recorded for this product");
    expect(out).toContain("Invent nothing.");
  });
});

describe("buildSectionList — removed elements", () => {
  it("omits a removed Subheader from the required-elements list", () => {
    const out = buildSectionList(uspsSection({ removed_elements: ["Subheader"] }));
    expect(out).toContain("elements required: USP 1, USP 2, USP 3, CTA");
  });

  it("omits both Subheader and CTA when the user switched both off", () => {
    const out = buildSectionList(uspsSection({ removed_elements: ["Subheader", "CTA"] }));
    expect(out).toContain("elements required: USP 1, USP 2, USP 3");
  });

  it("lists a variable USP count", () => {
    const out = buildSectionList(uspsSection({
      usp_slots: Array.from({ length: 5 }, () => ({ source: "product" as const })),
    }));
    expect(out).toContain("elements required: Subheader, USP 1, USP 2, USP 3, USP 4, USP 5, CTA");
  });
});

describe("buildSectionExampleLines — the JSONL skeleton", () => {
  it("omits a removed Subheader, so no subheader_variants are expected", () => {
    const out = buildSectionExampleLines(uspsSection({ removed_elements: ["Subheader"] }));
    expect(out).toBe(`{"type":"usps","elements":{"USP 1":"...","USP 2":"...","USP 3":"...","CTA":"..."}}`);
    expect(out).not.toContain("option 1");
  });

  it("keeps the 3-option Subheader array when the Subheader is present", () => {
    const out = buildSectionExampleLines(uspsSection());
    expect(out).toContain(`"Subheader":["option 1","option 2","option 3"]`);
  });

  it("matches the required-elements list exactly for a 4-slot section", () => {
    const spec = uspsSection({
      usp_slots: Array.from({ length: 4 }, () => ({ source: "product" as const })),
      removed_elements: ["CTA"],
    });
    expect(buildSectionExampleLines(spec)).toBe(
      `{"type":"usps","elements":{"Subheader":["option 1","option 2","option 3"],"USP 1":"...","USP 2":"...","USP 3":"...","USP 4":"..."}}`
    );
    expect(buildSectionList(spec)).toContain("elements required: Subheader, USP 1, USP 2, USP 3, USP 4");
  });
});

describe("backward compatibility", () => {
  it("a legacy usps section (no usp_slots) keeps the original element list", () => {
    expect(buildSectionList(uspsSection())).toContain(
      "elements required: Subheader, USP 1, USP 2, USP 3, CTA"
    );
    expect(buildSectionExampleLines(uspsSection())).toBe(
      `{"type":"usps","elements":{"Subheader":["option 1","option 2","option 3"],"USP 1":"...","USP 2":"...","USP 3":"...","CTA":"..."}}`
    );
  });

  it("a legacy section still gets a real product bank once expanded", () => {
    const out = buildSectionList(expandUspSections(uspsSection(), ["O25"], "O25"));
    expect(out).toContain("Available USPs for O25");
    expect(out).toContain("elements required: Subheader, USP 1, USP 2, USP 3, CTA");
  });

  it("leaves non-usps sections untouched", () => {
    const out = buildSectionList([{ id: "b", type: "body" }]);
    expect(out).toContain("elements required: Subheader, Body Copy, CTA");
    expect(out).not.toContain("USP rules for this section");
  });

  it("emits no per-slot block for a flow's usps section (no slot plan, no products)", () => {
    // Flows never run through expandUspSections and have no featured products.
    // They must keep the original free-form behaviour rather than being told
    // "no product is bound to this slot" three times.
    const out = buildSectionList([
      { id: "u", type: "usps", focus: "Three tips or features worth knowing." },
    ]);
    expect(out).not.toContain("USP rules for this section");
    expect(out).not.toContain("no product is bound");
    expect(out).toContain("elements required: Subheader, USP 1, USP 2, USP 3, CTA");
    expect(out).toContain("Three tips or features worth knowing.");
  });
});

// Regression: `retrieved_examples` is optional in the route's request schema, so
// generation has to survive its absence. It didn't — the prompt mapped over the
// undefined array and the route answered 500 on a payload its own schema accepts.
describe("generateUserPrompt without retrieved examples", () => {
  const brief = {
    headline_thesis: "t", audience_mindset: "m", key_message: "k", tonal_direction: "d",
    structural_notes: "n", rewritten_hero_angle: "h",
    campaign_type: "promo" as const, audience: "all" as const, products_featured: ["O15"],
  };
  const conceit = { id: "c", name: "C", description: "d" };
  const sections: SectionSpec[] = [{ id: "revs", type: "reviews" }];

  it("builds a prompt when examples are omitted entirely", () => {
    expect(() => generateUserPrompt(brief, conceit, sections)).not.toThrow();
    expect(generateUserPrompt(brief, conceit, sections)).toContain("Review 1");
  });

  it("builds a prompt when examples are an empty array", () => {
    expect(() => generateUserPrompt(brief, conceit, sections, [])).not.toThrow();
  });
});
