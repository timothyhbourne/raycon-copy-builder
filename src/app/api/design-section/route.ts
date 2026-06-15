import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getAnthropic, MODEL } from "@/lib/anthropic";
import { getDesignSpec, resolveProductImage } from "@/lib/design";
import { buildImagePromptRequest } from "@/lib/prompts/design-section";
import type { SectionType } from "@/lib/schemas";

const VALID_SECTION_TYPES = new Set<string>([
  "header", "body", "usps", "product_card", "product_grid", "reviews", "cta_bridge", "footer_cta",
] satisfies SectionType[]);

function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set in .env.local");
  return new OpenAI({ apiKey: key });
}

export async function POST(req: NextRequest) {
  try {
    const body: {
      section_type: string;
      elements: Record<string, string>;
      offer?: string;
    } = await req.json();

    if (!VALID_SECTION_TYPES.has(body.section_type)) {
      return NextResponse.json({ error: "Invalid section_type" }, { status: 400 });
    }

    const elements = body.elements ?? {};
    const spec = getDesignSpec(body.section_type); // null if not yet extracted — that's fine
    const productImage = resolveProductImage(
      elements["Hero Image Direction"] ?? "",
      elements["Headline"] ?? "",
      elements["Tagline"] ?? ""
    );

    // Step 1: Claude writes the image generation prompt
    const claudeRequest = buildImagePromptRequest({
      spec,
      headline: elements["Headline"] ?? "",
      tagline: elements["Tagline"] ?? "",
      subTagline: elements["Sub-Tagline"],
      cta: elements["CTA"] ?? "",
      heroImageDirection: elements["Hero Image Direction"] ?? "",
      offer: body.offer,
      productFilename: productImage ? null : null, // product described via heroImageDirection
    });

    const claudeResponse = await getAnthropic().messages.create({
      model: MODEL,
      max_tokens: 400,
      messages: [{ role: "user", content: claudeRequest }],
    });

    const imagePrompt = claudeResponse.content[0].type === "text"
      ? claudeResponse.content[0].text.trim()
      : "";

    if (!imagePrompt) {
      return NextResponse.json({ error: "Claude returned empty prompt" }, { status: 500 });
    }

    // Step 2: OpenAI gpt-image-1 generates the image
    const openai = getOpenAI();
    const imageResponse = await openai.images.generate({
      model: "gpt-image-1",
      prompt: imagePrompt,
      n: 1,
      size: "1536x1024",
      quality: "medium",
    });

    const b64 = imageResponse.data?.[0]?.b64_json;
    if (!b64) {
      return NextResponse.json({ error: "No image data returned from OpenAI" }, { status: 500 });
    }

    return NextResponse.json({ image: `data:image/png;base64,${b64}` });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Design generation failed" }, { status: 500 });
  }
}
