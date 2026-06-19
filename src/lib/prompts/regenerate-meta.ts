import type { ExpandedBrief, Conceit } from "../schemas";

export const regenerateMetaRoleInstruction = `Your job is to produce three new subject line variants and three new preview text variants for an email campaign.

RULE ZERO — non-negotiable. The "[Adjective] [Noun]. [Adjective] [Noun]." fragment cadence is the single biggest tell of AI-written copy and is permanently banned in every subject line and preview text. Forbidden examples: "Real dads. Real reviews.", "Real reviews. Real dads.", "Real buyers. Real dads.", "Real sound. Real comfort.", "Big sound. Bigger savings.". A third fragment does not save it. The comma version is the same pattern ("Real dads, real reviews."). When the campaign concept involves real customer reviews, social proof, or the word "real" being in the air, the pull toward this cadence is at its strongest — resist it specifically. Write one normal sentence that names the actual product, person, offer, or occasion.

Other banned AI cadence (same rules as the writer): em dashes anywhere, same-opening-word repetition ("Still X. Still Y."), clever inversions ("It's not X. It's Y."), defensive framings ("This is not a drill."), rhetorical-question openers used as a tired hook ("Looking for X?"), "Say goodbye to X / hello to Y", hollow validation adjectives ("proven", "trusted", "premium", "tested"), hype intensifiers ("game-changer", "next-level", "elevate", "unleash").

THREE DISTINCT IDENTITIES. The three subject lines (and three preview texts) are not three rewordings of one idea — each has its own job. Assign by slot, in order:
1. ADVERTORIAL / DIRECT — clear and scannable, leads with the actual offer, product, or occasion. The reader knows exactly what this is.
2. CREATIVE / EXPERIMENTAL — a real swing: bold, surprising, voicey, a provocation or unexpected question, the kind of line someone screenshots. Still anchored to the actual offer and occasion (creative never means off-brief). e.g. "What? You thought we were done with 30% off?"
3. CURIOSITY / CONVERSATIONAL — sounds like a real person talking; opens a curiosity gap, warm and intriguing, without shouting the discount.

ONE BREATH. Each line is ONE flowing, continuous thought — not two clipped micro-sentences split by a period. The tired shape to avoid: "Pick your summer. 30% off today." / "Summer's on. Three Raycons for it." Instead: "The summer everyone's been waiting for is now 30% off" / "What? You thought we were done with 30% off?". At most ONE of the three subject lines may use a two-part period structure; the other two must be single-breath. Same for the three preview texts.

Before returning: confirm the three are distinct identities (not one idea reworded), confirm at most one is the two-part staccato shape, and confirm each preview text complements (not repeats) its paired subject line.`;

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
- Slot order is fixed: line 1 = advertorial/direct, line 2 = creative/experimental, line 3 = curiosity/conversational. The three must be distinct identities, not three rewordings of the same line.
- Write each in one breath. At most one of the three subject lines (and one of the three preview texts) may use a two-part period structure; the rest are single flowing lines.

Return JSON (slot order matters — index 0 is the advertorial line, index 1 the experimental, index 2 the conversational):

{
  "subject_lines": ["...", "...", "..."],
  "preview_texts": ["...", "...", "..."]
}`;
}
