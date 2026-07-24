import { describe, it, expect } from "vitest";
import {
  computeSnapshot,
  cohortMemberEmails,
  deriveCustomers,
  isKnownCohort,
  COHORT_CATALOG,
  SEED_SNAPSHOT,
} from "./snapshot";
import type { CustomerFacts, CustomerFactsMap } from "./store";

const now = Date.parse("2026-07-24T00:00:00Z");
const nowISO = "2026-07-24T00:00:00Z";
const daysAgo = (n: number) => new Date(now - n * 86_400_000).toISOString().slice(0, 10);

const facts = (o: Partial<CustomerFacts> = {}): CustomerFacts => ({
  orderCount: 1,
  firstOrderDate: daysAgo(200),
  lastOrderDate: daysAgo(200),
  avgDaysBetweenOrders: null,
  monetary: 85,
  ownedProductIds: [],
  ownedCategories: ["Earbuds"],
  ...o,
});

describe("cohort predicates (brief appendix rules)", () => {
  const inCohort = (id: string, f: CustomerFacts) =>
    cohortMemberEmails({ "x@e.com": f }, id, now).length === 1;

  it("Reorder-Due · Earbuds: owns Earbuds AND last order 60–150d", () => {
    expect(inCohort("reorder_due_earbuds", facts({ lastOrderDate: daysAgo(90) }))).toBe(true);
    expect(inCohort("reorder_due_earbuds", facts({ lastOrderDate: daysAgo(160) }))).toBe(false);
    expect(inCohort("reorder_due_earbuds", facts({ lastOrderDate: daysAgo(90), ownedCategories: ["Headphones"] }))).toBe(false);
  });

  it("At-Risk · Earbuds overdue: owns Earbuds AND last order 151–300d", () => {
    expect(inCohort("atrisk_overdue_earbuds", facts({ lastOrderDate: daysAgo(200) }))).toBe(true);
    expect(inCohort("atrisk_overdue_earbuds", facts({ lastOrderDate: daysAgo(150) }))).toBe(false);
  });

  it("Win-Back · lapsed 181–365d (any category)", () => {
    expect(inCohort("winback_lapsed", facts({ lastOrderDate: daysAgo(300), ownedCategories: ["Power Tech"] }))).toBe(true);
    expect(inCohort("winback_lapsed", facts({ lastOrderDate: daysAgo(400) }))).toBe(false);
  });

  it("Cross-Sell · Earbuds→Headphones: owns Earbuds, NOT Headphones, ≤120d", () => {
    expect(inCohort("crosssell_headphones", facts({ lastOrderDate: daysAgo(30), ownedCategories: ["Earbuds"] }))).toBe(true);
    expect(inCohort("crosssell_headphones", facts({ lastOrderDate: daysAgo(30), ownedCategories: ["Earbuds", "Headphones"] }))).toBe(false);
  });

  it("New Customer · 2nd-order: exactly 1 order, first ≤45d", () => {
    expect(inCohort("new_customer_2nd", facts({ orderCount: 1, firstOrderDate: daysAgo(20), lastOrderDate: daysAgo(20) }))).toBe(true);
    expect(inCohort("new_customer_2nd", facts({ orderCount: 2, firstOrderDate: daysAgo(20) }))).toBe(false);
  });
});

describe("computeSnapshot", () => {
  const base: CustomerFactsMap = {
    "reorder@e.com": facts({ lastOrderDate: daysAgo(90) }), // reorder-due + winback? 90<181 no
    "atrisk@e.com": facts({ lastOrderDate: daysAgo(200) }), // atrisk + winback (181-365)
    "new@e.com": facts({ orderCount: 1, firstOrderDate: daysAgo(10), lastOrderDate: daysAgo(10) }), // new + cross-sell + reorder? 10<60 no
    "dormant@e.com": facts({ lastOrderDate: daysAgo(500) }), // dormant, suppression
  };

  it("computes cohort sizes and modeled_revenue = size × response × aov, sorted desc", () => {
    const snap = computeSnapshot(base, nowISO);
    const byId = Object.fromEntries(snap.cohorts.map((c) => [c.id, c]));
    expect(byId.reorder_due_earbuds.size).toBe(1);
    expect(byId.reorder_due_earbuds.modeled_revenue).toBe(Math.round(1 * 0.08 * 85));
    // sorted by modeled_revenue desc
    const revs = snap.cohorts.map((c) => c.modeled_revenue);
    expect(revs).toEqual([...revs].sort((a, b) => b - a));
    expect(snap.source).toBe("worker");
    expect(snap.total_audience).toBe(4);
  });

  it("builds recency bands that sum to the audience and carry pct", () => {
    const snap = computeSnapshot(base, nowISO);
    const sum = snap.overview.bands.reduce((n, b) => n + b.count, 0);
    expect(sum).toBe(4); // every customer lands in exactly one recency band
    expect(snap.overview.bands.find((b) => b.key === "dormant")!.count).toBe(1);
  });

  it("populates key-segment tiles from the facts", () => {
    const snap = computeSnapshot(base, nowISO);
    const tile = (label: string) => snap.overview.tiles.find((t) => t.label === label)!;
    expect(tile("New Customers").count).toBe(1);
    expect(tile("Suppression Watch").count).toBe(1);
  });
});

describe("catalog + seed integrity", () => {
  it("isKnownCohort matches the catalog ids and the seed cohort ids", () => {
    for (const c of COHORT_CATALOG) expect(isKnownCohort(c.meta.id)).toBe(true);
    for (const c of SEED_SNAPSHOT.cohorts) expect(isKnownCohort(c.id)).toBe(true);
    expect(isKnownCohort("nope")).toBe(false);
  });

  it("seed snapshot has the expected shape (911k audience, 5 cohorts)", () => {
    expect(SEED_SNAPSHOT.total_audience).toBe(911466);
    expect(SEED_SNAPSHOT.cohorts.length).toBe(5);
    expect(SEED_SNAPSHOT.source).toBe("seed");
  });

  it("deriveCustomers maps ownership + recency from facts", () => {
    const [d] = deriveCustomers({ "a@e.com": facts({ lastOrderDate: daysAgo(30), ownedCategories: ["Earbuds", "Power Tech"] }) }, now);
    expect(d.ownsEarbuds).toBe(true);
    expect(d.ownsPowerTech).toBe(true);
    expect(d.ownsHeadphones).toBe(false);
    expect(d.daysSinceLastOrder).toBe(30);
  });
});
