import type { ExpandedBrief, Conceit, SectionSpec, LibraryCampaign } from "../schemas";
import { SECTION_CATALOGUE } from "../schemas";
import { getProductName } from "../products";
import { RAYCON_VOICE } from "./voice";

export const generateRoleInstruction = `Your job in this step is to write the full email campaign copy.

${RAYCON_VOICE}

Campaign angle. The chosen conceit is the campaign's angle: an occasion, a product truth, or a customer moment, expressed in plain retail language. Let it shape the headline and body naturally. Do not force it into every module, and never treat it as a literary theme to develop. Each module's first job is to sell clearly.

Email structure hierarchy. Single-product-led emails convert faster than emails that open with multiple options — a clean hero module focused on the one product the team most wants action on moves readers down the funnel before they have to make a choice. Follow this hierarchy:
- Lead above the fold with a single featured product, not a grid or multi-option layout.
- Other products or options belong below the fold, after the hero has landed.
- If the campaign is part of a multi-send sale series, save the multi-option or product-grid treatment for the second send. The first send earns attention on one thing; the second can broaden.
- At the very bottom of the email, include a link to the storefront so readers who want to browse all options can find their own way.
If a product_grid or multi-option section appears before the hero in the requested structure, write the hero module first and push the grid below it regardless of the section order specified — single-product focus above the fold is the higher-priority rule.

Element craft.
- Headline: 2–4 words, warm and plain.
- Tagline: one sentence, max 12 words. States the offer OR the promise, not both layered together.
- Subheader: max 6 words. This element is an array of EXACTLY 3 distinct options (see output shape) — each a genuinely different angle (one benefit-led, one product/feature-led, one occasion/emotion-led), each within the cap and clean of every hard ban, ordered strongest-first. All other elements are single strings.
- Body copy per module: 2–4 short sentences in the voice. May restate the offer or code at the end.
- One-liners: 5–12 words, benefit-led and plain, per the voice rules. Never any offer mechanics.
- CTAs: 2–4 word action phrases. Offer mechanics belong here ("Get 30% Off", "Shop the Sale"). Never put a product name inside a CTA — the surrounding section already names what the reader is shopping for.
- Hero Image Direction: 30–50 words of art-direction notes for a designer (scene, mood, what the product is doing, what is in frame). No editorial commentary about the campaign or the deal.
- Closing line: one plain sentence, max 12 words.

Subject lines and preview texts. Produce THREE of each, distinct in rhythm and opening word, each within the caps (subject lines under 50 characters, preview texts under 90). Assign by slot:
1. DIRECT — the offer or product, stated plainly ("Fitness Earbuds: 30% off ends tonight.").
2. FRIENDLY / PLAYFUL — warm and human; the one light pun may live here if it comes easily.
3. CONVERSATIONAL / CURIOSITY — sounds like a real person; opens a small gap without shouting the discount.
A preview text complements its paired subject line (adds the code, the deadline, the second product, or the human reason); it never just repeats it.

References. Study the reference campaigns for register and rhythm. At low tone dials, stay close to the closest match; at higher dials, write fresh copy in the same voice.

Number and unit formatting. Always use numerals and symbols, never words: "56 hours" not "fifty-six hours", "30%" not "thirty percent", "$79.99" not "seventy-nine dollars", "Bluetooth 5.3" / "IPX7" exactly as the catalogue lists them.

Final pass. Before returning, check four gates and fix anything that fails:
(a) Length caps hold, and every Subheader is an array of 3 genuinely distinct options, strongest first.
(b) Every hard ban in the voice rules holds: no em/en dashes, no tension or paradox constructs, no personified objects or body parts, no hype intensifiers, no more than one parallel-fragment pair.
(c) Offer integrity: mechanics live in CTAs, taglines, and body copy only, never in a product one-liner; per-product discounts are exact; the stated scope is honest (a sitewide sale never reads as only-the-featured-products).
(d) Catalogue accuracy: product names, specs, and numbers match the catalogue exactly; no invented feature, figure, review, or person.

If any check fails, fix it before returning. Do not return output that violates these rules.`;

export function toneDirective(dial: number): string {
  const d = Math.max(1, Math.min(5, Math.round(dial)));

  const header = `

=== TONE DIRECTIVE (scales playfulness + distance from the references; never the register) ===
Tone dial: ${d} / 5.`;

  if (d === 1) return `${header}
Trace the closest reference closely and adapt it to the new offer. Use no phrasing that is absent from the references. This is the safest, most on-brand setting.`;

  if (d === 2) return `${header}
Stay close to the references; smooth phrasing for flow and pick the sharper of two on-brand options. Just slightly more polished than dial 1, never looser in voice.`;

  if (d === 3) return `${header}
Fresh copy in the Raycon voice. Natural, conversational, warm. No tracing, no straining — write the friendly-salesperson version of this email.`;

  if (d === 4) return `${header}
More personality: playful headlines and a lighter touch, and the one allowed pun is welcome here. Still plainly a friendly retail email, and every hard ban stays intact.`;

  // d === 5
  return `${header}
Maximum warmth and play WITHIN the same register: the punniest, most personality-forward version of a friendly Raycon email. Dial 5 is NOT license for literary devices, tension or paradox constructs, edginess, or "screenshot-worthy" originality — those violate the voice at every dial. It is the difference between a cheerful salesperson and a very charming cheerful salesperson.`;
}

