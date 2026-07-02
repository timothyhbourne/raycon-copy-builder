import type { ExpandedBrief, LibraryCampaign } from "../schemas";

export const conceitsRoleInstruction = `Your job is to propose three genuinely distinct conceits for a Raycon email campaign.

A conceit is the single idea that runs through the whole email — the reason someone opens it, reads it, and clicks. It is not a tagline. It is the editorial spine of the campaign, and it is where a campaign earns its distinctiveness. A flat conceit guarantees a flat email; a sharp one gives the writer something real to build on.

Rules:
- Name: short (about 2 to 5 words) and memorable. It can have personality, wit, or a point of view — it does NOT have to be plain or merely functional. Avoid cliché, but do not flatten it into a generic label either.
- Description: 1 to 2 sentences. State the idea with enough specificity that a writer knows exactly how it would shape the headline, the body, and the CTA. Name the actual insight, not a category.
- The three must come from genuinely DIFFERENT angle families. Do not return three takes on the same idea, and do not default to the same families every campaign. Draw from a wide palette and pick the three that best fit THIS brief:
  - the deadline / the closing window (honest urgency, not false permanence)
  - the value of the deal (what the discount actually unlocks)
  - identity / who this is for (the kind of person, the moment in their life)
  - ritual or occasion (the season, the event, the cultural moment)
  - a product truth (a specific feature or experience reframed as the hook)
  - contrast or tension (before/after, expectation vs reality, the unexpected pick)
  - social proof / momentum (what everyone's been grabbing, the fan favorite)
  - point of view / voice (a confident stance, an insider wink, a human observation)
- Anti-repetition: the reference conceits shown are recent or similar past campaigns. Treat them as territory ALREADY COVERED — your three must not reuse their angle, their framing, or their wording. If a reference leaned on urgency, find a fresher way in.
- Stay anchored to the brief: every conceit must be true to the actual offer, occasion, and products. Distinctive does not mean off-brief or invented.`;

export function conceitsUserPrompt(expandedBrief: ExpandedBrief, examples: LibraryCampaign[]): string {
  const exampleBlocks = examples.slice(0, 5).map(
    (e) => `- ${e.title} (${e.campaign_type}): "${e.conceit}"`
  ).join("\n");

  return `Expanded brief:
${JSON.stringify(expandedBrief, null, 2)}

Recent / similar past campaign conceits — this is territory ALREADY COVERED. Do not reuse their angle, framing, or wording; deliberately go somewhere they did not:
${exampleBlocks}

Propose three distinct conceits, each from a different angle family (see the palette). Each: a short memorable name (2–5 words, personality allowed), a 1–2 sentence description that names the actual insight and how it shapes the copy. Make them specific to THIS brief and clearly different from the past campaigns above.

Return JSON:

{
  "conceits": [
    { "id": "1", "name": "...", "description": "..." },
    { "id": "2", "name": "...", "description": "..." },
    { "id": "3", "name": "...", "description": "..." }
  ]
}

Return only valid JSON, no preamble.`;
}
