import { describe, it, expect } from "vitest";
import {
  aggregate, toRecord, attributesFromSaved, attributesFromLibrary, structureInfo,
  MIN_N, type PerformanceRecord, type CopyAttributes,
} from "./copy-performance";
import type { PlannerRow } from "./planner-types";
import type { SavedCampaign, LibraryCampaign, SectionSpec } from "./schemas";

// A minimal planner row; override the metric fields per test.
function row(over: Partial<PlannerRow> = {}): PlannerRow {
  return {
    id: over.id ?? "r1",
    name: over.name ?? "Row",
    channel: over.channel ?? "email",
    offer_type: over.offer_type ?? "promo",
    offer: "20% off",
    planned_send_at: "2026-08-01T12:00:00.000Z",
    status: "scheduled",
    audience_included: [],
    audience_excluded: [],
    notes: "",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...over,
  } as PlannerRow;
}

// A record with a given angle + platform rpr, attributed, for aggregation tests.
function rec(over: Partial<PerformanceRecord> & { attributes?: CopyAttributes }): PerformanceRecord {
  return {
    row_id: "r", name: "n", channel: "email", send_date: "2026-08-01",
    recipients: 1000, rpr: 1, revenue: 1000, northbeam_revenue: null, northbeam_rpr: null,
    open_rate: null, click_rate: null, metrics_synced_at: "x", metrics_source: null,
    attributes: {}, attribution_source: "saved",
    ...over,
  };
}

describe("platform RPR derivation (toRecord)", () => {
  it("prefers the stored/overridden revenue_per_recipient", () => {
    const r = toRecord(row({ revenue: 1000, recipients: 500, revenue_per_recipient: 3 }), null);
    expect(r.rpr).toBe(3); // stored wins over 1000/500=2
  });
  it("derives revenue/recipients when no stored value", () => {
    const r = toRecord(row({ revenue: 1000, recipients: 500, revenue_per_recipient: null }), null);
    expect(r.rpr).toBe(2);
  });
  it("is null (not 0) when recipients is missing", () => {
    const r = toRecord(row({ revenue: 1000, recipients: null, revenue_per_recipient: null }), null);
    expect(r.rpr).toBeNull();
  });
  it("derives northbeam_rpr from northbeam_revenue / recipients", () => {
    const r = toRecord(row({ northbeam_revenue: 800, recipients: 400 }), null);
    expect(r.northbeam_rpr).toBe(2);
  });
  it("no attribution → unattributed source", () => {
    expect(toRecord(row(), null).attribution_source).toBe("unattributed");
  });
});

describe("attribute extraction", () => {
  const sections: SectionSpec[] = [
    { id: "1", type: "header" }, { id: "2", type: "body" }, { id: "3", type: "reviews" },
  ];
  it("structureInfo builds a signature + boolean flags", () => {
    const info = structureInfo(sections);
    expect(info.structure_signature).toBe("header→body→reviews");
    expect(info.includes_reviews).toBe(true);
    expect(info.includes_product_grid).toBe(false);
  });
  it("attributesFromSaved pulls angle/conceit-architecture/type + offer_type from the row", () => {
    const saved = {
      campaign_type: "promo", angle: "offer_led", audience: "engaged",
      chosen_conceit: { id: "c", name: "x", description: "y", architecture: "story_led" },
      section_structure: sections, promotion_id: "p1",
    } as unknown as SavedCampaign;
    const a = attributesFromSaved(saved, row({ offer_type: "promo" }));
    expect(a.angle).toBe("offer_led");
    expect(a.conceit_architecture).toBe("story_led");
    expect(a.occasion_kind).toBe("promo_calendar");
    expect(a.includes_reviews).toBe(true);
    expect(a.offer_type).toBe("promo");
  });
  it("attributesFromLibrary carries fewer dimensions (no angle/architecture)", () => {
    const lib = {
      campaign_type: "story", audience: "all",
      structured: { section_structure: sections },
    } as unknown as LibraryCampaign;
    const a = attributesFromLibrary(lib, row());
    expect(a.campaign_type).toBe("story");
    expect(a.angle).toBeUndefined();
    expect(a.includes_reviews).toBe(true);
  });
});

