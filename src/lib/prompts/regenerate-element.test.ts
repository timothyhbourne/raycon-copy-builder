import { describe, it, expect } from "vitest";
import {
  regenerateElementUserPrompt, isReviewElement, elementReturnsVariants, parseGridItemKey,
} from "./regenerate-element";
import type {
  ExpandedBrief, Conceit, GeneratedSection, GeneratedCampaign, SectionSpec,
} from "../schemas";

const brief: ExpandedBrief = {
  headline_thesis: "t", audience_mindset: "m", key_message: "30% off sitewide",
  tonal_direction: "d", structural_notes: "n", rewritten_hero_angle: "h",
  campaign_type: "promo", audience: "all", products_featured: ["O25"],
};
const conceit: Conceit = { id: "c", name: "Back to School", description: "The sale is the story." };

const section = (over: Partial<GeneratedSection> = {}): GeneratedSection => ({
  id: "s2", type: "body",
  elements: { Subheader: "A battery that keeps going", "Body Copy": "Old body copy here.", CTA: "Shop Now" },
  ...over,
});

const campaign = (secs: GeneratedSection[]): GeneratedCampaign => ({
  meta: { subject_lines: ["30% off"], preview_texts: ["Ends Thursday"] },
  sections: secs,
});

const prompt = (elementKey: string, sec = section(), spec?: SectionSpec, steering = "") =>
  regenerateElementUserPrompt({
    elementKey, section: sec, sectionSpec: spec,
    fullCampaign: campaign([sec]), expandedBrief: brief, chosenConceit: conceit, steering,
  });

describe("element predicates", () => {
  it("identifies Review and Review N as never-LLM elements", () => {
    expect(isReviewElement("Review")).toBe(true);
    expect(isReviewElement("Review 2")).toBe(true);
    expect(isReviewElement("Reviews")).toBe(false);
    expect(isReviewElement("Subheader")).toBe(false);
  });

  it("only Subheader returns variants", () => {
    expect(elementReturnsVariants("Subheader")).toBe(true);
    expect(elementReturnsVariants("Headline")).toBe(false);
  });

  it("parses grid-item compound keys", () => {
    expect(parseGridItemKey("Products[2].one_liner")).toEqual({ index: 2, field: "one_liner" });
    expect(parseGridItemKey("Products[0].cta")).toEqual({ index: 0, field: "cta" });
    expect(parseGridItemKey("Products")).toBeNull();
    expect(parseGridItemKey("Products[1].price")).toBeNull();
  });
});

describe("cohesion — the whole point of a per-element call", () => {
  it("supplies the sibling elements and forbids restating them", () => {
    const out = prompt("Body Copy");
    expect(out).toContain("A battery that keeps going");   // the sibling Subheader
    expect(out).toContain("Shop Now");                      // the sibling CTA
    expect(out).toMatch(/must NOT restate/);
  });

  it("supplies the full campaign for context and marks the target's section", () => {
    const out = prompt("Body Copy");
    expect(out).toContain("the section containing your target element");
    expect(out).toContain("do NOT rewrite any of it");
  });

  it("shows the current value only so it can be avoided", () => {
    const out = prompt("Body Copy");
    expect(out).toContain("Old body copy here.");
    expect(out).toContain("ONLY so you avoid repeating it");
  });

  it("handles an empty element by asking for fresh copy", () => {
    const out = prompt("CTA", section({ elements: { CTA: "" } }));
    expect(out).toContain("this element has no copy yet");
  });
});

describe("output shape", () => {
  it("asks for a single value for a normal element", () => {
    expect(prompt("Body Copy")).toContain(`{"value":"the rewritten Body Copy"}`);
  });

  it("asks for exactly 3 options for a Subheader", () => {
    const out = prompt("Subheader");
    expect(out).toContain(`{"variants":["option 1","option 2","option 3"]}`);
    expect(out).toContain("EXACTLY 3 distinct options");
  });

  it("names the target element and forbids returning others", () => {
    const out = prompt("CTA");
    expect(out).toContain(`Rewrite ONLY "CTA"`);
    expect(out).toContain("do not return any other element");
  });
});

