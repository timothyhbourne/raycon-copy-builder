import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, MODEL } from "@/lib/anthropic";
import { getBrandContext, buildSystemBlocks } from "@/lib/data";
import { regenerateSectionRoleInstruction, regenerateSectionUserPrompt } from "@/lib/prompts/regenerate-section";
import { toneDirective } from "@/lib/prompts/generate";
import type { ExpandedBrief, Conceit, SectionSpec, GeneratedSection, GeneratedCampaign, LibraryCampaign } from "@/lib/schemas";
import { nanoid } from "@/lib/nanoid";

export async function POST(req: NextRequest) {
  try {
    const body: {
      expanded_brief: ExpandedBrief;
      chosen_conceit: Conceit;
      section_to_regenerate: SectionSpec & { current_content: GeneratedSection };
      full_campaign: GeneratedCampaign;
      steering: string;
      tone_dial?: number;
      retrieved_examples: LibraryCampaign[];
    } = await req.json();

    const roleInstruction = regenerateSectionRoleInstruction + toneDirective(body.tone_dial ?? 1);
    const systemBlocks = buildSystemBlocks(getBrandContext(), roleInstruction);
    const userPrompt = regenerateSectionUserPrompt(
      body.expanded_brief,
      body.chosen_conceit,
      body.section_to_regenerate,
      body.full_campaign,
      body.steering,
      body.retrieved_examples
    );

    const response = await getAnthropic().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemBlocks,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const json = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(json);

    const section: GeneratedSection = {
      ...parsed,
      id: body.section_to_regenerate.current_content.id || nanoid(),
    };

    return NextResponse.json({ section });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Section regeneration failed" }, { status: 500 });
  }
}
