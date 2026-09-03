import { describe, it, expect } from "vitest";
import { rowKind, isSendableRow, isEffectivelySent, isAbTest, abTestKind, abVariantBCopy, variantCopy, variantHolding } from "./planner-types";
import type { PlannerRow } from "./planner-types";

const row = (patch: Partial<PlannerRow> = {}): PlannerRow => ({
  id: "r1", name: "R", channel: "email",
  offer_type: "evergreen", offer: "20% off",
  planned_send_at: "2026-01-01T09:00:00.000Z",
  status: "scheduled",
  audience_included: [], audience_excluded: [], notes: "",
  created_at: "x", updated_at: "y",
  ...patch,
});

describe("row kind", () => {
  it("defaults a row with no row_kind to campaign — every row saved before the field", () => {
    expect(rowKind(row())).toBe("campaign");
    expect(isSendableRow(row())).toBe(true);
  });

  it("a flow-email row is not a send, so metrics sync and Copy Performance skip it", () => {
    const flowRow = row({ row_kind: "flow_email" });
    expect(rowKind(flowRow)).toBe("flow_email");
    expect(isSendableRow(flowRow)).toBe(false);
    // It still reads as "effectively sent" on its own terms — which is exactly why
    // the kind check has to be separate from the date check.
    expect(isEffectivelySent(flowRow)).toBe(true);
  });
});

describe("A/B tests", () => {
  it("a row with no ab_test is a plain single send — every row saved before the field", () => {
    expect(isAbTest(row())).toBe(false);
    expect(abTestKind(row())).toBeNull();
    expect(abVariantBCopy(row())).toBeNull();
  });

  it("variant A is the row's OWN copy link, untouched by A/B — the whole invariant", () => {
    // Everything downstream (corpus ingest, Copy Performance, the calendar glyph)
    // reads copy_campaign_id. If A/B moved it, all of them would need changing and a
    // send could be counted twice.
    const r = row({
      copy_campaign_id: "copy-a", copy_status: "final",
      ab_test: { kind: "content", copy_campaign_id: "copy-b", copy_status: "draft" },
    });
    expect(variantCopy(r, "a")).toMatchObject({ id: "copy-a", status: "final" });
    expect(variantCopy(r, "b")).toMatchObject({ id: "copy-b", status: "draft" });
    expect(r.copy_campaign_id).toBe("copy-a");
  });

  it("a subject-line test carries B's alternate, and NOT a second copy", () => {
    const r = row({ ab_test: { kind: "subject_line", subject_line: "Two days left" } });
    expect(abTestKind(r)).toBe("subject_line");
    expect(r.ab_test?.subject_line).toBe("Two days left");
    expect(abVariantBCopy(r)).toBeNull();
  });

  it("a B copy left behind by a switch to a subject-line test is inert, not half-alive", () => {
    // The UI unlinks before switching, but a row that slipped through must not render
    // a second copy on a test that no longer has one.
    const r = row({ ab_test: { kind: "subject_line", copy_campaign_id: "copy-b" } });
    expect(abVariantBCopy(r)).toBeNull();
    expect(variantHolding(r, "copy-b")).toBeNull();
  });

  it("the ROW says which slot a copy is in — a saved copy only remembers its row", () => {
    // Without this, reopening variant B's copy weeks later and saving it would ask
    // for slot A and silently evict the control.
    const r = row({
      copy_campaign_id: "copy-a",
      ab_test: { kind: "content", copy_campaign_id: "copy-b" },
    });
    expect(variantHolding(r, "copy-a")).toBe("a");
    expect(variantHolding(r, "copy-b")).toBe("b");
    expect(variantHolding(r, "copy-unrelated")).toBeNull();
    expect(variantHolding(null, "copy-a")).toBeNull();
  });

  it("a content test with no second copy yet is still a test", () => {
    const r = row({ ab_test: { kind: "content" } });
    expect(isAbTest(r)).toBe(true);
    expect(abVariantBCopy(r)).toBeNull();
  });
});
