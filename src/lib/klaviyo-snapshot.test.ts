import { describe, it, expect } from "vitest";
import { mergeSnapshot } from "./klaviyo-snapshot";
import { emptyStats, sliceRange, type CampaignSnapshotRow, type FlowDayRow, type KlaviyoSnapshot, type Stats } from "./klaviyo-slice";
import { dailyChunks } from "./klaviyo-sync";

const stats = (over: Partial<Stats> = {}): Stats => ({ ...emptyStats(), ...over });

const campaign = (id: string, ymd: string | null, rev: number, final = false): CampaignSnapshotRow => ({
  campaign_id: id, send_ymd: ymd, send_time: ymd ? `${ymd}T12:00:00Z` : null,
  name: id, status: "sent", audience_count: 0, stats: stats({ recipients: 100, conversion_value: rev }), final,
});
const flowDay = (flow: string, ymd: string, rev: number): FlowDayRow => ({ flow_id: flow, ymd, stats: stats({ conversion_value: rev }) });

const TODAY = "2026-08-25";

describe("mergeSnapshot — what makes an incremental sync safe", () => {
  it("creates a snapshot from nothing", () => {
    const snap = mergeSnapshot(null, {
      window: { start: "2026-08-20", end: TODAY }, timezone: "UTC", todayYmd: TODAY,
      campaigns: [campaign("c1", "2026-08-21", 100)],
      day_totals: [{ ymd: "2026-08-21", revenue: 500, orders: 5 }],
    });
    expect(snap.campaigns).toHaveLength(1);
    expect(snap.window).toEqual({ start: "2026-08-20", end: TODAY });
    expect(snap.synced_at).not.toBe("");
  });

  it("NEVER overwrites a sealed row — the whole basis of the incremental sync", () => {
    const prev = mergeSnapshot(null, {
      window: { start: "2026-07-01", end: "2026-07-31" }, timezone: "UTC", todayYmd: TODAY,
      campaigns: [campaign("old", "2026-07-02", 999)],
    });
    expect(prev.campaigns[0].final).toBe(true);   // long past the 5-day window

    // A later sync that somehow returns a different number for it is ignored.
    const next = mergeSnapshot(prev, {
      window: { start: "2026-08-20", end: TODAY }, timezone: "UTC", todayYmd: TODAY,
      campaigns: [campaign("old", "2026-07-02", 1)],
    });
    expect(next.campaigns.find((c) => c.campaign_id === "old")!.stats.conversion_value).toBe(999);
  });

  it("DOES overwrite a row still inside its attribution window", () => {
    const prev = mergeSnapshot(null, {
      window: { start: "2026-08-20", end: TODAY }, timezone: "UTC", todayYmd: TODAY,
      campaigns: [campaign("fresh", "2026-08-24", 100)],
    });
    expect(prev.campaigns[0].final).toBe(false);
    const next = mergeSnapshot(prev, {
      window: { start: "2026-08-20", end: TODAY }, timezone: "UTC", todayYmd: TODAY,
      campaigns: [campaign("fresh", "2026-08-24", 175)],
    });
    expect(next.campaigns[0].stats.conversion_value).toBe(175);
  });

  it("seals a row that has aged past the window since the last sync", () => {
    const prev = mergeSnapshot(null, {
      window: { start: "2026-08-01", end: "2026-08-10" }, timezone: "UTC", todayYmd: "2026-08-10",
      campaigns: [campaign("c", "2026-08-08", 50)],
    });
    expect(prev.campaigns[0].final).toBe(false);
    const later = mergeSnapshot(prev, { window: { start: "2026-08-20", end: "2026-08-25" }, timezone: "UTC", todayYmd: "2026-08-25" });
    expect(later.campaigns[0].final).toBe(true);
  });

  it("a NARROW incremental sync never deletes the wide history it layers on", () => {
    const backfill = mergeSnapshot(null, {
      window: { start: "2026-06-27", end: TODAY }, timezone: "UTC", todayYmd: TODAY,
      campaigns: [campaign("june", "2026-06-28", 10), campaign("aug", "2026-08-24", 20)],
      flow_days: [flowDay("f1", "2026-06-28", 1), flowDay("f1", "2026-08-24", 2)],
      day_totals: [{ ymd: "2026-06-28", revenue: 5, orders: 1 }, { ymd: "2026-08-24", revenue: 6, orders: 1 }],
    });
    const incremental = mergeSnapshot(backfill, {
      window: { start: "2026-08-23", end: TODAY }, timezone: "UTC", todayYmd: TODAY,
      campaigns: [campaign("aug", "2026-08-24", 25)],
      flow_days: [flowDay("f1", "2026-08-24", 3)],
      day_totals: [{ ymd: "2026-08-24", revenue: 7, orders: 2 }],
    });
    expect(incremental.campaigns.map((c) => c.campaign_id).sort()).toEqual(["aug", "june"]);
    expect(incremental.flow_days).toHaveLength(2);
    expect(incremental.day_totals).toHaveLength(2);
    // The wide window is preserved, not narrowed to the incremental one.
    expect(incremental.window).toEqual({ start: "2026-06-27", end: TODAY });
    // And the refreshed day won.
    expect(incremental.day_totals.find((d) => d.ymd === "2026-08-24")!.revenue).toBe(7);
    expect(incremental.flow_days.find((d) => d.ymd === "2026-08-24")!.stats.conversion_value).toBe(3);
  });

  it("re-merging the SAME window updates rather than duplicating", () => {
    let snap = mergeSnapshot(null, {
      window: { start: "2026-08-24", end: TODAY }, timezone: "UTC", todayYmd: TODAY,
      campaigns: [campaign("c", "2026-08-24", 10)], flow_days: [flowDay("f", "2026-08-24", 1)],
      day_totals: [{ ymd: "2026-08-24", revenue: 1, orders: 1 }],
    });
    for (let i = 0; i < 3; i++) {
      snap = mergeSnapshot(snap, {
        window: { start: "2026-08-24", end: TODAY }, timezone: "UTC", todayYmd: TODAY,
        campaigns: [campaign("c", "2026-08-24", 10)], flow_days: [flowDay("f", "2026-08-24", 1)],
        day_totals: [{ ymd: "2026-08-24", revenue: 1, orders: 1 }],
      });
    }
    expect(snap.campaigns).toHaveLength(1);
    expect(snap.flow_days).toHaveLength(1);
    expect(snap.day_totals).toHaveLength(1);
  });

  it("a PARTIAL run only writes what it got, leaving the rest intact", () => {
    // This is what makes the step budget safe: a run that only finished the
    // campaign step must not wipe the flow days from the previous run.
    const full = mergeSnapshot(null, {
      window: { start: "2026-08-20", end: TODAY }, timezone: "UTC", todayYmd: TODAY,
      campaigns: [campaign("c", "2026-08-24", 10)],
      flow_days: [flowDay("f", "2026-08-24", 4)],
      flow_meta: [{ id: "f", name: "Welcome" }],
      draft: [], scheduled: [],
    });
    const partial = mergeSnapshot(full, {
      window: { start: "2026-08-20", end: TODAY }, timezone: "UTC", todayYmd: TODAY,
      campaigns: [campaign("c", "2026-08-24", 12)],
      // no flow_days, no flow_meta — the step didn't run
    });
    expect(partial.flow_days).toHaveLength(1);
    expect(partial.flow_meta).toEqual([{ id: "f", name: "Welcome" }]);
    expect(partial.campaigns[0].stats.conversion_value).toBe(12);
  });

  it("keeps the merged snapshot sliceable and consistent", () => {
    const snap: KlaviyoSnapshot = mergeSnapshot(null, {
      window: { start: "2026-08-23", end: "2026-08-24" }, timezone: "UTC", todayYmd: TODAY,
      campaigns: [campaign("c", "2026-08-24", 10)],
      flow_days: [flowDay("f", "2026-08-23", 4)],
      day_totals: [{ ymd: "2026-08-23", revenue: 1, orders: 1 }, { ymd: "2026-08-24", revenue: 2, orders: 1 }],
      flow_meta: [{ id: "f", name: "Welcome" }],
    });
    const s = sliceRange(snap, "2026-08-23", "2026-08-24");
    expect(s.covered).toBe(true);
    expect(s.total_revenue).toBe(3);
    expect(s.campaigns).toHaveLength(1);
    expect(s.flows).toHaveLength(1);
  });
});

