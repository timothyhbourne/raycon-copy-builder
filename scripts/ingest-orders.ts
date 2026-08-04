#!/usr/bin/env tsx
import fs from "fs";
import path from "path";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import {
  VALID_PAYMENT_STATUSES,
  HARDWARE_CATEGORIES,
  normalizeCategory,
  isHardware,
} from "@/lib/lifecycle/categories";
import { resolveCatalogueId } from "@/lib/products";
import type { CustomerFacts } from "@/lib/lifecycle/store";

// Lifecycle order-ingestion worker (master spec §3.1, §6 — P1 "nightly order
// ingestion → per-customer store"). Streams the Shopify export
// (shopify_orders_l24m.csv) into per-customer RFM facts keyed by lowercased
// email — the direct, accurate replacement for Klaviyo's stale
// `expected_date_of_next_order`. Also prints the §2 population validation report
// so the spec's headline findings are reproducible from the raw data.
//
//   npm run ingest:orders                      # full run → writes data/lifecycle-customers.json
//   npm run ingest:orders -- --stats-only      # validation report only, no store write
//   npm run ingest:orders -- --limit 500000    # cap rows (smoke test)
//   npm run ingest:orders -- --in path.csv --out path.json
//
// Node heap: the full base is ~911k customers; run with a raised heap, e.g.
//   NODE_OPTIONS=--max-old-space-size=6144 npm run ingest:orders

const DAY_MS = 86_400_000;

interface Args {
  in: string;
  out: string;
  statsOnly: boolean;
  limit: number;
}
function parseArgs(argv: string[]): Args {
  const a: Args = {
    in: path.join(process.cwd(), "shopify_orders_l24m.csv"),
    out: path.join(process.cwd(), "data", "lifecycle-customers.json"),
    statsOnly: false,
    limit: Infinity,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--stats-only") a.statsOnly = true;
    else if (v === "--in") a.in = argv[++i];
    else if (v === "--out") a.out = argv[++i];
    else if (v === "--limit") a.limit = Number(argv[++i]) || Infinity;
  }
  return a;
}

