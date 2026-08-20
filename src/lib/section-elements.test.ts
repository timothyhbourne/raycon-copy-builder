import { describe, it, expect } from "vitest";
import { sectionElementNames, reviewSlotsOf, reviewsElements, REVIEW_SLOT_MAX, REVIEW_SLOT_MIN } from "./schemas";
import type { SectionSpec } from "./schemas";

// sectionElementNames() is THE single source of truth for which elements a section
// produces — the prompt, the JSONL skeleton, regeneration, the canvas and the fetch
// limit all read it. Getting the review count in here is what makes one control fix
// every surface at once (docs/REVIEWS_MODULE_SPEC.md §3).
const spec = (over: Partial<SectionSpec> = {}): SectionSpec => ({ id: "s1", type: "reviews", ...over });

describe("reviewSlotsOf", () => {
  it("falls back to 3 product-sourced slots for a section saved before slots existed", () => {
    expect(reviewSlotsOf({})).toEqual([
      { source: "product" }, { source: "product" }, { source: "product" },
    ]);
  });

  it("honours an explicit plan", () => {
    const slots = reviewSlotsOf({ review_slots: [{ source: "manual", manual_text: "x" }, { source: "url", source_url: "https://a" }] });
    expect(slots).toHaveLength(2);
    expect(slots[0].source).toBe("manual");
  });

  it("clamps to the supported range", () => {
    const many = Array.from({ length: 12 }, () => ({ source: "product" as const }));
    expect(reviewSlotsOf({ review_slots: many })).toHaveLength(REVIEW_SLOT_MAX);
    expect(reviewSlotsOf({ review_slots: [] })).toHaveLength(3); // empty = legacy default
  });
});

describe("reviewsElements", () => {
  it("names one element per slot", () => {
    expect(reviewsElements(2)).toEqual(["Subheader", "Review 1", "Review 2"]);
    expect(reviewsElements(6)).toHaveLength(7);
  });
  it("clamps out-of-range counts", () => {
    expect(reviewsElements(99)).toHaveLength(REVIEW_SLOT_MAX + 1);
    expect(reviewsElements(0)).toHaveLength(4); // 0 = unset → the 3-slot default
    expect(reviewsElements(1)).toHaveLength(REVIEW_SLOT_MIN + 1);
  });
});

describe("sectionElementNames — reviews", () => {
  it("derives the review count from the spec, not the static catalogue", () => {
    expect(sectionElementNames(spec({ review_slots: [{ source: "product" }, { source: "product" }, { source: "product" }, { source: "product" }, { source: "product" }] })))
      .toEqual(["Subheader", "Review 1", "Review 2", "Review 3", "Review 4", "Review 5"]);
  });

  it("keeps today's shape for a legacy section with no slots", () => {
    expect(sectionElementNames(spec())).toEqual(["Subheader", "Review 1", "Review 2", "Review 3"]);
  });

  it("supports a single-review section", () => {
    expect(sectionElementNames(spec({ review_slots: [{ source: "manual" }] })))
      .toEqual(["Subheader", "Review 1"]);
  });

  it("leaves other section types alone", () => {
    expect(sectionElementNames({ type: "header" })).toEqual(["Headline", "Tagline", "CTA"]);
    expect(sectionElementNames({ type: "usps" }).filter((e) => e.startsWith("USP "))).toHaveLength(3);
  });
});