describe("aggregate — basis selection", () => {
  const records = [
    rec({ attributes: { angle: "offer_led" }, rpr: 2, revenue: 2000, northbeam_revenue: 1000, northbeam_rpr: 1 }),
    rec({ attributes: { angle: "offer_led" }, rpr: 4, revenue: 4000, northbeam_revenue: 3000, northbeam_rpr: 3 }),
  ];
  it("platform basis uses rpr/revenue", () => {
    const { aggregates } = aggregate(records, "platform", 1);
    const angle = aggregates.find((a) => a.dimension === "angle")!.values[0];
    expect(angle.mean_rpr).toBe(3); // (2+4)/2
    expect(angle.total_revenue).toBe(6000);
  });
  it("northbeam basis uses northbeam_rpr/revenue and never mixes", () => {
    const { aggregates } = aggregate(records, "northbeam", 1);
    const angle = aggregates.find((a) => a.dimension === "angle")!.values[0];
    expect(angle.mean_rpr).toBe(2); // (1+3)/2
    expect(angle.total_revenue).toBe(4000);
  });
  it("records missing the chosen basis are excluded from that basis", () => {
    const mixed = [
      rec({ attributes: { angle: "story_led" }, rpr: 5, northbeam_rpr: null, northbeam_revenue: null }),
    ];
    expect(aggregate(mixed, "platform", 1).aggregates.find((a) => a.dimension === "angle")!.values.length).toBe(1);
    expect(aggregate(mixed, "northbeam", 1).aggregates.find((a) => a.dimension === "angle")!.values.length).toBe(0);
  });
});

