#!/usr/bin/env tsx
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import * as dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, "../.env.local") });

import { Redis } from "@upstash/redis";
import { redisCreds } from "@/lib/storage";
import type { LibraryCampaign } from "@/lib/schemas";

// One-time (idempotent) migration: parse the legacy per-file markdown library in
// data/library/*.md into the single JSON array that lib/library.ts now reads via
// the storage seam, and push it into Upstash Redis so the deployed app starts
// with the team's existing copy instead of an empty library. Run AFTER the
// Upstash env vars are available locally (`vercel env pull .env.local`):
//
//   npm run seed:library            # push local entries to Redis (refuses to clobber)
//   npm run seed:library -- --force # overwrite whatever is already in Redis
//
// The Redis key must match lib/storage.ts (namespace "library") + lib/library.ts
// (STORE_KEY "library.json"); keep them in sync if either changes.
const REDIS_KEY = "library:library.json";
const LIBRARY_DIR = path.join(__dirname, "../data/library");

// Parse one markdown file into a LibraryCampaign, mirroring the pre-migration
// getLibraryCampaigns() read logic exactly (frontmatter + body + structured).
function parseFile(file: string): LibraryCampaign | null {
  try {
    const raw = fs.readFileSync(path.join(LIBRARY_DIR, file), "utf8");
    const { data, content } = matter(raw);
    let structured: LibraryCampaign["structured"];
    if (typeof data.structured === "string" && data.structured.trim()) {
      try { structured = JSON.parse(data.structured); } catch { /* ignore malformed */ }
    }
    return {
      id: data.id ?? file.replace(".md", ""),
      title: data.title ?? "",
      date: data.date instanceof Date ? data.date.toISOString().split("T")[0] : (data.date ? String(data.date) : ""),
      campaign_type: data.campaign_type ?? "promo",
      offer: data.offer ?? "",
      promo_code: data.promo_code ?? undefined,
      hero_angle: data.hero_angle ?? "",
      audience: data.audience ?? "all",
      products_featured: data.products_featured ?? [],
      conceit: data.conceit ?? "",
      source: data.source ?? "doc",
      body: content.trim(),
      planner_row_id: data.planner_row_id ?? undefined,
      structured,
    };
  } catch {
    return null;
  }
}

async function main() {
  const creds = redisCreds();
  if (!creds) {
    console.error("Missing Redis creds (UPSTASH_REDIS_REST_URL/_TOKEN or KV_REST_API_URL/_TOKEN).");
    console.error("Add them to .env.local from the Vercel Redis store, then retry.");
    process.exit(1);
  }

  if (!fs.existsSync(LIBRARY_DIR)) {
    console.error(`No library dir at ${LIBRARY_DIR}; nothing to seed.`);
    process.exit(1);
  }

  const files = fs.readdirSync(LIBRARY_DIR).filter((f) => f.endsWith(".md"));
  const entries = files
    .map(parseFile)
    .filter((e): e is LibraryCampaign => e !== null)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (!entries.length) {
    console.error("Parsed 0 library entries; aborting.");
    process.exit(1);
  }

  const redis = new Redis({ ...creds, automaticDeserialization: false });
  const existing = await redis.get<string>(REDIS_KEY);
  const force = process.argv.includes("--force");
  if (existing && !force) {
    let n: number | string = "?";
    try { const v = JSON.parse(existing); n = Array.isArray(v) ? v.length : "?"; } catch { /* keep ? */ }
    console.error(`Redis already holds ${n} library entries at "${REDIS_KEY}".`);
    console.error("Re-run with --force to overwrite it with the local files.");
    process.exit(1);
  }

  await redis.set(REDIS_KEY, JSON.stringify(entries, null, 2));
  console.log(`Seeded ${entries.length} library entries into Redis ("${REDIS_KEY}").`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