describe("per-element craft rules", () => {
  it("carries the CTA rules (no code, no product name)", () => {
    const out = prompt("CTA");
    expect(out).toContain("2 to 4 word action phrase");
    expect(out).toMatch(/never the promo CODE/);
    expect(out).toMatch(/never a product name/);
  });

  it("scopes a One-Liner to the bound product", () => {
    const sec = section({ type: "product_card", elements: { "One-Liner": "old" } });
    const out = prompt("One-Liner", sec, { id: "x", type: "product_card", product_slug: "O25" });
    expect(out).toContain("Fitness Open Earbuds (SKU O25)");
    expect(out).toContain("no other product");
  });

  it("gives a product USP its own bank only", () => {
    const sec = section({ type: "usps", elements: { "USP 1": "old", "USP 2": "b" } });
    const spec: SectionSpec = {
      id: "u", type: "usps",
      usp_slots: [{ source: "product", product_slug: "O25" }, { source: "company" }],
    };
    const out = prompt("USP 1", sec, spec);
    expect(out).toContain("PRODUCT USP for Fitness Open Earbuds (SKU O25)");
    expect(out).toContain("Multi-angular hook");         // from O25's bank
    expect(out).not.toContain("Ultra-slim profile");      // E60's bank must not leak
    expect(out).not.toContain("1 year limited warranty"); // company bank must not leak
  });

  it("gives a company USP the company bank and the offer", () => {
    const sec = section({ type: "usps", elements: { "USP 1": "a", "USP 2": "old" } });
    const spec: SectionSpec = {
      id: "u", type: "usps",
      usp_slots: [{ source: "product", product_slug: "O25" }, { source: "company" }],
    };
    const out = prompt("USP 2", sec, spec);
    expect(out).toContain("COMPANY USP");
    expect(out).toContain("1 year limited warranty");
    expect(out).not.toContain("Free returns:");  // unverified, must never surface
  });

  it("defaults a canvas-added USP with no slot to a product USP", () => {
    // USP 3 added on the canvas: the spec only planned 2 slots.
    const sec = section({ type: "usps", elements: { "USP 1": "a", "USP 2": "b", "USP 3": "" } });
    const spec: SectionSpec = {
      id: "u", type: "usps",
      usp_slots: [{ source: "product", product_slug: "O25" }, { source: "company" }],
      product_slug: "O25",
    };
    const out = prompt("USP 3", sec, spec);
    expect(out).toContain("PRODUCT USP for Fitness Open Earbuds (SKU O25)");
  });

  it("pins Product Name to the exact catalogue name", () => {
    const sec = section({ type: "product_card", elements: { "Product Name": "old" } });
    const out = prompt("Product Name", sec, { id: "x", type: "product_card", product_slug: "E60" });
    expect(out).toContain("exact Raycon catalogue name");
    expect(out).toContain("Sleep Earbuds");
  });

  it("carries grid-item one-liner rules", () => {
    const sec = section({ type: "product_grid", elements: { Products: [] } });
    const out = prompt("Products[1].one_liner", sec);
    expect(out).toContain("one-liner for product 2 in the grid");
    expect(out).toContain("5 to 12 words");
  });
});

describe("steering", () => {
  it("makes steering the top priority and blocks urgency substitution", () => {
    const out = prompt("Body Copy", section(), undefined, "make it easier to decide");
    expect(out).toContain("make it easier to decide");
    expect(out).toContain("THIS IS YOUR TOP PRIORITY");
    expect(out).toMatch(/Only use urgency\/scarcity\/deadline framing if the steering explicitly asks/);
  });

  it("asks for a different angle when no steering is given", () => {
    expect(prompt("Body Copy")).toContain("No steering was given");
  });
});

describe("deadline honesty", () => {
  it("passes the computed deadline language through verbatim", () => {
    const out = regenerateElementUserPrompt({
      elementKey: "Body Copy", section: section(),
      fullCampaign: campaign([section()]),
      expandedBrief: { ...brief, deadline_language: "Friday, Aug 7" },
      chosenConceit: conceit,
    });
    expect(out).toContain("the sale ends Friday, Aug 7");
    expect(out).toMatch(/"Tonight"\/"today" are FORBIDDEN/);
  });
});
