// Run the Klaviyo snapshot sync to completion, with no timeout.
//
// The reporting tier is 2 calls/minute, so a full run genuinely takes minutes —
// this is the place to do it. A serverless invocation can't (see
// /api/klaviyo/sync's time budget), and the daily cron only needs the cheap
// incremental pass.
//
//   npm run sync:klaviyo              # incremental (trailing attribution window)
//   npm run sync:klaviyo -- --full    # the whole snapshot window
//   npm run sync:klaviyo -- --full --days=60
//   npm run sync:klaviyo -- --full --reset   # discard the stored snapshot first
//
// GOTCHA (the standing one for tsx scripts in this repo): the env must be exported
// BEFORE the process starts, or every store falls back to local files. `npm run`
// via package.json handles that through next/env below.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

async function main() {
  const args = process.argv.slice(2);
  const full = args.includes("--full");
  const reset = args.includes("--reset");
  const daysArg = args.find((a) => a.startsWith("--days="));
  const days = daysArg ? Number(daysArg.split("=")[1]) : undefined;

  const { syncKlaviyoSnapshot, DEFAULT_SNAPSHOT_DAYS } = await import("../src/lib/klaviyo-sync");
  const t0 = Date.now();
  const result = await syncKlaviyoSnapshot({
    mode: full ? "full" : "incremental",
    reset,
    days: days ?? DEFAULT_SNAPSHOT_DAYS,
    budgetMs: 60 * 60_000,          // an hour: the limiter's pacing is the real clock
    log: (l) => console.log(`  ${l}`),
  });

  console.log("\n--- result ---");
  console.log(`mode:             ${result.mode}`);
  console.log(`window:           ${result.window.start} .. ${result.window.end}`);
  console.log(`reporting calls:  ${result.reporting_calls}`);
  console.log(`completed:        ${result.completed}`);
  if (result.remaining.length) console.log(`remaining:        ${result.remaining.join(", ")}`);
  if (result.warnings.length) console.log(`warnings:\n  - ${result.warnings.join("\n  - ")}`);
  console.log(`elapsed:          ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(result.completed ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
