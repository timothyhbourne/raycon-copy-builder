import type { ExpandedBrief, Conceit, SectionSpec, GeneratedSection, GeneratedCampaign, LibraryCampaign } from "../schemas";
import { isProductCardType, sectionElementNames, uspSlotsOf } from "../schemas";
import { getProductName } from "../products";
import { getProductUsps, getCompanyUsps, formatUsp } from "../usps";
import { rayconVoice, hardRulesGate } from "./voice";

export const regenerateSectionRoleInstruction = `Your job is to rewrite a single section of an email campaign. Only this one section changes; the rest of the campaign stays intact. You are given the full campaign for context and the current version of this section.

Why you are being called: the user wants a DIFFERENT and better option for this section. The rules below are in PRIORITY ORDER , when two pull against each other, the higher one wins.

1. USER STEERING IS THE TOP PRIORITY , above being different, above imitation, above your own instincts. When the user gives steering, your single most important job is to deliver EXACTLY what they asked for. Read the steering literally and do the specific thing it names:
   - If they ask for "punchy", make it short and high-impact , NOT urgent.
   - If they ask for copy that "makes it easier to decide to buy", reduce friction and lead with the clearest reason to act (a concrete benefit, the value, what they get) , do NOT reach for urgency, scarcity, or a deadline unless the steering explicitly asked for urgency.
   - If they ask for "more benefit-led", "warmer", "more confident", "clearer", deliver that exact register.
   DO NOT substitute a different persuasion strategy for the one requested. Urgency/scarcity/deadline framing is its OWN strategy , only use it when the steering literally asks for urgency. Swapping in urgency because it "feels persuasive" when the user asked for something else is the #1 failure of this step and is forbidden. Before you answer, restate to yourself what the steering literally asked for, then confirm your output does that specific thing and not a generic substitute.
2. Produce a genuinely different alternative from the current version, not a paraphrase. The current version is shown ONLY so you can avoid repeating it. Do not reuse its opening words, its sentence shape, or its cadence. If the current subheader is "Six products. One sale.", do not return "Six products. One deal." , that is the same move. Change the angle. (This is subordinate to steering: if steering points you somewhere specific, go there, even if it is closer to the current version than you would otherwise pick.)
3. The tone dial (Tone directive at the end) governs how far you push stylistically. At higher dials this section reads clearly bolder than the by-the-book version. (Tone governs STYLE/boldness; steering governs SUBSTANCE/strategy , honor both, but never let tone override what the steering asked for.)
4. "Fits the campaign" means it serves the same conceit and offer and stays factually consistent with the other sections. It does NOT mean copying their sentence cadence. A section can stand out in voice while still belonging to the same email.
5. Use the full campaign to choose the strongest alternative: what has already been said, what angle is still untapped, what this specific section can add that the others don't.

The Raycon voice governs this rewrite exactly as it governs the full campaign writer:

${rayconVoice()}

One output-shape note: the Subheader element is returned as an array of 3 distinct options. Use only reviews the user supplied in the brief (see hero_angle_verbatim); never pull sample reviews from the reference campaigns.

Imitation strictness scales with the tone dial (Tone directive at the END): at low dials, trace the single closest reference and adapt it closely; at higher dials, keep every hard rule but earn more freedom to leave the references behind. The references are the brand floor; the dial decides how far above it this section climbs.

${hardRulesGate()}`;