// RFC-4180-ish single-record parser (fields may be quoted and contain commas).
function parseRecord(rec: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < rec.length; i++) {
    const c = rec[i];
    if (q) {
      if (c === '"') {
        if (rec[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
  }
  out.push(cur);
  return out;
}

const epochDay = (iso: string): number | null => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor(t / DAY_MS);
};

// Mutable per-customer accumulator (compact: plain objects, no Map/Set per
// customer, so ~911k records stay within a raised heap).
interface Accum {
  monetary: number;
  cats: string[]; // deduped coarse categories owned
  skus: string[]; // deduped resolved catalogue ids
  orders: Record<string, number>; // orderName -> epoch day (deduped by order)
}

function median(sorted: number[]): number {
  if (!sorted.length) return NaN;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.in)) {
    console.error(`[ingest] input not found: ${args.in}`);
    process.exit(1);
  }
  console.error(`[ingest] reading ${args.in}${args.limit !== Infinity ? ` (limit ${args.limit})` : ""}`);

  const customers = new Map<string, Accum>();
  let header: string[] | null = null;
  let rows = 0;
  let validRows = 0;
  let pending = "";

  const rl = createInterface({ input: createReadStream(args.in), crlfDelay: Infinity });
  for await (const line of rl) {
    // Re-join records whose quoted field spans a newline (odd quote count).
    pending = pending ? pending + "\n" + line : line;
    if ((pending.match(/"/g) || []).length % 2 !== 0) continue;
    const f = parseRecord(pending);
    pending = "";
    if (!header) {
      header = f;
      continue;
    }
    if (rows >= args.limit) break;
    rows++;
    if (rows % 250000 === 0) console.error(`[ingest] ${rows} rows, ${customers.size} customers…`);

    const email = (f[0] || "").trim().toLowerCase();
    const orderName = f[2] || "";
    const day = f[3] || "";
    const status = (f[4] || "").trim().toLowerCase();
    const title = f[5] || "";
    const sku = f[6] || "";
    const rawType = f[7];
    const totalSales = Number(f[10]) || 0;

    if (!email || !orderName) continue;
    if (!VALID_PAYMENT_STATUSES.has(status)) continue;
    const d = epochDay(day);
    if (d == null) continue;
    validRows++;

    let rec = customers.get(email);
    if (!rec) {
      rec = { monetary: 0, cats: [], skus: [], orders: {} };
      customers.set(email, rec);
    }
    rec.monetary += totalSales;
    // First line item of an order sets its date (dedupe by order name).
    if (!(orderName in rec.orders)) rec.orders[orderName] = d;

    const cat = normalizeCategory(rawType);
    if (cat && !rec.cats.includes(cat)) rec.cats.push(cat);
    const catId = resolveCatalogueId(title) ?? resolveCatalogueId(sku);
    if (catId && !rec.skus.includes(catId)) rec.skus.push(catId);
  }

  console.error(`[ingest] done streaming: ${rows} rows, ${validRows} valid, ${customers.size} customers`);

  // ---- population validation report (master spec §2) ----------------------
  let oneTime = 0;
  const monetaryAll: number[] = [];
  const firstToSecond: number[] = []; // days between 1st and 2nd order
  const allGaps: number[] = []; // every consecutive inter-order gap
  const hardwareOwners: Record<string, number> = Object.fromEntries(HARDWARE_CATEGORIES.map((c) => [c, 0]));
  let ownExactlyOneHardware = 0;
  // Earbuds repeat-buyer next-purchase category mix.
  const earbudsRepeatCatMix: Record<string, number> = {};
  let earbudsRepeatBuyers = 0;
  // reorder cumulative (share of repeaters whose 2nd order is within Nd of 1st)
  const reorderBuckets = { d30: 0, d90: 0, d180: 0, d365: 0 };
  let repeatBuyers = 0;

  for (const rec of customers.values()) {
    const dates = Object.values(rec.orders).sort((a, b) => a - b);
    const n = dates.length;
    monetaryAll.push(rec.monetary);
    if (n === 1) oneTime++;

    const ownedHardware = rec.cats.filter(isHardware);
    for (const h of ownedHardware) hardwareOwners[h]++;
    if (ownedHardware.length === 1) ownExactlyOneHardware++;

    if (n >= 2) {
      repeatBuyers++;
      const gap12 = dates[1] - dates[0];
      firstToSecond.push(gap12);
      if (gap12 <= 30) reorderBuckets.d30++;
      if (gap12 <= 90) reorderBuckets.d90++;
      if (gap12 <= 180) reorderBuckets.d180++;
      if (gap12 <= 365) reorderBuckets.d365++;
      for (let i = 1; i < dates.length; i++) allGaps.push(dates[i] - dates[i - 1]);

      if (rec.cats.includes("Earbuds")) {
        earbudsRepeatBuyers++;
        for (const c of rec.cats) earbudsRepeatCatMix[c] = (earbudsRepeatCatMix[c] || 0) + 1;
      }
    }
  }

  monetaryAll.sort((a, b) => a - b);
  firstToSecond.sort((a, b) => a - b);
  allGaps.sort((a, b) => a - b);
  const total = customers.size;
  const pct = (x: number, d = total) => `${((100 * x) / d).toFixed(1)}%`;

  const report: string[] = [];
  report.push("\n================ POPULATION VALIDATION (master spec §2) ================");
  report.push(`Customers (distinct email):       ${total.toLocaleString()}`);
  report.push(`One-time buyers:                  ${oneTime.toLocaleString()}  (${pct(oneTime)})   [spec: 83.2%]`);
  report.push(`Repeat buyers:                    ${repeatBuyers.toLocaleString()}  (${pct(repeatBuyers)})`);
  report.push("");
  report.push(`Cadence 1st→2nd order (days):     median ${median(firstToSecond)}  p25 ${percentile(firstToSecond, 25)}  p75 ${percentile(firstToSecond, 75)}  p90 ${percentile(firstToSecond, 90)}   [spec median: 94]`);
  report.push(`Overall inter-order cadence:      median ${median(allGaps)}   [spec median: 118]`);
  report.push("");
  report.push(`24-mo net sales / customer ($):   p50 ${percentile(monetaryAll, 50).toFixed(2)}  p75 ${percentile(monetaryAll, 75).toFixed(2)}  p90 ${percentile(monetaryAll, 90).toFixed(2)}   [spec: 85 / 119 / 173]`);
  report.push("");
  report.push("Hardware ownership (customers):   [spec: Earbuds 626k · Headphones 174k · Power Tech 168k · Audio 81k]");
  for (const h of HARDWARE_CATEGORIES) report.push(`  ${h.padEnd(12)} ${hardwareOwners[h].toLocaleString()}`);
  report.push(`Own exactly 1 hardware category:  ${pct(ownExactlyOneHardware)}   [spec: 85%]`);
  report.push("");
  report.push(`Earbuds repeat-buyer next-purchase mix (share of ${earbudsRepeatBuyers.toLocaleString()} Earbuds repeaters):`);
  report.push("  [spec: Earbuds 82% · Headphones 15% · Power Tech 14% · Accessories 13% · Audio 8%]");
  for (const [c, cnt] of Object.entries(earbudsRepeatCatMix).sort((a, b) => b[1] - a[1])) {
    report.push(`  ${c.padEnd(12)} ${pct(cnt, earbudsRepeatBuyers)}`);
  }
  report.push("");
  report.push(`Reorder cumulative (repeaters, 1st→2nd within): [spec: 30d 29% · 90d 49% · 180d 66% · 365d 88%]`);
  report.push(`  30d ${pct(reorderBuckets.d30, repeatBuyers)}  90d ${pct(reorderBuckets.d90, repeatBuyers)}  180d ${pct(reorderBuckets.d180, repeatBuyers)}  365d ${pct(reorderBuckets.d365, repeatBuyers)}`);
  report.push("=======================================================================\n");
  console.log(report.join("\n"));

  if (args.statsOnly) {
    console.error("[ingest] --stats-only: not writing store.");
    return;
  }

  // ---- write the order-facts store (email → CustomerFacts) ----------------
  // Stream the JSON to disk to avoid a ~150MB intermediate string. Written to
  // the local file directly (not via the Redis-backed storage seam) so a full
  // base is never accidentally pushed to prod Redis; a deliberate seed step does
  // that in production.
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  const ws = fs.createWriteStream(args.out, "utf8");
  ws.write("{");
  let first = true;
  for (const [email, rec] of customers) {
    const dates = Object.values(rec.orders).sort((a, b) => a - b);
    const n = dates.length;
    const avgGap =
      n >= 2 ? Math.round(((dates[n - 1] - dates[0]) / (n - 1)) * 10) / 10 : null;
    const facts: CustomerFacts = {
      orderCount: n,
      lastOrderDate: new Date(dates[n - 1] * DAY_MS).toISOString().slice(0, 10),
      firstOrderDate: new Date(dates[0] * DAY_MS).toISOString().slice(0, 10),
      avgDaysBetweenOrders: avgGap,
      monetary: Math.round(rec.monetary * 100) / 100,
      ownedProductIds: rec.skus,
      ownedCategories: rec.cats,
    };
    ws.write(`${first ? "" : ","}${JSON.stringify(email)}:${JSON.stringify(facts)}`);
    first = false;
  }
  ws.write("}");
  await new Promise<void>((res, rej) => ws.end((err?: Error | null) => (err ? rej(err) : res())));
  const bytes = fs.statSync(args.out).size;
  console.error(`[ingest] wrote ${customers.size} customers → ${args.out} (${(bytes / 1e6).toFixed(1)} MB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
