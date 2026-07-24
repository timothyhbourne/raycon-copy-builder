#!/usr/bin/env tsx
import fs from "fs";
import path from "path";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { VALID_PAYMENT_STATUSES, normalizeCategory } from "@/lib/lifecycle/categories";
import { POPULATION_MEDIAN_CADENCE_DAYS } from "@/lib/lifecycle/model";

// Lifecycle backtest harness (master spec §7). Holds out the last H days; scores
// every buyer AS OF T−H using only orders available then; checks what actually
// happened in the following H days. Reports:
//   • the P(active) → reorder-rate curve (does a higher band actually reorder more?)
//   • churn precision  — of those labeled Churning/Lapsed, share that did NOT reorder
//   • reorder "recall" — of those labeled Reorder-Due/Active, share that DID reorder
//   • cross-sell lift  — cross-sell cohort's target-category conversion vs the base rate
//
// This is a PURCHASE-AXIS backtest: the CSV carries orders, not Klaviyo
// engagement events, so engagement-gated stages (Suppression, engagement-Lapsed)
// are out of scope here. Use it to tune the P(active) cutoffs + cadence + windows.
//
//   NODE_OPTIONS=--max-old-space-size=6144 npm run backtest:lifecycle
//   npm run backtest:lifecycle -- --horizon 90 --in path.csv

const DAY_MS = 86_400_000;

