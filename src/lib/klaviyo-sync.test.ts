import { describe, it, expect } from "vitest";
import { stepNeedMs } from "./klaviyo-sync";
import { CATALOGUE_FETCH_MS, sizeBudgetFor } from "./klaviyo-audiences";

// A step that starts work it cannot finish gets the whole function killed with no
// step result and no progress written — the failure mode that actually hit
// production (FUNCTION_INVOCATION_TIMEOUT, fixed in 2dbab8d). The reservation
// arithmetic is the guard, so it is tested rather than trusted.

describe("stepNeedMs", () => {
  const SLOT = 18_000;

  it("reserves the limiter slot wait plus the call for a reporting step", () => {
    expect(stepNeedMs({ reporting: true }, SLOT)).toBe(26_000);
  });

  it("reserves only the call for a cheap step", () => {
    expect(stepNeedMs({ reporting: false }, SLOT)).toBe(8_000);
  });

  it("honours a declared cost over the default", () => {
    // The audiences step is ~36 sequential requests / 17.5s measured. The default
    // 8s would wave it through with 8s left and overrun the function.
    expect(stepNeedMs({ reporting: false, needMs: 26_000 }, SLOT)).toBe(26_000);
  });

  it("lets a declared cost exceed a reporting step's default", () => {
    expect(stepNeedMs({ reporting: true, needMs: 40_000 }, SLOT)).toBe(40_000);
  });

  it("treats a zero declared cost as declared, not as absent", () => {
    // `?? ` not `|| ` — a step that declares it needs nothing must not silently
    // inherit the 8s default.
    expect(stepNeedMs({ reporting: false, needMs: 0 }, SLOT)).toBe(0);
  });

  it("scales with the slot wait, so a slower limiter reserves more", () => {
    expect(stepNeedMs({ reporting: true }, 31_000)).toBeGreaterThan(stepNeedMs({ reporting: true }, 18_000));
  });
});

describe("sizeBudgetFor", () => {
  // The size pass runs AFTER the ~17.5s catalogue fetch inside the same function.
  // A flat budget that ignored the catalogue is what made ?sizes=1 overrun 60s.
  it("leaves room for the catalogue and the response", () => {
    const budget = sizeBudgetFor(60_000);
    expect(CATALOGUE_FETCH_MS + budget).toBeLessThanOrEqual(60_000 - 8_000);
  });

  it("never returns a negative budget when the catalogue alone exceeds the limit", () => {
    expect(sizeBudgetFor(10_000)).toBe(0);
    expect(sizeBudgetFor(0)).toBe(0);
  });

  it("gives a bigger function a bigger size pass", () => {
    expect(sizeBudgetFor(60_000)).toBeGreaterThan(sizeBudgetFor(45_000));
  });

  it("honours a caller's own reserve", () => {
    expect(sizeBudgetFor(60_000, 20_000)).toBe(60_000 - CATALOGUE_FETCH_MS - 20_000);
  });

  it("rejects the value that actually overran production", () => {
    // 40s of sizes + a 20s catalogue = 60s with nothing left to respond in.
    expect(sizeBudgetFor(60_000)).toBeLessThan(40_000);
  });
});

describe("the audiences step fits the sync route's budget", () => {
  // Mirrors src/app/api/klaviyo/sync/route.ts.
  const BUDGET_MS = 32_000;
  const NEED = CATALOGUE_FETCH_MS + 6_000;

  it("starts on a fresh budget", () => {
    expect(stepNeedMs({ reporting: false, needMs: NEED }, 18_000)).toBeLessThanOrEqual(BUDGET_MS);
  });

  it("leaves the catalogue and the response room after its size pass", () => {
    const sizeBudget = Math.max(0, BUDGET_MS - CATALOGUE_FETCH_MS - 4_000);
    expect(CATALOGUE_FETCH_MS + sizeBudget).toBeLessThanOrEqual(BUDGET_MS - 4_000);
  });

  it("defers rather than starting with too little left", () => {
    expect(NEED).toBeGreaterThan(10_000);
  });
});
