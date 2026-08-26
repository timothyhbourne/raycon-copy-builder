import { describe, it, expect } from "vitest";
import {
  addDaysYMD, rangeMutability, rangeTtlMs, ttlForMutability, overviewCacheKey, isFresh, todayYMDInTz, zonedMidnightUtc,
} from "./cache-ttl";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

describe("addDaysYMD", () => {
  it("adds/subtracts days across month boundaries (UTC)", () => {
    expect(addDaysYMD("2026-08-01", -1)).toBe("2026-07-31");
    expect(addDaysYMD("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDaysYMD("2026-08-10", -3)).toBe("2026-08-07");
  });
});

describe("rangeMutability", () => {
  const today = "2026-08-10";
  it("range including today → current", () => {
    expect(rangeMutability("2026-08-01", "2026-08-10", today)).toBe("current");
    expect(rangeMutability("2026-08-10", "2026-08-12", today)).toBe("current"); // end in future
  });
  it("range that ended within the last 3 days → trailing", () => {
    expect(rangeMutability("2026-08-01", "2026-08-09", today)).toBe("trailing"); // yesterday
    expect(rangeMutability("2026-08-01", "2026-08-07", today)).toBe("trailing"); // today-3 boundary
  });
  it("range that ended earlier → past (immutable)", () => {
    expect(rangeMutability("2026-06-01", "2026-06-12", today)).toBe("past");
    expect(rangeMutability("2026-08-01", "2026-08-06", today)).toBe("past"); // just past the 3-day window
  });
});

describe("ttl selection", () => {
  const today = "2026-08-10";
  it("current → 15 min, trailing → 1 h, past → 7 d", () => {
    expect(ttlForMutability("current")).toBe(15 * MIN);
    expect(ttlForMutability("trailing")).toBe(HOUR);
    expect(ttlForMutability("past")).toBe(7 * DAY);
  });
  it("rangeTtlMs routes through mutability", () => {
    expect(rangeTtlMs("2026-08-01", "2026-08-10", today)).toBe(15 * MIN);   // current
    expect(rangeTtlMs("2026-08-01", "2026-08-09", today)).toBe(HOUR);       // trailing
    expect(rangeTtlMs("2026-06-01", "2026-06-12", today)).toBe(7 * DAY);    // past → fetched once, ever
  });
});

describe("overviewCacheKey", () => {
  it("is versioned + range-scoped", () => {
    expect(overviewCacheKey("2026-08-01", "2026-08-31")).toBe("overview:v1:2026-08-01..2026-08-31");
  });
});

describe("isFresh", () => {
  const now = Date.parse("2026-08-10T12:00:00.000Z");
  it("fresh within TTL, stale past it", () => {
    expect(isFresh("2026-08-10T11:59:00.000Z", 15 * MIN, now)).toBe(true);  // 1 min old
    expect(isFresh("2026-08-10T11:40:00.000Z", 15 * MIN, now)).toBe(false); // 20 min old
    expect(isFresh("not-a-date", 15 * MIN, now)).toBe(false);
  });
});

describe("todayYMDInTz", () => {
  it("returns an ISO date for a valid tz", () => {
    const ymd = todayYMDInTz("America/New_York", new Date("2026-08-10T13:00:00.000Z"));
    expect(ymd).toBe("2026-08-10");
  });
  it("late-UTC evening is still the prior day in New York", () => {
    // 2026-08-11T02:00Z = 2026-08-10 22:00 in America/New_York.
    expect(todayYMDInTz("America/New_York", new Date("2026-08-11T02:00:00.000Z"))).toBe("2026-08-10");
  });
});

// ---------------------------------------------------------------------------
describe("zonedMidnightUtc", () => {
  it("is the real UTC instant of local midnight, not a naive relabelling", () => {
    // Klaviyo buckets by the timezone you pass but reads a naive filter datetime
    // as UTC. Sending 00:00Z for a US/Eastern account asked for 20:00 the previous
    // evening, which produced a partial leading bucket and truncated the last day.
    expect(zonedMidnightUtc("2026-08-20", "US/Eastern")).toBe("2026-08-20T04:00:00Z");   // EDT, UTC-4
    expect(zonedMidnightUtc("2026-01-15", "US/Eastern")).toBe("2026-01-15T05:00:00Z");   // EST, UTC-5
  });

  it("handles a zone ahead of UTC", () => {
    expect(zonedMidnightUtc("2026-08-20", "Europe/Berlin")).toBe("2026-08-19T22:00:00Z");
    expect(zonedMidnightUtc("2026-08-20", "Asia/Tokyo")).toBe("2026-08-19T15:00:00Z");
  });

  it("is identity for UTC", () => {
    expect(zonedMidnightUtc("2026-08-20", "UTC")).toBe("2026-08-20T00:00:00Z");
  });

  it("falls back to UTC for an unknown zone rather than throwing", () => {
    expect(zonedMidnightUtc("2026-08-20", "Not/AZone")).toBe("2026-08-20T00:00:00Z");
  });

  it("round-trips: the instant it returns lands on that day in that zone", () => {
    for (const tz of ["US/Eastern", "Europe/Berlin", "Asia/Tokyo", "UTC"]) {
      for (const ymd of ["2026-01-15", "2026-03-08", "2026-08-20", "2026-11-02"]) {
        expect(todayYMDInTz(tz, new Date(zonedMidnightUtc(ymd, tz))), `${tz} ${ymd}`).toBe(ymd);
      }
    }
  });
})
