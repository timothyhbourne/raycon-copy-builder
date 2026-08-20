import type {
  ExpandedBrief, Conceit, SectionSpec, GeneratedSection, GeneratedCampaign, LibraryCampaign,
} from "../schemas";
import { isProductCardType, uspSlotsOf, sectionElementNames } from "../schemas";
import { getProductName } from "../products";
import { getProductUsps, getCompanyUsps, formatUsp } from "../usps";
import { isReviewElement, elementReturnsVariants, elementReturnsHeadlineSlate, parseGridItemKey } from "../element-families";
import { rayconVoice, hardRulesGate } from "./voice";

// Re-exported so server code can keep importing them from the prompt module; the
// definitions live in element-families.ts because that file is client-safe.
export { isReviewElement, elementReturnsVariants, elementReturnsHeadlineSlate, parseGridItemKey };

/**
 * Rewrite ONE element of a section.
 *
 * The whole risk of a per-element call is losing the cohesion that the
 * section-wide rewrite gets for free: asked for a subheader in isolation, a model
 * will happily restate the line directly above it. So this prompt always carries
 * the section's other elements AND the full campaign, with an explicit
 * don't-restate instruction, and it names the element's own craft rules.
 */

const productLine = (spec: SectionSpec | undefined): string =>
  spec?.product_slug ? `${getProductName(spec.product_slug)} (SKU ${spec.product_slug})` : "the featured product";

/**
 * The craft rules for this specific element. Length caps are NOT restated — they
 * live once in the HARD RULES gate's table, which is appended below.
 */
