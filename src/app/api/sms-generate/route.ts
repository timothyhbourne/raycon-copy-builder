import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, MODEL } from "@/lib/anthropic";
import { smsSystemInstruction, buildSmsUserPrompt, type SmsBrief } from "@/lib/prompts/sms";
import { buildSmsAvoidBlock } from "@/lib/constructions";
import { smsLength } from "@/lib/sms-format";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

// Pull the first balanced JSON object out of a model response and read its
// `variants` array. Defensive: the model is told to return bare JSON, but strip
// fences / preamble just in case.
function parseVariants(text: string): string[] | null {
  let raw = text.trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) raw = fenced[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    const variants = parsed?.variants;
    if (!Array.isArray(variants)) return null;
    const strings = variants.filter((v): v is string => typeof v === "string").map((v) => v.trim());
    return strings.length >= 3 ? strings.slice(0, 3) : null;
  } catch {
    return null;
  }
}

async function callModel(system: string, messages: MessageParam[]): Promise<string> {
  const res = await getAnthropic().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages,
  });
  return res.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// Which variants (1-indexed for the model) still bust the 160-char ceiling.
function overBudget(variants: string[]): { n: number; chars: number }[] {
  return variants
    .map((text, i) => ({ n: i + 1, chars: smsLength(text).chars }))
    .filter((v) => v.chars > 160);
}

export async function POST(req: NextRequest) {
  try {
    const body: { brief: SmsBrief; source_email?: string } = await req.json();
    if (!body?.brief?.offer?.trim()) {
      return NextResponse.json({ error: "offer is required" }, { status: 400 });
    }

    const system = smsSystemInstruction;
    const userPrompt = buildSmsUserPrompt(body.brief, body.source_email, buildSmsAvoidBlock());
    const messages: MessageParam[] = [{ role: "user", content: userPrompt }];

    const first = await callModel(system, messages);
    let variants = parseVariants(first);
    if (!variants) {
      return NextResponse.json({ error: "Could not parse variants" }, { status: 502 });
    }

    // One automatic corrective round-trip if any variant exceeds the hard ceiling.
    const over = overBudget(variants);
    if (over.length) {
      const fix = over.map((v) => `variant ${v.n} is ${v.chars} chars`).join("; ");
      messages.push({ role: "assistant", content: first });
      messages.push({
        role: "user",
        content: `${fix} — cut each of these to under 145 characters while keeping the same offer, the promo code, the deadline, and the {link}. Return the full JSON object again with all 3 variants in the same order.`,
      });
      const second = await callModel(system, messages);
      const corrected = parseVariants(second);
      if (corrected) variants = corrected;
    }

    return NextResponse.json({
      variants: [{ text: variants[0] }, { text: variants[1] }, { text: variants[2] }],
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Generation failed" }, { status: 500 });
  }
}
