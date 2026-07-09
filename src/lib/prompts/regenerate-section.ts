import type { ExpandedBrief, Conceit, SectionSpec, GeneratedSection, GeneratedCampaign, LibraryCampaign } from "../schemas";
import { SECTION_CATALOGUE } from "../schemas";
import { getProductName } from "../products";
import { RAYCON_VOICE } from "./voice";

export const regenerateSectionRoleInstruction = `Your job is to rewrite a single section of an email campaign. Only this one section changes; the rest of the campaign stays intact. You are given the full campaign for context and the current version of this section.

Why you are being called: the user wants a DIFFERENT and better option for this section. The rules below are in PRIORITY ORDER — when two pull against each other, the higher one wins.

1. USER STEERING IS THE TOP PRIORITY — above being different, above imitation, above your own instincts. When the user gives steering, your single most important job is to deliver EXACTLY what they asked for. Read the steering literally and do the specific thing it names:
   - If they ask for "punchy", make it short and high-impact — NOT urgent.
   - If they ask for copy that "makes it easier to decide to buy", reduce friction and lead with the clearest reason to act (a concrete benefit, the value, what they get) — do NOT reach for urgency, scarcity, or a deadline unless the steering explicitly asked for urgency.
   - If they ask for "more benefit-led", "warmer", "more confident", "clearer", deliver that exact register.
   DO NOT substitute a different persuasion strategy for the one requested. Urgency/scarcity/deadline framing is its OWN strategy — only use it when the steering literally asks for urgency. Swapping in urgency because it "feels persuasive" when the user asked for something else is the #1 failure of this step and is forbidden. Before you answer, restate to yourself what the steering literally asked for, then confirm your output does that specific thing and not a generic substitute.
2. Produce a genuinely different alternative from the current version, not a paraphrase. The current version is shown ONLY so you can avoid repeating it. Do not reuse its opening words, its sentence shape, or its cadence. If the current subheader is "Six products. One sale.", do not return "Six products. One deal." — that is the same move. Change the angle. (This is subordinate to steering: if steering points you somewhere specific, go there, even if it is closer to the current version than you would otherwise pick.)
3. The tone dial (Tone directive at the end) governs how far you push stylistically. At higher dials this section reads clearly bolder than the by-the-book version. (Tone governs STYLE/boldness; steering governs SUBSTANCE/strategy — honor both, but never let tone override what the steering asked for.)
4. "Fits the campaign" means it serves the same conceit and offer and stays factually consistent with the other sections. It does NOT mean copying their sentence cadence. A section can stand out in voice while still belonging to the same email.
5. Use the full campaign to choose the strongest alternative: what has already been said, what angle is still untapped, what this specific section can add that the others don't.

The Raycon voice governs this rewrite exactly as it governs the full campaign writer. It is the single source of truth for register and the hard bans:

${RAYCON_VOICE}

Mechanical caps (hold at every dial): Headline 2–4 words; Subheader max 6 words and returned as an array of 3 distinct options; Body Copy 2–4 short sentences; product one-liner 5–12 words, benefit-led, no offer mechanics; USP description about one sentence (a benefit line, may weave in the offer when the section features the sale — woven in, never tacked onto a spec); Hero Image Direction 30–50 words; Closing Line max 12 words. Use only reviews the user supplied in the brief (see hero_angle_verbatim); never pull sample reviews from the reference campaigns.

Imitation strictness scales with the tone dial (Tone directive at the END): at low dials, trace the single closest reference and adapt it closely; at higher dials, keep every hard ban but earn more freedom to leave the references behind. The references are the brand floor; the dial decides how far above it this section climbs. Match the energy the dial calls for, even if that makes this section more distinctive than the surrounding copy.`;

