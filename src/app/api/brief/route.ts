import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, FAST_MODEL } from "@/lib/anthropic";
import { getBrandContext, buildSystemBlocks } from "@/lib/data";
import { briefRoleInstruction, briefUserPrompt } from "@/lib/prompts/brief";
import type { BriefInput } from "@/lib/schemas";

export async function POST(req: NextRequest) {
  try {
    const input: BriefInput = await req.json();
    const systemBlocks = buildSystemBlocks(getBrandContext(), briefRoleInstruction);
    const userPrompt = briefUserPrompt(input);

    const response = await getAnthropic().messages.create({
      model: FAST_MODEL,
      max_tokens: 1024,
      system: systemBlocks,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const json = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const expanded_brief = JSON.parse(json);
    expanded_brief.campaign_type = input.campaign_type;
    expanded_brief.audience = input.audience;
    expanded_brief.products_featured = input.products_featured;
    // Carry the user's literal instructions through untouched so must-use content
    // (specific reviews, quotes, names, exact copy) survives to the writer.
    expanded_brief.hero_angle_verbatim = input.hero_angle;
    if (input.campaign_specific_rules) expanded_brief.campaign_specific_rules = input.campaign_specific_rules;

    return NextResponse.json({ expanded_brief });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Brief expansion failed" }, { status: 500 });
  }
}
