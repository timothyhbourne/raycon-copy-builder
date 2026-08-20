import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, MODEL, CREATIVE_TEMPERATURE } from "@/lib/anthropic";
import { getBrandContext, buildSystemBlocks } from "@/lib/data";
import { regenerateSectionRoleInstruction, regenerateSectionUserPrompt } from "@/lib/prompts/regenerate-section";
import { toneDirective, DEFAULT_TONE_DIAL } from "@/lib/prompts/generate";
import { buildAvoidBlock } from "@/lib/constructions";
import { isProductCardType } from "@/lib/schemas";
import type { ExpandedBrief, Conceit, SectionSpec, GeneratedSection, GeneratedCampaign, LibraryCampaign } from "@/lib/schemas";
import { nanoid } from "@/lib/nanoid";
import { normalizeSectionElements } from "@/lib/normalize-section";
import { verifiedIndex, verifiedFromSection, stripUnprovenancedReviews } from "@/lib/reviews/provenance";
import { parseBody } from "@/lib/validation/api";
import { regenerateSectionBody } from "@/lib/validation/requests";

export async function POST(req: NextRequest) {
  try {
    const parsedBody = await parseBody(req, regenerateSectionBody);
    if (parsedBody.error) return parsedBody.error;
    const body = parsedBody.data as unknown as {
      expanded_brief: ExpandedBrief;
      chosen_conceit: Conceit;
      section_to_regenerate: SectionSpec & { current_content: GeneratedSection };
      full_campaign: GeneratedCampaign;
      steering: string;
      tone_dial?: number;
      retrieved_examples: LibraryCampaign[];
    };

    const roleInstruction = regenerateSectionRoleInstruction + toneDirective(body.tone_dial ?? DEFAULT_TONE_DIAL);
    const systemBlocks = buildSystemBlocks(getBrandContext(), roleInstruction);
    // Product-scoped avoid slice when rewriting a product card (verbatim
    // one-liner repeats hurt most there); recency-only otherwise.
    const sec = body.section_to_regenerate;
    const avoidBlock = isProductCardType(sec.type) && sec.product_slug
      ? await buildAvoidBlock({ productsFeatured: [sec.product_slug] })
      : await buildAvoidBlock({});
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
      temperature: CREATIVE_TEMPERATURE,
      system: systemBlocks,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const json = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(json);

    const { elements, ...slates } = normalizeSectionElements(parsed.elements);
    // A rewrite may KEEP the real reviews that were on the section and may not
    // produce any others. The reviews already on the canvas are the verified set;
    // anything else in a Review slot is emptied here rather than shipped
    // (docs/REVIEWS_MODULE_SPEC.md §5.2 point 2).
    const current = body.section_to_regenerate.current_content;
    const verified = verifiedIndex(verifiedFromSection(current));
    const guarded = stripUnprovenancedReviews(elements, verified);
    if (guarded.stripped.length) {
      console.warn(`[reviews] section rewrite rewrote ${guarded.stripped.length} real review(s) — reverting those slots: ${guarded.stripped.join(", ")}`);
    }
    const section: GeneratedSection = {
      type: parsed.type,
      elements: guarded.elements,
      id: current.id || nanoid(),
      ...slates,
      ...(Object.keys(guarded.review_provenance).length ? { review_provenance: guarded.review_provenance } : {}),
    };

    return NextResponse.json({
      section,
      // Named so the canvas can say WHICH slots came back empty and why, instead of
      // the writer noticing a blank review later.
      ...(guarded.stripped.length ? { reviews_reverted: guarded.stripped } : {}),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Section regeneration failed" }, { status: 500 });
  }
}
