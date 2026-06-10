import type { ExpandedBrief, Conceit, SectionSpec, GeneratedSection, GeneratedCampaign, LibraryCampaign } from "../schemas";
import { SECTION_CATALOGUE } from "../schemas";

export const regenerateSectionRoleInstruction = `Your job is to rewrite a single section of an email campaign. Only this one section changes; the rest of the campaign stays intact. You are given the full campaign for context and the current version of this section.

Why you are being called: the user wants a DIFFERENT and better option for this section. So:
- Produce a genuinely different alternative, not a paraphrase. The current version is shown ONLY so you can avoid repeating it. Do not reuse its opening words, its sentence shape, or its cadence. If the current subheader is "Six products. One sale.", do not return "Six products. One deal." or "X products, one code" — that is the same move. Change the angle.
- User steering, when provided, is the primary directive. Follow it directly and concretely. It outranks your default instinct to play it safe. If steering asks for a specific feeling, angle, or emphasis, deliver exactly that.
- The tone dial (Tone directive at the end) governs how far you push. At higher dials this section should read clearly bolder and more distinctive than the by-the-book version, even if the rest of the campaign is tamer.
- "Fits the campaign" means it serves the same conceit and offer and stays factually consistent with the other sections. It does NOT mean copying their sentence cadence. A section can stand out in voice while still belonging to the same email. Do not flatten your output to match the rhythm of the neighbors.
- Use the full campaign to choose the strongest possible alternative: what has already been said, what angle is still untapped, what this specific section can add that the others don't.

This prompt has two kinds of rules, the same as the full campaign writer:

BRAND INVARIANTS — absolute. They hold at every tone setting and you never relax them:
- Product names, specs, and numbers match the catalogue exactly. Never invent a feature, figure, or product.
- Never fabricate customer reviews, testimonials, quotes, or real people's names. Use ONLY reviews the user supplied in the brief (see hero_angle_verbatim), reproduced as written. Never invent reviewers or pull sample reviews from the reference campaigns.
- The offer field in the brief is the single source of truth for discount and promo information. One-liners describe the product only (no discount/promo/mechanic); offer mechanics appear only in CTAs.
- Numerals and symbols, never words ("30%" not "thirty percent", "32 hours" not "thirty-two hours").
- Length caps: Headline 2 to 5 words; Subheader max 6 words (a hook, not a sentence, do not just restate the offer); Hero Image Direction 30 to 50 words; Body Copy max 4 short sentences; USP description 1 short sentence; Closing Line max 12 words.
- No em dashes anywhere.
- No hollow validation adjectives. Words like "proven", "trusted", "reliable", "quality", "premium", "tested" are filler that assert a product is fine without showing anything. Cut them or swap in a word with real pride or a concrete attribute. "Two earbuds. Both proven." is weak ("proven" says nothing); "Two earbuds. Both legends." shows pride and is stronger.
- No AI-slop tells, at any dial: clever inversions ("The X changed. Nothing else did."), triple repetition with the same opening word ("Still X. Still Y." / "Same X. Same Y."), defensive framings ("The deal is real." / "This is not a drill."), editorial self-commentary in Hero Image Direction.

IMITATION STRICTNESS — scales with the tone dial. The Tone directive at the END of these instructions sets the license for this regeneration. At the conservative end, pick the single closest matching reference and adapt it closely, matching word counts within plus-or-minus 20% and using no structure absent from the references. As the dial rises, keep every BRAND INVARIANT but earn more freedom to leave the references behind: fresh angles, more personality, looser cadence. The references are the brand floor; the dial decides how far above it this section climbs. Match the energy the dial calls for, even if that makes this section more distinctive than the surrounding copy.`;

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

  const exampleSummary = examples.slice(0, 3).map((e) => `${e.title} (${e.campaign_type}): ${e.conceit}`).join("\n");

  const elemObj = elements.map((el) => `    "${el}": "..."`).join(",\n");

  const steeringBlock = steering.trim()
    ? `USER STEERING — this is your primary directive. Follow it directly and concretely, it outranks playing it safe:
"${steering.trim()}"`
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
${currentElements}

${steeringBlock}

Reference campaigns (for voice):
${exampleSummary}

Rewrite ONLY the target section. Keep the same section type and the same element keys. Hard requirements:
- It must be clearly different from the current version above — different opening, different cadence, different shape. Do not just swap a word ("deal" for "sale", "code" for "deal").
- Honor the steering and the tone dial.
- Stay true to the conceit and offer, and factually consistent with the other sections, but you do NOT have to copy their sentence cadence.
- Respect every length cap and brand invariant.

Return JSON in this shape:

{
  "type": "${sectionToRegenerate.type}",
  "elements": {
${elemObj}
  }
}

Return only valid JSON.`;
}
