import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, MODEL } from "@/lib/anthropic";
import { getBrandContext, buildSystemBlocks } from "@/lib/data";
import { regenerateMetaRoleInstruction, regenerateMetaUserPrompt } from "@/lib/prompts/regenerate-meta";
import type { ExpandedBrief, Conceit } from "@/lib/schemas";

export async function POST(req: NextRequest) {
  try {
    const body: {
      expanded_brief: ExpandedBrief;
      chosen_conceit: Conceit;
      current_campaign_summary: string;
    } = await req.json();

    const systemBlocks = buildSystemBlocks(getBrandContext(), regenerateMetaRoleInstruction);
    const userPrompt = regenerateMetaUserPrompt(
      body.expanded_brief,
      body.chosen_conceit,
      body.current_campaign_summary
    );

    const response = await getAnthropic().messages.create({
      model: MODEL,
      max_tokens: 512,
      system: systemBlocks,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const json = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(json);

    return NextResponse.json(parsed);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Meta regeneration failed" }, { status: 500 });
  }
}
