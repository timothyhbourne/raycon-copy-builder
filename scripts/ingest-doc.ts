#!/usr/bin/env tsx
import fs from "fs";
import path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, "../.env.local") });

import { getClient, MODEL, chunkText, getProductSlugs, existingIds, writeCampaign, makeId } from "./lib/shared";
import { ingestDocSystemPrompt, ingestDocUserPrompt } from "../src/lib/prompts/ingest-doc";

const RAW_DOC = path.join(__dirname, "../data/raw/copywriting-master.md");

async function main() {
  if (!fs.existsSync(RAW_DOC)) {
    console.error(`Error: ${RAW_DOC} not found. Paste your master Google Doc dump there first.`);
    process.exit(1);
  }

  const text = fs.readFileSync(RAW_DOC, "utf8");
  const productSlugs = getProductSlugs();
  const existing = existingIds();
  const chunks = chunkText(text);
  const client = getClient();

  console.log(`Processing ${chunks.length} chunk(s) from master doc...`);

  let totalParsed = 0;
  let totalWritten = 0;
  let totalSkipped = 0;
  let needConceit = 0;

  const systemPrompt = ingestDocSystemPrompt();

  for (let i = 0; i < chunks.length; i++) {
    console.log(`  Chunk ${i + 1}/${chunks.length}...`);
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: "user", content: ingestDocUserPrompt(chunks[i], productSlugs.join(", ")) }],
      });

      const raw = response.content[0].type === "text" ? response.content[0].text : "";
      const json = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(json);
      const campaigns = parsed.campaigns || [];
      totalParsed += campaigns.length;

      for (const c of campaigns) {
        const id = makeId(c.date, c.title);
        if (existing.has(id)) {
          totalSkipped++;
          continue;
        }
        writeCampaign({
          id,
          title: c.title,
          date: c.date,
          campaign_type: c.campaign_type || "promo",
          offer: c.offer || "",
          promo_code: c.promo_code || null,
          hero_angle: c.hero_angle || "",
          audience: c.audience || "all",
          products_featured: c.products_featured || [],
          conceit: "[FILL ME IN]",
          body: c.body || "",
          source: "doc",
        });
        existing.add(id);
        totalWritten++;
        needConceit++;
        console.log(`    Wrote: ${id}`);
      }
    } catch (e) {
      console.error(`  Error processing chunk ${i + 1}:`, e);
    }
  }

  console.log(`\nDone. Parsed ${totalParsed} campaigns, wrote ${totalWritten} new files, skipped ${totalSkipped} duplicates, ${needConceit} campaigns need conceit fill-in.`);
}

main().catch(console.error);
