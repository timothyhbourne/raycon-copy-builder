import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, MODEL } from "@/lib/anthropic";
import { getBrandContext, buildSystemBlocks } from "@/lib/data";
import { generateRoleInstruction, generateUserPrompt, toneDirective } from "@/lib/prompts/generate";
import { legacyGenerateRoleInstruction, legacyToneDirective } from "@/lib/prompts/legacy-generate";
import type { ExpandedBrief, Conceit, SectionSpec, LibraryCampaign } from "@/lib/schemas";

export async function POST(req: NextRequest) {
  try {
    const body: {
      expanded_brief: ExpandedBrief;
      chosen_conceit: Conceit;
      section_structure: SectionSpec[];
      retrieved_examples: LibraryCampaign[];
      tone_dial?: number;
    } = await req.json();

    // ROLLBACK LEVER: COPY_PROMPT_LEGACY=1 reverts to the pre-rebuild prompt
    // (src/lib/prompts/legacy-generate.ts) if the new voice ever regresses.
    const dial = body.tone_dial ?? 1;
    const useLegacy = process.env.COPY_PROMPT_LEGACY === "1";
    const roleInstruction = useLegacy
      ? legacyGenerateRoleInstruction + legacyToneDirective(dial)
      : generateRoleInstruction + toneDirective(dial);
    const systemBlocks = buildSystemBlocks(getBrandContext(), roleInstruction);
    const userPrompt = generateUserPrompt(
      body.expanded_brief,
      body.chosen_conceit,
      body.section_structure,
      body.retrieved_examples
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
