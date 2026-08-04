// Shared "give me alternatives" prompts. Both the SMS and email section
// variation flows produce a labeled spread in five distinct registers so the
// user can compare and pick, instead of a single replacement. Everything runs
// through the same voice + hard-rules gate as normal generation.
import { rayconVoice, hardRulesGate } from "./voice";
import { SMS_CRAFT } from "./sms";
import type { SmsBrief } from "../schemas";

/**
 * The five registers offered for every chunk. `nudge` is the stylistic steering
 * appended per variation; the label is shown in the UI. Kept identical across
 * SMS and email so the experience is consistent.
 */
export const REGISTERS: { label: string; nudge: string }[] = [
  { label: "Direct", nudge: "State the offer or benefit plainly and confidently. Straight to the point, no wind-up." },
  { label: "Playful", nudge: "Lead with a light, product-tied wink or the one allowed gentle pun. Warm and fun, never clever for its own sake." },
  { label: "Warm", nudge: "Human and friendly. Meet the reader where they are with a little empathy, like a helpful person talking." },
  { label: "Confident", nudge: "Brand-forward and self-assured. A premium, quietly certain feel. Let the product carry it." },
  { label: "Curiosity", nudge: "Open a small, honest curiosity gap that makes them want the next line, without shouting the discount." },
];

/**
 * Per-variation steering for the EMAIL flow. Reuses the existing
 * regenerate-section prompt, so we only need to compose the user's feedback
 * (substance) with the register (style) into one steering string.
 */
export function registerSteering(feedback: string, register: { label: string; nudge: string }): string {
  const fb = feedback.trim();
  const feedbackLine = fb
    ? `The user's feedback on the current version (this is the substance, honor it first): ${fb}`
    : "The user did not write specific feedback. Simply produce a genuinely different, better option.";
  return `${feedbackLine}

Style/register for THIS specific variation: ${register.label}. ${register.nudge}
Keep the same offer, products, and facts as the current campaign. Change the wording and register, not the deal.`;
}

// --- SMS variations --------------------------------------------------------

export function smsVariationsSystem(): string {
  const registerList = REGISTERS.map((r, i) => `${i + 1}. ${r.label} , ${r.nudge}`).join("\n");
  return `You are rewriting ONE Raycon SMS into a spread of better alternatives.

${rayconVoice()}

${SMS_CRAFT}

YOUR TASK. Produce EXACTLY 5 alternative versions of the SMS the user gives you, one in each register below, in this order. Each is a complete, ready-to-send SMS that keeps the same offer, promo code, deadline, and {link} as the original, but improves the wording per the user's feedback.
${registerList}

The 5 must be genuinely different builds, not one line reworded 5 times. Every one obeys every SMS craft rule and every hard rule.

${hardRulesGate()}`;
}

export function buildSmsVariationsUserPrompt(currentSms: string, brief: SmsBrief, feedback: string): string {
  const briefLines = [
    brief.offer ? `Offer: ${brief.offer}` : "",
    brief.promo_code ? `Promo code: ${brief.promo_code}` : "",
    brief.deadline ? `Deadline: ${brief.deadline}` : "",
    brief.angle ? `Angle / hook: ${brief.angle}` : "",
    brief.audience ? `Audience note: ${brief.audience}` : "",
  ].filter(Boolean).join("\n");

  const fb = feedback.trim();
  const feedbackBlock = fb
    ? `What the user wants changed (honor this first): ${fb}`
    : `The user could not articulate what is off. They just want stronger, more on-brand options. Diagnose what makes the current message flat (usually: a bare SKU list with a deadline stapled on, no hook, no personality) and fix it.`;

  return `Current SMS (rewrite this):
"${currentSms}"

Brief:
${briefLines}

${feedbackBlock}

Return ONLY a JSON object, nothing else, first character "{":
{"variations":[{"label":"Direct","text":"..."},{"label":"Playful","text":"..."},{"label":"Warm","text":"..."},{"label":"Confident","text":"..."},{"label":"Curiosity","text":"..."}]}

Exactly 5 items, labels in the order above. Each text opens with "Raycon:", stays under 160 characters, is GSM-7 only (no em dashes, curly quotes, or emoji), includes the promo code in caps if one exists, names the deadline plainly, and ends with a single {link}. Count characters before returning.`;
}
