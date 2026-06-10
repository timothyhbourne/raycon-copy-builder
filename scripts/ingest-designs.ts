#!/usr/bin/env tsx
import fs from "fs";
import path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, "../.env.local") });

import { getClient, MODEL, getProductSlugs, existingIds, writeCampaign, makeId, LIBRARY_DIR } from "./lib/shared";
import { ingestDesignsSystemPrompt, ingestDesignsUserPrompt } from "../src/lib/prompts/ingest-designs";
import matter from "gray-matter";

const DESIGNS_DIR = path.join(__dirname, "../data/raw/designs");
const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp"];

function imageToBase64(filepath: string): string {
  return fs.readFileSync(filepath).toString("base64");
}

function mimeType(ext: string): "image/png" | "image/jpeg" | "image/webp" {
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function fuzzyTitleMatch(newTitle: string, existingTitles: string[]): boolean {
  const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const newNorm = normalise(newTitle);
  return existingTitles.some((t) => {
    const tNorm = normalise(t);
    const longer = newNorm.length > tNorm.length ? newNorm : tNorm;
    const shorter = newNorm.length <= tNorm.length ? newNorm : tNorm;
    return longer.includes(shorter) || (shorter.length > 8 && levenshtein(newNorm, tNorm) < 5);
  });
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  }
  return dp[m][n];
}

function getExistingTitles(): string[] {
  if (!fs.existsSync(LIBRARY_DIR)) return [];
  return fs.readdirSync(LIBRARY_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      try {
        const raw = fs.readFileSync(path.join(LIBRARY_DIR, f), "utf8");
        const { data } = matter(raw);
        return data.title || "";
      } catch { return ""; }
    })
    .filter(Boolean);
}

async function main() {
  if (!fs.existsSync(DESIGNS_DIR)) {
    console.error(`Error: ${DESIGNS_DIR} not found. Place design images there first.`);
    process.exit(1);
  }

  const files = fs.readdirSync(DESIGNS_DIR).filter((f) => IMAGE_EXTS.includes(path.extname(f).toLowerCase()));
  if (files.length === 0) {
    console.log("No image files found in data/raw/designs/");
    return;
  }

  const productSlugs = getProductSlugs();
  const existing = existingIds();
  const existingTitles = getExistingTitles();
  const client = getClient();
  const systemPrompt = ingestDesignsSystemPrompt();

  console.log(`Processing ${files.length} image(s)...`);
  let written = 0;
  let skipped = 0;

  for (const file of files) {
    const filepath = path.join(DESIGNS_DIR, file);
    const ext = path.extname(file).toLowerCase();
    console.log(`  ${file}...`);

    try {
      const base64 = imageToBase64(filepath);
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mimeType(ext), data: base64 },
            },
            { type: "text", text: ingestDesignsUserPrompt(productSlugs.join(", ")) },
          ],
        }],
      });

      const raw = response.content[0].type === "text" ? response.content[0].text : "";
      const json = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const c = JSON.parse(json);

      if (fuzzyTitleMatch(c.title, existingTitles)) {
        console.log(`    Skipped (near-duplicate title): ${c.title}`);
        skipped++;
        continue;
      }

      // Prefer date from filename (format: YYYY-MM-DD at start)
      const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/);
      const date = dateMatch ? dateMatch[1] : c.date;

      const id = makeId(date, c.title) + "-design";
      if (existing.has(id)) {
        console.log(`    Skipped (duplicate id): ${id}`);
        skipped++;
        continue;
      }

      writeCampaign({
        id,
        title: c.title,
        date,
        campaign_type: c.campaign_type || "promo",
        offer: c.offer || "",
        promo_code: c.promo_code || null,
        hero_angle: c.hero_angle || "",
        audience: c.audience || "all",
        products_featured: c.products_featured || [],
        conceit: "[FILL ME IN]",
        body: c.body || "",
        source: "design",
      });
      existing.add(id);
      existingTitles.push(c.title);
      written++;
      console.log(`    Wrote: ${id}`);
    } catch (e) {
      console.error(`    Error processing ${file}:`, e);
    }
  }

  console.log(`\nDone. Processed ${files.length} images, wrote ${written} files, skipped ${skipped}.`);
}

main().catch(console.error);
