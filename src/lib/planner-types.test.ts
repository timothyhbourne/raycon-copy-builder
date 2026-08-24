import { describe, it, expect } from "vitest";
import { rowKind, isSendableRow, isEffectivelySent } from "./planner-types";
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
