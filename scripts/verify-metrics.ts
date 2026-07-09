#!/usr/bin/env tsx
import path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, "../.env.local") });

import {
  aggregateMetric, campaignValuesReport, dayRangeISO, flowValuesReport,
  getAccountTimezone, resolvePlacedOrderMetric, sumArray,
} from "@/lib/klaviyo";
import { readRange } from "@/lib/metrics/store";

// Correctness check: for a date range, compare the STORE-derived totals (summed
// daily snapshots — the fast read path) against a DIRECT one-off Klaviyo range
// report (the old live path). Flows + campaigns revenue/recipients/opens/clicks
// and headline revenue must match within rounding. Attributed drift on recent
// (unfrozen) days is expected — a conversion can land after the day it's
// reported — so it's noted, not failed.
//
//   npm run sync:metrics -- --backfill=10   # make sure the range is synced
//   tsx scripts/verify-metrics.ts 2026-07-01 2026-07-07

function arg(i: number, fallback: string): string { return process.argv[i] ?? fallback; }

function daysAgoYMD(n: number): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10);
}

interface AnyValuesResult {
  groupings: { flow_id?: string; campaign_id?: string; send_channel?: string };
  statistics: {
    recipients?: number; opens?: number; opens_unique?: number;
    clicks?: number; clicks_unique?: number; conversion_value?: number;
  };
}

function foldById(results: AnyValuesResult[], key: "flow_id" | "campaign_id") {
  const by = new Map<string, { recipients: number; opens: number; clicks: number; revenue: number }>();
  for (const r of results) {
    const id = r.groupings[key];
    if (!id) continue;
    const cur = by.get(id) ?? { recipients: 0, opens: 0, clicks: 0, revenue: 0 };
    cur.recipients += r.statistics.recipients ?? 0;
    cur.opens += r.statistics.opens_unique ?? r.statistics.opens ?? 0;
    cur.clicks += r.statistics.clicks_unique ?? r.statistics.clicks ?? 0;
    cur.revenue += r.statistics.conversion_value ?? 0;
    by.set(id, cur);
  }
  return by;
}

const sum = (m: Map<string, { recipients: number; opens: number; clicks: number; revenue: number }>) => {
  let recipients = 0, opens = 0, clicks = 0, revenue = 0;
  for (const v of m.values()) { recipients += v.recipients; opens += v.opens; clicks += v.clicks; revenue += v.revenue; }
  return { recipients, opens, clicks, revenue };
};

function line(label: string, store: number, live: number, money = false) {
  const fmt = (n: number) => (money ? `$${n.toFixed(2)}` : String(Math.round(n)));
  const diff = store - live;
  const pct = live !== 0 ? (diff / live) * 100 : store === 0 ? 0 : 100;
  const ok = Math.abs(diff) < (money ? 1 : 1) || Math.abs(pct) < 0.5;
  console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(22)} store=${fmt(store).padStart(12)}  live=${fmt(live).padStart(12)}  Δ=${fmt(diff).padStart(10)} (${pct.toFixed(2)}%)`);
}

async function main() {
  const startYMD = arg(2, daysAgoYMD(7));
  const endYMD = arg(3, daysAgoYMD(1));
  console.log(`[verify-metrics] range ${startYMD}..${endYMD}\n`);

  // ---- STORE side (fast path) ----
  const { days, missing } = readRange(startYMD, endYMD);
  let storeTotal = 0, storeOrders = 0;
  const storeFlows = new Map<string, { recipients: number; opens: number; clicks: number; revenue: number }>();
  const storeCamps = new Map<string, { recipients: number; opens: number; clicks: number; revenue: number }>();
  for (const d of days) {
    storeTotal += d.revenue.total; storeOrders += d.revenue.order_count;
    for (const f of d.flows) {
      const c = storeFlows.get(f.flow_id) ?? { recipients: 0, opens: 0, clicks: 0, revenue: 0 };
      c.recipients += f.recipients; c.opens += f.opens; c.clicks += f.clicks; c.revenue += f.revenue; storeFlows.set(f.flow_id, c);
    }
    for (const cp of d.campaigns) {
      const c = storeCamps.get(cp.campaign_id) ?? { recipients: 0, opens: 0, clicks: 0, revenue: 0 };
      c.recipients += cp.recipients; c.opens += cp.opens; c.clicks += cp.clicks; c.revenue += cp.revenue; storeCamps.set(cp.campaign_id, c);
    }
  }
  if (missing.length) console.log(`  ⚠ store missing ${missing.length} day(s): ${missing.join(", ")}\n  (diffs will understate until these are synced)\n`);

  // ---- LIVE side (direct range report) ----
  const timezone = await getAccountTimezone();
  const metric = await resolvePlacedOrderMetric();
  const { start, end } = dayRangeISO(startYMD, endYMD);
  const agg = await aggregateMetric({ metricId: metric.id, start, end, measurements: ["sum_value", "count"], timezone });
  const liveTotal = agg.data.reduce((a, g) => a + sumArray(g.measurements.sum_value), 0);
  const liveOrders = agg.data.reduce((a, g) => a + sumArray(g.measurements.count), 0);
  const flowReport = await flowValuesReport({ start, end, conversionMetricId: metric.id });
  const campaignReport = await campaignValuesReport({ start, end, conversionMetricId: metric.id });
  const liveFlows = foldById(flowReport.results, "flow_id");
  const liveCamps = foldById(campaignReport.results, "campaign_id");

  const sf = sum(storeFlows), lf = sum(liveFlows), sc = sum(storeCamps), lc = sum(liveCamps);
  console.log("HEADLINE (placed-order revenue)");
  line("total revenue", storeTotal, liveTotal, true);
  line("order count", storeOrders, liveOrders);
  console.log("\nFLOWS (attribution trails — recent-day drift expected)");
  line("recipients", sf.recipients, lf.recipients);
  line("opens", sf.opens, lf.opens);
  line("clicks", sf.clicks, lf.clicks);
  line("revenue", sf.revenue, lf.revenue, true);
  console.log("\nCAMPAIGNS");
  line("recipients", sc.recipients, lc.recipients);
  line("opens", sc.opens, lc.opens);
  line("clicks", sc.clicks, lc.clicks);
  line("revenue", sc.revenue, lc.revenue, true);
  console.log("\nNote: recipients/opens/clicks are immutable per day and should match exactly once synced.");
  console.log("Revenue on unfrozen (recent) days may drift as late conversions attribute — expected, not a failure.");
}

main().catch((e) => { console.error("[verify-metrics] error:", e instanceof Error ? e.message : e); process.exit(1); });
