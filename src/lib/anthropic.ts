import Anthropic from "@anthropic-ai/sdk";
import { readEnv } from "./env";

export function getAnthropic(): Anthropic {
  // readEnv handles the dev host that sets env vars to "" (falls back to .env.local).
  return new Anthropic({ apiKey: readEnv("ANTHROPIC_API_KEY") });
}

/** Full-quality model — used for final copy generation */
export const MODEL = "claude-sonnet-4-6";
/** Fast model — used for brief expansion and conceits where speed > perfection */
export const FAST_MODEL = "claude-haiku-4-5-20251001";
