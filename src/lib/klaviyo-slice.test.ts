import { describe, it, expect } from "vitest";
import {
  addStats, addYmdDays, attributionDays, emptyStats, isFinalOn, ratesOf, sliceRange, ymdInTz,
  type KlaviyoSnapshot, type Stats,
} from "./klaviyo-slice";

const stats = (over: Partial<Stats> = {}): Stats => ({ ...emptyStats(), ...over });

function snapshot(over: Partial<KlaviyoSnapshot> = {}): KlaviyoSnapshot {
  return {
    window: { start: "2026-08-01", end: "2026-08-05" },
    timezone: "America/New_York",
    synced_at: "2026-08-05T09:00:00.000Z",
    attribution_days: 5,
    campaigns: [
      { campaign_id: "c1", send_ymd: "2026-08-01", send_time: "2026-08-01T12:00:00Z", name: "Aug 1", status: "sent", audience_count: 10, stats: stats({ recipients: 100, delivered: 98, conversion_value: 500, opens_unique: 49 }), final: true },
      { campaign_id: "c2", send_ymd: "2026-08-03", send_time: "2026-08-03T12:00:00Z", name: "Aug 3", status: "sent", audience_count: 10, stats: stats({ recipients: 200, delivered: 190, conversion_value: 1000 }), final: false },
      { campaign_id: "c3", send_ymd: "2026-08-09", send_time: "2026-08-09T12:00:00Z", name: "Out of range", status: "sent", audience_count: 0, stats: stats({ recipients: 5, conversion_value: 9999 }), final: false },
    ],
    flow_days: [
      { flow_id: "f1", ymd: "2026-08-01", stats: stats({ recipients: 10, delivered: 10, conversion_value: 20 }) },
      { flow_id: "f1", ymd: "2026-08-02", stats: stats({ recipients: 12, delivered: 12, conversion_value: 25 }) },
      { flow_id: "f2", ymd: "2026-08-02", stats: stats({ recipients: 7, delivered: 7, conversion_value: 5 }) },
      { flow_id: "f1", ymd: "2026-08-09", stats: stats({ recipients: 99, conversion_value: 8888 }) },
    ],
    day_totals: [
      { ymd: "2026-08-01", revenue: 1000, orders: 10 },
      { ymd: "2026-08-02", revenue: 500, orders: 5 },
      { ymd: "2026-08-03", revenue: 2000, orders: 20 },
      { ymd: "2026-08-04", revenue: 0, orders: 0 },
      { ymd: "2026-08-05", revenue: 100, orders: 1 },
    ],
    flow_meta: [{ id: "f1", name: "Welcome", status: "live" }, { id: "f2", name: "Cart", status: "live" }],
    draft: [], scheduled: [], warnings: [],
    ...over,
  };
}

