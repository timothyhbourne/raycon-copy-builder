import { describe, it, expect } from "vitest";
import { decideLink, stripPlannerLinkFromRestoredForm } from "./planner-link-decision";

const row = (over: Partial<{ id: string; name: string; copy_campaign_id?: string }> = {}) => ({
  id: "row-a", name: "RAY | Summer Sale", ...over,
});

describe("decideLink", () => {
  it("does nothing when no row was chosen — the default for every ordinary campaign", () => {
    const d = decideLink({ rowId: null, row: null, copyCampaignId: "copy-1" });
    expect(d.action).toBe("none");
  });

  it("does nothing for an empty string row id", () => {
    expect(decideLink({ rowId: "", row: row(), copyCampaignId: "copy-1" }).action).toBe("none");
  });

  it("links when the row owns nothing", () => {
    expect(decideLink({ rowId: "row-a", row: row(), copyCampaignId: "copy-1" }).action).toBe("link");
  });

  it("links when the row already owns THIS copy (a re-save)", () => {
    const d = decideLink({ rowId: "row-a", row: row({ copy_campaign_id: "copy-1" }), copyCampaignId: "copy-1" });
    expect(d.action).toBe("link");
  });

  it("ASKS when the row belongs to a different copy — never steals it silently", () => {
    // This is the branch that caused the collateral damage: the link is
    // single-owner, so stamping it also unlinked the other campaign.
    const d = decideLink({ rowId: "row-a", row: row({ copy_campaign_id: "copy-other" }), copyCampaignId: "copy-1" });
    expect(d.action).toBe("confirm");
    if (d.action === "confirm") {
      expect(d.ownerCopyId).toBe("copy-other");
      expect(d.reason).toContain("already linked");
    }
  });

  it("reports a row that no longer exists, so the stale handoff can be cleared", () => {
    const d = decideLink({ rowId: "row-gone", row: null, copyCampaignId: "copy-1" });
    expect(d.action).toBe("missing");
    if (d.action === "missing") expect(d.reason).toMatch(/no longer exists/i);
  });

  it("does nothing when the copy has no id yet", () => {
    expect(decideLink({ rowId: "row-a", row: row(), copyCampaignId: "" }).action).toBe("none");
  });
});

describe("stripPlannerLinkFromRestoredForm", () => {
  it("removes a planner association from a restored draft", () => {
    // THE reproduction: one visit to ?planner=rowA persisted planner_row_id into
    // the brief form, and every campaign written afterwards inherited it.
    const restored = stripPlannerLinkFromRestoredForm({
      campaign_name: "Something unrelated",
      planner_row_id: "row-a",
    });
    expect(restored.planner_row_id).toBeUndefined();
    expect(restored.campaign_name).toBe("Something unrelated");
  });

  it("leaves the rest of the form alone, including the planner notes already typed", () => {
    const restored = stripPlannerLinkFromRestoredForm({
      campaign_name: "X", offer: "20% off", planner_notes: "carried over", planner_row_id: "row-a",
    } as { campaign_name: string; offer: string; planner_notes: string; planner_row_id?: string });
    expect(restored).toEqual({ campaign_name: "X", offer: "20% off", planner_notes: "carried over" });
  });

  it("is a no-op when there is no association", () => {
    const form: { campaign_name: string; planner_row_id?: string } = { campaign_name: "X" };
    expect(stripPlannerLinkFromRestoredForm(form)).toBe(form);
  });

  it("survives junk", () => {
    expect(stripPlannerLinkFromRestoredForm(null as never)).toBeNull();
  });
});
