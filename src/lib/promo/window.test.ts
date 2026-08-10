import { describe, it, expect } from "vitest";
import { promoWindow, promosInRange, promoOnDate } from "./window";
import type { Promotion } from "./consolidate";

function p(id: string, startDate?: string, endDate?: string): Promotion {
  return { id, year: 2026, month: "August", sale: id, promotion: "", startDate, endDate, products: [] };
}

describe("promoWindow", () => {
  it("fills a missing edge from the other date", () => {
    expect(promoWindow(p("a", "2026-08-04", "2026-09-08"))).toEqual({ start: "2026-08-04", end: "2026-09-08" });
    expect(promoWindow(p("b", "2026-08-04"))).toEqual({ start: "2026-08-04", end: "2026-08-04" });
    expect(promoWindow(p("c", undefined, "2026-08-04"))).toEqual({ start: "2026-08-04", end: "2026-08-04" });
  });

  it("rejects undated and inverted windows", () => {
    expect(promoWindow(p("d"))).toBeNull();
    expect(promoWindow(p("e", "2026-08-09", "2026-08-04"))).toBeNull();
  });
});

describe("promosInRange", () => {
  const list = [p("bts", "2026-08-04", "2026-09-08"), p("early", "2026-07-01", "2026-08-04"), p("undated")];

  it("is inclusive at both edges", () => {
    expect(promosInRange(list, "2026-08-04", "2026-08-04").map((x) => x.id)).toEqual(["early", "bts"]);
    expect(promosInRange(list, "2026-09-08", "2026-09-30").map((x) => x.id)).toEqual(["bts"]);
    expect(promosInRange(list, "2026-09-09", "2026-09-30")).toEqual([]);
  });

  it("never returns an undated promo", () => {
    expect(promosInRange(list, "2020-01-01", "2030-01-01").map((x) => x.id)).not.toContain("undated");
  });
});

describe("promoOnDate", () => {
  it("finds the promotion running on a planned send date", () => {
    expect(promoOnDate([p("bts", "2026-08-04", "2026-09-08")], "2026-08-20")?.id).toBe("bts");
    expect(promoOnDate([p("bts", "2026-08-04", "2026-09-08")], "2026-09-09")).toBeUndefined();
  });

  it("prefers the most specific (shortest) window when promos overlap", () => {
    const promos = [p("seasonal", "2026-08-01", "2026-08-31"), p("flash", "2026-08-19", "2026-08-21")];
    expect(promoOnDate(promos, "2026-08-20")?.id).toBe("flash");
    expect(promoOnDate(promos, "2026-08-25")?.id).toBe("seasonal");
  });

  it("is safe on empty input", () => {
    expect(promoOnDate([], "2026-08-20")).toBeUndefined();
    expect(promoOnDate([p("bts", "2026-08-04", "2026-09-08")], "")).toBeUndefined();
  });
});
