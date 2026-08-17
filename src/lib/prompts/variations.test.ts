import { describe, it, expect } from "vitest";
import { REGISTERS, registerSteering } from "./variations";

describe("registerSteering", () => {
  it("keeps SUBSTANCE and STYLE as two separate blocks", () => {
    // Guard against someone collapsing these back into one line: when the
    // register trails the user's feedback inside a single "read this literally"
    // block, all five registers converge on the feedback and the labels stop
    // meaning anything.
    const out = registerSteering("more premium", REGISTERS[1]);
    expect(out).toContain("SUBSTANCE");
    expect(out).toContain("STYLE / REGISTER , NON-NEGOTIABLE");
    expect(out).toContain("Playful");
    expect(out).toContain("more premium");
    expect(out.indexOf("SUBSTANCE")).toBeLessThan(out.indexOf("STYLE / REGISTER"));
  });

  it("still asks for a distinct angle when there is no feedback", () => {
    const out = registerSteering("   ", REGISTERS[0]);
    expect(out).toContain("SUBSTANCE: no explicit feedback");
    expect(out).toContain("STYLE / REGISTER , NON-NEGOTIABLE for THIS specific variation: Direct");
  });

  it("gives every register a concrete prohibition so they cannot converge", () => {
    expect(REGISTERS).toHaveLength(5);
    for (const r of REGISTERS) {
      expect(r.nudge, `${r.label} nudge`).toContain("Prohibited:");
    }
  });
});