describe("aggregate — min-n, median, unattributed", () => {
  it("flags values below MIN_N as low_confidence", () => {
    const two = [
      rec({ attributes: { angle: "offer_led" }, rpr: 1 }),
      rec({ attributes: { angle: "offer_led" }, rpr: 3 }),
    ];
    const v = aggregate(two, "platform", MIN_N).aggregates.find((a) => a.dimension === "angle")!.values[0];
    expect(v.n).toBe(2);
    expect(v.low_confidence).toBe(true); // 2 < 3
  });
  it("reports median alongside mean (whale-resistant)", () => {
    const skewed = [
      rec({ attributes: { angle: "x" }, rpr: 1 }),
      rec({ attributes: { angle: "x" }, rpr: 1 }),
      rec({ attributes: { angle: "x" }, rpr: 100 }),
    ];
    const v = aggregate(skewed, "platform", 1).aggregates.find((a) => a.dimension === "angle")!.values[0];
    expect(v.mean_rpr).toBeCloseTo(34);
    expect(v.median_rpr).toBe(1);
  });
  it("buckets unattributed into coverage, excludes them from aggregates", () => {
    const records = [
      rec({ attribution_source: "saved", attributes: { angle: "offer_led" }, rpr: 2, revenue: 2000 }),
      rec({ attribution_source: "unattributed", attributes: {}, rpr: 9, revenue: 5000 }),
    ];
    const { aggregates, coverage } = aggregate(records, "platform", 1);
    expect(coverage.sent_count).toBe(2);
    expect(coverage.attributed_count).toBe(1);
    expect(coverage.attributed_coverage).toBe(0.5);
    expect(coverage.unattributed_revenue).toBe(5000);
    // The unattributed record's angle is absent, so only the attributed one counts.
    const angle = aggregates.find((a) => a.dimension === "angle")!;
    expect(angle.values.length).toBe(1);
    expect(angle.values[0].total_revenue).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// The pooled (recipient-weighted) estimator and the dispersion guard.
// docs/RECURSIVE_LEARNING_FRAMEWORK_SPEC.md §2.7.
// ---------------------------------------------------------------------------
describe("aggregate — recipient-weighted pooling", () => {
  it("does not let a tiny test send outvote a big blast", () => {
    // A 2,000-recipient send at $5.00 RPR and a 400,000-recipient send at $1.00.
    // The unweighted mean says $3.00; the account actually earned $1.02 per
    // recipient. Only the second number is a fact about the business.
    const records = [
      rec({ attributes: { angle: "offer_led" }, rpr: 5, revenue: 10_000, recipients: 2_000 }),
      rec({ attributes: { angle: "offer_led" }, rpr: 1, revenue: 400_000, recipients: 400_000 }),
    ];
    const v = aggregate(records, "platform", 1).aggregates.find((a) => a.dimension === "angle")!.values[0];
    expect(v.mean_rpr).toBe(3);
    expect(v.pooled_rpr).toBeCloseTo(410_000 / 402_000);
  });

  it("ranks on the pooled figure, not the unweighted mean", () => {
    const records = [
      // "story_led" wins on the unweighted mean off one small send…
      rec({ attributes: { angle: "story_led" }, rpr: 9, revenue: 9_000, recipients: 1_000 }),
      rec({ attributes: { angle: "story_led" }, rpr: 0.5, revenue: 150_000, recipients: 300_000 }),
      // …while "offer_led" is the one that actually earns per recipient.
      rec({ attributes: { angle: "offer_led" }, rpr: 2, revenue: 200_000, recipients: 100_000 }),
      rec({ attributes: { angle: "offer_led" }, rpr: 2, revenue: 200_000, recipients: 100_000 }),
    ];
    const values = aggregate(records, "platform", 1).aggregates.find((a) => a.dimension === "angle")!.values;
    expect(values[0].value).toBe("offer_led");
    // Confirm the old estimator would have got this backwards.
    const storyLed = values.find((v) => v.value === "story_led")!;
    expect(storyLed.mean_rpr).toBeGreaterThan(values[0].mean_rpr);
  });

  it("falls back to the unweighted mean when recipient counts are missing", () => {
    const records = [
      rec({ attributes: { angle: "offer_led" }, rpr: 2, revenue: 0, recipients: null }),
      rec({ attributes: { angle: "offer_led" }, rpr: 4, revenue: 0, recipients: null }),
    ];
    const v = aggregate(records, "platform", 1).aggregates.find((a) => a.dimension === "angle")!.values[0];
    expect(v.pooled_rpr).toBe(3);
  });
});

describe("aggregate — dispersion eligibility", () => {
  it("is ineligible with only one bucket at n >= minN", () => {
    const records = [
      rec({ attributes: { angle: "offer_led" }, rpr: 2, revenue: 2_000, recipients: 1_000 }),
      rec({ attributes: { angle: "offer_led" }, rpr: 3, revenue: 3_000, recipients: 1_000 }),
    ];
    const agg = aggregate(records, "platform", 2).aggregates.find((a) => a.dimension === "angle")!;
    expect(agg.spread.groups).toBe(1);
    expect(agg.spread.eligible).toBe(false);
  });

  it("is ineligible when the buckets overlap more than they differ", () => {
    // Two buckets whose pooled RPRs are nearly identical but whose members are all
    // over the place: the ranking here is noise.
    const records = [
      rec({ attributes: { angle: "offer_led" }, rpr: 0.5, revenue: 500, recipients: 1_000 }),
      rec({ attributes: { angle: "offer_led" }, rpr: 3.5, revenue: 3_500, recipients: 1_000 }),
      rec({ attributes: { angle: "story_led" }, rpr: 0.4, revenue: 400, recipients: 1_000 }),
      rec({ attributes: { angle: "story_led" }, rpr: 3.6, revenue: 3_600, recipients: 1_000 }),
    ];
    const agg = aggregate(records, "platform", 2).aggregates.find((a) => a.dimension === "angle")!;
    expect(agg.spread.groups).toBe(2);
    expect(agg.spread.within).toBeGreaterThan(agg.spread.between);
    expect(agg.spread.eligible).toBe(false);
  });

  it("is eligible when tight buckets sit far apart", () => {
    const records = [
      rec({ attributes: { angle: "offer_led" }, rpr: 4.0, revenue: 4_000, recipients: 1_000 }),
      rec({ attributes: { angle: "offer_led" }, rpr: 4.1, revenue: 4_100, recipients: 1_000 }),
      rec({ attributes: { angle: "story_led" }, rpr: 1.0, revenue: 1_000, recipients: 1_000 }),
      rec({ attributes: { angle: "story_led" }, rpr: 1.1, revenue: 1_100, recipients: 1_000 }),
    ];
    const agg = aggregate(records, "platform", 2).aggregates.find((a) => a.dimension === "angle")!;
    expect(agg.spread.eligible).toBe(true);
    expect(agg.values[0].value).toBe("offer_led");
  });
});
