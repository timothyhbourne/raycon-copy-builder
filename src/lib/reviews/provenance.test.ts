import { describe, it, expect } from "vitest";
import {
  normalizeReviewText, verifiedIndex, verifiedFromSection, stripUnprovenancedReviews,
  unverifiedReviews, describeUnverified, migrateLegacyProvenance, guardReviewLine,
} from "./provenance";
import type { GeneratedCampaign, GeneratedSection, ReviewProvenance } from "../schemas";

const REAL = "These fit perfectly and the battery lasts all week. I wear them every day.";
const FETCHED: ReviewProvenance = { origin: "fetched", author: "Jordan M.", rating: 5, fetched_at: "2026-08-20T00:00:00.000Z" };

function section(over: Partial<GeneratedSection> = {}): GeneratedSection {
  return { id: "s1", type: "reviews", elements: {}, ...over };
}

describe("normalizeReviewText", () => {
  it("ignores whitespace, curly quotes and dash style", () => {
    expect(normalizeReviewText("It’s  great — really.")).toBe(normalizeReviewText("It's great - really."));
  });
  it("still treats different words as different", () => {
    expect(normalizeReviewText("great sound")).not.toBe(normalizeReviewText("great fit"));
  });
});

describe("stripUnprovenancedReviews", () => {
  const verified = verifiedIndex([{ text: REAL, provenance: FETCHED }]);

  it("keeps a review that matches a verified one, and records its provenance", () => {
    const r = stripUnprovenancedReviews({ "Review 1": REAL, Subheader: "What people say" }, verified);
    expect(r.elements["Review 1"]).toBe(REAL);
    expect(r.review_provenance["Review 1"]).toEqual(FETCHED);
    expect(r.stripped).toEqual([]);
  });

  it("EMPTIES a review nothing verified — the fabrication does not survive", () => {
    const invented = "I have never owned a better pair of earbuds in my life!";
    const r = stripUnprovenancedReviews({ "Review 1": REAL, "Review 2": invented }, verified);
    expect(r.elements["Review 1"]).toBe(REAL);
    expect(r.elements["Review 2"]).toBe("");
    expect(r.stripped).toEqual(["Review 2"]);
    expect(r.review_provenance["Review 2"]).toBeUndefined();
  });

  it("tolerates the punctuation drift a model introduces when echoing text", () => {
    const echoed = REAL.replace(/\. /g, ".  ").replace("'", "’");
    const r = stripUnprovenancedReviews({ "Review 1": echoed }, verified);
    expect(r.stripped).toEqual([]);
  });

  it("catches a review that was subtly REWRITTEN rather than copied", () => {
    const reworded = "These fit perfectly and the battery lasts all month. I wear them every day.";
    expect(stripUnprovenancedReviews({ "Review 1": reworded }, verified).stripped).toEqual(["Review 1"]);
  });

  it("leaves non-review elements completely alone", () => {
    const r = stripUnprovenancedReviews({ Subheader: "Loved by 40,000 people", CTA: "Shop Now" }, verified);
    expect(r.elements).toEqual({ Subheader: "Loved by 40,000 people", CTA: "Shop Now" });
  });

  it("passes an empty slot through as empty, not as a violation", () => {
    const r = stripUnprovenancedReviews({ "Review 1": "   " }, verified);
    expect(r.elements["Review 1"]).toBe("");
    expect(r.stripped).toEqual([]);
  });

  it("covers the single `Review` element of a product card too", () => {
    expect(stripUnprovenancedReviews({ Review: "made up" }, verified).stripped).toEqual(["Review"]);
  });

  it("strips everything when nothing was verified at all", () => {
    const r = stripUnprovenancedReviews({ "Review 1": REAL }, new Map());
    expect(r.elements["Review 1"]).toBe("");
  });
});

describe("verifiedFromSection", () => {
  it("treats the reviews already on a section as the verified set for a rewrite", () => {
    const s = section({
      elements: { "Review 1": REAL, "Review 2": "" },
      review_provenance: { "Review 1": FETCHED },
    });
    expect(verifiedFromSection(s)).toEqual([{ text: REAL, provenance: FETCHED }]);
  });

  it("does not let an already-unverified review legitimise itself through a rewrite", () => {
    const s = section({
      elements: { "Review 1": "invented earlier" },
      review_provenance: { "Review 1": { origin: "unverified" } },
    });
    expect(verifiedFromSection(s)).toEqual([]);
  });
});

describe("unverifiedReviews (what blocks Save Final)", () => {
  const campaign = (sections: GeneratedSection[]): GeneratedCampaign =>
    ({ meta: { subject_lines: [], preview_texts: [] }, sections });

  it("finds a review with no provenance record", () => {
    const list = unverifiedReviews(campaign([section({ elements: { "Review 1": "made up" } })]));
    expect(list).toHaveLength(1);
    expect(list[0].element).toBe("Review 1");
    expect(list[0].flagged).toBe(false);
  });

  it("finds a review explicitly marked unverified", () => {
    const list = unverifiedReviews(campaign([section({
      elements: { "Review 1": "made up" },
      review_provenance: { "Review 1": { origin: "unverified" } },
    })]));
    expect(list[0].flagged).toBe(true);
  });

  it("passes fetched, curated and manual reviews", () => {
    for (const origin of ["fetched", "curated", "manual"] as const) {
      const list = unverifiedReviews(campaign([section({
        elements: { "Review 1": REAL },
        review_provenance: { "Review 1": { origin } },
      })]));
      expect(list, origin).toEqual([]);
    }
  });

  it("ignores empty slots — an empty review is honest, not a violation", () => {
    expect(unverifiedReviews(campaign([section({ elements: { "Review 1": "", "Review 2": "  " } })]))).toEqual([]);
  });

  it("ignores non-review elements entirely", () => {
    expect(unverifiedReviews(campaign([section({ type: "body", elements: { "Body Copy": "words" } })]))).toEqual([]);
  });

  it("survives a null campaign", () => {
    expect(unverifiedReviews(null)).toEqual([]);
  });

  it("names the offending slots for the blocking message", () => {
    const list = unverifiedReviews(campaign([section({ elements: { "Review 1": "a", "Review 2": "b" } })]));
    expect(describeUnverified(list)).toBe("reviews → Review 1, reviews → Review 2");
    expect(describeUnverified([])).toBe("");
  });
});

