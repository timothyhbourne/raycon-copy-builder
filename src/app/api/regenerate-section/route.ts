import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, MODEL } from "@/lib/anthropic";
import { getBrandContext, buildSystemBlocks } from "@/lib/data";
import { regenerateSectionRoleInstruction, regenerateSectionUserPrompt } from "@/lib/prompts/regenerate-section";
import { toneDirective } from "@/lib/prompts/generate";
import { buildAvoidBlock } from "@/lib/constructions";
import type { ExpandedBrief, Conceit, SectionSpec, GeneratedSection, GeneratedCampaign, LibraryCampaign } from "@/lib/schemas";
import { nanoid } from "@/lib/nanoid";
import { extractSubheaderVariants } from "@/lib/normalize-section";

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
    // Product-scoped avoid slice when rewriting a product card (verbatim
    // one-liner repeats hurt most there); recency-only otherwise.
    const sec = body.section_to_regenerate;
    const avoidBlock = sec.type === "product_card" && sec.product_slug
      ? buildAvoidBlock({ productsFeatured: [sec.product_slug] })
      : buildAvoidBlock({});
    const userPrompt = regenerateSectionUserPrompt(
      body.expanded_brief,
      body.chosen_conceit,
      body.section_to_regenerate,
      body.full_campaign,
      body.steering,
      body.retrieved_examples,
      avoidBlock
    );

    const response = await getAnthropic().messages.create({
      model: MODEL,
      max_tokens: 1536,
      system: systemBlocks,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const json = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(json);

    const { elements, subheader_variants, subheader_selected } = extractSubheaderVariants(parsed.elements);
    const section: GeneratedSection = {
      type: parsed.type,
      elements,
      id: body.section_to_regenerate.current_content.id || nanoid(),
      ...(subheader_variants ? { subheader_variants, subheader_selected } : {}),
    };

    return NextResponse.json({ section });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Section regeneration failed" }, { status: 500 });
  }
}
