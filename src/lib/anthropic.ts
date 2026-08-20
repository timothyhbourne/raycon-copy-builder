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

/**
 * Temperature for the COPY-WRITING calls (campaign generation, section/element
 * rewrites, variations, SMS, flow emails). Named and passed explicitly at every
 * one of those call sites so the sampling temperature is a decision we can see
 * and tune per element, not the API default arriving by accident. 1 is the value
 * those routes were already running at, so naming it changed no output.
 */
export const CREATIVE_TEMPERATURE = 1;
