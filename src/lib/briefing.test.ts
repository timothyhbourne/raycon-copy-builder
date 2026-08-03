import { describe, it, expect } from "vitest";
import {
  buildBriefingFacts, pctChange, safeDiv, dayCount, priorWindow,
} from "./briefing";
import type { RangeOverview } from "./measure";
import type { CampaignRow, FlowRow, CampaignMeta } from "@/app/dashboard/types";

function campaign(over: Partial<CampaignRow> & { name: string; revenue: number; recipients: number }): CampaignRow {
  return {
    campaign_id: over.name, status: "sent", send_time: "2026-08-05T12:00:00Z",
    opens: 0, clicks: 0,
    revenue_per_recipient: over.recipients > 0 ? over.revenue / over.recipients : 0,
    ...over,
  } as CampaignRow;
}
function flow(name: string, revenue: number, recipients: number): FlowRow {
  return { flow_id: name, name, status: "live", opens: 0, clicks: 0, revenue, recipients, revenue_per_recipient: recipients > 0 ? revenue / recipients : 0 };
}
function meta(n: number): CampaignMeta[] {
  return Array.from({ length: n }, (_, i) => ({ campaign_id: `c${i}`, name: `c${i}`, status: "sent", send_time: null, audience_count: 0 }));
}
function overview(over: Partial<RangeOverview> & { campaigns: CampaignRow[]; flows: FlowRow[] }): RangeOverview {
  const campRev = over.campaigns.reduce((s, c) => s + c.revenue, 0);
  const flowRev = over.flows.reduce((s, f) => s + f.revenue, 0);
  return {
    revenue: {
      total: over.revenue?.total ?? campRev + flowRev + 100,
      attributed: campRev + flowRev,
      attributed_from_flows: flowRev,
      attributed_from_campaigns: campRev,
      order_count: over.revenue?.order_count ?? 10,
    },
    campaigns: over.campaigns,
    flows: over.flows,
    campaign_status: over.campaign_status ?? { draft: meta(1), scheduled: meta(2), sent: meta(over.campaigns.length) },
    warnings: over.warnings ?? [],
    range: over.range ?? { start: "2026-08-01", end: "2026-08-31" },
  };
}

describe("ratio / delta guards", () => {
  it("safeDiv returns null on non-positive denominator", () => {
    expect(safeDiv(10, 0)).toBeNull();
    expect(safeDiv(10, -5)).toBeNull();
    expect(safeDiv(10, null)).toBeNull();
    expect(safeDiv(10, 5)).toBe(2);
  });
  it("pctChange is null when prior is missing or ≤ 0 (never Infinity)", () => {
    expect(pctChange(100, null)).toBeNull();
    expect(pctChange(100, 0)).toBeNull();
    expect(pctChange(150, 100)).toBeCloseTo(0.5);
    expect(pctChange(50, 100)).toBeCloseTo(-0.5);
  });
});

describe("date math", () => {
  it("dayCount is inclusive", () => {
    expect(dayCount("2026-08-01", "2026-08-31")).toBe(31);
    expect(dayCount("2026-08-01", "2026-08-01")).toBe(1);
  });
  it("priorWindow is the equal-length window immediately before", () => {
    expect(priorWindow("2026-08-01", "2026-08-31")).toEqual({ start: "2026-07-01", end: "2026-07-31" });
    expect(priorWindow("2026-08-08", "2026-08-14")).toEqual({ start: "2026-08-01", end: "2026-08-07" });
  });
});

describe("buildBriefingFacts — selection + concentration", () => {
  const cur = overview({
    campaigns: [
      campaign({ name: "Big", revenue: 8000, recipients: 10000 }),   // rpr 0.8
      campaign({ name: "Mid", revenue: 1500, recipients: 1000 }),    // rpr 1.5 (best rpr)
      campaign({ name: "Weak", revenue: 100, recipients: 5000 }),    // rpr 0.02 (weakest)
    ],
    flows: [flow("Welcome", 3000, 6000), flow("Cart", 1000, 500)],
  });

  it("ranks top campaigns by revenue and by RPR separately", () => {
    const f = buildBriefingFacts(cur, null);
    expect(f.top_campaigns_by_revenue.map((c) => c.name)).toEqual(["Big", "Mid", "Weak"]);
    expect(f.top_campaigns_by_rpr[0].name).toBe("Mid"); // 1.5 highest RPR
  });
  it("flags the weakest sent campaign (below-average RPR)", () => {
    const f = buildBriefingFacts(cur, null);
    expect(f.weakest_campaign?.name).toBe("Weak");
  });
  it("ranks top flows by revenue", () => {
    const f = buildBriefingFacts(cur, null);
    expect(f.top_flows_by_revenue.map((x) => x.name)).toEqual(["Welcome", "Cart"]);
  });
  it("computes concentration as share of attributed revenue", () => {
    const f = buildBriefingFacts(cur, null);
    const attributed = 8000 + 1500 + 100 + 3000 + 1000; // 13600
    expect(f.concentration.top_campaign_share_pct).toBeCloseTo(8000 / attributed);
    expect(f.concentration.top3_campaign_share_pct).toBeCloseTo((8000 + 1500 + 100) / attributed);
  });
  it("computes flow vs campaign split", () => {
    const f = buildBriefingFacts(cur, null);
    expect(f.revenue.flow_revenue).toBe(4000);
    expect(f.revenue.campaign_revenue).toBe(9600);
    expect(f.revenue.flow_share_pct).toBeCloseTo(4000 / 13600);
  });
});

describe("buildBriefingFacts — comparison + low-data", () => {
  const cur = overview({ campaigns: [campaign({ name: "A", revenue: 2000, recipients: 2000 })], flows: [] });

  it("missing prior → comparison unavailable, all deltas null", () => {
    const f = buildBriefingFacts(cur, null);
    expect(f.comparison_available).toBe(false);
    expect(f.prior_range).toBeNull();
    expect(f.deltas.total_revenue_pct).toBeNull();
    expect(f.deltas.program_rpr_pct).toBeNull();
  });
  it("with prior → deltas computed", () => {
    const prior = overview({ campaigns: [campaign({ name: "A0", revenue: 1000, recipients: 2000 })], flows: [], range: { start: "2026-07-01", end: "2026-07-31" } });
    const f = buildBriefingFacts(cur, prior);
    expect(f.comparison_available).toBe(true);
    expect(f.deltas.campaign_revenue_pct).toBeCloseTo(1); // 1000 → 2000 = +100%
  });
  it("low_data flag trips when fewer than 3 sends", () => {
    expect(buildBriefingFacts(cur, null).low_data).toBe(true); // 1 sent
    const many = overview({ campaigns: [
      campaign({ name: "a", revenue: 1, recipients: 1 }),
      campaign({ name: "b", revenue: 1, recipients: 1 }),
      campaign({ name: "c", revenue: 1, recipients: 1 }),
    ], flows: [] });
    expect(buildBriefingFacts(many, null).low_data).toBe(false); // 3 sent
  });
  it("passes through warnings", () => {
    const withWarn = overview({ campaigns: [], flows: [], warnings: ["Flow values report hit the page cap"] });
    expect(buildBriefingFacts(withWarn, null).warnings).toContain("Flow values report hit the page cap");
  });
});
