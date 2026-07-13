#!/usr/bin/env tsx
import fs from "fs";
import path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, "../.env.local") });

import { Redis } from "@upstash/redis";

// One-time (idempotent) migration: push the local file-based planner store into
// Upstash Redis so the deployed app starts with the team's existing rows instead
// of an empty calendar. Run AFTER the Upstash env vars are available locally
// (`vercel env pull .env.local`):
//
//   npm run seed:planner            # push local rows to Redis (refuses to clobber)
//   npm run seed:planner -- --force # overwrite whatever is already in Redis
//
// The Redis key must match lib/storage.ts (namespace "planner") + lib/planner.ts
// (STORE_KEY "campaign-planner.json"); keep them in sync if either changes.
const REDIS_KEY = "planner:campaign-planner.json";
const FILE = path.join(__dirname, "../data/campaign-planner.json");

function rowCount(raw: string): number | string {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.length : "?";
  } catch {
    return "?";
  }
}

async function main() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.error("Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.");
    console.error("Provision Upstash Redis in Vercel, then run `vercel env pull .env.local` and retry.");
    process.exit(1);
  }

  const raw = fs.readFileSync(FILE, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    console.error(`Local store ${FILE} is not a JSON array; aborting.`);
    process.exit(1);
  }

  const redis = Redis.fromEnv({ automaticDeserialization: false });
  const existing = await redis.get<string>(REDIS_KEY);
  const force = process.argv.includes("--force");
  if (existing && !force) {
    console.error(`Redis already holds ${rowCount(existing)} planner rows at "${REDIS_KEY}".`);
    console.error("Re-run with --force to overwrite it with the local file.");
    process.exit(1);
  }

  await redis.set(REDIS_KEY, raw);
  console.log(`Seeded ${parsed.length} planner rows into Redis ("${REDIS_KEY}").`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
