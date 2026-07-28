import { describe, it, expect } from "vitest";
import { eachDay, isValidYMD } from "./store";

// The range summing in the overview route is `sum over eachDay(start,end)`, so
// the additivity of a range total rests on eachDay producing exactly the right
// inclusive set of days. These test that backbone.
describe("eachDay", () => {
  it("is inclusive of both endpoints", () => {
    expect(eachDay("2026-07-01", "2026-07-03")).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
  });
  it("returns a single day when start === end", () => {
    expect(eachDay("2026-07-10", "2026-07-10")).toEqual(["2026-07-10"]);
  });
  it("crosses month boundaries correctly", () => {
    expect(eachDay("2026-01-30", "2026-02-02")).toEqual([
      "2026-01-30", "2026-01-31", "2026-02-01", "2026-02-02",
    ]);
  });
  it("partitions a range: [a,m] ∪ (m,b] covers [a,b] with no gaps or overlap (additivity)", () => {
    const full = eachDay("2026-07-01", "2026-07-10");
    const left = eachDay("2026-07-01", "2026-07-05");
    const right = eachDay("2026-07-06", "2026-07-10");
    expect([...left, ...right]).toEqual(full);
    expect(new Set(full).size).toBe(full.length); // no duplicates
  });
  it("returns [] for invalid or reversed input", () => {
    expect(eachDay("not-a-date", "2026-07-10")).toEqual([]);
    expect(eachDay("2026-07-10", "2026-07-01")).toEqual([]);
  });
});

describe("isValidYMD", () => {
  it("accepts YYYY-MM-DD", () => {
    expect(isValidYMD("2026-07-01")).toBe(true);
  });
  it("rejects other shapes and non-strings", () => {
    expect(isValidYMD("2026-7-1")).toBe(false);
    expect(isValidYMD("07/01/2026")).toBe(false);
    expect(isValidYMD(20260701)).toBe(false);
    expect(isValidYMD(undefined)).toBe(false);
  });
});
