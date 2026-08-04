import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, MODEL } from "@/lib/anthropic";
import { getBrandContext, buildSystemBlocks } from "@/lib/data";
import { generateRoleInstruction, generateUserPrompt, toneDirective } from "@/lib/prompts/generate";
import { legacyGenerateRoleInstruction, legacyToneDirective } from "@/lib/prompts/legacy-generate";
import { buildAvoidBlock } from "@/lib/constructions";
import { fetchProductReviews } from "@/lib/reviews/fetch";
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
    const dial = input.tone_dial ?? 1;
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
    await Promise.all(reviewSlugs.map(async (slug) => {
      try {
        // Fetch a small ranked list so the UI's refresh control has alternatives;
        // the top one is placed by default. Each review carries its real reviewer
        // name as embedded attribution ("… — Jordan M."); never invent a name.
        const reviews = await fetchProductReviews(slug, { limit: 5 });
        if (reviews.length) reviewsBySlug[slug] = reviews.map((r) => (r.author ? `${r.text} — ${r.author}` : r.text));
      } catch { /* no review → Review element stays empty + flagged */ }
    }));
    // Which review cards will come back EMPTY. Surfaced to the client so an empty
    // Review field reads as "no eligible review found" rather than a silent gap.
    // (We never fabricate — an empty card is always a real data gap.)
    const reviewGaps = reviewSlugs
      .filter((slug) => !reviewsBySlug[slug]?.length)
      .map((slug) => ({ slug, name: getProductName(slug) }));

    const userPrompt = generateUserPrompt(
      expanded_brief,
      conceit,
      input.section_structure,
      body.retrieved_examples,
      await buildAvoidBlock({
        productsFeatured: input.products_featured,
        campaignType: input.campaign_type,
      }),
      reviewsBySlug
    );

    const anthropicStream = getAnthropic().messages.stream({
      model: MODEL,
      max_tokens: 8192,
      system: systemBlocks,
      messages: [{ role: "user", content: userPrompt }],
    });

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
                    controller.enqueue(encoder.encode(`data: ${trimmed}\n\n`));
                  }
                }
              }
            }
          }
          // Flush any remaining buffer content
          if (lineBuffer.trim()) {
            controller.enqueue(encoder.encode(`data: ${lineBuffer.trim()}\n\n`));
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
