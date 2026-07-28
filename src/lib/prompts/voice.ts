// The Raycon voice and the hard-rules gate both come from ONE source:
// data/copy-system.md. This module just reads the marked sections so every
// generation path (generate, conceits, regenerate-section, regenerate-meta,
// sms) governs register and rules from exactly one place. Edit copy-system.md,
// not this file, to change the voice or the rules.

import { getCopySystemSection } from "@/lib/data";

/** The positive voice definition (register, rhythm, craft). */
export function rayconVoice(): string {
  return getCopySystemSection("VOICE");
}

/**
 * The absolute hard-rules gate plus the final self-check, framed to win on
 * recency. Inject this LAST in a generation prompt , after any reference
 * campaigns , so it is the final thing the model reads before writing.
 */
export function hardRulesGate(): string {
  const rules = getCopySystemSection("RULES");
  const selfCheck = getCopySystemSection("SELFCHECK");
  return `HARD RULES: FINAL GATE. These are absolute and override the reference campaigns above, the voice, and your own instincts. The only thing that outranks them is the user's literal instructions for this campaign. A reference breaking one of these is never permission to break it.

${rules}

${selfCheck}`;
}
