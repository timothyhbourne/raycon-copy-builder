import type { ExpandedBrief, Conceit } from "../schemas";

export const regenerateMetaRoleInstruction = `Your job is to produce three new subject line variants and three new preview text variants for an email campaign.`;

export function regenerateMetaUserPrompt(
  expandedBrief: ExpandedBrief,
  chosenConceit: Conceit,
  currentCampaignSummary: string
): string {
  return `Expanded brief:
${JSON.stringify(expandedBrief, null, 2)}

Chosen conceit:
Name: ${chosenConceit.name}
Description: ${chosenConceit.description}

Summary of the campaign body that just got generated:
${currentCampaignSummary}

Constraints:
- Subject lines under 50 characters.
- Preview text under 90 characters.
- Each variant should take a meaningfully different angle on the conceit. Not three rewordings of the same line.

Return JSON:

{
  "subject_lines": ["...", "...", "..."],
  "preview_texts": ["...", "...", "..."]
}`;
}
