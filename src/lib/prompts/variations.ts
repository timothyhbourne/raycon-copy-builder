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
// Each nudge names what the register DOES and what it may never do. The
// "Prohibited" clause is what actually separates one register from the next:
// without a concrete way to fail, five near-identical prompts converge on five
// near-identical drafts.
export const REGISTERS: { label: string; nudge: string }[] = [
  { label: "Direct", nudge: "One clean claim, no wind-up. Short sentences. State what it is and what the deal is. Zero decoration. Reads like a product page headline. Prohibited: rhetorical questions, wordplay, metaphors, curiosity gaps." },
  { label: "Playful", nudge: "Lead with a light, product-tied wink or the one allowed gentle pun. Fun without trying too hard. Prohibited: opening with the discount, hard-sell verbs (\"Grab\", \"Snag\"), any \"don't miss\" construction." },
  { label: "Warm", nudge: "Human and friendly, second-person, meet the reader where they are. A little empathy for the moment they are in. Reads like a helpful person talking, not marketing. Prohibited: exclamation points, urgency language, imperative openers." },
  { label: "Confident", nudge: "Brand-forward and quietly certain. Premium feel. Short declarative sentences carry the weight; the product does the selling. Prohibited: hedges (\"kind of\", \"we think\"), enthusiasm markers (\"so excited\"), any pleading." },
  { label: "Curiosity", nudge: "Open a small honest curiosity gap that makes them want the next line. The subject or opener names the interesting thing without revealing the payoff. Prohibited: shouting the discount in the opener, listing product specs before the hook lands, questions with obvious answers." },
];

/**
 * Per-variation steering for the EMAIL flow. Reuses the existing
 * regenerate-section prompt, whose wrapper reads the whole steering string as
 * one literal top-priority instruction , so the register must be presented as
 * its own mandatory constraint, NOT as a hint trailing the user's feedback.
 * Collapsing these two blocks back together is what made all five registers
 * converge on the same copy.
 */
export function registerSteering(feedback: string, register: { label: string; nudge: string }): string {
  const fb = feedback.trim();
  const substance = fb
    ? `SUBSTANCE (what the user asked for , the angle, benefit, and promise):
${fb}`
    : `SUBSTANCE: no explicit feedback. Produce a genuinely different, stronger angle from the current version.`;

  return `${substance}

STYLE / REGISTER , NON-NEGOTIABLE for THIS specific variation: ${register.label}.
${register.nudge}

How to combine them: SUBSTANCE controls what you say (the angle, the benefit, the promise, the strategy). STYLE controls how you say it (voice, cadence, opener shape, warmth). They are orthogonal , do BOTH, not one at the expense of the other. If the user asked for "more premium" and the register is "Playful", write premium copy in a playful register (a light, confident wink), not one or the other.

This variation is part of a spread of 5. It must read as unmistakably ${register.label} , a reader shown this card next to the other 4 should be able to tell which register produced it from the wording alone. If your draft could plausibly have been produced by any of the other 4 registers, it is failing this instruction; rewrite the opener and cadence until the register is legible.

Keep the same offer, products, and factual claims as the current campaign. Change the wording and register, not the deal.`;
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
