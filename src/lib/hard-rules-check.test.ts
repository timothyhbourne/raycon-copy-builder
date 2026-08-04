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

  it("exempts real reviews from every scan and the exclamation budget", () => {
    const report = checkHardRules([el("review", "These are game-changing!!! Elevate everything!!!")]);
    expect(report.ok).toBe(true);
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