export function regenerateSectionUserPrompt(
  expandedBrief: ExpandedBrief,
  chosenConceit: Conceit,
  sectionToRegenerate: SectionSpec & { current_content: GeneratedSection },
  fullCampaign: GeneratedCampaign,
  steering: string,
  examples: LibraryCampaign[],
  avoidBlock = ""
): string {
  const formatSection = (s: GeneratedSection) =>
    Object.entries(s.elements).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n");

  const targetId = sectionToRegenerate.current_content.id;

  // Render the whole campaign in order so the model has full context, with the
  // section being rewritten clearly marked as the target.
  const campaignContext = fullCampaign.sections.map((s, i) => {
    const marker = s.id === targetId ? "  <<< TARGET , this is the section you are rewriting" : "";
    return `[${i + 1}] type: ${s.type}${marker}\n${formatSection(s)}`;
  }).join("\n\n");

  const currentElements = formatSection(sectionToRegenerate.current_content);
  // The section's own element plan — USP slot count, opted-in optional elements
  // and switched-off removable ones all included, so a rewrite returns exactly
  // the keys the section actually has (no Subheader resurrected on a section the
  // user switched it off for). A bundle whose spec lost its template falls back
  // to the keys already on the rendered section.
  const elements = sectionToRegenerate.type === "bundle" && !sectionToRegenerate.bundle_template
    ? Object.keys(sectionToRegenerate.current_content.elements)
    : sectionElementNames(sectionToRegenerate);

  const productMapNote = isProductCardType(sectionToRegenerate.type) && sectionToRegenerate.product_slug
    ? `\n\nPRODUCT MAPPING , this card features: ${getProductName(sectionToRegenerate.product_slug)} (SKU ${sectionToRegenerate.product_slug}). Every element of the rewrite must be about this exact product and no other. The One-Liner leads with a concrete use-case framing , a scene, a need, an audience, or a moment that grounds the product , then follows with 2-3 specs. Do NOT default to "For the [audience] who [verbs]…" , that template has been overused; pick a different opener shape unless the campaign genuinely calls for it AND the other cards in this campaign use different openers.`
    : "";

  // A product_card_review carries a REAL customer review. Regeneration/variations
  // reword the copy but must keep that Review element exactly as-is.
  const reviewFixedNote = sectionToRegenerate.type === "product_card_review"
    ? `\n\nREVIEW IS FIXED , the "Review" element is a real customer review. Preserve it EXACTLY as it appears in the current version above. Never reword, replace, shorten, or invent it. Only rewrite the other elements (Subheader, One-Liner, etc.).`
    : "";

  const exampleSummary = examples.slice(0, 3).map((e) => `${e.title} (${e.campaign_type}): ${e.conceit}`).join("\n");

  const hasSubheader = elements.includes("Subheader");
  const elemObj = elements.map((el) =>
    el === "Subheader"
      ? `    "Subheader": ["option 1", "option 2", "option 3"]`
      : `    "${el}": "..."`
  ).join(",\n");

  const subheaderNote = hasSubheader
    ? `\n\nSUBHEADER VARIANTS , this section has a Subheader. Return it as an array of EXACTLY 3 distinct options, not a single string. The 3 must take genuinely different angles (e.g. one benefit-led, one product/feature-led, one occasion/emotion-led) , not one idea reworded three times. Each option independently obeys the Subheader cap in the HARD RULES gate, every hard rule, and every banned-cadence rule, and each must honor the user steering. Order them strongest-first. If steering was given, all 3 options must reflect what the steering asked for, each in its own way.`
    : "";

  // The USP slot plan drives this note. It replaces the old fixed "divide the
  // labour across three USPs" guidance: which USP sells a product and which sells
  // the brand is now an explicit per-slot decision the user made, and each slot
  // gets its own bank rather than the model guessing from the whole catalogue.
  // A section with no slot plan (a flow email, or a campaign saved before the USP
  // system and regenerated without re-expansion) keeps the original generic
  // guidance; anything with a plan gets the per-slot, bank-scoped version.
  const uspsLegacyNote = `\n\nUSPS SECTION , the USPs are a planned SET, not interchangeable product specs. Build them so they pull different weight. Two valid ways (pick the one the steering and campaign call for):
(a) Divide the labour: e.g. one USP is a product benefit, one is the sale benefit (the actual offer expressed as a benefit, like "30% off your whole order through Sunday"), one is a TRUE brand/trust promise the data supports , never invent free shipping, free returns, or a warranty the data does not state; if none exists, make it a second distinct product or sale angle.
(b) Blend product + sale cohesively inside each USP, fused as one organic thought.
NON-NEGOTIABLE: when the offer appears in a USP, WEAVE it into the benefit , do NOT concatenate it onto the end of a product spec. The exact failure to avoid: a product-spec sentence with "...30% off with code PRIME" tacked on the end. Each USP must be distinct, organic, tight (about one sentence), and clean of gimmickry and banned cadence.`;

  const uspsNote = sectionToRegenerate.type !== "usps"
    ? ""
    : !sectionToRegenerate.usp_slots?.length
    ? uspsLegacyNote
    : (() => {
        const slots = uspSlotsOf(sectionToRegenerate);
        const companyBank = getCompanyUsps();
        // Slots sharing a bank print it once; later ones point back at it.
        const emittedAt = new Map<string, number>();
        const plan = slots.map((slot, idx) => {
          const n = idx + 1;
          const focus = slot.focus?.trim() ? ` Focus for this USP: ${slot.focus.trim()}.` : "";
          if (slot.source === "company") {
            const seenAt = emittedAt.get("company");
            const bank = !companyBank.length
              ? `\n  (No company USP bank available , do NOT claim any shipping, returns, or warranty term.)`
              : seenAt
                ? `\n  Company USP bank: the same one listed under USP ${seenAt} above. Pick a DIFFERENT entry from it.`
                : `\n  Verified company USP bank , the ONLY sanctioned source for shipping, returns, warranty, and brand-proof claims:\n${companyBank.map((u) => `    ${formatUsp(u)}`).join("\n")}`;
            if (companyBank.length && !seenAt) emittedAt.set("company", n);
            return `USP ${n} , COMPANY USP. Draw from the verified company bank below, or express this campaign's offer as a benefit. Never invent shipping, returns, or warranty terms that are not listed.${focus}${bank}`;
          }
          if (!slot.product_slug) {
            return `USP ${n} , PRODUCT USP with no product bound. Write a benefit true of the campaign's subject without inventing a spec.${focus}`;
          }
          const name = getProductName(slot.product_slug);
          const bank = getProductUsps(slot.product_slug);
          if (!bank.length) {
            return `USP ${n} , PRODUCT USP for ${name} (SKU ${slot.product_slug}). No USP bank is recorded for this product; draw only on its product-catalogue entry and invent nothing.${focus}`;
          }
          const seenAt = emittedAt.get(slot.product_slug);
          if (seenAt) {
            return `USP ${n} , PRODUCT USP for ${name} (SKU ${slot.product_slug}). Same bank as USP ${seenAt} above , choose a DIFFERENT entry from it. It must be about this product and no other.${focus}`;
          }
          emittedAt.set(slot.product_slug, n);
          return `USP ${n} , PRODUCT USP for ${name} (SKU ${slot.product_slug}). It must be about this product and no other.${focus}\n  Available USPs for ${slot.product_slug} (draw from these only):\n${bank.map((u) => `    ${formatUsp(u)}`).join("\n")}`;
        }).join("\n");
        return `\n\nUSPS SECTION , these ${slots.length} USPs are a planned SET, not interchangeable product specs. Each slot below has its own source and its own bank. Rewrite every slot to its plan:
${plan}
NON-NEGOTIABLE for this section:
- Each USP must draw from a DIFFERENT bank entry. No two may restate the same benefit.
- A product USP must not reference any product other than the one bound to its slot.
- Offer mechanics belong ONLY in a company USP, and must be WOVEN into the benefit. The exact failure to avoid is a product-spec sentence with "...30% off with code PRIME" tacked on the end.
- The bank entries are source material, not finished copy: rewrite each in the voice, tight (about one sentence), clean of gimmickry and banned cadence.`;
      })();

  const steeringBlock = steering.trim()
    ? `USER STEERING , THIS IS YOUR TOP PRIORITY. It outranks being different, imitation, and your own instincts. Read it literally and do the SPECIFIC thing it asks:
"${steering.trim()}"

Interpret this literally and deliver exactly that register or strategy. Do NOT substitute a different persuasion approach. In particular: do not reach for urgency, scarcity, countdowns, or deadline framing unless this steering explicitly asks for urgency , if it asks for "punchy", "easier to decide", "clearer", "more benefit-led", or "warmer", deliver THAT, not urgency. When the steering DOES ask for urgency, make it classy and honest per the "Urgency craft" in the brand context: anchor to the real deadline or occasion, vary the mechanism, stay confident not desperate, and never claim the deal is gone for good or "gone for the rest of the year" (Raycon runs recurring sales). Before finalizing, restate what the steering literally asked for and confirm your output does that specific thing.`
    : `No specific steering was given. Produce a meaningfully different and stronger alternative , a new angle, not a paraphrase of the current version.`;

  return `Expanded brief:
${JSON.stringify(expandedBrief, null, 2)}

Chosen conceit:
Name: ${chosenConceit.name}
Description: ${chosenConceit.description}

Full campaign as it currently reads (for context , do NOT rewrite these, only the TARGET):
${campaignContext}

The section to rewrite (TARGET), current version , provided ONLY so you avoid repeating it:
Type: ${sectionToRegenerate.type}
${currentElements}${productMapNote}${reviewFixedNote}${subheaderNote}${uspsNote}

${steeringBlock}
${avoidBlock ? `\n${avoidBlock}\n` : ""}
Reference campaigns (for voice):
${exampleSummary}

Rewrite ONLY the target section. Keep the same section type and the same element keys. Hard requirements:
- Honor the steering EXACTLY , this is the first thing to get right. If the steering named a feeling, register, or strategy, the output must deliver that specific thing, not a generic substitute (never swap the requested angle for urgency/scarcity unless urgency was asked for).
- It must be clearly different from the current version above , different opening, different cadence, different shape. Do not just swap a word ("deal" for "sale"). (Subordinate to steering: go where the steering points even if that lands nearer the current version.)
- Respect the tone dial for boldness/style.
- Stay true to the conceit and offer, and factually consistent with the other sections, but you do NOT have to copy their sentence cadence.
- Respect every length cap and brand invariant.
- Return EXACTLY the element keys shown in the output shape below , every one of them, and no others. If "Subheader" or "CTA" is absent from that shape, this section does not have one; do not add it back.${hasSubheader ? "\n- The Subheader must be an array of exactly 3 distinct options as described above." : ""}${sectionToRegenerate.type === "usps" ? "\n- Build the USPs as a distinct set, each to its slot's source and bank; if the offer belongs here it goes in a company slot, woven into a benefit, never tacked onto a product spec (see USPS SECTION note above)." : ""}

Return JSON in this shape:

{
  "type": "${sectionToRegenerate.type}",
  "elements": {
${elemObj}
  }
}

Return only valid JSON.`;
}
