// Pure, unit-testable SMS craft utilities. No fs, no Next — safe to import from
// both client (live counter) and server (post-generation validation).
//
// SMS segmentation depends on encoding. A message that is entirely GSM-7 packs
// 160 characters into one segment; a single non-GSM-7 character (curly quote,
// em dash, emoji) silently forces the whole message to UCS-2 (Unicode), which
// caps a single segment at 70. That cliff is why the live counter warns.

// GSM 03.38 basic character set. Every char here costs one septet.
// Includes the two control chars that ARE representable (LF, CR).
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

// GSM 03.38 extension table. Representable in GSM-7, but each costs TWO septets
// (an escape prefix). Curly quotes and em dashes are NOT here — they are the
// classic "why did my SMS become Unicode?" offenders.
const GSM7_EXTENSION = "\f^{}\\[~]|€";

const BASIC_SET = new Set(GSM7_BASIC);
const EXTENSION_SET = new Set(GSM7_EXTENSION);

/** Leave headroom for Postscript's appended opt-out text on compliance sends. */
export const TARGET_CHARS = 145;

/** True when every character is representable in GSM-7 (basic or extension). */
export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!BASIC_SET.has(ch) && !EXTENSION_SET.has(ch)) return false;
  }
  return true;
}

export interface SmsLength {
  /** Billable unit count: GSM-7 septets, or UTF-16 code units for Unicode. */
  chars: number;
  encoding: "GSM-7" | "Unicode";
  segments: number;
  /** First character that forced Unicode encoding, for the UI hint. */
  offendingChar?: string;
}

/**
 * Measure a message the way a carrier bills it.
 * - GSM-7: 1 segment up to 160 septets, then 153 septets/segment. Extension
 *   chars (€, {, }, etc.) count as 2 septets.
 * - Unicode: 1 segment up to 70 UTF-16 code units, then 67/segment. Emoji are
 *   surrogate pairs, so they count as 2 units.
 */
export function smsLength(text: string): SmsLength {
  if (isGsm7(text)) {
    let septets = 0;
    for (const ch of text) septets += EXTENSION_SET.has(ch) ? 2 : 1;
    const segments = septets === 0 ? 0 : septets <= 160 ? 1 : Math.ceil(septets / 153);
    return { chars: septets, encoding: "GSM-7", segments };
  }
  const units = text.length; // UTF-16 code units (emoji = 2)
  const segments = units === 0 ? 0 : units <= 70 ? 1 : Math.ceil(units / 67);
  return { chars: units, encoding: "Unicode", segments, offendingChar: firstNonGsm7(text) ?? undefined };
}

/** First character not representable in GSM-7, or null if the text is all GSM-7. */
export function firstNonGsm7(text: string): string | null {
  for (const ch of text) {
    if (!BASIC_SET.has(ch) && !EXTENSION_SET.has(ch)) return ch;
  }
  return null;
}
