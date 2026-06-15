export interface DesignSectionContext {
  spec: Record<string, unknown> | null;
  headline: string;
  tagline: string;
  subTagline?: string;
  cta: string;
  heroImageDirection: string;
  offer?: string;
  productFilename: string | null;
}

export function buildImagePromptRequest(ctx: DesignSectionContext): string {
  const specBlock = ctx.spec
    ? `DESIGN SPEC (extracted from approved Raycon reference headers):\n${JSON.stringify(ctx.spec, null, 2)}`
    : `BRAND BASELINE: Raycon uses a thin black logo bar at top (white "RAYCON" wordmark), then a hero section — typically dark/black background with white text, product render on one side, copy and a CTA pill button on the other. Clean, modern, premium wireless audio aesthetic.`;

  const productLabel = ctx.heroImageDirection
    || (ctx.productFilename ? ctx.productFilename.replace(/-/g, " ").replace(".png", "") : "Raycon wireless earbuds");

  return `Write a detailed image generation prompt for an AI image generator. The output will be an email header mockup for Raycon, a premium wireless audio brand.

${specBlock}

COPY — must appear in the generated image exactly as written:
- Headline: "${ctx.headline}"
- Tagline: "${ctx.tagline}"${ctx.subTagline ? `\n- Sub-tagline: "${ctx.subTagline}"` : ""}
- CTA button label: "${ctx.cta}"${ctx.offer ? `\n- Offer context (use to inform the visual tone, not necessarily as text): ${ctx.offer}` : ""}

PRODUCT: ${productLabel}

Write a single precise image generation prompt (4–6 sentences) that:
1. Establishes this as an email marketing header banner, wide landscape format
2. Describes the two-zone layout: thin top bar with the "RAYCON" wordmark, then the main hero section below
3. Specifies where each piece of copy appears and its visual treatment (size, weight, color)
4. Describes product placement, background color/gradient, CTA button appearance
5. Ends with style and quality descriptors (e.g. "professional ecommerce email design, high production quality")

Output ONLY the prompt text. No labels, no explanation, no markdown.`;
}
