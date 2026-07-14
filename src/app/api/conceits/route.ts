import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, FAST_MODEL } from "@/lib/anthropic";
import { getBrandContext, buildSystemBlocks } from "@/lib/data";
import { conceitsRoleInstruction, conceitsUserPrompt } from "@/lib/prompts/conceits";
import { buildAvoidBlock, recentConceits } from "@/lib/constructions";
import type { ExpandedBrief, LibraryCampaign } from "@/lib/schemas";

export async function POST(req: NextRequest) {
  try {
    const { expanded_brief, retrieved_examples }: { expanded_brief: ExpandedBrief; retrieved_examples: LibraryCampaign[] } = await req.json();
    const systemBlocks = buildSystemBlocks(getBrandContext(), conceitsRoleInstruction);
    // Recency slice only (no product/type scoping) plus past conceit names —
    // conceits should stop repeating as much as headlines do.
    const userPrompt = conceitsUserPrompt(
      expanded_brief,
      retrieved_examples,
      recentConceits(),
      buildAvoidBlock({})
    );

    const response = await getAnthropic().messages.create({
      model: FAST_MODEL,
      max_tokens: 1024,
      system: systemBlocks,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const json = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(json);

    return NextResponse.json(parsed);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Conceit generation failed" }, { status: 500 });
  }
}
