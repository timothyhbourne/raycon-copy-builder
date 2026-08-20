import { describe, it, expect } from "vitest";
import { checkHardRules, autoFixMechanical, type HardRuleElement } from "./hard-rules-check";

const el = (kind: HardRuleElement["kind"], text: string, id = "x"): HardRuleElement => ({ id, kind, text });

describe("checkHardRules", () => {
  it("clean copy passes", () => {
    const report = checkHardRules([el("body", "Your earbuds, ready for the commute.")]);
    expect(report.ok).toBe(true);
    expect(report.elements).toHaveLength(0);
  });

  it("flags banned hype", () => {
    const report = checkHardRules([el("headline", "Elevate your everyday")]);
    expect(report.ok).toBe(false);
    expect(report.elements[0].violations.length).toBeGreaterThan(0);
  });

  it("enforces the email-wide exclamation budget (max 2)", () => {
    const report = checkHardRules([
      el("body", "One!", "a"),
      el("body", "Two!", "b"),
      el("body", "Three!", "c"),
    ]);
    expect(report.ok).toBe(false);
    expect(report.emailLevel.some((v) => v.rule === "exclamation-budget")).toBe(true);
  });

  // A review with provenance is real customer text: it legitimately breaks the
  // voice rules, the ban list and the exclamation budget, and none of that applies.
  it("exempts a PROVENANCED review from every style scan and the exclamation budget", () => {
    const report = checkHardRules([
      { ...el("review", "These are game-changing!!! Elevate everything!!!"), provenance: { origin: "fetched" } },
    ]);
    expect(report.ok).toBe(true);
    expect(report.blockingCount).toBe(0);
  });

  // …but the exemption used to be unconditional, so a review the MODEL wrote passed
  // every gate in the app in silence. Where the text came from is the one rule that
  // does apply (docs/REVIEWS_MODULE_SPEC.md §5.2 point 3).
  it("flags a review with NO provenance, and marks it blocking", () => {
    const report = checkHardRules([el("review", "I have never owned a better pair of earbuds.")]);
    expect(report.ok).toBe(false);
    expect(report.blockingCount).toBe(1);
    const violation = report.elements[0].violations[0];
    expect(violation.rule).toBe("review-provenance");
    expect(violation.blocking).toBe(true);
    expect(violation.fixable).toBe(false);
  });

  it("flags a review explicitly marked unverified", () => {
    const report = checkHardRules([
      { ...el("review", "Model wrote this one."), provenance: { origin: "unverified" } },
    ]);
    expect(report.blockingCount).toBe(1);
    expect(report.elements[0].violations[0].detail).toMatch(/written by the model/i);
  });

  it("accepts manual and curated origins", () => {
    for (const origin of ["manual", "curated"] as const) {
      const report = checkHardRules([{ ...el("review", "Real words from a real person."), provenance: { origin } }]);
      expect(report.ok, origin).toBe(true);
    }
  });

  it("does not flag an EMPTY review slot — an empty slot is the honest outcome", () => {
    const report = checkHardRules([el("review", "   ")]);
    expect(report.ok).toBe(true);
    expect(report.blockingCount).toBe(0);
  });

  it("keeps every other violation advisory, not blocking", () => {
    const report = checkHardRules([el("headline", "Say Goodbye To Bad Sound")]);
    expect(report.ok).toBe(false);
    expect(report.blockingCount).toBe(0);
  });

  it("flags a Product Name that is not an exact catalogue name", () => {
    const report = checkHardRules([el("product_name", "Definitely Not A Real SKU")]);
    expect(report.ok).toBe(false);
    expect(report.elements[0].violations.some((v) => v.rule === "product-name-drift")).toBe(true);
  });
});

describe("autoFixMechanical", () => {
  it("turns a digit range em-dash into a hyphen", () => {
    expect(autoFixMechanical("15—50% off")).toBe("15-50% off");
  });
  it("turns a spaced em-dash into a comma", () => {
    expect(autoFixMechanical("clean — looks great")).toBe("clean, looks great");
  });
  it("turns an ellipsis into a period", () => {
    expect(autoFixMechanical("wait for it…")).toBe("wait for it.");
    expect(autoFixMechanical("wait for it...")).toBe("wait for it.");
  });
  it("collapses stacked exclamations", () => {
    expect(autoFixMechanical("wow!!!")).toBe("wow!");
  });
});
