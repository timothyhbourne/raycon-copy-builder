import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  acquireReportingSlot, callsToday, DAILY_CAP, isBlocked, limiterState, openBreaker,
  __resetLocalLimiter, MIN_SPACING_MS, BREAKER_THRESHOLD_S,
} from "./klaviyo-limiter";

// With no Redis env configured these tests exercise the in-process fallback,
// which is the same logic on a single-process path. The point being tested is the
// POLICY: one slot at a time, paced, counted, and refused when blocked.
beforeEach(() => {
  __resetLocalLimiter();
  vi.useRealTimers();
});

const DAY = "2026-08-25";

describe("pacing — one reporting call at a time, 31s apart", () => {
  it("grants the first slot immediately", async () => {
    expect(await acquireReportingSlot({ day: DAY })).toEqual({ ok: true });
  });

  it("REFUSES a second immediate slot — this is what stops a paginated report 429ing", async () => {
    // The old code followed a report's cursor back-to-back. Against 2/min that
    // throttles on page 3 every time, which is why a flow report could never
    // finish. A non-waiting caller must be told no.
    await acquireReportingSlot({ day: DAY });
    const second = await acquireReportingSlot({ day: DAY, waitMs: 0 });
    expect(second).toEqual({ ok: false, reason: "timeout" });
  });

  it("grants the next slot once the spacing has elapsed", async () => {
    vi.useFakeTimers();
    await acquireReportingSlot({ day: DAY });
    vi.setSystemTime(Date.now() + MIN_SPACING_MS + 1);
    expect(await acquireReportingSlot({ day: DAY, waitMs: 0 })).toEqual({ ok: true });
    vi.useRealTimers();
  });

  it("a waiting caller gives up at its deadline rather than hanging", async () => {
    await acquireReportingSlot({ day: DAY });
    const t0 = Date.now();
    const res = await acquireReportingSlot({ day: DAY, waitMs: 1_200 });
    expect(res).toEqual({ ok: false, reason: "timeout" });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1_000);
  });
});

describe("the daily counter", () => {
  it("counts each granted slot", async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 3; i++) {
      await acquireReportingSlot({ day: DAY, waitMs: 0 });
      vi.setSystemTime(Date.now() + MIN_SPACING_MS + 1);
    }
    expect(await callsToday(DAY)).toBe(3);
    vi.useRealTimers();
  });

  it("counts per DAY key, so the account's midnight rolls it over", async () => {
    await acquireReportingSlot({ day: DAY, waitMs: 0 });
    expect(await callsToday(DAY)).toBe(1);
    expect(await callsToday("2026-08-26")).toBe(0);
  });

  it("refuses past the daily cap, and does not consume a count doing so", async () => {
    vi.useFakeTimers();
    for (let i = 0; i < DAILY_CAP; i++) {
      const r = await acquireReportingSlot({ day: DAY, waitMs: 0 });
      expect(r.ok).toBe(true);
      vi.setSystemTime(Date.now() + MIN_SPACING_MS + 1);
    }
    expect(await callsToday(DAY)).toBe(DAILY_CAP);
    const over = await acquireReportingSlot({ day: DAY, waitMs: 0 });
    expect(over).toEqual({ ok: false, reason: "daily_cap" });
    // The refused attempt must not leave the counter above the cap.
    expect(await callsToday(DAY)).toBe(DAILY_CAP);
    vi.useRealTimers();
  });
});

describe("the circuit breaker", () => {
  it("refuses every slot while open, without waiting", async () => {
    await openBreaker(BREAKER_THRESHOLD_S + 60);
    const res = await acquireReportingSlot({ day: DAY, waitMs: 5_000 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("blocked");
      expect(res.retryAfterS).toBeGreaterThan(BREAKER_THRESHOLD_S);
    }
  });

  it("reports how long it is blocked for", async () => {
    await openBreaker(900);
    const b = await isBlocked();
    expect(b.blocked).toBe(true);
    expect(b.forS).toBeGreaterThan(800);
  });

  it("closes once the block has passed", async () => {
    vi.useFakeTimers();
    await openBreaker(60);
    expect((await isBlocked()).blocked).toBe(true);
    vi.setSystemTime(Date.now() + 61_000);
    expect((await isBlocked()).blocked).toBe(false);
    vi.useRealTimers();
  });

  it("keeps the LONGER of two blocks — a shorter one must not shorten it", async () => {
    await openBreaker(3600);
    await openBreaker(30);
    expect((await isBlocked()).forS).toBeGreaterThan(3000);
  });
});

describe("limiterState — what /api/klaviyo/budget surfaces", () => {
  it("reports the cap, the spend and the remaining headroom", async () => {
    await acquireReportingSlot({ day: DAY, waitMs: 0 });
    const st = await limiterState(DAY);
    expect(st.calls_today).toBe(1);
    expect(st.daily_cap).toBe(DAILY_CAP);
    expect(st.daily_remaining).toBe(DAILY_CAP - 1);
    expect(st.over_alert_threshold).toBe(false);
    expect(st.blocked_until).toBeNull();
  });

  it("surfaces an open breaker, which is the point of the endpoint", async () => {
    await openBreaker(1200);
    const st = await limiterState(DAY);
    expect(st.blocked_until).not.toBeNull();
    expect(st.blocked_for_s).toBeGreaterThan(1000);
  });
});
