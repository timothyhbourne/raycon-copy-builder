import { describe, it, expect } from "vitest";
import { flowEmailId, parseFlowEmailId, isFlowEmailId } from "./flow-email-id";

describe("flow email composite ids", () => {
  it("round-trips a flow id and an email id", () => {
    const id = flowEmailId("2026-08-24-welcome-abc123", "V1StGXR8Z5");
    expect(id).toBe("2026-08-24-welcome-abc123::V1StGXR8Z5");
    expect(parseFlowEmailId(id)).toEqual({ flowId: "2026-08-24-welcome-abc123", emailId: "V1StGXR8Z5" });
  });

  it("returns null for every OTHER store's id shape, so those stores stay untouched", () => {
    // The existing id format — a date-slug-nanoid — can never contain "::".
    expect(parseFlowEmailId("2026-08-24-flash-sale-abc123")).toBeNull();
    expect(parseFlowEmailId("V1StGXR8Z5jdHi6B-myT")).toBeNull();
    expect(parseFlowEmailId("")).toBeNull();
    expect(isFlowEmailId(undefined)).toBe(false);
    expect(isFlowEmailId(null)).toBe(false);
  });

  it("rejects a malformed composite id rather than half-resolving it", () => {
    expect(parseFlowEmailId("::email")).toBeNull();      // no flow id
    expect(parseFlowEmailId("flow::")).toBeNull();       // no email id
    expect(parseFlowEmailId("flow::a::b")).toBeNull();   // the tail isn't a safe id
    expect(parseFlowEmailId("../etc::email")).toBeNull(); // never a path
  });
});
