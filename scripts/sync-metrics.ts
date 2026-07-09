#!/usr/bin/env tsx
import path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, "../.env.local") });

import { syncMetrics } from "@/lib/metrics/sync";

// Local / manual metrics backfill:
//   npm run sync:metrics                 # trailing window only
//   npm run sync:metrics -- --backfill=90  # also backfill up to 90 days of history
// Re-run until it reports no deferred days (MAX_DAYS_PER_RUN bounds each run).

function arg(name: string): string | undefined {
  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : undefined;
}

async function main() {
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
