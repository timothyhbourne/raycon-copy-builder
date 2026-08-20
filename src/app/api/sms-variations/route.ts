import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, MODEL, CREATIVE_TEMPERATURE } from "@/lib/anthropic";
import { smsVariationsSystem, buildSmsVariationsUserPrompt } from "@/lib/prompts/variations";
import { autoFixMechanical } from "@/lib/hard-rules-check";
import { smsLength } from "@/lib/sms-format";
import { parseBody } from "@/lib/validation/api";
import { smsVariationsBody } from "@/lib/validation/requests";
import type { SmsBrief } from "@/lib/schemas";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

interface LabeledVariation { label: string; text: string; }

// Defensive parse: pull the JSON object out of the model response and read a
// labeled `variations` array. Tolerates fences / stray prose.
function parseLabeled(text: string): LabeledVariation[] | null {
  let raw = text.trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) raw = fenced[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    const arr = parsed?.variations;
    if (!Array.isArray(arr)) return null;
    const out = arr
      .filter((v): v is LabeledVariation => v && typeof v.label === "string" && typeof v.text === "string")
      .map((v) => ({ label: v.label.trim(), text: v.text.trim() }));
    return out.length ? out : null;
  } catch {
    return null;
  }
}

async function callModel(system: string, messages: MessageParam[]): Promise<string> {
  const res = await getAnthropic().messages.create({
    model: MODEL,
    max_tokens: 1200,
    temperature: CREATIVE_TEMPERATURE,
    system,
    messages,
  });
  return res.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseBody(req, smsVariationsBody);
    if (parsed.error) return parsed.error;
    const body = parsed.data as { current_sms: string; brief: SmsBrief; feedback?: string };
    if (!body.current_sms.trim()) {
      return NextResponse.json({ error: "current_sms is required" }, { status: 400 });
    }

    const system = smsVariationsSystem();
    const userPrompt = buildSmsVariationsUserPrompt(body.current_sms, body.brief ?? { offer: "" }, body.feedback ?? "");
    const messages: MessageParam[] = [{ role: "user", content: userPrompt }];

    const first = await callModel(system, messages);
    let variations = parseLabeled(first);
    if (!variations) {
      return NextResponse.json({ error: "Could not parse variations" }, { status: 502 });
    }

    // One corrective round-trip if any message busts the hard 160-char ceiling.
    const over = variations.filter((v) => smsLength(v.text).chars > 160);
    if (over.length) {
      messages.push({ role: "assistant", content: first });
      messages.push({
        role: "user",
        content: `These are over 160 characters: ${over.map((v) => `"${v.label}"`).join(", ")}. Cut each to under 145 characters while keeping the offer, promo code, deadline, and {link}. Return the full JSON object again with all variations in the same order.`,
      });
      const second = await callModel(system, messages);
      const corrected = parseLabeled(second);
      if (corrected) variations = corrected;
    }

    // Deterministic scrub, then cap at 5.
    const cleaned = variations.slice(0, 5).map((v) => ({ label: v.label, text: autoFixMechanical(v.text) }));
    return NextResponse.json({ variations: cleaned });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "SMS variations failed" }, { status: 500 });
  }
}
