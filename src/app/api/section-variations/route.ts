import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, MODEL, CREATIVE_TEMPERATURE } from "@/lib/anthropic";
import { getBrandContext, buildSystemBlocks } from "@/lib/data";
import { regenerateSectionRoleInstruction, regenerateSectionUserPrompt } from "@/lib/prompts/regenerate-section";
import { toneDirective, DEFAULT_TONE_DIAL } from "@/lib/prompts/generate";
import { REGISTERS, registerSteering } from "@/lib/prompts/variations";
import { buildAvoidBlock } from "@/lib/constructions";
import { isProductCardType } from "@/lib/schemas";
import { autoFixMechanical } from "@/lib/hard-rules-check";
import { normalizeSectionElements } from "@/lib/normalize-section";
import { verifiedIndex, verifiedFromSection, stripUnprovenancedReviews } from "@/lib/reviews/provenance";
import { isReviewElement } from "@/lib/element-families";
import { nanoid } from "@/lib/nanoid";
import { parseBody } from "@/lib/validation/api";
import { regenerateSectionBody } from "@/lib/validation/requests";
import type { ExpandedBrief, Conceit, SectionSpec, GeneratedSection, GeneratedCampaign, LibraryCampaign, SectionElements } from "@/lib/schemas";
import type { TextBlockParam } from "@anthropic-ai/sdk/resources/messages";

// Scrub every string in a parsed section's element map (mirrors the client scrub
// so variations are punctuation-clean regardless of entry point).
function scrubSectionElements(elements: Record<string, unknown>): SectionElements {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(elements)) {
    // Never scrub a review: it is a customer's words, and the punctuation autofix
    // rewrites the em dash in "… — Jordan M." — which both edits what they said and
    // breaks the verbatim match the provenance check relies on.
    if (isReviewElement(k)) { out[k] = v; continue; }
    if (typeof v === "string") out[k] = autoFixMechanical(v);
    else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        typeof item === "string" ? autoFixMechanical(item)
          : item && typeof item === "object" ? scrubSectionElements(item as Record<string, unknown>)
            : item
      );
    } else out[k] = v;
  }
  return out as SectionElements;
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseBody(req, regenerateSectionBody);
    if (parsed.error) return parsed.error;
    const body = parsed.data as unknown as {
      expanded_brief: ExpandedBrief;
      chosen_conceit: Conceit;
      section_to_regenerate: SectionSpec & { current_content: GeneratedSection };
      full_campaign: GeneratedCampaign;
      feedback?: string;
      tone_dial?: number;
      retrieved_examples: LibraryCampaign[];
      /** Every card the user has already seen and rejected, across all prior
       *  sets. Feeds the anti-duplication block so "Regenerate a new set"
       *  actually diverges instead of resending an identical prompt. */
      prior_variations?: Array<{ label: string; preview: string }>;
    };

    const roleInstruction = regenerateSectionRoleInstruction + toneDirective(body.tone_dial ?? DEFAULT_TONE_DIAL);
    const systemBlocks: TextBlockParam[] = buildSystemBlocks(getBrandContext(), roleInstruction);
    const sec = body.section_to_regenerate;
    const avoidBlock = isProductCardType(sec.type) && sec.product_slug
      ? await buildAvoidBlock({ productsFeatured: [sec.product_slug] })
      : await buildAvoidBlock({});
    const currentId = sec.current_content.id || nanoid();
    // The reviews already on the section are the only reviews any variation is
    // allowed to contain (resolved once, used by all five registers).
    const verifiedReviews = verifiedIndex(verifiedFromSection(sec.current_content));

    // Sets after the first carry every card the user already rejected, so the
    // model is told what NOT to restate. Without this, "Regenerate a new set"
    // posts a byte-identical prompt and gets set 1 back.
    const prior = body.prior_variations ?? [];
    const priorBlock = prior.length
      ? `\n\nANTI-DUPLICATION , the user already rejected these previous alternatives:
${prior.map((p, i) => `[Prior ${i + 1} , ${p.label}] ${p.preview}`).join("\n\n")}
Do not restate any of these. Change the opener, the angle, the sentence shape. If your draft rhymes with any prior above, rewrite it.`
      : "";

    // One call per register, in parallel. Reusing the regenerate-section prompt
    // guarantees each variation is a schema-valid section of the right type.
    const results = await Promise.all(
      REGISTERS.map(async (register) => {
        try {
          const userPrompt = regenerateSectionUserPrompt(
            body.expanded_brief,
            body.chosen_conceit,
            body.section_to_regenerate,
            body.full_campaign,
            registerSteering(body.feedback ?? "", register) + priorBlock,
            body.retrieved_examples,
            avoidBlock
          );
          const response = await getAnthropic().messages.create({
            model: MODEL,
            max_tokens: 1536,
            // Explicit, not the SDK default: five prompts that differ by one
            // block need full sampling range to come back reading differently.
            temperature: CREATIVE_TEMPERATURE,
            system: systemBlocks,
            messages: [{ role: "user", content: userPrompt }],
          });
          const text = response.content[0]?.type === "text" ? response.content[0].text : "";
          const json = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const parsed = JSON.parse(json);
          const { elements, ...slates } = normalizeSectionElements(parsed.elements);
          // Same guard as the single-section rewrite: a variation may keep the real
          // reviews and may not write new ones. Without this, running the five
          // registers on a reviews section produced five sets of fabricated quotes.
          const guarded = stripUnprovenancedReviews(
            scrubSectionElements(elements as Record<string, unknown>) as GeneratedSection["elements"],
            verifiedReviews,
          );
          const section: GeneratedSection = {
            type: parsed.type ?? sec.type,
            elements: guarded.elements,
            id: currentId,
            ...slates,
            ...(Object.keys(guarded.review_provenance).length ? { review_provenance: guarded.review_provenance } : {}),
          };
          return { label: register.label, section };
        } catch (err) {
          // A single failed register is not fatal, but it is never silent: it
          // comes back labeled so the UI can say which one dropped and why.
          return { failed: register.label, reason: err instanceof Error ? err.message : "unknown" };
        }
      })
    );

    const variations = results.filter((r): r is { label: string; section: GeneratedSection } => !("failed" in r));
    const failures = results.filter((r): r is { failed: string; reason: string } => "failed" in r);
    if (failures.length) console.warn("section-variations: registers dropped", failures);
    if (!variations.length) {
      return NextResponse.json({ error: "Could not generate variations", failures }, { status: 502 });
    }
    return NextResponse.json({ variations, failures });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Section variations failed" }, { status: 500 });
  }
}
