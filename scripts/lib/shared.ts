import fs from "fs";
import path from "path";
import matter from "gray-matter";
import Anthropic from "@anthropic-ai/sdk";

export const ROOT = path.join(__dirname, "../..");
export const LIBRARY_DIR = path.join(ROOT, "data/library");
export const PRODUCTS_PATH = path.join(ROOT, "data/products.md");

export function getProductSlugs(): string[] {
  const text = fs.existsSync(PRODUCTS_PATH) ? fs.readFileSync(PRODUCTS_PATH, "utf8") : "";
  const matches = text.match(/\*\*Slug:\*\* `([^`]+)`/g) || [];
  return matches.map((m) => m.replace(/\*\*Slug:\*\* `/, "").replace(/`/, ""));
}

export function ensureLibraryDir() {
  if (!fs.existsSync(LIBRARY_DIR)) fs.mkdirSync(LIBRARY_DIR, { recursive: true });
}

export function campaignToFilename(id: string): string {
  return path.join(LIBRARY_DIR, `${id}.md`);
}

export function existingIds(): Set<string> {
  ensureLibraryDir();
  const files = fs.readdirSync(LIBRARY_DIR).filter((f) => f.endsWith(".md"));
  const ids = new Set<string>();
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(LIBRARY_DIR, file), "utf8");
      const { data } = matter(raw);
      if (data.id) ids.add(data.id);
    } catch { /* */ }
  }
  return ids;
}

export function writeCampaign(campaign: {
  id: string; title: string; date: string | null; campaign_type: string;
  offer: string; promo_code: string | null; hero_angle: string; audience: string;
  products_featured: string[]; conceit: string; body: string; source: "doc" | "design";
}): void {
  const fm = {
    id: campaign.id,
    title: campaign.title,
    date: campaign.date,
    campaign_type: campaign.campaign_type,
    offer: campaign.offer,
    promo_code: campaign.promo_code,
    hero_angle: campaign.hero_angle,
    audience: campaign.audience,
    products_featured: campaign.products_featured,
    conceit: campaign.conceit,
    source: campaign.source,
  };
  const content = matter.stringify("\n" + campaign.body, fm);
  fs.writeFileSync(campaignToFilename(campaign.id), content, "utf8");
}

export function makeSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export function makeId(date: string | null, title: string): string {
  const d = date || new Date().toISOString().split("T")[0];
  return `${d}-${makeSlug(title)}`;
}

export function getClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set in env");
  return new Anthropic({ apiKey: key });
}

export const MODEL = "claude-sonnet-4-6";

// Chunk text into ~15k token pieces with 1k overlap (rough char approximation: 1 token ≈ 4 chars)
export function chunkText(text: string, chunkChars = 60000, overlapChars = 4000): string[] {
  if (text.length <= chunkChars) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkChars, text.length);
    chunks.push(text.slice(start, end));
    start = end - overlapChars;
    if (start >= text.length) break;
  }
  return chunks;
}
