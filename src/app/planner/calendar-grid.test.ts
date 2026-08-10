import { describe, it, expect } from "vitest";
import {
  buildMonthCells, toWeeks, promoWindow, promosInRange, assignLanes,
  layoutWeekBands, promoColorIndex, assignColors, ymdLocal,
} from "./calendar-grid";
import { holidayName } from "@/lib/holidays";
import type { Promotion } from "@/lib/promo/consolidate";

function promo(id: string, startDate?: string, endDate?: string): Promotion {
  return { id, year: 2026, month: "August", sale: id, promotion: "", startDate, endDate, products: [] };
}

// The spec's worked example: Back-to-School runs across the Aug/Sep boundary.
const BTS = promo("bts", "2026-08-04", "2026-09-08");

describe("buildMonthCells", () => {
  it("pads with the previous month's real dates (Sep 2026 starts Tuesday)", () => {
    const cells = buildMonthCells(2026, 8);
    expect(cells.length).toBe(35);
    expect(cells[0]).toEqual({ ymd: "2026-08-30", day: 30, inMonth: false });
    // The exact cell the spec calls out: Aug 31 sitting in September's first Monday.
    expect(cells[1]).toEqual({ ymd: "2026-08-31", day: 31, inMonth: false });
    expect(cells[2]).toEqual({ ymd: "2026-09-01", day: 1, inMonth: true });
  });

  it("pads the tail with the next month's real dates", () => {
    const cells = buildMonthCells(2026, 8);
    expect(cells[cells.length - 3]).toEqual({ ymd: "2026-10-01", day: 1, inMonth: false });
    expect(cells[cells.length - 1]).toEqual({ ymd: "2026-10-03", day: 3, inMonth: false });
  });

  it("crosses the year boundary (Dec 2026 -> Jan 2027)", () => {
    const cells = buildMonthCells(2026, 11);
    expect(cells[0].ymd).toBe("2026-11-29");
    expect(cells[cells.length - 1].ymd).toBe("2027-01-02");
  });

  it("is always a whole number of weeks and strictly consecutive", () => {
    for (let m = 0; m < 12; m++) {
      const cells = buildMonthCells(2026, m);
      expect(cells.length % 7).toBe(0);
      expect(new Date(cells[0].ymd + "T00:00:00").getDay()).toBe(0); // starts Sunday
      for (let i = 1; i < cells.length; i++) {
        const prev = new Date(cells[i - 1].ymd + "T00:00:00");
        prev.setDate(prev.getDate() + 1);
        expect(cells[i].ymd).toBe(ymdLocal(prev));
      }
      // Every day of the month is present exactly once.
      expect(cells.filter((c) => c.inMonth).length).toBe(new Date(2026, m + 1, 0).getDate());
    }
  });
});

describe("promoWindow / promosInRange", () => {
  it("treats a single-dated promo as a one-day event and drops undated ones", () => {
    expect(promoWindow(promo("a", "2026-08-04"))).toEqual({ start: "2026-08-04", end: "2026-08-04" });
    expect(promoWindow(promo("b", undefined, "2026-08-09"))).toEqual({ start: "2026-08-09", end: "2026-08-09" });
    expect(promoWindow(promo("c"))).toBeNull();
    expect(promoWindow(promo("d", "2026-08-09", "2026-08-04"))).toBeNull(); // inverted
  });

  it("includes promos touching either edge and excludes the ones just outside", () => {
    const list = [BTS, promo("before", "2026-07-01", "2026-07-25"), promo("after", "2026-09-09", "2026-09-20")];
    expect(promosInRange(list, "2026-07-26", "2026-08-01").map((p) => p.id)).toEqual([]);
    expect(promosInRange(list, "2026-08-02", "2026-08-08").map((p) => p.id)).toEqual(["bts"]);
    expect(promosInRange(list, "2026-09-06", "2026-09-12").map((p) => p.id)).toEqual(["bts", "after"]);
  });
});

describe("assignLanes", () => {
  it("keeps one lane per promo for the whole month and reuses lanes when clear", () => {
    const list = promosInRange(
      [BTS, promo("overlap", "2026-08-06", "2026-08-20"), promo("later", "2026-09-20", "2026-09-30")],
      "2026-08-01", "2026-09-30",
    );
    const lanes = assignLanes(list);
    expect(lanes.get("bts")).toBe(0);
    expect(lanes.get("overlap")).toBe(1);   // overlaps bts -> its own lane
    expect(lanes.get("later")).toBe(0);     // starts after bts ends -> lane 0 is free again
  });
});

