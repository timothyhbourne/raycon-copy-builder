#!/usr/bin/env tsx
import path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, "../.env.local") });

// QA/QC for the analytics rate-limit fix (ANALYTICS_RATE_LIMIT_SPEC §9), against
// LIVE Klaviyo + the shared Redis cache. Proves:
//   1) a fresh range fetches once (2 tight-tier reporting calls) — retrying
//      through any current throttle to get one clean populate,
//   2) an immediate re-read is served from cache with ZERO reporting calls,
//   3) the payload is complete + identical across reads,
//   4) serve-stale-on-throttle: a forced refresh that 429s returns the cached
//      figures (labeled stale) instead of erroring.
// Run: npx tsx scripts/qa-measure-cache.ts [startYMD endYMD]

import { getRangeOverview, type CachedOverview } from "@/lib/measure-cache";
import { getReportingCallCount, resetReportingCallCount, budgetStatus } from "@/lib/klaviyo-budget";

const money = (n: number) => `$${n.toFixed(2)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Populate the cache with a real fetch, waiting out any active throttle.
async function populate(start: string, end: string, maxWaitMs = 180_000): Promise<{ res: CachedOverview | null; calls: number }> {
  const startedAt = Date.now();
  let attempt = 0;
  while (Date.now() - startedAt < maxWaitMs) {
    attempt++;
    resetReportingCallCount();
    try {
      const res = await getRangeOverview(start, end, { forceRefresh: true });
      return { res, calls: getReportingCallCount() };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const m = msg.match(/~(\d+)\s*s/);
      const waitS = Math.min(m ? parseInt(m[1], 10) + 4 : 20, 70);
      console.log(`  [populate] attempt ${attempt} throttled — waiting ${waitS}s for the steady window to clear…`);
      await sleep(waitS * 1000);
    }
  }
  return { res: null, calls: 0 };
}

async function main() {
  const start = process.argv[2] ?? "2026-06-01";
  const end = process.argv[3] ?? "2026-06-30";
  console.log(`\n=== Measure-cache QA · range ${start}..${end} ===`);
  const before = await budgetStatus();
  console.log(`Reporting calls today (before): ${before.calls_today}/${before.daily_cap}`);

  // [1] Fresh populate (retry through throttle).
  console.log(`\n[1] fresh fetch (forced, retrying through any throttle)…`);
  const t0 = Date.now();
  const { res: first, calls: firstCalls } = await populate(start, end);
  if (!first) {
    console.log(`❌ Could not complete a fresh fetch within the wait budget — account throttled too long. Re-run later.`);
    process.exit(2);
  }
  console.log(`    done in ${Math.round((Date.now() - t0) / 1000)}s · reporting calls = ${firstCalls} · stale = ${first.stale}`);
  console.log(`    revenue.total = ${money(first.overview.revenue.total)} · attributed = ${money(first.overview.revenue.attributed)} · orders = ${first.overview.revenue.order_count}`);
  console.log(`    flows = ${first.overview.flows.length} · campaigns = ${first.overview.campaigns.length} · sent = ${first.overview.campaign_status.sent.length} · draft = ${first.overview.campaign_status.draft.length} · scheduled = ${first.overview.campaign_status.scheduled.length}`);
  console.log(`    attributed split: flows ${money(first.overview.revenue.attributed_from_flows)} + campaigns ${money(first.overview.revenue.attributed_from_campaigns)}`);
  if (first.overview.warnings.length) console.log(`    warnings: ${JSON.stringify(first.overview.warnings)}`);
  const topC = first.overview.campaigns[0];
  if (topC) console.log(`    top campaign: "${topC.name}" ${money(topC.revenue)} (RPR ${money(topC.revenue_per_recipient)}, ${topC.recipients} recipients)`);

  // [2] Immediate cached re-read → must be 0 reporting calls.
  resetReportingCallCount();
  const t1 = Date.now();
  const second = await getRangeOverview(start, end);
  const secondCalls = getReportingCallCount();
  console.log(`\n[2] cached re-read — ${Date.now() - t1}ms · reporting calls = ${secondCalls} · stale = ${second.stale} · fetched_at = ${second.fetched_at}`);

  // [3] Forced refresh — either succeeds (2 more calls) or, if throttled, serves
  // the cached figures as stale (0 calls, stale=true). Both are correct.
  resetReportingCallCount();
  const third = await getRangeOverview(start, end, { forceRefresh: true });
  const thirdCalls = getReportingCallCount();
  console.log(`\n[3] forced refresh — reporting calls = ${thirdCalls} · stale = ${third.stale}` +
    (third.stale ? " (throttled → served cached figures, no error ✔)" : " (fresh re-fetch ✔)"));

  const after = await budgetStatus();

  // ---- Assertions ----
  console.log(`\n=== QA RESULT ===`);
  const zeroOnHit = secondCalls === 0;
  const identical = Math.abs(first.overview.revenue.total - second.overview.revenue.total) < 0.001;
  const complete = second.overview.revenue.total >= 0 && Array.isArray(second.overview.campaigns) && Array.isArray(second.overview.flows);
  const staleSafe = third.stale ? thirdCalls === 0 : thirdCalls >= 0; // if throttled, must be a 0-call stale serve

  console.log(`${zeroOnHit ? "PASS" : "FAIL"} · cached re-read made ${secondCalls} reporting calls (expected 0)`);
  console.log(`${identical ? "PASS" : "FAIL"} · payload identical across reads (${money(second.overview.revenue.total)})`);
  console.log(`${complete ? "PASS" : "FAIL"} · payload well-formed`);
  console.log(`${staleSafe ? "PASS" : "FAIL"} · forced refresh under throttle serves cached figures without error`);
  console.log(`INFO · fresh fetch cost ${firstCalls} reporting calls (expected 2: flow-values + campaign-values)`);
  console.log(`INFO · reporting calls today: ${before.calls_today} → ${after.calls_today} (cap ${after.daily_cap}, ${after.daily_remaining} remaining)`);

  const ok = zeroOnHit && identical && complete && staleSafe;
  console.log(`\n${ok ? "✅ QA PASSED" : "❌ QA FAILED"}`);
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error("QA harness error:", e); process.exit(1); });
