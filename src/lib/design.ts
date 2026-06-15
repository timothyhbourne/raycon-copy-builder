import fs from "fs";
import path from "path";

const SPECS_DIR = path.join(process.cwd(), "data/design-specs");
const ASSETS_DIR = path.join(process.cwd(), "data/design-assets");
const PRODUCTS_DIR = path.join(ASSETS_DIR, "Products");

export function getDesignSpec(sectionType: string): Record<string, unknown> | null {
  // Sanitise: only allow alphanumeric + underscores/hyphens (matches SectionType values)
  const safeName = sectionType.replace(/[^a-zA-Z0-9_-]/g, "");
  const p = path.join(SPECS_DIR, `${safeName}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function getRayconLogoSvg(): string {
  const p = path.join(ASSETS_DIR, "raycon_icon.svg");
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p, "utf8");
}

export interface ImageAsset {
  base64: string;
  mime: "image/png" | "image/jpeg" | "image/webp";
}

const PRODUCT_KEYWORDS: { keywords: string[]; file: string }[] = [
  { keywords: ["sleep"], file: "sleep-earbuds.png" },
  { keywords: ["fitness", "workout", "open earbuds", "fitness open", "open ear"], file: "fitness-earbuds.png" },
  { keywords: ["notetaker", "note taker", "clip"], file: "notetaker.png" },
  // "everyday" / "classic" is the catch-all default — keep it last
  { keywords: ["classic", "everyday", "earbuds"], file: "everyday-earbuds.png" },
];

export function resolveProductImage(
  heroImageDirection: string,
  headline: string,
  tagline: string
): ImageAsset | null {
  if (!fs.existsSync(PRODUCTS_DIR)) return null;

  const text = `${heroImageDirection} ${headline} ${tagline}`.toLowerCase();

  let chosen = "everyday-earbuds.png";
  for (const { keywords, file } of PRODUCT_KEYWORDS) {
    if (keywords.some((k) => text.includes(k))) {
      chosen = file;
      break;
    }
  }

  const filepath = path.join(PRODUCTS_DIR, chosen);
  if (!fs.existsSync(filepath)) {
    // Fall back to any PNG in the products dir
    const any = fs.readdirSync(PRODUCTS_DIR).find((f) => f.endsWith(".png"));
    if (!any) return null;
    return { base64: fs.readFileSync(path.join(PRODUCTS_DIR, any)).toString("base64"), mime: "image/png" };
  }
  return { base64: fs.readFileSync(filepath).toString("base64"), mime: "image/png" };
}
