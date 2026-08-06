#!/usr/bin/env tsx
// Coverage + verification report for the USP banks. Asserts every SKU in
// PRODUCT_CATEGORIES has a bank of at least MIN_USPS VERIFIED entries, and
// reports missing banks, thin banks, unverified entries, and provenance gaps
// (a block with no Source or Verified line).
//
// Exits 1 when a catalogue product has no bank or falls under the minimum, so
// this can gate a deploy. Unverified entries are reported but never fatal —
// they are a deliberate, honest way to record a claim the live page did not
// confirm, and the loader already keeps them out of prompts.
import { PRODUCT_CATEGORIES } from "../src/lib/products";
import { getAllProductUspBanks, getAllCompanyUsps, getProductUsps, getCompanyUsps } from "../src/lib/usps";
import { SKUS_WITH_USP_BANK } from "../src/lib/usps-coverage";

const MIN_USPS = 8;
const MAX_USPS = 12;

function main(): void {
  const banks = getAllProductUspBanks();
  const bySku = new Map(banks.map((b) => [b.sku, b]));
  const catalogue = PRODUCT_CATEGORIES.flatMap((c) => c.products);

  const missing: string[] = [];
  const thin: string[] = [];
  const oversized: string[] = [];
  const noProvenance: string[] = [];
  const unverified: string[] = [];

  console.log("Product USP banks\n");
  for (const p of catalogue) {
    const bank = bySku.get(p.id);
    if (!bank) {
      missing.push(p.id);
      console.log(`  ✗ ${p.id.padEnd(10)} ${p.name} — NO BANK`);
      continue;
    }
    const verified = getProductUsps(p.id).length;
    const unverifiedCount = bank.usps.length - verified;
    if (verified < MIN_USPS) thin.push(`${p.id} (${verified})`);
    if (verified > MAX_USPS) oversized.push(`${p.id} (${verified})`);
    if (!bank.source || !bank.verified) noProvenance.push(p.id);
    if (unverifiedCount > 0) unverified.push(`${p.id} (${unverifiedCount})`);

    const mark = verified < MIN_USPS ? "✗" : verified > MAX_USPS ? "!" : "✓";
    const flags = [
      unverifiedCount > 0 ? `${unverifiedCount} unverified` : "",
      !bank.source ? "no source" : "",
      !bank.verified ? "no verified date" : "",
    ].filter(Boolean).join(", ");
    console.log(
      `  ${mark} ${p.id.padEnd(10)} ${String(verified).padStart(2)} verified` +
      `  ${(bank.verified || "?").padEnd(10)} ${p.name}${flags ? `  [${flags}]` : ""}`
    );
  }

  // Banks for SKUs that are not in the catalogue (e.g. E26, which has no live
  // product page). Informational — they never reach a section picker.
  const orphans = banks.filter((b) => !catalogue.some((p) => p.id === b.sku));
  if (orphans.length) {
    console.log("\n  Banks outside PRODUCT_CATEGORIES (informational):");
    for (const b of orphans) {
      const v = b.usps.filter((u) => !u.unverified).length;
      console.log(`    · ${b.sku.padEnd(10)} ${v} verified / ${b.usps.length} total — ${b.name}`);
    }
  }

  const companyAll = getAllCompanyUsps();
  const companyVerified = getCompanyUsps();
  const themes = [...new Set(companyVerified.map((u) => u.theme))];
  console.log(`\nCompany USP bank\n  ${companyVerified.length} verified / ${companyAll.length} total across ${themes.length} themes`);
  for (const t of themes) {
    console.log(`    · ${t}: ${companyVerified.filter((u) => u.theme === t).length}`);
  }
  const companyUnverified = companyAll.filter((u) => u.unverified);
  if (companyUnverified.length) {
    console.log("  Excluded from prompts as unverified:");
    for (const u of companyUnverified) console.log(`    · [${u.theme}] ${u.label}`);
  }

  console.log("\nSummary");
  console.log(`  catalogue products: ${catalogue.length}`);
  console.log(`  with a bank:        ${catalogue.length - missing.length}`);
  if (unverified.length) console.log(`  unverified entries: ${unverified.join(", ")}`);
  if (oversized.length) console.log(`  over ${MAX_USPS} USPs:      ${oversized.join(", ")}`);
  if (noProvenance.length) console.log(`  missing provenance: ${noProvenance.join(", ")}`);

  // Drift guard for the client-safe coverage list (src/lib/usps-coverage.ts),
  // which the Section Structure builder reads to warn about a product with no bank.
  const parsedSkus = new Set(banks.map((b) => b.sku));
  const listed = new Set(SKUS_WITH_USP_BANK);
  const notListed = [...parsedSkus].filter((s) => !listed.has(s));
  const staleListed = [...listed].filter((s) => !parsedSkus.has(s));

  const fatal: string[] = [];
  if (missing.length) fatal.push(`no USP bank: ${missing.join(", ")}`);
  if (thin.length) fatal.push(`under ${MIN_USPS} verified USPs: ${thin.join(", ")}`);
  if (!companyVerified.length) fatal.push("company USP bank is empty");
  if (notListed.length) fatal.push(`in product-usps.md but missing from usps-coverage.ts: ${notListed.join(", ")}`);
  if (staleListed.length) fatal.push(`in usps-coverage.ts but missing from product-usps.md: ${staleListed.join(", ")}`);

  if (fatal.length) {
    console.error("\nFAIL");
    for (const f of fatal) console.error(`  · ${f}`);
    process.exit(1);
  }
  console.log("\nPASS — every catalogue product has a verified USP bank.");
}

main();
