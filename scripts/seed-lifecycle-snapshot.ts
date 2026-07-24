#!/usr/bin/env tsx
import path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, "../.env.local") });

import { SEED_SNAPSHOT, writeSnapshot, readSnapshot } from "@/lib/lifecycle/snapshot";

// Seed the lifecycle snapshot store (key "snapshot.json") with the bundled seed
// (real sizes from 24 months of Shopify orders), mirroring seed:library. Writes
// through the storage seam — the local file in dev, Upstash Redis in prod when
// its env is present (`vercel env pull .env.local` first). The page already falls
// back to the embedded seed, so this only makes the STORE authoritative; the
// daily sync then overwrites it with worker-computed figures.
//
//   npm run seed:lifecycle            # refuses to clobber a worker snapshot
//   npm run seed:lifecycle -- --force # overwrite whatever is stored

async function main() {
  const force = process.argv.includes("--force");
  const current = await readSnapshot();
  if (!force && current.source === "worker") {
    console.error("[seed:lifecycle] a worker snapshot is already stored — pass --force to overwrite.");
    process.exit(1);
  }
  await writeSnapshot(SEED_SNAPSHOT);
  console.error(`[seed:lifecycle] wrote seed snapshot (${SEED_SNAPSHOT.total_audience.toLocaleString()} audience, ${SEED_SNAPSHOT.cohorts.length} cohorts).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
