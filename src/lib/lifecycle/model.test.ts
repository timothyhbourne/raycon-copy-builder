import { describe, it, expect } from "vitest";
import {
  pActive, assignStage, computeBadges, scoreProfile, productAffinity,
  POPULATION_MEDIAN_CADENCE_DAYS, type LifecycleInput,
} from "./model";
import { klaviyoProfileToLifecycleInput, extractInterests, type KlaviyoProfileLike } from "./klaviyo";

// A healthy, on-cadence repeat buyer; override per case.
const base: LifecycleInput = {
  orderCount: 2,
  ageDays: 500,
  engagementRecencyDays: 10,
  clv: 100,
  daysPastExpectedReorder: 0,
  avgDaysBetweenOrders: 100,
  churnProbability: 0.99,
  ownedProductIds: [],
  interests: [],
};
const mk = (o: Partial<LifecycleInput> = {}): LifecycleInput => ({ ...base, ...o });

describe("pActive — half-life of one purchase cycle (§3)", () => {
  it("on cadence (or not yet due) → 1.0", () => {
    expect(pActive(mk({ daysPastExpectedReorder: 0 }))).toBe(1);
    expect(pActive(mk({ daysPastExpectedReorder: -50 }))).toBe(1); // clamped at 0
  });
  it("one cycle overdue → 0.50", () => {
    expect(pActive(mk({ daysPastExpectedReorder: 100, avgDaysBetweenOrders: 100 }))).toBeCloseTo(0.5, 10);
  });
  it("two cycles overdue → 0.25", () => {
    expect(pActive(mk({ daysPastExpectedReorder: 200, avgDaysBetweenOrders: 100 }))).toBeCloseTo(0.25, 10);
  });
  it("falls back to the population median cadence when the customer's own is unknown", () => {
    expect(pActive(mk({ daysPastExpectedReorder: POPULATION_MEDIAN_CADENCE_DAYS, avgDaysBetweenOrders: null }))).toBeCloseTo(0.5, 10);
  });
  it("is null (not computable) when there is no reorder estimate", () => {
    expect(pActive(mk({ daysPastExpectedReorder: null }))).toBeNull();
  });
});

describe("assignStage — columns, first-match (§4, §8-A split)", () => {
  it("1. Suppression-Ready when engagement is past the sunset window", () => {
    expect(assignStage(mk({ engagementRecencyDays: 400 }))).toBe("suppression_ready");
  });
  it("1. Suppression-Ready for a never-engaged non-buyer on an aged account", () => {
    expect(assignStage(mk({ orderCount: 0, engagementRecencyDays: null, ageDays: 400, daysPastExpectedReorder: null }))).toBe("suppression_ready");
  });
  it("2. Lead / Non-Buyer when n = 0", () => {
    expect(assignStage(mk({ orderCount: 0, engagementRecencyDays: 100, daysPastExpectedReorder: null }))).toBe("lead_non_buyer");
  });
  it("3. New Customer when n ≥ 1 and age ≤ 45d", () => {
    expect(assignStage(mk({ orderCount: 1, ageDays: 10 }))).toBe("new_customer");
  });
  it("engagement guardrail: 180 < R_e ≤ 365 → Lapsed, even with a healthy purchase signal", () => {
    expect(assignStage(mk({ engagementRecencyDays: 250, daysPastExpectedReorder: 0 }))).toBe("lapsed_dormant");
  });
  it("4. Lapsed / Dormant: P(active) < 0.20 and engagement cooled (R_e > 45)", () => {
    expect(assignStage(mk({ daysPastExpectedReorder: 400, avgDaysBetweenOrders: 100, engagementRecencyDays: 100 }))).toBe("lapsed_dormant");
  });
  it("Win-Back: purchase-gone but reachable (≤45d), not high value", () => {
    expect(assignStage(mk({ daysPastExpectedReorder: 400, avgDaysBetweenOrders: 100, engagementRecencyDays: 10, clv: 100 }))).toBe("win_back");
  });
  it("Win-Back: 0.20 ≤ P(active) < 0.50, not high value", () => {
    expect(assignStage(mk({ daysPastExpectedReorder: 150, avgDaysBetweenOrders: 100, engagementRecencyDays: 10, clv: 100 }))).toBe("win_back");
  });
  it("VIP Reactivation (§8-A): same churning band but HIGH value + reachable", () => {
    expect(assignStage(mk({ daysPastExpectedReorder: 150, avgDaysBetweenOrders: 100, engagementRecencyDays: 10, clv: 1000 }))).toBe("vip_reactivation");
  });
  it("6. At-Risk: 0.50 ≤ P(active) < 0.80", () => {
    expect(assignStage(mk({ daysPastExpectedReorder: 50, avgDaysBetweenOrders: 100, engagementRecencyDays: 10 }))).toBe("at_risk");
  });
  it("7. Upsell-Ready: live, repeat, high value, reachable", () => {
    expect(assignStage(mk({ daysPastExpectedReorder: 0, orderCount: 3, clv: 300, engagementRecencyDays: 30 }))).toBe("upsell_ready");
  });
  it("8. Active / On-Track: live but not upsell (single order)", () => {
    expect(assignStage(mk({ daysPastExpectedReorder: 0, orderCount: 1, clv: 100, engagementRecencyDays: 30 }))).toBe("active_on_track");
  });
  it("9. Unknown: a buyer with neither engagement nor cadence/reorder data", () => {
    expect(assignStage(mk({ engagementRecencyDays: null, daysPastExpectedReorder: null }))).toBe("unknown");
  });

  describe("cadence-missing fallback → engagement-recency bands", () => {
    it("R_e ≤ 45 → Active", () => {
      expect(assignStage(mk({ daysPastExpectedReorder: null, engagementRecencyDays: 10 }))).toBe("active_on_track");
    });
    it("45 < R_e ≤ 90 → At-Risk", () => {
      expect(assignStage(mk({ daysPastExpectedReorder: null, engagementRecencyDays: 70 }))).toBe("at_risk");
    });
    it("90 < R_e ≤ 180 → Win-Back", () => {
      expect(assignStage(mk({ daysPastExpectedReorder: null, engagementRecencyDays: 150 }))).toBe("win_back");
    });
  });
});

