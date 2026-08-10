import { describe, it, expect } from "vitest";
import {
  parsePlannerRow, parsePlannerRows, parseLibraryCampaigns,
  parseSavedCampaign, stamp, stampAll, SCHEMA_VERSION,
} from "./index";

const baseRow = {
  id: "a", name: "A", channel: "email", offer: "20% off",
  planned_send_at: "2026-07-01", status: "planned",
  audience_included: [], audience_excluded: [], notes: "",
  created_at: "x", updated_at: "y",
};

describe("planner migration + validation", () => {
  it("migrates a legacy status and a free-typed audience string", () => {
    const row = parsePlannerRow({ ...baseRow, status: "idea", audience_included: ["VIPs"] });
    expect(row).not.toBeNull();
    expect(row!.status).toBe("writing_brief");
    expect(row!.audience_included).toEqual([{ id: "", name: "VIPs", type: "segment" }]);
    expect(row!.offer_type).toBe("evergreen");
  });

  it("infers offer_type = promo when a promo_code is present", () => {
    const row = parsePlannerRow({ ...baseRow, promo_code: "SAVE30" });
    expect(row!.offer_type).toBe("promo");
  });

  it("drops malformed rows while keeping valid ones", () => {
    const rows = parsePlannerRows([
      { ...baseRow, id: "good" },
      { id: "bad", channel: "carrier-pigeon" },
      "not even an object",
    ]);
    expect(rows.map((r) => r.id)).toEqual(["good"]);
  });

  it("returns [] for non-array input rather than throwing", () => {
    expect(parsePlannerRows("nope" as unknown)).toEqual([]);
    expect(parsePlannerRows(null)).toEqual([]);
  });

  it("preserves unknown fields (no data loss on round-trip)", () => {
    const row = parsePlannerRow({ ...baseRow, some_future_field: 42 });
    expect((row as unknown as { some_future_field: number }).some_future_field).toBe(42);
  });
});

describe("library / saved validation", () => {
  it("skips a malformed library entry but keeps the good one", () => {
    const list = parseLibraryCampaigns([
      { foo: 1 },
      {
        id: "c", title: "t", date: "2026-07-01", campaign_type: "promo", offer: "",
        hero_angle: "", audience: "all", products_featured: [], conceit: "",
        source: "generated", body: "",
      },
    ]);
    expect(list.map((c) => c.id)).toEqual(["c"]);
  });

  it("parseSavedCampaign returns null on garbage instead of throwing", () => {
    expect(parseSavedCampaign({})).toBeNull();
    expect(parseSavedCampaign(null)).toBeNull();
  });
});

describe("element-level editing / removed design feature", () => {
  const savedWith = (section: Record<string, unknown>) => ({
    id: "s", campaign_name: "n", campaign_type: "promo", offer: "30% off", audience: "all",
    products_featured: ["O25"], section_structure: [],
    campaign: { meta: { subject_lines: [], preview_texts: [] }, sections: [section] },
    status: "draft", created_at: "x", updated_at: "y",
  });

  it("still loads a campaign carrying the legacy design_image field", () => {
    // The "Design this" feature is gone and design_image is off the interface, but
    // saved drafts and library snapshots may still carry it. Loose validation must
    // preserve rather than reject — no migration, dead data is harmless.
    const saved = parseSavedCampaign(savedWith({
      id: "h", type: "header", elements: { Headline: "Hi" },
      design_image: "data:image/png;base64,AAAA",
    }));
    expect(saved).not.toBeNull();
    expect(saved!.campaign.sections[0].elements.Headline).toBe("Hi");
    expect((saved!.campaign.sections[0] as unknown as Record<string, unknown>).design_image)
      .toBe("data:image/png;base64,AAAA");
  });

  it("round-trips canvas-level removed_elements on a generated section", () => {
    const saved = parseSavedCampaign(savedWith({
      id: "r", type: "reviews",
      elements: { "Review 1": "a", "Review 2": "b" },
      removed_elements: ["Subheader", "Review 3"],
    }));
    expect(saved).not.toBeNull();
    expect(saved!.campaign.sections[0].removed_elements).toEqual(["Subheader", "Review 3"]);
  });

  it("accepts a section with no removed_elements (backward compatible)", () => {
    const saved = parseSavedCampaign(savedWith({ id: "b", type: "body", elements: { "Body Copy": "x" } }));
    expect(saved).not.toBeNull();
    expect(saved!.campaign.sections[0].removed_elements).toBeUndefined();
  });

  it("rejects a removed_elements that is not a string array", () => {
    expect(parseSavedCampaign(savedWith({
      id: "b", type: "body", elements: { "Body Copy": "x" }, removed_elements: "Subheader",
    }))).toBeNull();
  });
});

describe("schema_version stamping", () => {
  it("stamp adds the current version", () => {
    expect(stamp({ a: 1 }).schema_version).toBe(SCHEMA_VERSION);
  });
  it("stampAll stamps every record", () => {
    expect(stampAll([{ a: 1 }, { a: 2 }]).every((r) => r.schema_version === SCHEMA_VERSION)).toBe(true);
  });
});
