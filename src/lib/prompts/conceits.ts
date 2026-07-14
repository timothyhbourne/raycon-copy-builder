import type { ExpandedBrief, LibraryCampaign } from "../schemas";

export const conceitsRoleInstruction = `Your job is to propose three genuinely distinct conceits for a Raycon email campaign.

A conceit is the campaign's angle: a simple retail reason to open and buy — an occasion, a product truth, a customer moment, or a deal framing — described in plain language. It shapes the headline and body. It is NOT a literary theme, a metaphor, or a clever title to develop. "Last-call urgency: the sale ends tonight, lead with the deadline" is a good conceit. "Caught Between Two Worlds" is not — Raycon never poses riddles or spins themes.

Register: warm, plain-spoken retail advertorial — a friendly salesperson the reader likes, not an ad-school copywriter. Every conceit has to be sellable in that voice; if it can't be said plainly and cheerfully, it's wrong for Raycon.

Rules:
- Name: short (about 2 to 5 words), plain and clear. Light personality is welcome; literary cleverness, paradox, and abstraction are not.
- Description: 1 to 2 sentences. Name the actual angle and how it shapes the headline, body, and CTA — concretely, in retail terms, not as a category label.
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
- Stay anchored to the brief: every conceit must be true to the actual offer, occasion, and products. Distinctive does not mean off-brief or invented.
- Three DIFFERENT architectures, one each — they must differ in CONSTRUCTION, not just angle. Assign one conceit to each:
  - "offer_led": the deal/mechanics are the hook (the discount, the code, the deadline).
  - "story_led": a moment, occasion, or narrative is the hook (the offer is secondary).
  - "product_truth_led": one concrete product fact or benefit is the hook.
  Return the assigned architecture on each conceit.`;

export function conceitsUserPrompt(
  expandedBrief: ExpandedBrief,
  examples: LibraryCampaign[],
  pastConceits: { name: string; date: string; campaign_type: string }[] = [],
  avoidBlock = ""
): string {
  const conceitLines = (pastConceits.length
    ? pastConceits.map((c) => `- ${c.date} (${c.campaign_type}): "${c.name}"`)
    : examples.slice(0, 5).map((e) => `- ${e.title} (${e.campaign_type}): "${e.conceit}"`)
  ).join("\n");

  return `Expanded brief:
${JSON.stringify(expandedBrief, null, 2)}
${avoidBlock ? `\n${avoidBlock}\n` : ""}
Recent / similar past campaign conceits — this is territory ALREADY COVERED. Do not reuse their angle, framing, or wording; deliberately go somewhere they did not:
${conceitLines}

Propose three distinct conceits, each from a different angle family (see the palette) AND a different architecture — one offer_led, one story_led, one product_truth_led. Each: a short memorable name (2–5 words, personality allowed), a 1–2 sentence description that names the actual insight and how it shapes the copy. Make them specific to THIS brief and clearly different from the past campaigns above.

Return JSON (architecture is one of "offer_led" | "story_led" | "product_truth_led"; the three must be all different):

{
  "conceits": [
    { "id": "1", "name": "...", "description": "...", "architecture": "offer_led" },
    { "id": "2", "name": "...", "description": "...", "architecture": "story_led" },
    { "id": "3", "name": "...", "description": "...", "architecture": "product_truth_led" }
  ]
}

Return only valid JSON, no preamble.`;
}
