export function designSpecSystemPrompt(): string {
  return `You are a visual design analyst reviewing Raycon email marketing campaigns. You extract the visual design system from approved reference emails to create a reusable specification.`;
}

export function designSpecUserPrompt(): string {
  return `I'm showing you screenshots of approved Raycon email campaigns. Analyse the HEADER section only — the top portion of each email that includes: a narrow logo bar (Raycon wordmark on a dark background) and the hero area below it (product render, headline, offer/tagline text, and CTA button). Ignore everything below the header.

Synthesise a unified style specification across all the references. Where they vary, capture the dominant pattern.

Return a single JSON object with exactly this structure:

{
  "source_count": <integer — number of reference images you analysed>,
  "logo_bar": {
    "bg": "<hex colour>",
    "height_approx": "narrow (40-50px) | medium (60-80px)",
    "logo_alignment": "center | left"
  },
  "hero": {
    "bg_color": "<dominant hex background colour>",
    "layout": "split | full_bleed | stacked",
    "image_side": "left | right | background",
    "image_coverage_pct": <integer 0-100>,
    "copy_alignment": "left | center | right",
    "has_decorative_elements": <boolean>,
    "decorative_notes": "<brief description or empty string>"
  },
  "palette": {
    "headline_color": "<hex>",
    "tagline_color": "<hex>",
    "cta_bg": "<hex>",
    "cta_text": "<hex>"
  },
  "typography": {
    "headline_size": "<px value e.g. 32px>",
    "headline_weight": "<400|600|700|800>",
    "tagline_size": "<px value>",
    "tagline_weight": "<400|500>",
    "cta_size": "<px value>",
    "cta_weight": "<600|700>",
    "cta_uppercase": <boolean>
  },
  "cta_button": {
    "shape": "pill | rounded | rectangle",
    "border_radius": "<px value>",
    "min_width": "<px value>",
    "padding": "<CSS padding shorthand>"
  },
  "spacing": {
    "copy_padding": "<CSS shorthand for the hero copy zone padding>",
    "headline_mb": "<px margin below headline>",
    "tagline_mb": "<px margin below tagline>"
  },
  "observations": "<1-2 sentences describing the dominant visual pattern>"
}

Return only valid JSON. No preamble, no explanation.`;
}
