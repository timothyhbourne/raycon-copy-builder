import type { ExpandedBrief, Conceit } from "../schemas";
import { RAYCON_VOICE } from "./voice";
import { formatRecentlySent } from "./generate";
import type { RecentConstruction } from "../library";

export const regenerateMetaRoleInstruction = `Your job is to produce three new subject line variants and three new preview text variants for an email campaign.

${RAYCON_VOICE}

THREE DISTINCT IDENTITIES. The three subject lines (and three preview texts) are not three rewordings of one idea — each has its own job. Assign by slot, in order:
1. DIRECT — the offer or product, stated plainly ("Fitness Earbuds: 30% off ends tonight.").
2. FRIENDLY / PLAYFUL — warm and human; the one light pun may live here if it comes easily.
3. CONVERSATIONAL / CURIOSITY — sounds like a real person talking; opens a small curiosity gap, warm and intriguing, without shouting the discount.

The three must be distinct in rhythm and opening word, not one idea reworded. Each preview text complements (never repeats) its paired subject line — it adds the code, the deadline, the second product, or the human reason. Every line stays within the caps and clean of every hard ban in the voice rules above.`;

export function regenerateMetaUserPrompt(
  expandedBrief: ExpandedBrief,
  chosenConceit: Conceit,
  currentCampaignSummary: string,
  recent: RecentConstruction[] = []
): string {
  const recentlySent = formatRecentlySent(recent);
  return `Expanded brief:
${JSON.stringify(expandedBrief, null, 2)}

Chosen conceit:
Name: ${chosenConceit.name}
Description: ${chosenConceit.description}
${recentlySent ? `\n${recentlySent}\n` : ""}
Summary of the campaign body that just got generated:
${currentCampaignSummary}

Constraints:
- Subject lines under 50 characters.
- Preview text under 90 characters.
- Slot order is fixed: line 1 = direct, line 2 = friendly/playful, line 3 = conversational/curiosity. The three must be distinct identities, not three rewordings of the same line.
- Distinct in rhythm and opening word. Each preview text complements its paired subject line, never repeats it.

Return JSON (slot order matters — index 0 is the direct line, index 1 the friendly/playful, index 2 the conversational):

{
  "subject_lines": ["...", "...", "..."],
  "preview_texts": ["...", "...", "..."]
}`;
}