describe("§6 sanity cases — the two-axis design", () => {
  it("Ray (11 orders, $1,668, engaged 7d, stale eno → 448d overdue) → VIP Reactivation, not Lapsed", () => {
    const ray = mk({
      orderCount: 11, clv: 1668, engagementRecencyDays: 7,
      daysPastExpectedReorder: 448, avgDaysBetweenOrders: 100, ageDays: 900,
    });
    const score = scoreProfile(ray);
    expect(score.pActive).toBeLessThan(0.2);         // purchase axis says "gone"...
    expect(score.stage).toBe("vip_reactivation");    // ...but engagement + value make him priority
    expect(score.badges).toContain("VIP at-risk");
    expect(score.badges).toContain("high value");
    expect(score.badges).toContain("repeat x11");
    expect(score.badges).toContain("purchase-overdue 448d");
  });

  it("Barbara (2,809d overdue, engagement cooled) → Lapsed / Dormant", () => {
    const barbara = mk({
      orderCount: 2, clv: 150, engagementRecencyDays: 200,
      daysPastExpectedReorder: 2809, avgDaysBetweenOrders: null, ageDays: 3000,
    });
    expect(scoreProfile(barbara).stage).toBe("lapsed_dormant");
  });
});

describe("product affinity (§8-D)", () => {
  it("splits owned vs cross-sell categories from real SKU ids", () => {
    // E25 = Earbuds; O25 = Open Audio. Owns 2 categories → cross-sell the rest.
    const { ownedCategories, upsellCategories } = productAffinity(["E25", "O25"]);
    expect(ownedCategories).toEqual(["Open Audio", "Earbuds"]);
    expect(upsellCategories).toEqual(["Headphones", "AI Notetaker", "Fast Charging"]);
  });
  it("claims nothing when ownership is unknown", () => {
    expect(productAffinity([])).toEqual({ ownedCategories: [], upsellCategories: [] });
  });
  it("surfaces a cross-sell badge and score fields from order-derived ownership", () => {
    const score = scoreProfile(mk({ ownedProductIds: ["H10"] })); // owns Headphones
    expect(score.ownedCategories).toEqual(["Headphones"]);
    expect(score.badges.some((b) => b.startsWith("cross-sell: "))).toBe(true);
  });
  it("falls back to the interest signal only when ownership is unknown", () => {
    const score = scoreProfile(mk({ ownedProductIds: [], interests: ["Home"] }));
    expect(score.badges).toContain("interest: Home");
    expect(score.badges.some((b) => b.startsWith("cross-sell: "))).toBe(false);
  });
});

