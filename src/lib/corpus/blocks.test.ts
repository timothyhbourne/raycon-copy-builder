import { describe, it, expect } from "vitest";
import {
  computeFormBudget, formBudgetBlock, inFlightBlock, referenceBlock,
  selectReferenceSample, approvedSends, shippedHeadline, FORM_BUDGET_WINDOW,
} from "./blocks";
import { formSignature } from "./signature";
import type { CorpusRecord, CorpusTier, CorpusElement } from "./types";

// A record whose headline is `headline`, sent on `date`. Everything else is the
// least interesting thing that type-checks.
function rec(
  id: string,
  tier: CorpusTier,
  date: string,
  headline: string,
  extra: Partial<CorpusRecord> = {},
  elements: CorpusElement[] = [],
): CorpusRecord {
  return {
    id, tier, channel: "email", platform: "klaviyo", planner_row_id: `row-${id}`,
    approved_at: date, sent_at: date, title: `Campaign ${id}`,
    campaign_type: "promo", products_featured: [],
    elements: [
      { kind: "headline", text: headline, signature: formSignature(headline) },
      ...elements,
    ],
    performance: null,
    ...extra,
  };
}

describe("computeFormBudget", () => {
  it("counts one headline pattern per send, not one per header section", () => {
    // Two headlines in one record: only the shipped one votes.
    const record = rec("a", "shipped", "2026-08-01", "Motion Never Stops", {}, [
      { kind: "headline", text: "Best Part of Working Out", signature: formSignature("Best Part of Working Out") },
    ]);
    record.elements[0].was_selected = true;
    const budget = computeFormBudget([record]);
    expect(budget.counted).toBe(1);
    expect(budget.counts.product_truth).toBe(1);
    expect(budget.counts.bold_claim).toBe(0);
  });

  it("names the over-used patterns and the one to reach for", () => {
    const records = [
      rec("1", "shipped", "2026-08-01", "Summer Just Got Louder"),   // idiom_remix
      rec("2", "shipped", "2026-07-25", "Open All Summer"),          // idiom_remix
      rec("3", "shipped", "2026-07-18", "Ready for the Road"),       // idiom_remix
      rec("4", "shipped", "2026-07-11", "Still Going Strong"),       // idiom_remix
      rec("5", "shipped", "2026-07-04", "Best Part of Working Out"), // bold_claim
      rec("6", "shipped", "2026-06-27", "Sound Worth Celebrating"),  // bold_claim
      rec("7", "shipped", "2026-06-20", "Comfort Never Fades"),      // product_truth
      rec("8", "shipped", "2026-06-13", "Motion Never Stops"),       // product_truth
    ];
    const budget = computeFormBudget(records);
    expect(budget.counted).toBe(8);
    expect(budget.counts.idiom_remix).toBe(4);
    expect(budget.over_used).toContain("idiom_remix");
    // Exactly its fair share (2 of 8) is NOT over-used.
    expect(budget.over_used).not.toContain("bold_claim");
    expect(budget.reach_for).toEqual(["rhyme"]);
  });

  it("never bans every pattern when the spread is even", () => {
    const records = [
      rec("1", "shipped", "2026-08-01", "Summer Just Got Louder"),
      rec("2", "shipped", "2026-07-25", "Best Part of Working Out"),
      rec("3", "shipped", "2026-07-18", "Motion Never Stops"),
      rec("4", "shipped", "2026-07-11", "Fit That Won't Quit"),
    ];
    expect(computeFormBudget(records).over_used).toEqual([]);
  });

  it("bans nothing on a sample too small to call anything over-represented", () => {
    const budget = computeFormBudget([rec("1", "shipped", "2026-08-01", "Motion Never Stops")]);
    expect(budget.counted).toBe(1);
    expect(budget.over_used).toEqual([]);
  });

  it("counts approved-but-unsent sends, and ignores drafts", () => {
    const records = [
      rec("1", "approved", "2026-09-01", "Motion Never Stops"),
      rec("2", "drafted", "2026-08-01", "Summer Just Got Louder"),
    ];
    const budget = computeFormBudget(records);
    expect(budget.counted).toBe(1);
    expect(budget.counts.product_truth).toBe(1);
    expect(budget.counts.idiom_remix).toBe(0);
  });

  it("only looks back over the window", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      rec(`${i}`, "shipped", `2026-0${(i % 9) + 1}-01`, i < 4 ? "Motion Never Stops" : "Summer Just Got Louder"),
    );
    expect(computeFormBudget(many).counted).toBe(FORM_BUDGET_WINDOW);
  });
});

describe("formBudgetBlock", () => {
  it("is empty when nothing has been approved", () => {
    expect(formBudgetBlock(computeFormBudget([]))).toBe("");
  });

  it("states the distribution, deprioritises the over-used, and still asks for all four", () => {
    const records = [
      rec("1", "shipped", "2026-08-01", "Summer Just Got Louder"),
      rec("2", "shipped", "2026-07-25", "Open All Summer"),
      rec("3", "shipped", "2026-07-18", "Ready for the Road"),
      rec("4", "shipped", "2026-07-11", "Motion Never Stops"),
    ];
    const block = formBudgetBlock(computeFormBudget(records));
    expect(block).toContain("idiom_remix ×3");
    expect(block).toContain("Do NOT make it the FIRST");
    // The slate stays four wide: the budget rotates the default, it doesn't
    // shrink the writer's options.
    expect(block).toContain("one candidate per pattern");
  });
});

