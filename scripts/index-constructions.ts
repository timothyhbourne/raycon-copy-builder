#!/usr/bin/env tsx
// Rebuild the construction index from scratch from data/library/. Idempotent —
// overwrites data/constructions-index.json with a fresh full extraction.
import { getLibraryCampaigns } from "../src/lib/library";
import { extractConstructions, type ConstructionsIndex } from "../src/lib/constructions";
import fs from "fs";
import path from "path";

const INDEX_PATH = path.join(process.cwd(), "data", "constructions-index.json");

function main() {
  const campaigns = getLibraryCampaigns();
  const index: ConstructionsIndex = { version: 1, campaigns: {} };
  let extracted = 0;
  let skipped = 0;

  for (const c of campaigns) {
    const constructions = extractConstructions(c);
    if (constructions) {
      index.campaigns[c.id] = constructions;
      extracted++;
    } else {
      skipped++;
      console.warn(`  skipped (no extractable constructions): ${c.id}`);
    }
  }

  const dir = path.dirname(INDEX_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), "utf8");

  console.log(`Construction index rebuilt: ${extracted} campaign(s) indexed, ${skipped} skipped.`);
  console.log(`Written to ${path.relative(process.cwd(), INDEX_PATH)}`);
}

main();
