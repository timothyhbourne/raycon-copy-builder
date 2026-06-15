import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, MODEL } from "@/lib/anthropic";
import { getDesignSpec, getRayconLogoSvg, resolveProductImage } from "@/lib/design";
import { designSectionPrompt } from "@/lib/prompts/design-section";
import type { SectionType } from "@/lib/schemas";

const VALID_SECTION_TYPES = new Set<string>([
  "header", "body", "usps", "product_card", "product_grid", "reviews", "cta_bridge", "footer_cta",
] satisfies SectionType[]);

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

    const spec = getDesignSpec(body.section_type);
    if (!spec) {
      return NextResponse.json(
        { error: `No design spec found for '${body.section_type}'. Run: npm run ingest:design-spec` },
        { status: 400 }
      );
    }

    const elements = body.elements ?? {};
    const productImage = resolveProductImage(
      elements["Hero Image Direction"] ?? "",
      elements["Headline"] ?? "",
      elements["Tagline"] ?? ""
    );
    const logoSvg = getRayconLogoSvg();

    const promptText = designSectionPrompt({
      spec,
      headline: elements["Headline"] ?? "",
      tagline: elements["Tagline"] ?? "",
      subTagline: elements["Sub-Tagline"],
      cta: elements["CTA"] ?? "",
      heroImageDirection: elements["Hero Image Direction"] ?? "",
      offer: body.offer,
      hasProductImage: productImage !== null,
    });

    // Pass the product image as a vision block so the model can see what it's
    // placing — without needing to output binary data itself.
    const messageContent = [];
    if (productImage) {
      messageContent.push({
        type: "image",
        source: { type: "base64", media_type: productImage.mime, data: productImage.base64 },
      });
    }
    messageContent.push({ type: "text", text: promptText });

    const response = await getAnthropic().messages.create({
      model: MODEL,
      max_tokens: 4096,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: "user", content: messageContent as any }],
    });

    let html = response.content[0].type === "text" ? response.content[0].text.trim() : "";
    // Strip code fences if the model wrapped the output
    html = html.replace(/^```html\n?/i, "").replace(/\n?```$/i, "").trim();

    // Inject real asset data URIs in place of the placeholders Claude used
    if (logoSvg) {
      const logoDataUri = `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString("base64")}`;
      html = html.split("RAYCON_LOGO_PLACEHOLDER").join(logoDataUri);
    }
    if (productImage) {
      const productDataUri = `data:${productImage.mime};base64,${productImage.base64}`;
      html = html.split("PRODUCT_IMAGE_PLACEHOLDER").join(productDataUri);
    }

    return NextResponse.json({ html });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Design generation failed" }, { status: 500 });
  }
}
