import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, MODEL } from "@/lib/anthropic";
import { getBrandContext, buildSystemBlocks } from "@/lib/data";
import { toneDirective } from "@/lib/prompts/generate";
import {
  regenerateElementRoleInstruction, regenerateElementUserPrompt,
  isReviewElement, elementReturnsVariants, parseGridItemKey,
} from "@/lib/prompts/regenerate-element";
import { buildAvoidBlock } from "@/lib/constructions";
import { isProductCardType } from "@/lib/schemas";
import { getProductName } from "@/lib/products";
import { autoFixMechanical } from "@/lib/hard-rules-check";
import { parseBody } from "@/lib/validation/api";
import { regenerateElementBody } from "@/lib/validation/requests";
import type {
  ExpandedBrief, Conceit, SectionSpec, GeneratedSection, GeneratedCampaign, LibraryCampaign,
} from "@/lib/schemas";

// Rewrite ONE element of one section. Small, fast call — the whole point is that
// the rest of the section stays untouched, so nothing else is returned.
//
// Response: { value: string } normally, { variants: string[] } for Subheader.

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseBody(req, regenerateElementBody);
    if (parsed.error) return parsed.error;
    const body = parsed.data as unknown as {
      element_key: string;
      section: GeneratedSection;
      section_spec?: SectionSpec;
      full_campaign: GeneratedCampaign;
      expanded_brief: ExpandedBrief;
      chosen_conceit: Conceit;
      steering?: string;
      tone_dial?: number;
      retrieved_examples?: LibraryCampaign[];
    };
    const { element_key: key, section, section_spec: spec } = body;

    // HARD LINE: a customer review is real text, fetched from the storefront and
    // used verbatim. It is never written by a model. The client routes Review
    // elements to /api/reviews instead; this is the server-side backstop.
    if (isReviewElement(key)) {
      return NextResponse.json(
        { error: "Review elements are real customer reviews and are never generated. Fetch another via /api/reviews." },
        { status: 400 }
      );
    }

    // Product Name must be the exact catalogue name — a deterministic answer, so
    // don't spend a model call (or risk it coining a variant).
    if (key === "Product Name" && spec?.product_slug) {
      return NextResponse.json({ value: getProductName(spec.product_slug) });
    }

    const roleInstruction = regenerateElementRoleInstruction + toneDirective(body.tone_dial ?? 3);
    const systemBlocks = buildSystemBlocks(getBrandContext(), roleInstruction);

    // Product-scoped avoid block for a product card, matching the section route.
    const gridItem = parseGridItemKey(key);
    const avoidBlock = (isProductCardType(section.type) || gridItem) && spec?.product_slug
      ? await buildAvoidBlock({ productsFeatured: [spec.product_slug] })
      : await buildAvoidBlock({});

    const offerContext = [
      body.expanded_brief.key_message?.trim(),
      body.expanded_brief.deadline_language ? `ends ${body.expanded_brief.deadline_language}` : "",
    ].filter(Boolean).join(", ");

    const userPrompt = regenerateElementUserPrompt({
      elementKey: key,
      section,
      sectionSpec: spec,
      fullCampaign: body.full_campaign,
      expandedBrief: body.expanded_brief,
      chosenConceit: body.chosen_conceit,
      steering: body.steering,
      examples: body.retrieved_examples ?? [],
      avoidBlock,
      offerContext,
    });

    // One element is a small output; Subheader needs room for 3 options.
    const wantsVariants = elementReturnsVariants(key);
    const response = await getAnthropic().messages.create({
      model: MODEL,
      max_tokens: wantsVariants ? 600 : 400,
      system: systemBlocks,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const json = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let payload: unknown;
    try {
      payload = JSON.parse(json);
    } catch {
      return NextResponse.json({ error: "Could not parse the rewritten element." }, { status: 502 });
    }

    const obj = (payload ?? {}) as { value?: unknown; variants?: unknown };

    if (wantsVariants) {
      const variants = Array.isArray(obj.variants)
        ? obj.variants.filter((v): v is string => typeof v === "string").map((v) => autoFixMechanical(v.trim())).filter(Boolean)
        : [];
      if (!variants.length) {
        // A single string is a tolerable near-miss — take it as one option.
        const single = typeof obj.value === "string" ? autoFixMechanical(obj.value.trim()) : "";
        if (!single) return NextResponse.json({ error: "No options came back." }, { status: 502 });
        return NextResponse.json({ variants: [single] });
      }
      return NextResponse.json({ variants });
    }

    const value = typeof obj.value === "string"
      ? autoFixMechanical(obj.value.trim())
      : Array.isArray(obj.variants) && typeof obj.variants[0] === "string"
        ? autoFixMechanical(String(obj.variants[0]).trim())
        : "";
    if (!value) return NextResponse.json({ error: "No replacement came back." }, { status: 502 });
    return NextResponse.json({ value });
  } catch (e) {
    console.error("regenerate-element failed:", e);
    return NextResponse.json({ error: "Element regeneration failed" }, { status: 500 });
  }
}