describe("migrateLegacyProvenance", () => {
  it("treats reviews saved before provenance existed as curated, not unverified", () => {
    // Otherwise the new gate would retroactively block every saved campaign.
    const before: GeneratedCampaign = {
      meta: { subject_lines: [], preview_texts: [] },
      sections: [section({ elements: { "Review 1": REAL, "Review 2": "another real one." } })],
    };
    const after = migrateLegacyProvenance(before);
    expect(after.sections[0].review_provenance).toEqual({
      "Review 1": { origin: "curated" },
      "Review 2": { origin: "curated" },
    });
    expect(unverifiedReviews(after)).toEqual([]);
  });

  it("leaves a section that already has provenance alone, so a stripped slot stays stripped", () => {
    const already: GeneratedCampaign = {
      meta: { subject_lines: [], preview_texts: [] },
      sections: [section({
        elements: { "Review 1": REAL, "Review 2": "model wrote this after the strip" },
        review_provenance: { "Review 1": FETCHED },
      })],
    };
    const after = migrateLegacyProvenance(already);
    expect(after).toBe(already);
    expect(unverifiedReviews(after)).toHaveLength(1);
  });

  it("is a no-op for a campaign with no reviews", () => {
    const plain: GeneratedCampaign = {
      meta: { subject_lines: [], preview_texts: [] },
      sections: [section({ type: "body", elements: { "Body Copy": "x" } })],
    };
    expect(migrateLegacyProvenance(plain)).toBe(plain);
  });
});

// The generation path's guard, tested at the wire level — this is where a
// fabricated review is caught as the model streams it, and it must be impossible
// for the guard itself to break a generation.
describe("guardReviewLine (the generation stream filter)", () => {
  const verified = verifiedIndex([{ text: REAL, provenance: FETCHED }]);
  const parse = (line: string) => JSON.parse(line) as {
    type: string;
    elements: Record<string, string>;
    review_provenance?: Record<string, ReviewProvenance>;
  };

  it("empties a review the model invented and keeps the one it was given", () => {
    const input = JSON.stringify({
      type: "reviews",
      elements: { Subheader: "What people say", "Review 1": REAL, "Review 2": "Best earbuds on the planet, hands down." },
    });
    const { line, stripped } = guardReviewLine(input, verified);
    const out = parse(line);
    expect(stripped).toEqual(["Review 2"]);
    expect(out.elements["Review 1"]).toBe(REAL);
    expect(out.elements["Review 2"]).toBe("");
    expect(out.elements.Subheader).toBe("What people say");
    expect(out.review_provenance?.["Review 1"]).toEqual(FETCHED);
    expect(out.review_provenance?.["Review 2"]).toBeUndefined();
  });

  it("matches on TEXT, so a review placed in the 'wrong' slot still survives", () => {
    const input = JSON.stringify({ type: "reviews", elements: { "Review 1": "", "Review 2": REAL } });
    const out = parse(guardReviewLine(input, verified).line);
    expect(out.elements["Review 2"]).toBe(REAL);
    expect(out.review_provenance?.["Review 2"]).toEqual(FETCHED);
  });

  it("covers a product card's single Review element", () => {
    const input = JSON.stringify({
      type: "product_card_review",
      elements: { "Product Name": "Everyday Earbuds", Review: "I made this up." },
    });
    const { line, stripped } = guardReviewLine(input, verified);
    expect(stripped).toEqual(["Review"]);
    expect(parse(line).elements.Review).toBe("");
  });

  it("passes lines with no review through byte-for-byte", () => {
    const input = JSON.stringify({ type: "header", elements: { Headline: "Motion Never Stops" } });
    expect(guardReviewLine(input, verified).line).toBe(input);
  });

  it("passes the meta line and partial JSON through untouched — it can never break a generation", () => {
    for (const line of [
      '{"meta":{"subject_lines":["a"],"preview_texts":["b"]}}',
      '{"type":"reviews","elements":{"Review 1":"half a li',
      "not json at all",
      "",
      "[DONE]",
    ]) {
      expect(guardReviewLine(line, verified).line).toBe(line);
    }
  });

  it("strips everything when the server resolved no reviews at all", () => {
    const input = JSON.stringify({ type: "reviews", elements: { "Review 1": REAL, "Review 2": REAL } });
    const { line, stripped } = guardReviewLine(input, new Map());
    expect(stripped).toEqual(["Review 1", "Review 2"]);
    expect(parse(line).elements["Review 1"]).toBe("");
  });
});