export function generateUserPrompt(
  expandedBrief: ExpandedBrief,
  chosenConceit: Conceit,
  sectionStructure: SectionSpec[],
  examples: LibraryCampaign[]
): string {
  const sectionList = sectionStructure.map((s) => {
    const baseElements = SECTION_CATALOGUE[s.type] ?? [];
    const optionalAdded = s.optional_elements ?? [];
    const allElements = [...baseElements, ...optionalAdded];
    const gridNote = s.type === "product_grid"
      ? `\n  grid layout: ${s.grid_cols ?? 2} columns × ${s.grid_rows ?? 2} rows = ${(s.grid_cols ?? 2) * (s.grid_rows ?? 2)} products total (Products array must have exactly this many entries)`
      : "";
    const productNote = s.type === "product_card" && s.product_slug
      ? `\n  product to feature in this card: ${getProductName(s.product_slug)} (SKU ${s.product_slug}) — Product Name must be this exact product, One-Liner must be about this product, every element must be about this product and no other`
      : "";
    return `- type: ${s.type}
  elements required: ${allElements.join(", ")}${gridNote}${productNote}
  focus (optional steering from user): ${s.focus || "none"}`;
  }).join("\n");

  const exampleBlocks = examples.map((e) => `---
${e.title} (${e.date}, ${e.campaign_type})
Conceit: ${e.conceit}

${e.body}
---`).join("\n");

  // Build per-section JSONL shape examples
  const exampleLines = sectionStructure.map((s) => {
    if (s.type === "product_grid") {
      const cols = s.grid_cols ?? 2;
      const rows = s.grid_rows ?? 2;
      const count = cols * rows;
      const products = Array.from({ length: count }, () =>
        `{"name":"...","image_direction":"...","one_liner":"...","cta":"..."}`
      ).join(",");
      return `{"type":"product_grid","elements":{"Subheader":"...","Products":[${products}]}}`;
    }
    const baseElements = SECTION_CATALOGUE[s.type] ?? [];
    const optionalAdded = s.optional_elements ?? [];
    const allElements = [...baseElements, ...optionalAdded];
    const elemPairs = allElements.map((el) =>
      el === "Subheader"
        ? `"Subheader":["option 1","option 2","option 3"]`
        : `"${el}":"..."`
    ).join(",");
    return `{"type":"${s.type}","elements":{${elemPairs}}}`;
  }).join("\n");

  const verbatimParts: string[] = [];
  if (expandedBrief.hero_angle_verbatim?.trim()) {
    verbatimParts.push(`Hero angle / hook (exactly as the user wrote it):\n${expandedBrief.hero_angle_verbatim.trim()}`);
  }
  if (expandedBrief.campaign_specific_rules?.trim()) {
    verbatimParts.push(`Campaign-specific rules (the user's, follow exactly):\n${expandedBrief.campaign_specific_rules.trim()}`);
  }
  const verbatimBlock = verbatimParts.length
    ? `\nUSER'S LITERAL INSTRUCTIONS — these outrank the references and your own invention. If they name specific reviews, quotes, people, products, or exact copy, use those EXACTLY and do not substitute your own:\n${verbatimParts.join("\n\n")}\n`
    : "";

  return `Expanded brief:
${JSON.stringify(expandedBrief, null, 2)}
${verbatimBlock}
Chosen conceit:
Name: ${chosenConceit.name}
Description: ${chosenConceit.description}

Section structure to produce (in order):
${sectionList}

Reference campaigns — recent or similar past Raycon sends. Study them for register and rhythm. At low tone dials, stay close to the closest match; at higher dials, write fresh copy in the same voice.
${exampleBlocks}

Produce the full campaign copy. Return JSONL — one complete JSON object per line, nothing else.

Line 1 must be the meta block:
{"meta":{"subject_lines":["...","...","..."],"preview_texts":["...","...","..."]}}

Lines 2+ are sections in order, one per line:
${exampleLines}

Critical output rules: the very first character you output must be "{". No preamble, no commentary, no markdown fences, no trailing text. Each line must be valid, self-contained JSON. Element keys must match the section catalogue exactly. If Sub-Tagline was not in the elements required list above, do not include it. The "Subheader" element, wherever it appears, must be a JSON array of EXACTLY 3 distinct option strings (see the Subheader variants rule) — never a single string. All other elements are single strings.

COMPLETENESS REQUIREMENT — read carefully. The section structure above lists ${sectionStructure.length} section${sectionStructure.length === 1 ? "" : "s"}. Your output must contain exactly ${sectionStructure.length + 1} JSON lines in total: the meta block, then one line per section, in the order listed, every section included. If the same section type appears multiple times (e.g. three product_card sections in a row), you must produce a separate JSON line for EACH one — do not collapse, merge, or skip any of them, even when their content looks similar. Do not stop early because the email "feels done." The output is incomplete unless every section in the list above has its own line. Before you finish, count your output lines and confirm there are ${sectionStructure.length + 1}.`;
}
