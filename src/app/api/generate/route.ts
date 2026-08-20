import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, MODEL, CREATIVE_TEMPERATURE } from "@/lib/anthropic";
import { getBrandContext, buildSystemBlocks } from "@/lib/data";
import { generateRoleInstruction, generateUserPrompt, toneDirective, DEFAULT_TONE_DIAL } from "@/lib/prompts/generate";
import { legacyGenerateRoleInstruction, legacyToneDirective } from "@/lib/prompts/legacy-generate";
import { buildAvoidBlock, recentUspsBySlug } from "@/lib/constructions";
import { buildLearningBlocks } from "@/lib/corpus/inject";
import { uspSlotsOf } from "@/lib/schemas";
import { fetchProductReviewsWithOrigin } from "@/lib/reviews/fetch";
import { resolveSectionReviews } from "@/lib/reviews/resolve";
import { verifiedIndex, guardReviewLine } from "@/lib/reviews/provenance";
import { getProductName } from "@/lib/products";
import { compileBrief } from "@/lib/brief/compile";
import { readPromoStore } from "@/lib/promo/store";
import { parseBody } from "@/lib/validation/api";
import { generateBody } from "@/lib/validation/requests";
import type { BriefInput, LibraryCampaign } from "@/lib/schemas";

export async function POST(req: NextRequest) {
  try {
    // The client now posts the raw structured BriefInput; we DETERMINISTICALLY
    // compile it into the ExpandedBrief + Conceit the generator consumes (no
    // brief-expansion or conceits LLM step). One streamed creative call.
    const parsed = await parseBody(req, generateBody);
    if (parsed.error) return parsed.error;
    const body = parsed.data as unknown as {
      brief_input: BriefInput;
      retrieved_examples: LibraryCampaign[];
    };
    const input = body.brief_input;

    // Resolve the selected Promotional Calendar promotion (if any) for the compiler.
    let promotion;
    if (input.promotion_id) {
      const store = await readPromoStore();
      promotion = store?.promotions.find((p) => p.id === input.promotion_id);
    }
    const compiled = compileBrief(input, promotion);
    const { expanded_brief, conceit } = compiled;

    // ROLLBACK LEVER: COPY_PROMPT_LEGACY=1 reverts to the pre-rebuild prompt
    // (src/lib/prompts/legacy-generate.ts) if the new voice ever regresses.
    const dial = input.tone_dial ?? DEFAULT_TONE_DIAL;
    const useLegacy = process.env.COPY_PROMPT_LEGACY === "1";
    const roleInstruction = useLegacy
      ? legacyGenerateRoleInstruction + legacyToneDirective(dial)
      : generateRoleInstruction + toneDirective(dial);
    const systemBlocks = buildSystemBlocks(getBrandContext(), roleInstruction);

    // Real reviews for any product_card_review card — fetched (and cached) so the
    // model has a genuine, verbatim review to place. NEVER fabricated: a product
    // with no review simply isn't in the map, and generate.ts tells the model to
    // leave that card's Review element empty. (The plain `reviews` section still
    // relies on the never-invent hard rule + user-supplied reviews.)
    const reviewSlugs = Array.from(new Set(
      input.section_structure
        .filter((s) => s.type === "product_card_review" && s.product_slug)
        .map((s) => s.product_slug as string)
    ));
    const reviewsBySlug: Record<string, string[]> = {};
    // Every review handed to the model, with where it came from. This is the set the
    // server-side strip below checks the model's output against, so a review that
    // was not resolved here cannot survive generation.
    const verifiedReviews: { text: string; provenance: import("@/lib/schemas").ReviewProvenance }[] = [];
    await Promise.all(reviewSlugs.map(async (slug) => {
      try {
        // Fetch a small ranked list so the UI's refresh control has alternatives;
        // the top one is placed by default. Each review carries its real reviewer
        // name as embedded attribution ("… — Jordan M."); never invent a name.
        const { reviews, origin } = await fetchProductReviewsWithOrigin(slug, { limit: 5 });
        if (reviews.length) {
          reviewsBySlug[slug] = reviews.map((r) => (r.author ? `${r.text} — ${r.author}` : r.text));
          const stamped = new Date().toISOString();
          for (const r of reviews) {
            verifiedReviews.push({
              text: r.author ? `${r.text} — ${r.author}` : r.text,
              provenance: {
                origin, fetched_at: stamped,
                ...(r.author ? { author: r.author } : {}),
                ...(r.rating != null ? { rating: r.rating } : {}),
              },
            });
          }
        }
      } catch { /* no review → Review element stays empty + flagged */ }
    }));

    // Standalone `reviews` sections: resolve each SLOT (product / url / manual).
    // This was the fabrication hole — the section was named Review 1/2/3 and handed
    // nothing, so the model filled it in.
    const heroProduct = input.hero_product_slug || input.products_featured?.[0];
    const sectionReviews = await resolveSectionReviews(input.section_structure, heroProduct);
    verifiedReviews.push(...sectionReviews.verified);
    const verified = verifiedIndex(verifiedReviews);

    // Which review slots will come back EMPTY. Surfaced to the client so an empty
    // Review field reads as "no eligible review found" rather than a silent gap.
    // (We never fabricate — an empty slot is always a real data gap.)
    const reviewGaps = [
      ...reviewSlugs
        .filter((slug) => !reviewsBySlug[slug]?.length)
        .map((slug) => ({ slug, name: getProductName(slug) })),
      ...sectionReviews.gaps.map((g) => ({ slug: `${g.section_id}:${g.slot}`, name: `Review ${g.slot} — ${g.reason}` })),
    ];

    // USPs sections: the live offer goes ONLY to company-sourced slots (so offer
    // mechanics are woven into a brand benefit and never appended to a product
    // spec), plus the USP lines already sent for each bound product so the same
    // bank entries stop resurfacing every send.
    const offerContext = [
      input.offer?.trim(),
      input.promo_code?.trim() ? `code ${input.promo_code.trim()}` : "",
      expanded_brief.deadline_language ? `ends ${expanded_brief.deadline_language}` : "",
      input.occasion?.trim() ? `for ${input.occasion.trim()}` : "",
    ].filter(Boolean).join(", ");
    const uspKeys = Array.from(new Set(
      input.section_structure
        .filter((s) => s.type === "usps")
        .flatMap((s) => uspSlotsOf(s).map((slot) => (slot.source === "company" ? "company" : slot.product_slug ?? "")))
        .filter(Boolean)
    ));

    // The recursive-learning blocks: a rotating Tier-A reference sample, the
    // headline-pattern form budget, and the approved-but-unsent repulsion set
    // (docs/RECURSIVE_LEARNING_FRAMEWORK_SPEC.md §2.6). All of them fail open —
    // an empty corpus yields no blocks and generation is unaffected.
    const learning = await buildLearningBlocks({
      campaign_type: input.campaign_type,
      audience: input.audience,
      occasion: input.occasion,
      products_featured: input.products_featured,
    }, { campaignType: input.campaign_type, channel: "email" });
    // One line per generation recording what the model was actually shown, so a
    // "why is this headline like that" question has an answer.
    console.log(
      `[learning] corpus=${learning.diagnostics.records} measured=${learning.diagnostics.measured}/${learning.diagnostics.floor} ` +
      `rotation=${learning.diagnostics.rotation} refs=[${learning.diagnostics.reference_ids.join(",")}] ` +
      `blocks=${[
        learning.reference ? "reference" : "",
        learning.formBudget ? "formBudget" : "",
        learning.inFlight ? "inFlight" : "",
        learning.performance ? "performance" : "",
      ].filter(Boolean).join("+") || "none"}`,
    );

    const userPrompt = generateUserPrompt(
      expanded_brief,
      conceit,
      input.section_structure,
      body.retrieved_examples,
      await buildAvoidBlock({
        productsFeatured: input.products_featured,
        campaignType: input.campaign_type,
        // Tier-weighted: in-flight copy first, drafts last and trimmed first.
        tiers: learning.tiers,
      }),
      reviewsBySlug,
      { offerContext, recentUspsBySlug: await recentUspsBySlug(uspKeys), reviewsBySection: sectionReviews.textBySection },
      learning
    );

    const anthropicStream = getAnthropic().messages.stream({
      model: MODEL,
      max_tokens: 8192,
      temperature: CREATIVE_TEMPERATURE,
      system: systemBlocks,
      messages: [{ role: "user", content: userPrompt }],
    });

    /**
     * SERVER-SIDE REVIEW STRIP (spec §5.2 point 2). Every section line the model
     * emits passes through here on its way to the client: any Review element whose
     * text does not match a review we actually resolved is emptied, and the
     * provenance of the ones that survive is attached to the line.
     *
     * This is deliberately a filter on the wire rather than an instruction in the
     * prompt. An instruction the model can ignore is not a control — and this one
     * had been ignored for every standalone `reviews` section, silently, because
     * nothing downstream checked. The logic is in src/lib/reviews/provenance.ts so
     * it is unit-tested without needing a generation.
     */
    const guardReviews = (line: string): string => {
      const { line: guarded, stripped } = guardReviewLine(line, verified);
      if (stripped.length) {
        console.warn(`[reviews] stripped ${stripped.length} model-written review(s) from a generated section: ${stripped.join(", ")}`);
      }
      return guarded;
    };

    const encoder = new TextEncoder();
    let lineBuffer = "";

    const readable = new ReadableStream({
      async start(controller) {
        try {
          // Hand the compiled brief back first so the client can persist it
          // (save + regenerate/variations run off this conceit) and show the
          // derived send-stage / urgency.
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            compiled: { expanded_brief, conceit, send_stage: compiled.send_stage, urgency: compiled.urgency },
            review_gaps: reviewGaps,
          })}\n\n`));
          for await (const event of anthropicStream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              lineBuffer += event.delta.text;
              // Flush every complete newline-terminated line as an SSE event
              const newlineIdx = lineBuffer.lastIndexOf("\n");
              if (newlineIdx !== -1) {
                const ready = lineBuffer.slice(0, newlineIdx);
                lineBuffer = lineBuffer.slice(newlineIdx + 1);
                for (const line of ready.split("\n")) {
                  const trimmed = line.trim();
                  if (trimmed) {
                    controller.enqueue(encoder.encode(`data: ${guardReviews(trimmed)}\n\n`));
                  }
                }
              }
            }
          }
          // Flush any remaining buffer content
          if (lineBuffer.trim()) {
            controller.enqueue(encoder.encode(`data: ${guardReviews(lineBuffer.trim())}\n\n`));
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Generation failed" }, { status: 500 });
  }
}
