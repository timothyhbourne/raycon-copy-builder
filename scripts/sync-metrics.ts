#!/usr/bin/env tsx
import path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, "../.env.local") });

import { syncMetrics } from "@/lib/metrics/sync";
import { eachDay, readRange } from "@/lib/metrics/store";

// Local / manual metrics sync:
//   npm run sync:metrics                       # trailing window only
//   npm run sync:metrics -- --backfill=90      # backfill up to 90 days of history
//   npm run sync:metrics -- --from=2025-01-01  # DEEP BACKFILL: sync ALL history
//                                              # from a date to today, in chunks
//
// Deep backfill is the "make every range instant" mode: run it once and any
// dashboard range after that is served from disk with zero waiting. It walks
// 90-day chunks oldest-first, SKIPS chunks that are already fully synced (free
// to re-run), and sleeps between chunks to respect Klaviyo's reporting quota
// (steady 2/min, 225/day — each chunk costs ~2 reporting calls, so a 2-year
// backfill is ~16 calls over ~10 minutes).

const CHUNK_DAYS = 90;
const SLEEP_BETWEEN_CHUNKS_MS = 65_000; // ~2 reporting calls per chunk vs 2/min quota

function arg(name: string): string | undefined {
  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : undefined;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function deepBackfill(from: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const allDays = eachDay(from, today);
  console.log(`[sync:metrics] deep backfill ${from}..${today} (${allDays.length} days, ${CHUNK_DAYS}-day chunks)`);

  let failures = 0;
  let chunkStart = from;
  let ranAChunk = false;
  while (chunkStart <= today) {
    const chunkEnd = addDays(chunkStart, CHUNK_DAYS - 1) > today ? today : addDays(chunkStart, CHUNK_DAYS - 1);
    const { missing } = readRange(chunkStart, chunkEnd);
    if (missing.length === 0) {
      console.log(`  ${chunkStart}..${chunkEnd}  already synced — skipped`);
    } else {
      if (ranAChunk) {
        console.log(`  (sleeping ${Math.round(SLEEP_BETWEEN_CHUNKS_MS / 1000)}s for the reporting quota…)`);
        await sleep(SLEEP_BETWEEN_CHUNKS_MS);
      }
      const summary = await syncMetrics({ rangeStart: chunkStart, rangeEnd: chunkEnd });
      ranAChunk = true;
      failures += summary.days_failed;
      console.log(`  ${chunkStart}..${chunkEnd}  synced=${summary.days_synced} failed=${summary.days_failed} calls=${summary.api_calls} (${Math.round(summary.duration_ms / 1000)}s)`);
      for (const w of summary.warnings) console.log(`    warn: ${w}`);
    }
    chunkStart = addDays(chunkEnd, 1);
  }
  return failures;
}

async function main() {
  const from = arg("from");
  if (from != null) {
    if (!YMD_RE.test(from)) {
      console.error(`Invalid --from=${from} (expected YYYY-MM-DD)`);
      process.exit(1);
    }
    const failures = await deepBackfill(from);
    console.log(failures > 0
      ? `[sync:metrics] done with ${failures} failed day(s) — re-run to retry them.`
      : "[sync:metrics] deep backfill complete — every range back to " + from + " is now instant.");
    process.exit(failures > 0 ? 1 : 0);
  }

  const raw = arg("backfill");
  const backfillDays = raw != null ? Number(raw) : undefined;
  if (raw != null && !Number.isFinite(backfillDays)) {
    console.error(`Invalid --backfill=${raw} (expected a number of days)`);
    process.exit(1);
  }
  console.log(`[sync:metrics] starting${backfillDays != null ? ` (backfill ${backfillDays}d)` : ""}…`);
  const summary = await syncMetrics(backfillDays != null ? { backfillDays } : {});
  console.log("[sync:metrics] done:", JSON.stringify(summary, null, 2));
  process.exit(summary.days_failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error("[sync:metrics] fatal:", e); process.exit(1); });
