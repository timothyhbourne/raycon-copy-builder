#!/usr/bin/env tsx
import fs from "fs";
import path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, "../.env.local") });

import { getClient, MODEL } from "./lib/shared";
import { designSpecSystemPrompt, designSpecUserPrompt } from "../src/lib/prompts/design-spec";

const DESIGNS_DIR = path.join(__dirname, "../data/raw/designs");
const SPECS_DIR = path.join(__dirname, "../data/design-specs");
const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp"];

function mimeType(ext: string): "image/png" | "image/jpeg" | "image/webp" {
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

async function main() {
  const files = fs.readdirSync(DESIGNS_DIR)
    .filter((f) => IMAGE_EXTS.includes(path.extname(f).toLowerCase()));

  if (files.length === 0) {
    console.error("No images found in data/raw/designs/. Add reference email screenshots first.");
    process.exit(1);
  }

  console.log(`Extracting header design spec from ${files.length} reference image(s)...`);
  const client = getClient();

  const imageBlocks = files.map((file) => {
    const filepath = path.join(DESIGNS_DIR, file);
    const ext = path.extname(file).toLowerCase();
    const sizeKb = Math.round(fs.statSync(filepath).size / 1024);
    console.log(`  Loading: ${file} (${sizeKb}KB)`);
    return {
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: mimeType(ext),
        data: fs.readFileSync(filepath).toString("base64"),
      },
    };
  });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: designSpecSystemPrompt(),
    messages: [{
      role: "user",
      content: [
        ...imageBlocks,
        { type: "text", text: designSpecUserPrompt() },
      ],
    }],
  });

  const raw = response.content[0].type === "text" ? response.content[0].text : "";
  const json = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const spec = JSON.parse(json);

  if (!fs.existsSync(SPECS_DIR)) fs.mkdirSync(SPECS_DIR, { recursive: true });
  const outPath = path.join(SPECS_DIR, "header.json");
  fs.writeFileSync(outPath, JSON.stringify({ ...spec, _extracted_from: files }, null, 2), "utf8");

  console.log(`\nSpec written → ${outPath}`);
  console.log(JSON.stringify(spec, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
