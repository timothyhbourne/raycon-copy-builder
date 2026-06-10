import type { ExpandedBrief, LibraryCampaign } from "../schemas";

export const conceitsRoleInstruction = `Your job is to propose three distinct conceits for a Raycon email campaign.

A conceit is the single angle that runs through the whole email — the reason someone opens it, reads it, and clicks. It is not a tagline. It is a one-line editorial direction.

Rules:
- Name: 2 to 4 words. Direct and functional. Not clever or literary.
- Description: exactly 1 sentence. State the angle plainly. No story, no metaphor, no paragraph.
- Each of the three must be genuinely different angles — not three variations of the same idea.
- Typical angles for a flash sale: urgency (the deadline), the deal itself (size/value of the offer), scarcity (stock or availability). Use the brief to pick the three most relevant angles for this specific campaign.
- Do not invent angles that are not supported by the brief.`;

export function conceitsUserPrompt(expandedBrief: ExpandedBrief, examples: LibraryCampaign[]): string {
  const exampleBlocks = examples.slice(0, 5).map(
    (e) => `- ${e.title} (${e.campaign_type}): "${e.conceit}"`
  ).join("\n");

  return `Expanded brief:
${JSON.stringify(expandedBrief, null, 2)}

Reference conceits from past campaigns (for calibration only — do not copy):
${exampleBlocks}

Propose three distinct conceits. Each: 2–4 word name, 1-sentence description, plainly stated angle.

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