function elementCraftNote(
  key: string,
  section: GeneratedSection,
  spec: SectionSpec | undefined,
  offerContext: string
): string {
  const grid = parseGridItemKey(key);
  if (grid) {
    switch (grid.field) {
      case "one_liner":
        return `This is the one-liner for product ${grid.index + 1} in the grid. 5 to 12 words, benefit-led and plain, about that product only. Never any offer mechanics.`;
      case "name":
        return `This is the product NAME for grid item ${grid.index + 1}. It must be an exact Raycon catalogue product name, copied verbatim. Never coin a variant.`;
      case "cta":
        return `This is the CTA for grid item ${grid.index + 1}. A 2 to 4 word action phrase. Never a promo code, never a product name.`;
      case "image_direction":
        return `This is art direction for grid item ${grid.index + 1}: a short, concrete description of the shot. Not customer-facing copy.`;
    }
  }

  const uspMatch = key.match(/^USP (\d+)$/);
  if (uspMatch && section.type === "usps") {
    const slot = uspSlotsOf(spec ?? { usp_slots: undefined })[Number(uspMatch[1]) - 1];
    // A USP added on the canvas has no slot in the spec — default it to a product
    // slot on the bound/hero product, per USP_SYSTEM_SPEC §5.3.
    const source = slot?.source ?? "product";
    if (source === "company") {
      const bank = getCompanyUsps();
      return `This is a COMPANY USP. Draw from the verified company bank below, or express the live offer as a benefit. Never invent shipping terms, returns terms, warranty length, or certifications that are not listed.
${bank.length ? `Verified company USP bank (the ONLY sanctioned source for shipping, returns, warranty, and brand-proof claims):\n${bank.map((u) => `  ${formatUsp(u)}`).join("\n")}` : "(No company USP bank available , do NOT claim any shipping, returns, or warranty term.)"}${offerContext ? `\nLive offer for this campaign: ${offerContext}` : ""}
Weave any offer mechanics INTO the benefit; never append them to a spec.`;
    }
    const slug = slot?.product_slug ?? spec?.product_slug;
    const bank = slug ? getProductUsps(slug) : [];
    return `This is a PRODUCT USP for ${slug ? `${getProductName(slug)} (SKU ${slug})` : "the featured product"}. It must be about that product and no other, and must NOT carry offer mechanics.
${bank.length ? `Draw from this product's USP bank only:\n${bank.map((u) => `  ${formatUsp(u)}`).join("\n")}\nPick an entry the section's other USPs do not already cover, and rewrite it in the voice , never paste a bank line verbatim.` : "No USP bank is recorded for this product; draw only on its product-catalogue entry and invent nothing."}`;
  }

  if (key === "Subheader") {
    return `Return EXACTLY 3 distinct Subheader options, strongest first. Each is a benefit FRAGMENT, each takes a genuinely different angle (one benefit-led, one product/feature-led, one occasion/emotion-led), and each independently obeys the Subheader cap and every hard rule. Spec proof belongs in the supporting line below, never inside the subheader. Offer mechanics are never a subheader.`;
  }
  if (key === "Headline") {
    const hasTagline = typeof section.elements["Tagline"] === "string";
    return `The HOOK. Return a SLATE of EXACTLY 4 candidates, one per named headline pattern (idiom_remix, product_truth, rhyme, bold_claim), each labelled with its pattern${hasTagline ? ` and each carrying the Tagline that pays IT off (the pair is one thought, so a candidate written as a rhyme needs the tagline written for that rhyme)` : ""}. Four patterns means four genuinely different constructions, not four rewordings. The test is LEAST PREDICTABLE, not "strongest": discard any candidate a competitor could have written for a different product, any that states the obvious benefit flatly, and any that is the first phrase the offer suggests. Never a discount number, promo code, or urgency tag , the offer lives in the tagline.`;
  }
  if (key === "Tagline") {
    return `ONE line: the plain PAYOFF of the headline's hook. It states the offer and what it covers, naming products per the count rule in the gate. A light wink at most; never a code, an urgency tag, or a counting construction. It must read as one thought with the Headline above.`;
  }
  if (key === "Sub-Tagline") {
    return `A short supporting line under the tagline. Adds a concrete reason to act that the tagline did not already state.`;
  }
  if (key === "CTA") {
    return `A 2 to 4 word action phrase (4 words MAX). A discount phrase is allowed ("Get 30% Off"), but never the promo CODE, and never a product name.`;
  }
  if (key === "Closing Line") {
    return `One plain sentence, 12 words max, that lands the email.`;
  }
  if (key === "Body Copy" || key === "Body") {
    return `2 to 4 short sentences in the voice. May restate the offer or code at the end. Advance the argument , do not re-say the header.`;
  }
  if (key === "One-Liner") {
    return `5 to 12 words, benefit-led and plain, about ${productLine(spec)} and no other product. Never any offer mechanics. Lead with a concrete use-case framing , a scene, a need, an audience, or a moment , then the spec. Do NOT default to "For the [audience] who [verbs]…".`;
  }
  if (key === "Product Name") {
    return `The exact Raycon catalogue name for ${productLine(spec)}, copied verbatim. Never coin a variant or append words.`;
  }
  if (key === "Bundle Name") {
    return `A short, appealing name for the bundle as a whole. Never a promo code, never a fake product name, never a roll-call of two product names.`;
  }
  if (/^Item \d+$/.test(key)) {
    return `One "what's inside" line for that bundle product: the product name plus a short one-liner.`;
  }
  if (/^Add-On \d+$/.test(key)) {
    return `One add-on line for that bundle product: why it complements the hero.`;
  }
  if (key === "Value Line") {
    return `Anchor the combined value or saving of buying the bundle together.`;
  }
  if (key === "Hero Line") {
    return `Sell the bundle's hero product in one line.`;
  }
  if (key === "Pairing Line" || key === "Combined Benefit") {
    return `Narrative, not a spec list: how these specific products complete each other and the payoff of owning both.`;
  }
  return `Rewrite this element in the Raycon voice, true to its role in the section.`;
}

export const regenerateElementRoleInstruction = `Your job is to rewrite ONE named element inside one section of an email campaign. Nothing else changes.

${rayconVoice()}

How to do this well:
1. USER STEERING IS THE TOP PRIORITY when given. Read it literally and deliver that specific thing. Do not substitute a different persuasion strategy , in particular, never reach for urgency, scarcity, or a deadline unless the steering explicitly asks for urgency.
2. Produce a genuinely DIFFERENT line from the current one. The current value is shown only so you can avoid repeating it: change the angle, the opening, and the cadence, not just a word.
3. STAY IN THE SECTION. You are given every other element of this section and the whole campaign. The new line must be consistent with them and must NOT restate what a neighbouring element already says. If the subheader above already says "a battery that keeps going", the body must not open on battery life. This is the single most important difference between rewriting one element and rewriting a whole section.
4. Obey the element's own craft rules (given in the request) and every hard rule.

${hardRulesGate()}`;