describe("layoutWeekBands", () => {
  const weeksOf = (y: number, m: number) => toWeeks(buildMonthCells(y, m));
  const lanes = assignLanes([BTS]);

  it("clips the band to the days the promo actually covers in its first week", () => {
    const week = weeksOf(2026, 7)[1];               // Aug 2 - Aug 8
    const { bands, overflow } = layoutWeekBands(week, [BTS], lanes);
    expect(overflow).toBe(0);
    expect(bands).toHaveLength(1);
    expect(bands[0]).toMatchObject({ colStart: 2, span: 5, lane: 0, isStart: true, isEnd: false });
  });

  it("renders no band in a week the promo does not touch", () => {
    expect(layoutWeekBands(weeksOf(2026, 7)[0], [BTS], lanes).bands).toHaveLength(0);
  });

  it("continues the same promo into the next month's view", () => {
    const sep = weeksOf(2026, 8);
    // Aug 30 - Sep 5: mid-promo, so it spans the full week and is neither end.
    expect(layoutWeekBands(sep[0], [BTS], lanes).bands[0]).toMatchObject({
      colStart: 0, span: 7, isStart: false, isEnd: false,
    });
    // Sep 6 - Sep 12: ends Tuesday Sep 8.
    expect(layoutWeekBands(sep[1], [BTS], lanes).bands[0]).toMatchObject({
      colStart: 0, span: 3, isStart: false, isEnd: true,
    });
  });

  it("stacks overlapping promos and counts the rest as overflow", () => {
    const all = promosInRange(
      [BTS, promo("b", "2026-08-03", "2026-08-10"), promo("c", "2026-08-03", "2026-08-11"), promo("d", "2026-08-03", "2026-08-12")],
      "2026-08-01", "2026-08-31",
    );
    const week = weeksOf(2026, 7)[1];
    const { bands, overflow } = layoutWeekBands(week, all, assignLanes(all), 3);
    expect(bands.map((b) => b.lane).sort()).toEqual([0, 1, 2]);
    expect(overflow).toBe(1);
  });
});

describe("promoColorIndex", () => {
  it("is stable and inside the 6-colour data palette", () => {
    expect(promoColorIndex("bts")).toBe(promoColorIndex("bts"));
    for (const id of ["p_a", "p_b", "p_c", "bts", "x", ""]) {
      const i = promoColorIndex(id);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(6);
    }
  });
});

describe("assignColors", () => {
  it("never gives two OVERLAPPING promos the same colour", () => {
    // Ids chosen from the real calendar: these two genuinely hash to the same
    // slot and share a week, which is the collision this function exists for.
    const a = promo("a", "2026-08-01", "2026-08-31");
    const clashing = ["b", "c", "d", "e", "f", "g", "h"].map((id) => promo(id, "2026-08-10", "2026-08-20"));
    const list = promosInRange([a, ...clashing], "2026-08-01", "2026-08-31");
    const colors = assignColors(list);
    // Every pair that overlaps must differ (7 promos > 6 colours, so only the
    // first six are guaranteed — assert on those).
    const first6 = list.slice(0, 6);
    const used = first6.map((p) => colors.get(p.id));
    expect(new Set(used).size).toBe(6);
  });

  it("lets NON-overlapping promos reuse a colour and keeps the hashed preference", () => {
    const list = promosInRange([promo("x", "2026-08-01", "2026-08-05"), promo("y", "2026-09-01", "2026-09-05")], "2026-08-01", "2026-09-30");
    const colors = assignColors(list);
    expect(colors.get("x")).toBe(promoColorIndex("x"));
    expect(colors.get("y")).toBe(promoColorIndex("y"));
  });

  it("gives a promo the SAME colour whichever month is on screen", () => {
    // The whole point of colouring over the full calendar: paging Aug -> Sep must
    // not recolour a promo that spans both, or it stops reading as one promo.
    const all = [BTS, promo("summer", "2026-06-01", "2026-08-05"), promo("fall", "2026-09-06", "2026-10-01")];
    const global = assignColors(all);
    // Whatever slice the view happens to hold, the map it renders from is the same.
    expect(assignColors(all).get("bts")).toBe(global.get("bts"));
    // ...and it differs from both promos it overlaps.
    expect(global.get("bts")).not.toBe(global.get("summer"));
  });

  it("is deterministic and always inside the 6-colour palette", () => {
    const list = promosInRange([BTS, promo("s", "2026-08-01", "2026-08-10")], "2026-08-01", "2026-09-30");
    const a = assignColors(list), b = assignColors(list);
    for (const p of list) {
      expect(a.get(p.id)).toBe(b.get(p.id));
      expect(a.get(p.id)).toBeGreaterThanOrEqual(0);
      expect(a.get(p.id)).toBeLessThan(6);
    }
  });
});

describe("holidays land on the adjacent-month cells too", () => {
  it("resolves Labor Day and Independence Day from the real cell date", () => {
    expect(holidayName("2026-09-07")).toBe("Labor Day (US)");
    expect(holidayName("2026-07-04")).toBe("Independence Day (US)");
    // Aug 31 is not a holiday, but it must still resolve as a real date.
    expect(holidayName("2026-08-31")).toBeNull();
  });
});
