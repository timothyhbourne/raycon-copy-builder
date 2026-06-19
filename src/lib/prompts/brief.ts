import type { BriefInput } from "../schemas";
import { getProductName } from "../products";

export const briefRoleInstruction = `Your job in this step is to take a raw campaign brief and expand it into a structured brief that downstream prompts will use. Do not write any campaign copy yet.`;

export function briefUserPrompt(input: BriefInput): string {
  const sections = input.section_structure.map((s) => {
    const parts: string[] = [`- ${s.type}`];
    if (s.focus) parts.push(`: focus on "${s.focus}"`);
    if (s.type === "product_card" && s.product_slug) {
      parts.push(` — features ${getProductName(s.product_slug)} (${s.product_slug})`);
    }
    return parts.join("");
  }).join("\n");
  return `Raw brief:

Campaign name: ${input.campaign_name}
Campaign type: ${input.campaign_type}
Offer: ${input.offer}
Promo code: ${input.promo_code || "none"}
Audience: ${input.audience}
Hero angle (user wrote): ${input.hero_angle}
Featured products: ${input.products_featured.map((id) => `${getProductName(id)} (${id})`).join(", ") || "none specified"}
Campaign-specific rules: ${input.campaign_specific_rules || "none"}

Section structure the user wants:
${sections}

The offer field is the single source of truth for all discount and pricing information. Do not infer, round, or generalise it. If it specifies different discounts per product, preserve every product-specific figure exactly as written.

Expand this into a structured brief. Return JSON with exactly these fields:

- headline_thesis: one sentence summarising the campaign's core idea
- audience_mindset: 2-3 sentences on what the reader is thinking/feeling when they open this
- key_message: the single most important takeaway
- tonal_direction: 2-3 sentences on how the copy should feel
- structural_notes: a module-by-module blueprint the downstream copywriter will execute. Walk the section structure above in order. For each section, write one line: its job in the campaign arc (what it must accomplish) and how it hands off to the next section (what tension or thread it leaves open for the following module to pick up). The whole sequence should read as one build, not independent blocks — opening sets up the thesis, middle modules prove and deepen it, the close pays off the promise the headline made. If the offer contains different discounts per product, also list each product and its exact discount here so the copywriter applies the right figure to each product CTA. Structural rule: the email must lead with a single featured product above the fold — the one product the team most wants action on. Any product grid or multi-option section belongs below the fold, after the hero has established focus. Note this placement explicitly in the blueprint. Also instruct the copywriter to include a storefront link at the very bottom so readers who want to browse all options can self-select.
- rewritten_hero_angle: the user's hero angle, sharpened and elaborated. Keep their intent but make it crisper and more actionable for the downstream copywriter.

Return only valid JSON, no preamble.`;
}