export function regenerateElementUserPrompt(args: {
  elementKey: string;
  section: GeneratedSection;
  sectionSpec?: SectionSpec;
  fullCampaign: GeneratedCampaign;
  expandedBrief: ExpandedBrief;
  chosenConceit: Conceit;
  steering?: string;
  examples?: LibraryCampaign[];
  avoidBlock?: string;
  offerContext?: string;
}): string {
  const {
    elementKey, section, sectionSpec, fullCampaign, expandedBrief, chosenConceit,
    steering = "", examples = [], avoidBlock = "", offerContext = "",
  } = args;

  const fmt = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));
  const currentValue = fmt(section.elements[elementKey] ?? "");

  // Sibling elements — the don't-restate context.
  const siblings = Object.entries(section.elements)
    .filter(([k]) => k !== elementKey)
    .map(([k, v]) => `  ${k}: ${fmt(v)}`)
    .join("\n") || "  (this section has no other elements)";

  // The rest of the campaign, compact.
  const campaignContext = fullCampaign.sections.map((s, i) => {
    const marker = s.id === section.id ? "  <<< the section containing your target element" : "";
    const body = Object.entries(s.elements)
      .map(([k, v]) => `    ${k}: ${fmt(v)}`)
      .join("\n");
    return `[${i + 1}] ${s.type}${marker}\n${body}`;
  }).join("\n\n");

  const craft = elementCraftNote(elementKey, section, sectionSpec, offerContext);
  const wantsVariants = elementReturnsVariants(elementKey);
  const wantsHeadlineSlate = elementReturnsHeadlineSlate(elementKey);
  const headlineHasTagline = wantsHeadlineSlate && typeof section.elements["Tagline"] === "string";

  const steeringBlock = steering.trim()
    ? `USER STEERING , THIS IS YOUR TOP PRIORITY. Read it literally and do the SPECIFIC thing it asks:
"${steering.trim()}"
Do NOT substitute a different approach. Only use urgency/scarcity/deadline framing if the steering explicitly asks for urgency.`
    : `No steering was given. Produce a meaningfully different and stronger alternative , a new angle, not a paraphrase of the current value.`;

  const exampleSummary = examples.slice(0, 3)
    .map((e) => `${e.title} (${e.campaign_type}): ${e.conceit}`)
    .join("\n");

  const productNote = isProductCardType(section.type) && sectionSpec?.product_slug
    ? `\nThis section is a product card for ${productLine(sectionSpec)}. Every word must be about that product and no other.`
    : "";

  const expectedElements = sectionSpec ? sectionElementNames(sectionSpec) : Object.keys(section.elements);

  return `Campaign brief:
${JSON.stringify(expandedBrief, null, 2)}

Conceit: ${chosenConceit.name} , ${chosenConceit.description}

The full campaign as it currently reads (context , do NOT rewrite any of it):
${campaignContext}

=== YOUR TARGET ===
Element to rewrite: "${elementKey}"
It lives in the "${section.type}" section${productNote}
That section's elements are: ${expectedElements.join(", ")}

Current value of "${elementKey}" (shown ONLY so you avoid repeating it):
${currentValue || "(empty , this element has no copy yet, so write it fresh)"}

The other elements of this same section , your new line must be consistent with these and must NOT restate them:
${siblings}

Craft rules for "${elementKey}":
${craft}

${steeringBlock}
${avoidBlock ? `\n${avoidBlock}\n` : ""}${exampleSummary ? `Reference campaigns (for voice only):\n${exampleSummary}\n` : ""}
${expandedBrief.deadline_language ? `DEADLINE LANGUAGE: the sale ends ${expandedBrief.deadline_language}. Use this exact time frame anywhere a deadline is named. "Tonight"/"today" are FORBIDDEN unless the supplied phrase is "tonight".\n` : ""}
Return ONLY valid JSON, nothing else, in exactly this shape:
${wantsHeadlineSlate
  ? `{"headline_variants":[${["idiom_remix", "product_truth", "rhyme", "bold_claim"]
      .map((p) => `{"pattern":"${p}","text":"the headline"${headlineHasTagline ? `,"tagline":"the tagline that pays it off"` : ""}}`)
      .join(",")}]}`
  : wantsVariants
    ? `{"variants":["option 1","option 2","option 3"]}`
    : `{"value":"the rewritten ${elementKey}"}`}

Rules for your output: the very first character must be "{". No preamble, no commentary, no markdown fences. Rewrite ONLY "${elementKey}" , do not return any other element.${wantsVariants ? " The variants array must hold EXACTLY 3 distinct options." : ""}${wantsHeadlineSlate ? " The headline_variants array must hold EXACTLY 4 candidates, one per pattern, in the order shown." : ""}`;
}