describe("inFlightBlock", () => {
  const scheduled = rec("future", "approved", "2026-09-05", "Motion Never Stops", {}, [
    { kind: "tagline", text: "20% off the Fitness Earbuds", signature: formSignature("20% off the Fitness Earbuds") },
    { kind: "subject", text: "Motion never stops. Neither do these.", signature: formSignature("Motion never stops. Neither do these.") },
  ]);
  const sent = rec("past", "shipped", "2026-07-01", "Fit That Won't Quit");

  it("is empty with no corpus", () => {
    expect(inFlightBlock([])).toBe("");
  });

  it("surfaces approved-but-unsent copy as in flight", () => {
    const block = inFlightBlock([scheduled, sent]);
    expect(block).toContain("NOT YET SENT");
    expect(block).toContain("Motion Never Stops");
    expect(block).toContain("approved, in flight");
  });

  it("lists constructions in use as shapes, not as lines", () => {
    const block = inFlightBlock([sent]);
    expect(block).toContain("CONSTRUCTIONS ALREADY IN USE");
    expect(block).toContain("rhyme");
    // The construction list describes; it does not re-quote (the lexical avoid
    // block already carries the words).
    const constructions = block.split("CONSTRUCTIONS ALREADY IN USE")[1];
    expect(constructions).not.toContain("Fit That Won't Quit");
  });

  it("excludes the campaign being rewritten", () => {
    expect(inFlightBlock([scheduled], { excludeId: "future" })).toBe("");
  });
});

describe("selectReferenceSample", () => {
  const pool = [
    rec("p1", "shipped", "2026-08-01", "Summer Just Got Louder", { campaign_type: "promo" }),
    rec("p2", "shipped", "2026-07-25", "Best Part of Working Out", { campaign_type: "promo" }),
    rec("p3", "shipped", "2026-07-18", "Motion Never Stops", { campaign_type: "promo" }),
    rec("p4", "shipped", "2026-07-11", "Fit That Won't Quit", { campaign_type: "promo" }),
    rec("p5", "shipped", "2026-07-04", "Open All Summer", { campaign_type: "launch" }),
    rec("p6", "shipped", "2026-06-27", "Sound Worth Celebrating", { campaign_type: "launch" }),
    rec("d1", "drafted", "2026-08-10", "Never Gets Old", { campaign_type: "promo" }),
    rec("a1", "approved", "2026-09-10", "Time's Almost Up", { campaign_type: "promo" }),
  ];

  it("draws only from shipped copy", () => {
    const sample = selectReferenceSample(pool, {}, { rotation: 0 });
    expect(sample.every((r) => r.tier === "shipped")).toBe(true);
  });

  // Acceptance criterion (§4).
  it("differs between two consecutive generations of the same brief", () => {
    const brief = { campaign_type: "promo" };
    const first = selectReferenceSample(pool, brief, { rotation: 1 }).map((r) => r.id);
    const second = selectReferenceSample(pool, brief, { rotation: 2 }).map((r) => r.id);
    expect(first).not.toEqual(second);
  });

  it("prefers relevance to the brief", () => {
    const sample = selectReferenceSample(pool, { campaign_type: "launch" }, { rotation: 0, size: 2 });
    expect(sample[0].campaign_type).toBe("launch");
  });

  it("does not hand back four instances of one construction", () => {
    const samey = [
      rec("s1", "shipped", "2026-08-01", "Motion Never Stops"),
      rec("s2", "shipped", "2026-07-25", "Sound Never Quits"),
      rec("s3", "shipped", "2026-07-18", "Comfort Never Fades"),
      rec("s4", "shipped", "2026-07-11", "Fit That Won't Quit"),
      rec("s5", "shipped", "2026-07-04", "Best Part of Working Out"),
    ];
    const sample = selectReferenceSample(samey, {}, { rotation: 0, size: 4 });
    const patterns = sample.map((r) => shippedHeadline(r)!.signature.pattern);
    expect(new Set(patterns).size).toBeGreaterThan(1);
  });

  it("is performance-blind: a high earner gets no ranking advantage", () => {
    // Attraction may never operate on form (§2.1). Ranking references by revenue
    // would be exactly that.
    const withMoney = pool.map((r) =>
      r.id === "p6" ? { ...r, performance: { recipients: 1000, revenue: 99999, rpr: 99, basis: "platform" as const } } : r,
    );
    const before = selectReferenceSample(pool, { campaign_type: "promo" }, { rotation: 0 }).map((r) => r.id);
    const after = selectReferenceSample(withMoney, { campaign_type: "promo" }, { rotation: 0 }).map((r) => r.id);
    expect(after).toEqual(before);
  });
});

describe("referenceBlock", () => {
  it("is empty with no sample", () => {
    expect(referenceBlock([])).toBe("");
  });

  it("supersedes the frozen table and warns against reusing the constructions", () => {
    const block = referenceBlock([rec("p1", "shipped", "2026-08-01", "Summer Just Got Louder")]);
    expect(block).toContain("REPLACES the 11-row canonical table");
    expect(block).toContain("Summer Just Got Louder");
    expect(block).toContain("NOT templates");
  });
});

describe("approvedSends", () => {
  it("is newest-first and excludes drafts", () => {
    const records = [
      rec("old", "shipped", "2026-06-01", "Motion Never Stops"),
      rec("new", "approved", "2026-09-01", "Fit That Won't Quit"),
      rec("draft", "drafted", "2026-08-01", "Open All Summer"),
    ];
    expect(approvedSends(records).map((r) => r.id)).toEqual(["new", "old"]);
  });
});
