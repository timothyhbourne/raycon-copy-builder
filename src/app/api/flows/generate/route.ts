import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, MODEL, CREATIVE_TEMPERATURE } from "@/lib/anthropic";
import { getBrandContext, buildSystemBlocks } from "@/lib/data";
import { flowRoleInstruction, flowUserPrompt, type FlowEmailContext } from "@/lib/prompts/flows";
import { fetchProductReviews } from "@/lib/reviews/fetch";
import { getProductName } from "@/lib/products";
import { buildLearningBlocks } from "@/lib/corpus/inject";
import { parseBody } from "@/lib/validation/api";
import { flowGenerateBody } from "@/lib/validation/requests";
import type { SectionSpec, FlowType } from "@/lib/schemas";

// Generate ONE flow email. Mirrors /api/generate's streaming plumbing (SSE of
// JSONL: a meta line, then one section line each, then [DONE]) so the flows
// client reuses the same parser and the email renders in the existing canvas.
// The difference is the BRAIN: the flow role instruction + flow user prompt
// (src/lib/prompts/flows.ts), which write triggered/sequential copy rather than
// a broadcast campaign. No deterministic brief compile step — a flow email's
// context is its position + job + highlights + sibling arc.

interface RawContext {
  flow_type: FlowType;
  flow_name?: string;
  channel?: "email" | "sms";
  trigger?: string;
  goal?: string;
  position: number;
  total_emails?: number;
  job: string;
  delay?: string;
  highlights?: string;
  /** The reader's journey to this email, branch conditions included (spec §5).
   * Built client-side by pathContext() over the flow graph. */
  path_context?: string;
  siblings?: { position: number; job: string; summary?: string }[];
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseBody(req, flowGenerateBody);
    if (parsed.error) return parsed.error;
    const body = parsed.data as unknown as {
      context: RawContext;
      section_structure: SectionSpec[];
      products_featured?: string[];
    };
    const rc = body.context;
    const sectionStructure = body.section_structure ?? [];

    const ctx: FlowEmailContext = {
      flowType: rc.flow_type,
      flowName: rc.flow_name || rc.flow_type,
      channel: rc.channel || "email",
      trigger: rc.trigger,
      goal: rc.goal,
      position: rc.position,
      totalEmails: rc.total_emails ?? Math.max(rc.position, 1),
      job: rc.job,
      delay: rc.delay,
      highlights: rc.highlights,
      pathContext: rc.path_context,
      siblings: rc.siblings ?? [],
    };

    const roleInstruction = flowRoleInstruction;
    const systemBlocks = buildSystemBlocks(getBrandContext(), roleInstruction);

    // Real reviews for any product_card_review card that has a pinned product —
    // fetched (and cached) so the model has a genuine, verbatim review. Never
    // fabricated: a product with no review simply isn't in the map, and the flow
    // brain tells the model to leave that card's Review element empty.
    const reviewSlugs = Array.from(new Set(
      sectionStructure
        .filter((s) => s.type === "product_card_review" && s.product_slug)
        .map((s) => s.product_slug as string)
    ));
    const reviewsBySlug: Record<string, string[]> = {};
    await Promise.all(reviewSlugs.map(async (slug) => {
      try {
        const reviews = await fetchProductReviews(slug, { limit: 5 });
        if (reviews.length) reviewsBySlug[slug] = reviews.map((r) => (r.author ? `${r.text} — ${r.author}` : r.text));
      } catch { /* no review → Review element stays empty + flagged */ }
    }));
    const reviewGaps = reviewSlugs
      .filter((slug) => !reviewsBySlug[slug]?.length)
      .map((slug) => ({ slug, name: getProductName(slug) }));

    // Repulsion + account-level performance context. withReference: false — a flow
    // email is evergreen and has no campaign brief to score reference relevance
    // against, so the rotating broadcast sample would be noise here.
    const learning = await buildLearningBlocks({}, {
      withReference: false,
      channel: ctx.channel === "sms" ? "sms" : "email",
    });
    const userPrompt = flowUserPrompt(ctx, sectionStructure, "", reviewsBySlug, {
      formBudget: learning.formBudget,
      inFlight: learning.inFlight,
      performance: learning.performance,
    });

    const anthropicStream = getAnthropic().messages.stream({
      model: MODEL,
      max_tokens: 8192,
      temperature: CREATIVE_TEMPERATURE,
      system: systemBlocks,
      messages: [{ role: "user", content: userPrompt }],
    });

    const encoder = new TextEncoder();
    let lineBuffer = "";

    const readable = new ReadableStream({
      async start(controller) {
        try {
          // Hand back review gaps first (empty Review cards are always real data
          // gaps, never fabricated), so the client can explain them.
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ review_gaps: reviewGaps })}\n\n`));
          for await (const event of anthropicStream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              lineBuffer += event.delta.text;
              const newlineIdx = lineBuffer.lastIndexOf("\n");
              if (newlineIdx !== -1) {
                const ready = lineBuffer.slice(0, newlineIdx);
                lineBuffer = lineBuffer.slice(newlineIdx + 1);
                for (const line of ready.split("\n")) {
                  const trimmed = line.trim();
                  if (trimmed) controller.enqueue(encoder.encode(`data: ${trimmed}\n\n`));
                }
              }
            }
          }
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
