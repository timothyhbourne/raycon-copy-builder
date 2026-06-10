import fs from "fs";
import path from "path";
import type Anthropic from "@anthropic-ai/sdk";

const DATA_DIR = path.join(process.cwd(), "data");

function readFile(filename: string): string {
  const p = path.join(DATA_DIR, filename);
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p, "utf8");
}

export function getBrandVoice(): string { return readFile("brand-voice.md"); }
export function getHardRules(): string { return readFile("hard-rules.md"); }
export function getProducts(): string { return readFile("products.md"); }
export function getRawLibrary(): string { return readFile("raw/raycon_email_copywriting_library.md"); }

export function getBrandContext() {
  return {
    brandVoice: getBrandVoice(),
    hardRules: getHardRules(),
    products: getProducts(),
    rawLibrary: getRawLibrary(),
  };
}

/**
 * Returns the system prompt as an array of content blocks.
 * The brand context block (large, static) is marked for caching.
 * The role-specific instruction (small, varies per call) is a separate block.
 *
 * Anthropic caches the prefix up to and including the last cache_control block,
 * so we put cache_control on the brand context and append the role instruction after.
 *
 * The rawLibrary is included in the cached block — it is static reference material
 * and the single largest source of voice signal for imitation.
 */
export function buildSystemBlocks(
  ctx: { brandVoice: string; hardRules: string; products: string; rawLibrary: string },
  roleInstruction: string
): Anthropic.Messages.TextBlockParam[] {
  const rawLibrarySection = ctx.rawLibrary
    ? `\n\nApproved email copywriting reference library (complete archive — use as primary voice reference):\n<<<\n${ctx.rawLibrary}\n>>>`
    : "";

  const brandContextText = `You are a senior email copywriter for Raycon, a direct-to-consumer audio brand (earbuds, headphones, bone conduction). You write email campaigns that sound like Raycon: direct, confident, specific, occasionally playful. You have studied every approved Raycon campaign and you write inside the existing voice rather than introducing a new one.

Brand voice document:
<<<
${ctx.brandVoice}
>>>

Hard rules (never violate):
<<<
${ctx.hardRules}
>>>

Product catalogue:
<<<
${ctx.products}
>>>${rawLibrarySection}`;

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
