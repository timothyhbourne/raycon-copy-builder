export interface DesignSectionContext {
  spec: Record<string, unknown>;
  headline: string;
  tagline: string;
  subTagline?: string;
  cta: string;
  heroImageDirection: string;
  offer?: string;
  hasProductImage: boolean;
}

export function designSectionPrompt(ctx: DesignSectionContext): string {
  return `You are building an email header mockup for internal design review at Raycon. Generate a complete, self-contained HTML document representing the header section only.

STYLE SPEC (extracted from approved Raycon headers — match this faithfully):
${JSON.stringify(ctx.spec, null, 2)}

COPY:
- Headline: "${ctx.headline}"
- Tagline: "${ctx.tagline}"${ctx.subTagline ? `\n- Sub-Tagline: "${ctx.subTagline}"` : ""}
- CTA button label: "${ctx.cta}"${ctx.offer ? `\n- Offer context (for background reference): ${ctx.offer}` : ""}

HERO IMAGE DIRECTION: "${ctx.heroImageDirection}"

ASSETS — use these exact placeholder strings as the src attribute values; they will be replaced with real data URIs server-side:
- Raycon logo img tag: src="RAYCON_LOGO_PLACEHOLDER"
- Product render img tag: ${ctx.hasProductImage ? 'src="PRODUCT_IMAGE_PLACEHOLDER"' : "no product image available — render a styled placeholder rectangle in the hero image zone, matching the hero background colour, no text label"}

REQUIREMENTS:
1. Output a complete HTML document from <!DOCTYPE html> to </html>.
2. Width: exactly 600px. No centering wrappers, no max-width, no margins.
3. All CSS in a single <style> block in the <head>. No inline style attributes except for truly one-off values.
4. No external resources: no CDN fonts, no external images, no Google Fonts, no external stylesheets.
5. Font stack: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif.
6. Structure: two zones stacked vertically:
   a. LOGO BAR (~48px tall): background from spec.logo_bar.bg. One <img> tag using RAYCON_LOGO_PLACEHOLDER as src, height 24px, aligned per spec.logo_bar.logo_alignment.
   b. HERO AREA: background colour from spec.hero.bg_color. If layout is "split", put the product image on the spec.hero.image_side side and the copy (headline, tagline, CTA) on the opposite side, each in a flex child. If layout is "full_bleed", overlay copy on top of the image. If layout is "stacked", stack copy above the image vertically.
7. Match spec colours exactly: headline, tagline, CTA button background and text.
8. CTA button shape: pill = border-radius matching spec.cta_button.border_radius; rounded = 8px; rectangle = 0px.
9. Font sizes and weights from the typography spec.
10. The product image zone: use object-fit: contain. Give it a natural aspect ratio — do not stretch or distort.
11. Body element: margin 0, padding 0, background matching spec.hero.bg_color.

OUTPUT: the first character must be <. No preamble, no code fences, no commentary after the closing </html>.`;
}
