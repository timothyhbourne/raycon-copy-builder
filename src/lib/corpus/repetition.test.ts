import { describe, it, expect } from "vitest";
import { scanForms } from "./repetition";
import { formSignature, FORM_SIMILARITY_THRESHOLD } from "./signature";
import type { CorpusRecord, CorpusTier, ElementKind } from "./types";

function record(id: string, tier: CorpusTier, kind: ElementKind, text: string): CorpusRecord {
  return {
    id, tier, channel: "email", platform: "klaviyo", planner_row_id: null,
    approved_at: "2026-08-01", sent_at: "2026-08-01", title: `Campaign ${id}`,
    campaign_type: "promo", products_featured: [],
    elements: [{ kind, text, signature: formSignature(text) }],
    performance: null,
  };
}

const corpus = [
  record("sent", "shipped", "headline", "Motion Never Stops"),
  record("flight", "approved", "headline", "Comfort Never Fades"),
  record("draft", "drafted", "headline", "Traction Never Slips"),
];

describe("scanForms", () => {
  // The spec's acceptance criterion, end to end through the scan.
  it("flags a headline that shares a construction and no words with a past send", () => {
    const [match] = scanForms([{ id: "h", kind: "headline", text: "Sound Never Quits" }], [corpus[0]]);
    expect(match).toBeDefined();
    expect(match.reason).toBe("form");
    expect(match.match_text).toBe("Motion Never Stops");
    expect(match.construction).toContain("product_truth");
    expect(match.score).toBeGreaterThanOrEqual(FORM_SIMILARITY_THRESHOLD);
  });

  it("repels from approved-but-unsent copy as hard as from copy already sent", () => {
    const sentOnly = scanForms([{ id: "h", kind: "headline", text: "Sound Never Quits" }], [corpus[0]])[0];
    const flightOnly = scanForms([{ id: "h", kind: "headline", text: "Sound Never Quits" }], [corpus[1]])[0];
    expect(flightOnly).toBeDefined();
    expect(flightOnly.score).toBeCloseTo(sentOnly.score);
    expect(flightOnly.match_campaign_title).toContain("in flight");
  });

  it("weights a draft lower than a send", () => {
    const draftOnly = scanForms([{ id: "h", kind: "headline", text: "Sound Never Quits" }], [corpus[2]])[0];
    const sentOnly = scanForms([{ id: "h", kind: "headline", text: "Sound Never Quits" }], [corpus[0]])[0];
    expect(draftOnly.score).toBeLessThan(sentOnly.score);
  });

  it("never compares across element kinds", () => {
    // The same construction as a past HEADLINE is not a repetitive TAGLINE.
    expect(scanForms([{ id: "t", kind: "tagline", text: "Sound Never Quits" }], corpus)).toEqual([]);
  });

  it("leaves near-verbatim reuse to the lexical checker", () => {
    // Same line, different case: the lexical scan reports this, and reporting it
    // here too would double-flag one defect.
    expect(scanForms([{ id: "h", kind: "headline", text: "motion never stops" }], [corpus[0]])).toEqual([]);
  });

  it("reports the single strongest match per element", () => {
    const matches = scanForms([{ id: "h", kind: "headline", text: "Sound Never Quits" }], corpus);
    expect(matches).toHaveLength(1);
    expect(matches[0].tier).not.toBe("drafted"); // the higher-weighted match wins
  });

  it("excludes the campaign being rewritten", () => {
    expect(scanForms([{ id: "h", kind: "headline", text: "Sound Never Quits" }], [corpus[0]], { excludeId: "sent" })).toEqual([]);
  });

  it("returns nothing when the corpus is empty, rather than failing", () => {
    expect(scanForms([{ id: "h", kind: "headline", text: "Sound Never Quits" }], [])).toEqual([]);
    expect(scanForms([], corpus)).toEqual([]);
    expect(scanForms([{ id: "h", kind: "headline", text: "   " }], corpus)).toEqual([]);
  });

  it("does not flag a genuinely different construction", () => {
    expect(scanForms([{ id: "h", kind: "headline", text: "Best Part of Working Out" }], corpus)).toEqual([]);
  });
});
