import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

function getApiKey(): string {
  // System env (e.g. Claude desktop) may set this to "" — fall back to .env.local
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const envFile = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    const match = envFile.match(/^ANTHROPIC_API_KEY=(.+)$/m);
    if (match) return match[1].trim();
  } catch { /* */ }
  return "";
}

export function getAnthropic(): Anthropic {
  return new Anthropic({ apiKey: getApiKey() });
}

/** Full-quality model — used for final copy generation */
export const MODEL = "claude-sonnet-4-6";
/** Fast model — used for brief expansion and conceits where speed > perfection */
export const FAST_MODEL = "claude-haiku-4-5";