describe("sliceRange — the whole point of the snapshot", () => {
  it("includes only campaigns whose SEND DAY is in range", () => {
    const s = sliceRange(snapshot(), "2026-08-01", "2026-08-03");
    expect(s.campaigns.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
  });

  it("sums flow days per flow, over the range only", () => {
    const s = sliceRange(snapshot(), "2026-08-01", "2026-08-02");
    const f1 = s.flows.find((f) => f.id === "f1")!;
    expect(f1.stats.recipients).toBe(22);          // 10 + 12, not the 2026-08-09 day
    expect(f1.stats.conversion_value).toBe(45);
    expect(f1.name).toBe("Welcome");
  });

  it("a one-day range is the single day, not the whole window", () => {
    const s = sliceRange(snapshot(), "2026-08-02", "2026-08-02");
    expect(s.total_revenue).toBe(500);
    expect(s.order_count).toBe(5);
    expect(s.campaigns).toHaveLength(0);
    expect(s.flows.map((f) => f.id).sort()).toEqual(["f1", "f2"]);
  });

  it("sub-ranges of one snapshot sum to the whole — the property the fix relies on", () => {
    const snap = snapshot();
    const whole = sliceRange(snap, "2026-08-01", "2026-08-05");
    const a = sliceRange(snap, "2026-08-01", "2026-08-02");
    const b = sliceRange(snap, "2026-08-03", "2026-08-05");
    expect(a.total_revenue + b.total_revenue).toBe(whole.total_revenue);
    expect(a.order_count + b.order_count).toBe(whole.order_count);
    const rev = (x: { campaigns: { stats: Stats }[] }) => x.campaigns.reduce((n, c) => n + c.stats.conversion_value, 0);
    expect(rev(a) + rev(b)).toBe(rev(whole));
  });

  it("is deterministic and repeatable — the same range twice gives the same answer", () => {
    const snap = snapshot();
    expect(sliceRange(snap, "2026-08-01", "2026-08-04")).toEqual(sliceRange(snap, "2026-08-01", "2026-08-04"));
  });

  it("sorts both lists by revenue, descending", () => {
    const s = sliceRange(snapshot(), "2026-08-01", "2026-08-05");
    expect(s.campaigns.map((c) => c.stats.conversion_value)).toEqual([1000, 500]);
    expect(s.flows[0].id).toBe("f1");
  });

  it("names the days it has NO data for instead of quietly under-reporting", () => {
    // Asking for a range wider than the snapshot must not look like a real total.
    const s = sliceRange(snapshot(), "2026-07-30", "2026-08-02");
    expect(s.covered).toBe(false);
    expect(s.missing_days).toEqual(["2026-07-30", "2026-07-31"]);
    expect(s.total_revenue).toBe(1500);   // only the days it actually has
  });

  it("a fully covered range reports covered with no missing days", () => {
    const s = sliceRange(snapshot(), "2026-08-01", "2026-08-05");
    expect(s.covered).toBe(true);
    expect(s.missing_days).toEqual([]);
  });

  it("counts a zero-revenue day as COVERED, not missing", () => {
    // 2026-08-04 has a row with revenue 0. Treating "no revenue" as "no data"
    // would raise a false gap warning on every quiet day.
    const s = sliceRange(snapshot(), "2026-08-04", "2026-08-04");
    expect(s.covered).toBe(true);
    expect(s.total_revenue).toBe(0);
  });

  it("skips a campaign with no send day rather than placing it arbitrarily", () => {
    const snap = snapshot({
      campaigns: [{ campaign_id: "x", send_ymd: null, send_time: null, name: "Undated", status: "", audience_count: 0, stats: stats({ conversion_value: 77 }), final: false }],
    });
    expect(sliceRange(snap, "2026-08-01", "2026-08-05").campaigns).toHaveLength(0);
  });

  it("labels a flow with no metadata rather than dropping its revenue", () => {
    const snap = snapshot({ flow_meta: [] });
    const s = sliceRange(snap, "2026-08-01", "2026-08-02");
    expect(s.flows.find((f) => f.id === "f1")!.name).toContain("unknown flow");
    expect(s.flows.reduce((n, f) => n + f.stats.conversion_value, 0)).toBe(50);
  });
});

describe("ratesOf — per DELIVERED, which is what delivered was being thrown away for", () => {
  it("divides opens, clicks, unsubs and spam by delivered", () => {
    const r = ratesOf(stats({ recipients: 1000, delivered: 900, opens_unique: 450, clicks_unique: 90, unsubscribes: 9, spam_complaints: 45 }));
    expect(r.open_rate).toBeCloseTo(0.5);      // 450/900, NOT 450/1000
    expect(r.click_rate).toBeCloseTo(0.1);
    expect(r.unsubscribe_rate).toBeCloseTo(0.01);
    expect(r.spam_rate).toBeCloseTo(0.05);
  });

  it("divides bounces by RECIPIENTS — a bounce is a non-delivery, so per-delivered would be circular", () => {
    const r = ratesOf(stats({ recipients: 1000, delivered: 900, bounced: 100 }));
    expect(r.bounce_rate).toBeCloseTo(0.1);
    expect(r.delivery_rate).toBeCloseTo(0.9);
  });

  it("keeps revenue_per_recipient per recipient — it is a cost-of-send measure", () => {
    expect(ratesOf(stats({ recipients: 1000, delivered: 500, conversion_value: 2000 })).revenue_per_recipient).toBe(2);
  });

  it("never divides by zero", () => {
    const r = ratesOf(emptyStats());
    for (const v of Object.values(r)) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("attribution sealing", () => {
  it("seals a campaign once its send day plus the window has passed", () => {
    // 5-day window: sent on the 1st is final from the 7th.
    expect(isFinalOn("2026-08-01", "2026-08-06", 5)).toBe(false);
    expect(isFinalOn("2026-08-01", "2026-08-07", 5)).toBe(true);
  });

  it("never seals a campaign with no send day", () => {
    expect(isFinalOn(null, "2027-01-01", 5)).toBe(false);
  });

  it("reads the window from the environment, defaulting to 5", () => {
    const prev = process.env.KLAVIYO_ATTRIBUTION_DAYS;
    delete process.env.KLAVIYO_ATTRIBUTION_DAYS;
    expect(attributionDays()).toBe(5);
    process.env.KLAVIYO_ATTRIBUTION_DAYS = "1";
    expect(attributionDays()).toBe(1);
    process.env.KLAVIYO_ATTRIBUTION_DAYS = "nonsense";
    expect(attributionDays()).toBe(5);
    if (prev === undefined) delete process.env.KLAVIYO_ATTRIBUTION_DAYS;
    else process.env.KLAVIYO_ATTRIBUTION_DAYS = prev;
  });
});

describe("date helpers", () => {
  it("places an instant on the account's day, not UTC's", () => {
    // 03:00 UTC on the 2nd is still the 1st in New York. Getting this wrong moves
    // a campaign's revenue to the wrong day at the boundary.
    expect(ymdInTz("2026-08-02T03:00:00Z", "America/New_York")).toBe("2026-08-01");
    expect(ymdInTz("2026-08-02T03:00:00Z", "UTC")).toBe("2026-08-02");
  });

  it("returns null for a missing or unparseable timestamp", () => {
    expect(ymdInTz(null, "UTC")).toBeNull();
    expect(ymdInTz("not a date", "UTC")).toBeNull();
  });

  it("adds days across a month boundary", () => {
    expect(addYmdDays("2026-08-30", 3)).toBe("2026-09-02");
    expect(addYmdDays("2026-08-02", -3)).toBe("2026-07-30");
  });
});

describe("addStats", () => {
  it("adds every field and treats a missing one as zero", () => {
    const sum = addStats(stats({ recipients: 1, conversion_value: 2 }), { recipients: 3 });
    expect(sum.recipients).toBe(4);
    expect(sum.conversion_value).toBe(2);
    expect(sum.bounced).toBe(0);
  });
});
