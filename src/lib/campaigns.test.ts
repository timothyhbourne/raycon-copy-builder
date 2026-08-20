import { describe, it, expect } from "vitest";
import { parseSavedCampaign } from "./validation";
import type { SavedCampaign } from "./schemas";

// Regression guard for the draft round trip. The store writes drafts as
// gray-matter frontmatter, and js-yaml refuses to dump `undefined` — so every
// optional field is written as `null` and must be read back as `undefined`, or the
// schema (which types them as `string | undefined`) drops the whole record at the
// read boundary. That failure mode is invisible from the UI: the POST returns 200
// and the draft is simply never in the list again.
describe("saved-campaign read boundary", () => {
  const base = {
    id: "2026-08-20-untitled-abc123",
    campaign_name: "Hand written",
    campaign_type: "promo",
    offer: "20% off",
    audience: "all",
    products_featured: [],
    section_structure: [],
    status: "draft",
    created_at: "2026-08-20T00:00:00.000Z",
    updated_at: "2026-08-20T00:00:00.000Z",
    campaign: { meta: { subject_lines: ["", "", ""], preview_texts: ["", "", ""] }, sections: [] },
  };

  it("accepts a draft with no promo code", () => {
    expect(parseSavedCampaign({ ...base, promo_code: undefined })).not.toBeNull();
  });

  it("rejects a null promo_code — which is why the reader must map null to undefined", () => {
    expect(parseSavedCampaign({ ...base, promo_code: null })).toBeNull();
  });

  it("round-trips every optional frontmatter field read back as undefined", () => {
    // Exactly what markdownToCampaign() hands the parser for a scratch canvas:
    // nulls in the file become undefined in the candidate.
    const nullish = (v: unknown) => v ?? undefined;
    const fromFile: Record<string, unknown> = {
      promo_code: null, hero_angle: null, angle: null, promotion_id: null,
      occasion: null, hero_product_slug: null, send_stage: null, urgency: null,
      planner_row_id: null,
    };
    const candidate = { ...base, ...Object.fromEntries(Object.entries(fromFile).map(([k, v]) => [k, nullish(v)])) };
    const parsed = parseSavedCampaign(candidate) as SavedCampaign | null;
    expect(parsed).not.toBeNull();
    expect(parsed?.promo_code).toBeUndefined();
  });

  it("keeps a real promo code", () => {
    expect((parseSavedCampaign({ ...base, promo_code: "SUNNY" }) as SavedCampaign)?.promo_code).toBe("SUNNY");
  });
});
