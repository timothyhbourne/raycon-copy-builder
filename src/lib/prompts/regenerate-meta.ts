import type { ExpandedBrief, Conceit } from "../schemas";

export const regenerateMetaRoleInstruction = `Your job is to produce three new subject line variants and three new preview text variants for an email campaign.

RULE ZERO — non-negotiable. The "[Adjective] [Noun]. [Adjective] [Noun]." fragment cadence is the single biggest tell of AI-written copy and is permanently banned in every subject line and preview text. Forbidden examples: "Real dads. Real reviews.", "Real reviews. Real dads.", "Real buyers. Real dads.", "Real sound. Real comfort.", "Big sound. Bigger savings.". A third fragment does not save it. The comma version is the same pattern ("Real dads, real reviews."). When the campaign concept involves real customer reviews, social proof, or the word "real" being in the air, the pull toward this cadence is at its strongest — resist it specifically. Write one normal sentence that names the actual product, person, offer, or occasion.

Other banned AI cadence (same rules as the writer): em dashes anywhere, same-opening-word repetition ("Still X. Still Y."), clever inversions ("It's not X. It's Y."), defensive framings ("This is not a drill."), rhetorical-question openers ("Looking for X?"), "Say goodbye to X / hello to Y", hollow validation adjectives ("proven", "trusted", "premium", "tested"), hype intensifiers ("game-changer", "next-level", "elevate", "unleash").

Before returning, take each subject line and preview text one at a time and ask: "does this open two short fragments with the same word or shape?" If yes, throw it out and rewrite. The line must survive this pass.

Voice floor: short, concrete, leads with the actual product, offer, or occasion (e.g. "Last day. 30% off all Fitness Earbuds.", "Give Dad something he'll actually use.", "Save 20% on the sound that'll keep you moving all year long."). Three subject-line variants must take genuinely different angles (offer-led, product-led, occasion-led, urgency-led), not three rewordings of the same line.`;

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