function parseRecord(rec: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < rec.length; i++) {
    const c = rec[i];
    if (q) {
      if (c === '"') {
        if (rec[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
const epochDay = (iso: string): number | null => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor(t / DAY_MS);
};
const pct = (x: number, d: number) => (d ? `${((100 * x) / d).toFixed(1)}%` : "n/a");

interface Order { day: number; cats: Set<string> }

async function main() {
  const argv = process.argv.slice(2);
  let inPath = path.join(process.cwd(), "shopify_orders_l24m.csv");
  let horizon = 90;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--in") inPath = argv[++i];
    else if (argv[i] === "--horizon") horizon = Number(argv[++i]) || 90;
  }
  if (!fs.existsSync(inPath)) { console.error(`[backtest] input not found: ${inPath}`); process.exit(1); }

  const customers = new Map<string, Map<string, Order>>();
  let header: string[] | null = null;
  let pending = "";
  let rows = 0;
  let maxDay = -Infinity;

  const rl = createInterface({ input: createReadStream(inPath), crlfDelay: Infinity });
  for await (const line of rl) {
    pending = pending ? pending + "\n" + line : line;
    if ((pending.match(/"/g) || []).length % 2 !== 0) continue;
    const f = parseRecord(pending);
    pending = "";
    if (!header) { header = f; continue; }
    rows++;
    if (rows % 400000 === 0) console.error(`[backtest] ${rows} rows…`);
    const email = (f[0] || "").trim().toLowerCase();
    const orderName = f[2] || "";
    const status = (f[4] || "").trim().toLowerCase();
    if (!email || !orderName || !VALID_PAYMENT_STATUSES.has(status)) continue;
    const d = epochDay(f[3] || "");
    if (d == null) continue;
    if (d > maxDay) maxDay = d;
    const cat = normalizeCategory(f[7]);
    let orders = customers.get(email);
    if (!orders) { orders = new Map(); customers.set(email, orders); }
    let o = orders.get(orderName);
    if (!o) { o = { day: d, cats: new Set() }; orders.set(orderName, o); }
    if (cat) o.cats.add(cat);
  }

  const T = maxDay;
  const cut = T - horizon; // score as of `cut`; outcome window is (cut, T]
  console.error(`[backtest] T=${new Date(T * DAY_MS).toISOString().slice(0, 10)} · cut=${new Date(cut * DAY_MS).toISOString().slice(0, 10)} · horizon=${horizon}d · ${customers.size} customers`);

  // P(active) band → outcome counters.
  const bands = ["active(≥.80)", "at-risk(.50–.80)", "churning(.20–.50)", "lapsed(<.20)"] as const;
  type Band = (typeof bands)[number];
  const bandTotal: Record<Band, number> = { "active(≥.80)": 0, "at-risk(.50–.80)": 0, "churning(.20–.50)": 0, "lapsed(<.20)": 0 };
  const bandReordered: Record<Band, number> = { "active(≥.80)": 0, "at-risk(.50–.80)": 0, "churning(.20–.50)": 0, "lapsed(<.20)": 0 };

  let reorderDueN = 0, reorderDueConverted = 0;
  let crossN = 0, crossConverted = 0;
  let earbudsBase = 0, earbudsBaseConverted = 0; // control: any earbuds owner acquiring a new target cat

  for (const orders of customers.values()) {
    const all = [...orders.values()];
    const trainDates: number[] = [];
    const catsBefore = new Set<string>();
    let reorderedInHoldout = false;
    const holdoutCats = new Set<string>();
    for (const o of all) {
      if (o.day <= cut) {
        trainDates.push(o.day);
        o.cats.forEach((c) => catsBefore.add(c));
      } else {
        reorderedInHoldout = true;
        o.cats.forEach((c) => holdoutCats.add(c));
      }
    }
    if (trainDates.length === 0) continue; // not yet a buyer at scoring time
    trainDates.sort((a, b) => a - b);
    const nTrain = trainDates.length;
    const lastTrain = trainDates[nTrain - 1];
    const cadence = nTrain >= 2 ? (lastTrain - trainDates[0]) / (nTrain - 1) : POPULATION_MEDIAN_CADENCE_DAYS;
    const daysSinceLast = cut - lastTrain;
    const daysPastReorder = daysSinceLast - cadence;
    const pActive = Math.pow(0.5, Math.max(0, daysPastReorder) / (cadence || POPULATION_MEDIAN_CADENCE_DAYS));

    const band: Band =
      pActive >= 0.8 ? "active(≥.80)" : pActive >= 0.5 ? "at-risk(.50–.80)" : pActive >= 0.2 ? "churning(.20–.50)" : "lapsed(<.20)";
    bandTotal[band]++;
    if (reorderedInHoldout) bandReordered[band]++;

    const ownsEarbuds = catsBefore.has("Earbuds");
    // Reorder-Due cohort as of `cut`: owns Earbuds, last order 60–150d before cut.
    if (ownsEarbuds && daysSinceLast >= 60 && daysSinceLast <= 150) {
      reorderDueN++;
      if (reorderedInHoldout) reorderDueConverted++;
    }
    // Cross-Sell cohort: owns Earbuds, recent (≤120d), missing Headphones or Power Tech.
    const missingTarget = !catsBefore.has("Headphones") || !catsBefore.has("Power Tech");
    if (ownsEarbuds && daysSinceLast <= 120 && missingTarget) {
      crossN++;
      const acquired = (holdoutCats.has("Headphones") && !catsBefore.has("Headphones")) ||
        (holdoutCats.has("Power Tech") && !catsBefore.has("Power Tech"));
      if (acquired) crossConverted++;
    }
    // Control base rate: any earbuds owner acquiring a target category they lacked.
    if (ownsEarbuds && missingTarget) {
      earbudsBase++;
      const acquired = (holdoutCats.has("Headphones") && !catsBefore.has("Headphones")) ||
        (holdoutCats.has("Power Tech") && !catsBefore.has("Power Tech"));
      if (acquired) earbudsBaseConverted++;
    }
  }

  const churnTotal = bandTotal["churning(.20–.50)"] + bandTotal["lapsed(<.20)"];
  const churnCorrect = (bandTotal["churning(.20–.50)"] - bandReordered["churning(.20–.50)"]) + (bandTotal["lapsed(<.20)"] - bandReordered["lapsed(<.20)"]);
  const reorderLabeledTotal = bandTotal["active(≥.80)"] + reorderDueN;
  const reorderLabeledHit = bandReordered["active(≥.80)"] + reorderDueConverted;

  const out: string[] = [];
  out.push(`\n================ LIFECYCLE BACKTEST (master spec §7) ================`);
  out.push(`Horizon ${horizon}d · scored as of ${new Date(cut * DAY_MS).toISOString().slice(0, 10)} · outcome window to ${new Date(T * DAY_MS).toISOString().slice(0, 10)}`);
  out.push(`Buyers scored: ${(bandTotal["active(≥.80)"] + bandTotal["at-risk(.50–.80)"] + bandTotal["churning(.20–.50)"] + bandTotal["lapsed(<.20)"]).toLocaleString()}`);
  out.push("");
  out.push(`P(active) band → actually reordered in next ${horizon}d  (monotonic ↓ validates the cutoffs):`);
  for (const b of bands) out.push(`  ${b.padEnd(20)} n=${String(bandTotal[b]).padStart(8)}  reordered ${pct(bandReordered[b], bandTotal[b])}`);
  out.push("");
  out.push(`Churn precision  (labeled Churning/Lapsed AND did NOT reorder): ${pct(churnCorrect, churnTotal)}  [want high]`);
  out.push(`Reorder recall   (labeled Active/Reorder-Due AND did reorder):  ${pct(reorderLabeledHit, reorderLabeledTotal)}  [want high]`);
  out.push("");
  out.push(`Reorder-Due cohort:  n=${reorderDueN.toLocaleString()}  reordered ${pct(reorderDueConverted, reorderDueN)}`);
  out.push(`Cross-Sell cohort:   n=${crossN.toLocaleString()}  acquired target ${pct(crossConverted, crossN)}`);
  out.push(`  control (all earbuds owners missing a target): ${pct(earbudsBaseConverted, earbudsBase)}  → lift ${crossN && earbudsBase ? ((crossConverted / crossN) / (earbudsBaseConverted / earbudsBase)).toFixed(2) + "×" : "n/a"}`);
  out.push(`=====================================================================\n`);
  console.log(out.join("\n"));
}

main().catch((e) => { console.error(e); process.exit(1); });
