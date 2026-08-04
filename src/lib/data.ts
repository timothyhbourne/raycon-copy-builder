import fs from "fs";
import path from "path";
import type Anthropic from "@anthropic-ai/sdk";

const DATA_DIR = path.join(process.cwd(), "data");

// Read-only loader for static content that ships in the deploy bundle
// (brand-voice.md, products.md, copy-system.md, raw/...). Never written at
// runtime, so reading it via fs on Vercel is correct — intentionally exempt
// from the storage seam (see storage.ts / remediation §3.3).
function readFile(filename: string): string {
  const p = path.join(DATA_DIR, filename);
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p, "utf8");
}

export function getReferenceDesk(): string { return readFile("brand-voice.md"); }
export function getProducts(): string { return readFile("products.md"); }
export function getRawLibrary(): string { return readFile("raw/raycon_email_copywriting_library.md"); }

// --- copy-system.md: the single source of truth for voice + rules ----------

export function getCopySystem(): string { return readFile("copy-system.md"); }

/**
 * Extract one marked section from copy-system.md. Sections are delimited by
 * `<!-- SECTION:NAME -->` ... `<!-- /SECTION:NAME -->`. Returns "" if missing.
 */
export function getCopySystemSection(name: "PRIORITY" | "VOICE" | "RULES" | "SELFCHECK"): string {
  const doc = getCopySystem();
  const re = new RegExp(`<!--\\s*SECTION:${name}\\s*-->([\\s\\S]*?)<!--\\s*/SECTION:${name}\\s*-->`);
  const m = doc.match(re);
  return m ? m[1].trim() : "";
}

export function getBrandContext() {
  return {
    priority: getCopySystemSection("PRIORITY"),
    referenceDesk: getReferenceDesk(),
    products: getProducts(),
  };
}

/**
 * Returns the system prompt as an array of content blocks.
 *
 * Layering (see data/copy-system.md for the priority order this implements):
 *   1. Priority order — framed up top so every downstream instruction is read
 *      through it.
 *   2. Reference desk (brand-voice.md) — menus and examples only, no rules.
 *   3. Product catalogue.
 *   4. Role instruction (separate block) — carries the voice; the hard-rules
 *      gate is injected LAST in the per-call user prompt for recency.
 *
 * The full campaign archive is intentionally NOT loaded here. The most relevant
 * past campaigns for each brief are retrieved and injected into the user prompt
 * instead (see the client's scored retrieval), so this static block stays small
 * and fully cacheable. The large block is marked for caching; the role
 * instruction varies per call and is appended after the cache boundary.
 */
export function buildSystemBlocks(
  ctx: { priority: string; referenceDesk: string; products: string },
  roleInstruction: string
): Anthropic.Messages.TextBlockParam[] {
  const brandContextText = `You are a senior email copywriter for Raycon, a direct-to-consumer audio brand (earbuds, headphones, bone conduction). You write campaigns that sound unmistakably like Raycon: direct, confident, specific, occasionally playful. You write inside the existing voice rather than introducing a new one.

PRIORITY ORDER (read everything below through this):
<<<
${ctx.priority}
>>>

Reference desk (menus and examples, NOT rules. The rules live in the hard-rules gate at the end of your instructions):
<<<
${ctx.referenceDesk}
>>>

Product catalogue:
<<<
${ctx.products}
>>>

The most relevant past campaigns for this specific brief are provided as reference examples in the user message. Use those for register and rhythm only; they are the lowest authority and never override the hard rules.`;

  return [
    {
      type: "text" as const,
      text: brandContextText,
      cache_control: { type: "ephemeral" as const },
    },
    {
      type: "text" as const,
      text: roleInstruction,
    },
  ];
}
