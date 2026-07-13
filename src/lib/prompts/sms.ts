import { RAYCON_VOICE } from "./voice";
import { TARGET_CHARS } from "../sms-format";

// SMS copy generation. Composes the shared Raycon voice with an SMS craft block
// (hard character/encoding rules) and the three construction-distinct variants.
// Non-streaming: three short variants don't need a stream.

export interface SmsBrief {
  name?: string;
  offer: string;
  promo_code?: string;
  deadline?: string;
  angle?: string;
  audience?: string;
}

const SMS_CRAFT = `SMS CRAFT RULES (these are absolute — an SMS is not a short email):
- One message = ONE idea: the offer or hook, the code, the deadline, and a link. Nothing else. Never cram in a second product or a second reason.
- Hard budget: aim for ${TARGET_CHARS} characters or fewer; never exceed 160. Count the characters before you return.
- GSM-7 only: no emoji, no em dashes or en dashes, no curly/smart quotes. Use straight quotes ('), a hyphen (-), and plain ASCII. A single curly quote or emoji silently cuts the budget to 70 characters, so this rule is not optional.
- Open every message with "Raycon:" so the sender is instant.
- Name the deadline plainly ("Ends Sunday", "Today only"). Put the promo code in CAPS. End with exactly one {link} placeholder, as the last thing in the message.
- No "Hurry!!"-style shouting. No all-caps words except the promo code. At most ONE exclamation point across the whole message.
- Offer stated plainly and proudly, per the voice. Numerals and symbols, never words ("30%", not "thirty percent").`;

const SMS_VARIANTS = `THE THREE VARIANTS — construction-distinct, in this exact order. These are three different builds, NOT three rewordings of one line:
1. DIRECT — offer-first and plainest. Lead with the deal itself, then code and deadline. The no-nonsense version.
2. FRIENDLY — the same offer in warm, human phrasing. Sounds like a helpful person texting you, not a banner. Same facts, softer build.
3. ANGLE — leads with the hook, occasion, or reason (the angle), and states the offer second. The offer still lands, but the message opens on the why.
If all three could be swapped without anyone noticing, you have failed the task. Make the openings and shapes genuinely different.`;

export const smsSystemInstruction = `You are writing SMS marketing copy for Raycon.

${RAYCON_VOICE}

${SMS_CRAFT}

${SMS_VARIANTS}`;

/**
 * Build the user prompt. `sourceEmail` (the full normalized email copy, when the
 * user is distilling from a finished email campaign) is distilled, not compressed.
 */
export function buildSmsUserPrompt(
  brief: SmsBrief,
  sourceEmail?: string,
  avoidBlock = ""
): string {
  const briefLines = [
    brief.name ? `Campaign: ${brief.name}` : "",
    `Offer: ${brief.offer}`,
    brief.promo_code ? `Promo code: ${brief.promo_code}` : "",
    brief.deadline ? `Deadline: ${brief.deadline}` : "",
    brief.angle ? `Angle / hook: ${brief.angle}` : "",
    brief.audience ? `Audience note: ${brief.audience}` : "",
  ].filter(Boolean).join("\n");

  const sourceBlock = sourceEmail
    ? `\nSOURCE EMAIL CAMPAIGN — distill this into SMS. Pull ONE offer, ONE hook, and ONE deadline from it; do NOT compress the whole email into a string of fragments. The SMS is a single clean idea drawn from the email, not a summary of it.\n---\n${sourceEmail}\n---\n`
    : "";

  return `Write SMS copy from this brief:
${briefLines}
${sourceBlock}${avoidBlock ? `\n${avoidBlock}\n` : ""}
Return ONLY a single JSON object, nothing else. The very first character you output must be "{". No preamble, no markdown fences, no trailing text.

Shape:
{"variants":["<DIRECT>","<FRIENDLY>","<ANGLE>"]}

The array must have exactly 3 strings, in the order DIRECT, FRIENDLY, ANGLE. Each string is one complete SMS message: opens with "Raycon:", stays under ${TARGET_CHARS} characters (never over 160), is GSM-7 only, contains the promo code in caps if one was given, names the deadline plainly, and ends with a single {link} placeholder. Before returning, count each message's characters and confirm all three are within budget and construction-distinct.`;
}
