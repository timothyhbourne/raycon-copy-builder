// Dry-run the promo consolidation engine over the LIVE sheet and print one
// month's promotions so the grouping/forward-fill/date-normalization can be
// eyeballed. Usage:
//   npx tsx scripts/promo-dryrun.ts [Year] [Month]
//   e.g. npx tsx scripts/promo-dryrun.ts 2023 January
import { fetchPromoCsv } from "../src/lib/promo/fetch";
import { consolidate } from "../src/lib/promo/consolidate";

async function main() {
  const [, , yearArg, monthArg] = process.argv;
  const csv = await fetchPromoCsv();
  const { promotions, warnings } = consolidate(csv);

  const years = Array.from(new Set(promotions.map((p) => p.year))).sort();
  console.log(`Consolidated ${promotions.length} promotions across years: ${years.join(", ")}`);
  console.log(`Warnings: ${warnings.length}`);
  warnings.slice(0, 10).forEach((w) => console.log("  ! " + w));
  if (warnings.length > 10) console.log(`  … +${warnings.length - 10} more`);

  const year = yearArg ? Number(yearArg) : years[0];
  const monthPick = (monthArg || "").toLowerCase();
  const inMonth = promotions.filter(
    (p) => p.year === year && (!monthPick || p.month.toLowerCase() === monthPick)
  );
  console.log(`\n=== ${monthArg || "all months"} ${year} — ${inMonth.length} promotions ===`);
  for (const p of inMonth) {
    console.log(`\n• [${p.month} ${p.year}] ${p.sale}`);
    console.log(`  ${p.startDate ?? "?"} ${p.startTime ?? ""} → ${p.endDate ?? "?"} ${p.endTime ?? ""}  (${p.days ?? "?"} days)`);
    console.log(`  promotion: ${p.promotion || "(none)"}  type: ${p.type ?? "-"}`);
    console.log(`  products (${p.products.length}):`);
    p.products.slice(0, 6).forEach((pr) =>
      console.log(`     - ${pr.product}  msrp=${pr.msrp ?? "-"} sale=${pr.salePrice ?? "-"} %off=${pr.pctOff ?? "-"}`)
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