describe("Phase-2 seam (§8-C): injected fitted P(alive)", () => {
  it("a fitted P(alive) overrides the proxy and drives the stage", () => {
    // Proxy would be 1.0 (on cadence) → Active; a fitted 0.1 flips it to churning region.
    const i = mk({ daysPastExpectedReorder: 0, engagementRecencyDays: 10, clv: 100 });
    expect(scoreProfile(i).stage).toBe("active_on_track");
    const fitted = scoreProfile(i, { fittedPAlive: 0.1 });
    expect(fitted.pActiveSource).toBe("fitted");
    expect(fitted.pActive).toBe(0.1);
    expect(fitted.stage).toBe("win_back");
  });
  it("marks the proxy source when no fitted value is supplied", () => {
    expect(scoreProfile(mk()).pActiveSource).toBe("proxy");
    expect(scoreProfile(mk({ daysPastExpectedReorder: null, engagementRecencyDays: 10 })).pActiveSource).toBe("none");
  });
});

describe("computeBadges (§5, non-exclusive)", () => {
  it("single-purchase for n = 1", () => {
    const i = mk({ orderCount: 1 });
    expect(computeBadges(i, pActive(i))).toContain("single-purchase");
  });
  it("repeat xN for n ≥ 2", () => {
    const i = mk({ orderCount: 5 });
    expect(computeBadges(i, pActive(i))).toContain("repeat x5");
  });
  it("high value at/above the CLV threshold; churn as a raw reference badge", () => {
    const i = mk({ clv: 300, churnProbability: 0.99 });
    const b = computeBadges(i, pActive(i));
    expect(b).toContain("high value");
    expect(b).toContain("Klaviyo churn (raw) 0.99");
  });
  it("recently re-engaged when engaged ≤30d but purchase-lapsed", () => {
    const i = mk({ engagementRecencyDays: 10, daysPastExpectedReorder: 400, avgDaysBetweenOrders: 100 });
    expect(computeBadges(i, pActive(i))).toContain("recently re-engaged");
  });
  it("missing engagement data flag for a buyer with no last_event_date", () => {
    const i = mk({ engagementRecencyDays: null, daysPastExpectedReorder: null });
    expect(computeBadges(i, pActive(i))).toContain("missing engagement data");
  });
});

describe("klaviyoProfileToLifecycleInput adapter", () => {
  const now = Date.parse("2026-07-24T00:00:00Z");
  it("derives scalar days + predictive fields + fallback interests relative to a fixed now", () => {
    const profile: KlaviyoProfileLike = {
      attributes: {
        created: "2024-01-01T00:00:00Z",
        last_event_date: "2026-07-17T00:00:00Z", // 7 days before now
        properties: { Audio: true, Home: false, "PS - Interest": "yes" },
        predictive_analytics: {
          historic_number_of_orders: 11,
          total_clv: 1668,
          churn_probability: 0.99,
          expected_date_of_next_order: "2025-05-02T00:00:00Z", // ~448 days before now
          average_days_between_orders: 100,
        },
      },
    };
    const input = klaviyoProfileToLifecycleInput(profile, now);
    expect(input.orderCount).toBe(11);
    expect(input.clv).toBe(1668);
    expect(input.churnProbability).toBe(0.99);
    expect(input.engagementRecencyDays).toBe(7);
    expect(input.daysPastExpectedReorder).toBe(448);
    expect(input.avgDaysBetweenOrders).toBe(100);
    expect(input.ownedProductIds).toEqual([]); // ownership comes from orders, not the profile
    expect(input.interests).toEqual(["Audio", "PS - Interest"]); // truthy interest flags only
  });
  it("treats missing predictive fields as nulls / zero, never throwing", () => {
    const input = klaviyoProfileToLifecycleInput({ attributes: {} }, now);
    expect(input.orderCount).toBe(0);
    expect(input.clv).toBeNull();
    expect(input.engagementRecencyDays).toBeNull();
    expect(input.daysPastExpectedReorder).toBeNull();
    expect(input.ownedProductIds).toEqual([]);
    expect(input.interests).toEqual([]);
    expect(scoreProfile(input).stage).toBe("lead_non_buyer");
  });
  it("extractInterests keeps only present-and-truthy interest flags", () => {
    expect(extractInterests({ Audio: true, Home: 0, "PS - Interest": "1" })).toEqual(["Audio", "PS - Interest"]);
  });
});
