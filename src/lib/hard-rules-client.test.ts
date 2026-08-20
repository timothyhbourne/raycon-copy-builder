import { describe, it, expect } from "vitest";
import { scrubElements, scrubMeta, collectHardRuleElements } from "./hard-rules-client";
import type { GeneratedCampaign } from "./schemas";

// The punctuation autofix rewrites em dashes, ellipses and stacked "!". That is
// right for our copy and WRONG for a customer's words — and the exemption used to
// test `k === "Review"`, so it covered a product card's single Review and missed
// every "Review 1".."Review 6" slot of a reviews section. The damage was double:
// it edited what a customer said, and it broke the verbatim match that the
// provenance gate depends on (docs/REVIEWS_MODULE_SPEC.md §5).
describe("scrubElements — review exemption", () => {
  const withDash = "These never slip, even on a run — best pair I've owned. — Jordan M.";

  it("leaves a product card's Review untouched", () => {
    expect(scrubElements({ Review: withDash }).Review).toBe(withDash);
  });

  it("leaves a reviews section's numbered slots untouched", () => {
    const out = scrubElements({ "Review 1": withDash, "Review 2": withDash, "Review 6": withDash });
    expect(out["Review 1"]).toBe(withDash);
    expect(out["Review 2"]).toBe(withDash);
    expect(out["Review 6"]).toBe(withDash);
  });

  it("still scrubs our own copy in the same section", () => {
    const out = scrubElements({ Subheader: "Real sound — real value", "Review 1": withDash });
    expect(out.Subheader).not.toContain("—");
    expect(out["Review 1"]).toBe(withDash);
  });
});

describe("scrubMeta", () => {
  it("scrubs the lines and preserves the selection fields", () => {
    const out = scrubMeta({
      subject_lines: ["30% off — today only", "b", "c"],
      preview_texts: ["x", "y", "z"],
      subject_selected: 2,
      preview_selected: 1,
    });
    expect(out.subject_lines[0]).not.toContain("—");
    expect(out.subject_selected).toBe(2);
    expect(out.preview_selected).toBe(1);
  });
});

describe("collectHardRuleElements — review provenance", () => {
  const campaign = (): GeneratedCampaign => ({
    meta: { subject_lines: [], preview_texts: [] },
    sections: [{
      id: "s1",
      type: "reviews",
      elements: { "Review 1": "A real one.", "Review 2": "A made up one." },
      review_provenance: { "Review 1": { origin: "fetched" } },
    }],
  });

  it("carries each review's provenance to the checker, so it can judge the SOURCE", () => {
    const els = collectHardRuleElements(campaign());
    const one = els.find((e) => e.id === "s1::Review 1");
    const two = els.find((e) => e.id === "s1::Review 2");
    expect(one?.kind).toBe("review");
    expect(one?.provenance).toEqual({ origin: "fetched" });
    expect(two?.provenance).toBeUndefined();
  });
});