describe("dailyChunks — Klaviyo rejects a daily interval over 60 days", () => {
  it("returns one chunk when the window fits", () => {
    expect(dailyChunks("2026-08-01", "2026-08-10")).toEqual([{ start: "2026-08-01", end: "2026-08-10" }]);
  });

  it("splits a longer window into contiguous, non-overlapping chunks", () => {
    const chunks = dailyChunks("2026-06-01", "2026-08-25", 60);
    expect(chunks).toEqual([
      { start: "2026-06-01", end: "2026-07-30" },
      { start: "2026-07-31", end: "2026-08-25" },
    ]);
    // Contiguous: each chunk starts the day after the previous one ends.
    for (let i = 1; i < chunks.length; i++) {
      const prevEnd = Date.parse(`${chunks[i - 1].end}T00:00:00Z`);
      const thisStart = Date.parse(`${chunks[i].start}T00:00:00Z`);
      expect(thisStart - prevEnd).toBe(86_400_000);
    }
  });

  it("never emits a chunk longer than the cap", () => {
    for (const c of dailyChunks("2025-09-01", "2026-08-25", 60)) {
      const days = (Date.parse(`${c.end}T00:00:00Z`) - Date.parse(`${c.start}T00:00:00Z`)) / 86_400_000 + 1;
      expect(days).toBeLessThanOrEqual(60);
    }
  });

  it("handles a single-day window", () => {
    expect(dailyChunks("2026-08-25", "2026-08-25")).toEqual([{ start: "2026-08-25", end: "2026-08-25" }]);
  });
});