export function regenerateSectionUserPrompt(
  expandedBrief: ExpandedBrief,
  chosenConceit: Conceit,
  sectionToRegenerate: SectionSpec & { current_content: GeneratedSection },
  fullCampaign: GeneratedCampaign,
  steering: string,
  examples: LibraryCampaign[]
): string {
  const formatSection = (s: GeneratedSection) =>
    Object.entries(s.elements).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n");

  const targetId = sectionToRegenerate.current_content.id;

  // Render the whole campaign in order so the model has full context, with the
  // section being rewritten clearly marked as the target.
  const campaignContext = fullCampaign.sections.map((s, i) => {
    const marker = s.id === targetId ? "  <<< TARGET — this is the section you are rewriting" : "";
    return `[${i + 1}] type: ${s.type}${marker}\n${formatSection(s)}`;
  }).join("\n\n");

  const currentElements = formatSection(sectionToRegenerate.current_content);
  const elements = SECTION_CATALOGUE[sectionToRegenerate.type] ?? [];

  const productMapNote = sectionToRegenerate.type === "product_card" && sectionToRegenerate.product_slug
    ? `\n\nPRODUCT MAPPING — this card features: ${getProductName(sectionToRegenerate.product_slug)} (SKU ${sectionToRegenerate.product_slug}). Every element of the rewrite must be about this exact product and no other. The One-Liner leads with a concrete use-case framing — a scene, a need, an audience, or a moment that grounds the product — then follows with 2-3 specs. Do NOT default to "For the [audience] who [verbs]…" — that template has been overused; pick a different opener shape unless the campaign genuinely calls for it AND the other cards in this campaign use different openers.`
    : "";

  const exampleSummary = examples.slice(0, 3).map((e) => `${e.title} (${e.campaign_type}): ${e.conceit}`).join("\n");

  const hasSubheader = elements.includes("Subheader");
  const elemObj = elements.map((el) =>
    el === "Subheader"
      ? `    "Subheader": ["option 1", "option 2", "option 3"]`
      : `    "${el}": "..."`
  ).join(",\n");

  const subheaderNote = hasSubheader
    ? `\n\nSUBHEADER VARIANTS — this section has a Subheader. Return it as an array of EXACTLY 3 distinct options, not a single string. The 3 must take genuinely different angles (e.g. one benefit-led, one product/feature-led, one occasion/emotion-led) — not one idea reworded three times. Each option independently obeys the 6-word cap, every hard rule, and every banned-cadence rule, and each must honor the user steering. Order them strongest-first. If steering was given, all 3 options must reflect what the steering asked for, each in its own way.`
    : "";

  const uspsNote = sectionToRegenerate.type === "usps"
    ? `\n\nUSPS SECTION — the three USPs are a planned SET, not three interchangeable product specs. Build them so they pull different weight. Two valid ways (pick the one the steering and campaign call for):
(a) Divide the labour: e.g. USP 1 = a product benefit, USP 2 = the sale benefit (the actual offer expressed as a benefit, like "30% off your whole order through Sunday"), USP 3 = a TRUE brand/trust promise the data supports (e.g. guaranteed delivery by the order-by date) — never invent free shipping, free returns, or a warranty the data does not state; if none exists, make USP 3 a second distinct product or sale angle.
(b) Blend product + sale cohesively inside each USP, fused as one organic thought.
NON-NEGOTIABLE: when the offer appears in a USP, WEAVE it into the benefit — do NOT concatenate it onto the end of a product spec. The exact failure to avoid: a product-spec sentence with "...30% off with code PRIME" tacked on the end. Each USP must be distinct, organic, tight (about one sentence), and clean of gimmickry and banned cadence. Follow the "USPS section craft" in the brand context.`
    : "";

  const steeringBlock = steering.trim()
    ? `USER STEERING — THIS IS YOUR TOP PRIORITY. It outranks being different, imitation, and your own instincts. Read it literally and do the SPECIFIC thing it asks:
"${steering.trim()}"

Interpret this literally and deliver exactly that register or strategy. Do NOT substitute a different persuasion approach. In particular: do not reach for urgency, scarcity, countdowns, or deadline framing unless this steering explicitly asks for urgency — if it asks for "punchy", "easier to decide", "clearer", "more benefit-led", or "warmer", deliver THAT, not urgency. When the steering DOES ask for urgency, make it classy and honest per the "Urgency craft" in the brand context: anchor to the real deadline or occasion, vary the mechanism, stay confident not desperate, and never claim the deal is gone for good or "gone for the rest of the year" (Raycon runs recurring sales). Before finalizing, restate what the steering literally asked for and confirm your output does that specific thing.`
    : `No specific steering was given. Produce a meaningfully different and stronger alternative — a new angle, not a paraphrase of the current version.`;

  return `Expanded brief:
${JSON.stringify(expandedBrief, null, 2)}

Chosen conceit:
Name: ${chosenConceit.name}
Description: ${chosenConceit.description}

Full campaign as it currently reads (for context — do NOT rewrite these, only the TARGET):
${campaignContext}

The section to rewrite (TARGET), current version — provided ONLY so you avoid repeating it:
Type: ${sectionToRegenerate.type}
${currentElements}${productMapNote}${subheaderNote}${uspsNote}

${steeringBlock}

Reference campaigns (for voice):
${exampleSummary}

Rewrite ONLY the target section. Keep the same section type and the same element keys. Hard requirements:
- Honor the steering EXACTLY — this is the first thing to get right. If the steering named a feeling, register, or strategy, the output must deliver that specific thing, not a generic substitute (never swap the requested angle for urgency/scarcity unless urgency was asked for).
- It must be clearly different from the current version above — different opening, different cadence, different shape. Do not just swap a word ("deal" for "sale"). (Subordinate to steering: go where the steering points even if that lands nearer the current version.)
- Respect the tone dial for boldness/style.
- Stay true to the conceit and offer, and factually consistent with the other sections, but you do NOT have to copy their sentence cadence.
- Respect every length cap and brand invariant.${hasSubheader ? "\n- The Subheader must be an array of exactly 3 distinct options as described above." : ""}${sectionToRegenerate.type === "usps" ? "\n- Build the three USPs as a distinct set; if the offer belongs here, weave it into a benefit, never tack it onto a product spec (see USPS SECTION note above)." : ""}

Return JSON in this shape:

{
  "type": "${sectionToRegenerate.type}",
  "elements": {
${elemObj}
  }
}

Return only valid JSON.`;
}
