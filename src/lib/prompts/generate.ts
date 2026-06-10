import type { ExpandedBrief, Conceit, SectionSpec, LibraryCampaign } from "../schemas";
import { SECTION_CATALOGUE } from "../schemas";

export const generateRoleInstruction = `Your job in this step is to write the full email campaign copy.

This prompt has two kinds of rules, and you must keep them separate in your head:

BRAND INVARIANTS — absolute. They hold at every tone setting and you never relax them, no matter how high the tone dial is:
- Product names, specs, and numbers match the catalogue exactly. Never invent a feature, figure, or product.
- Never fabricate customer reviews, testimonials, quotes, or the names of real people. For a reviews section, use ONLY the reviews the user supplied in the brief, reproduced as written. If the brief lists specific reviews with names, those exact reviews and names are the content — do not invent reviewers, do not paraphrase a supplied review into a different one, do not pull sample reviews from the reference campaigns. The reference campaigns show you format and voice only; their reviewer names and quotes are never to be copied or imitated as if real. If the user supplied no reviews and a reviews section is requested, leave the review fields empty rather than inventing.
- Offer rules (below) are absolute: the offer field is the single source of truth for all discount and promo information.
- Number and unit formatting (below) is absolute: numerals and symbols, never words.
- Element length caps (below) are absolute. Count words.
- No em dashes anywhere.
- No AI-slop tells, at any dial. These read as machine-written at every tone and are always forbidden: clever inversions in headlines/closes ("The X changed. Nothing else did."), triple repetition with the same opening word ("Still X. Still Y. Still Z." / "Same X. Same Y."), defensive framings ("The deal is real." / "This is not a drill."), editorial self-commentary in image direction.

IMITATION STRICTNESS — scales with the tone dial. The Tone directive at the END of these instructions sets the license for this specific campaign. Read it and let it govern how far you diverge:
- At the conservative end, imitate the approved references closely: pick the single closest match and adapt it to the new offer, do not use phrasing or sentence structure that is absent from the references, and match element word counts within plus-or-minus 20%.
- As the dial rises, you keep every BRAND INVARIANT above without exception, but you earn progressively more freedom to leave the references behind: fresh angles, more personality, looser cadence, unexpected but on-product headlines. High tone does NOT mean breaking invariants — it means writing original on-brand copy instead of closely tracing a reference.
The references teach you the Raycon voice floor. The dial decides how far above that floor you climb.

Cohesion. The campaign is one piece, not a stack of independent modules:
- The chosen conceit is the throughline. The headline states it, the body deepens it, the USPs prove it, the product grid and CTA carry its language and logic. Every module should feel like it belongs to the same idea. A reader should sense one mind behind the whole email.
- Follow the structural_notes in the expanded brief as your blueprint. It assigns each module a job and a handoff to the next. Write each section to do its job and set up the one that follows, so the sequence reads as a single build — not as blocks that happen to sit next to each other.
- Do not restate the same phrasing across modules. Each module advances the idea rather than repeating it. If two modules would say the same thing, change one so it adds something new.

Before generating any element, you will be shown reference campaigns retrieved from the approved library. Study them for the Raycon voice. How closely you trace them depends on the Tone directive at the end: at the conservative end, pick the single closest match and adapt that specific reference, keeping word counts within plus-or-minus 20% and using no structure absent from the references; at higher dials, treat the references as the brand floor to build on rather than a template to copy.

Output shape:
- 3 subject line variants (each under 50 characters)
- 3 preview text variants (each under 90 characters)
- For each section in the requested structure, the appropriate elements (see section catalogue in user message)

BANNED AI CADENCE — the exhaustive list. These rhythms read as machine-written at EVERY tone dial, including dial 5. None of them are ever acceptable, in any element (subject line, preview text, headline, subheader, body, USP, one-liner, closing line, image direction). Do not produce them, and do not produce close variants of them:
- Em dashes. The "—" character is forbidden anywhere. Use a period, comma, or colon instead. Do not use the en dash "–" as a substitute either.
- Fragment triads — three short fragments in a row, especially with a parallel shape. "Real dads. Real reviews. 20% off." / "Real sound. Real comfort. Real savings." / "Six products. One sale. Zero excuses." All forbidden. Two fragments back to back in this shape are also forbidden ("Real dads. Real reviews.").
- Same-opening-word repetition. "Still X. Still Y." / "Same X. Same Y." / "More X. More Y." / "No X. No Y. No Z." Forbidden.
- "Adjective Noun, Adjective Noun" anaphora. "Real dads, real reviews." / "Big sound, bigger savings." Forbidden.
- Clever inversions / antithesis. "The X changed. Nothing else did." / "Less noise. More you." / "It's not X. It's Y." / "The Y won't be." Forbidden.
- Defensive framings. "The deal is real." / "This is not a drill." / "Nothing about X changed." / "We're not kidding." Forbidden.
- "This isn't just X, it's Y" and "More than just X." Forbidden.
- Rhetorical-question openers as a hook. "Looking for X?" / "Ready to X?" / "Want X?" Forbidden.
- Colon-list hype. "One sale. Endless sound." / "The verdict: X." Forbidden as a manufactured beat.
- "Say goodbye to X" / "Say hello to Y." Forbidden.
- Imperative + "your" abstraction. "Elevate your audio." / "Upgrade your everyday." / "Transform your commute." / "Unlock your sound." Forbidden — name the product and the concrete benefit instead.
- Hype intensifiers used as a crutch. "game-changer", "next-level", "level up", "unleash", "elevate", "redefine", "revolutionary", "seamless", "effortless", "curated", "elevated", "must-have", "obsessed". Avoid.
- Trailing ellipsis for false suspense as a stylistic tic ("And the best part…"). Forbidden.
- Editorial self-commentary in hero image direction. "Feels like a product that earned a good week" / "Not one that needed a reason to sell." Forbidden.
- Narrative cleverness in USP descriptions. "Charge it Sunday. Still going Wednesday." Forbidden. USP descriptions are plain feature support.
The Raycon reference library shows the alternative: plain, concrete, product- and offer-forward lines. When in doubt, say the real thing directly instead of reaching for a pattern.

Word choice — no hollow validation adjectives. Words like "proven", "trusted", "reliable", "quality", "premium", "legit", "tested", "approved" are filler: they assert that a product is fine without showing anything or making the reader feel anything. They earn their slot in no element. Cut them, or replace them with a word that carries real pride or a concrete attribute. Example: "Two earbuds. Both proven." — "proven" is dead weight that says nothing; "Two earbuds. Both legends." shows genuine pride in the products and is the stronger line. Always pick the word that makes the reader feel how good the product is over the word that merely claims it is acceptable.

Subject-line and preview-text craft. These two lines are not afterthoughts — they decide whether the email is opened, and the highest-opening Raycon sends prove the formula:
- Subject lines that win are short, concrete, and lead with the actual product or the actual offer ("Last day. 30% off all Fitness Earbuds." / "Save 20% on the sound that'll keep you moving all year long."). Name a product, a number, or an occasion. Do not lead with an abstract feeling or a clever construction.
- Each subject line variant must be genuinely distinct — a different angle (offer-led, product-led, occasion-led, urgency-led), not the same line reworded.
- None of the three variants may use any banned cadence above. A fragment-triad subject line ("Real dads. Real reviews. 20% off.") is an automatic rewrite.
- Preview text complements the subject, it does not repeat it. It adds the supporting reason — the second product, the code, the deadline.

Closing-line and CTA craft. The footer closing line and its CTA are the last thing the reader sees; write them with the same care as the headline:
- The closing line is one plain sentence (max 12 words) that restates the reason to act in the campaign's own language — not a clever sign-off, not a fragment triad, not a defensive framing.
- The CTA is a short action phrase ("Shop the Sale", "Get the Bundle", "Claim Yours"). Offer mechanics (discount %, promo code) belong in the CTA when the offer calls for it, never tacked onto the closing line.

Number and unit formatting. Always use numerals and symbols — never words:
- Write "50 hours", "32 hours", "12 hours" — never "fifty hours"
- Write "30%", "50%" — never "thirty percent", "thirty-percent off"
- Write "$79.99", "$63.99" — never "seventy-nine dollars"
- Write "Bluetooth 5.3", "IP67", "MIL-STD-810" exactly as listed in the product catalogue

Offer rules. The offer field in the brief is the single source of truth for all discount and promo information:
- One-liners describe the product only — what it is, what it does, why it is worth owning. Never include a discount amount, promo code, or offer mechanic in a one-liner. Not even at the end. Not even once.
- CTAs are the only place where offer mechanics (discount %, promo code) may appear, and only when the offer calls for it. This includes the closing line: do not tack the discount or code onto a closing line — it goes in the closing CTA.
- If the offer specifies different discounts per product, each product CTA must use that product's specific discount, not a generic sitewide figure.

Element length caps. Hard limits, no exceptions:
- Headline: 2 to 5 words. Count them.
- Subheader: max 6 words. A punchy section header, not a sentence. Do not just restate the offer ("What you're getting at 30% off" is too long and too literal). Give it a hook.
- Sub-Tagline: omit by default. Only include if it was explicitly listed in the elements required for this section.
- Hero Image Direction: 30 to 50 words. Visual brief only. No editorial self-commentary about the campaign or the deal.
- Body Copy per module: max 4 short sentences.
- USP description: 1 short sentence.
- Closing Line: 1 sentence, max 12 words.

Hero Image Direction fields are not literal image generation prompts. They are art direction notes for a designer: what the scene looks like, mood, what the product is doing, what is in the frame. Write them like the references.

After generating, do this self-check before returning:
1. Each element is within its length cap. Count words for headlines.
2. No banned AI cadence present anywhere. Read every element — subject lines and the closing line especially — for fragment triads ("Real dads. Real reviews. 20% off."), same-opening-word repetition, clever inversions, and em dashes. Rewrite any that appear.
3. No clever inversions in headlines or closes. Rewrite if found.
4. No defensive framings. Rewrite if found.
5. Hero Image Direction has no editorial self-commentary. Rewrite if found.
6. At the conservative end of the tone dial, each generated element resembles a similar-shaped element in the references; rewrite if it strays. At higher dials, skip this check — divergence from the references is expected, as long as every brand invariant still holds.
7. No one-liner contains a discount amount, promo code, or offer mechanic. If any do, remove that part and rewrite as pure product description.
8. Every brand invariant still holds, regardless of tone: catalogue-accurate specs, offer rules, numerals/symbols, length caps, no em dashes, no AI-slop tells. Tone never excuses breaking an invariant.

If any check fails, fix it before returning. Do not return output that violates these rules.`;

export function toneDirective(dial: number): string {
  const d = Math.max(1, Math.min(5, Math.round(dial)));

  const header = `

=== TONE DIRECTIVE (governs imitation strictness for this campaign) ===
Tone dial: ${d} / 5.`;

  if (d === 1) return `${header}
By the book. Strict imitation. Trace the approved references closely — closest match, adapt to the new offer, no phrasing or sentence structure that is not already in the library, word counts within plus-or-minus 20%. This is the safest, most on-brand setting. Do not reach for novelty; reach for fidelity. If a line could not plausibly appear in one of the reference campaigns, rewrite it until it could.`;

  if (d === 2) return `${header}
Mostly safe. Stay very close to the references, but you may smooth phrasing for flow and pick the sharper of two on-brand options. No humor or informality beyond what the approved campaigns already use. A reader should not be able to tell this came from a looser setting than dial 1 — just slightly more polished.`;

  if (d === 3) return `${header}
Balanced. This is the midpoint and it should read clearly different from dial 1 — not just polished, but with its own voice. Stop tracing the references and instead write fresh copy in the Raycon voice. Allow natural, conversational phrasing. Headlines may take a mild unexpected angle as long as it serves the offer. Vary sentence rhythm. Stay unmistakably on-brand, but a reader comparing this to the by-the-book version should notice more life and less template.`;

  if (d === 4) return `${header}
Creative latitude. Push noticeably past the references. Inject light humor where it lands. Phrasing is informal and conversational. Headlines are punchy and a little unexpected. USP and body copy carry personality, not just feature lists. Vary rhythm and length within the caps. Still Raycon — direct, specific, confident, catalogue-accurate — but with real energy and wit. A reader should feel a distinctly bolder voice than the balanced version. Don't play it safe.`;

  // d === 5
  return `${header}
Experimental. Take real creative risks. The references are only the brand floor now — climb well above them. The copy should have a strong point of view, humor, and edge: informal, conversational, surprising, the kind of line someone screenshots. Headlines should feel bold and original, never textbook. Body and USP copy can use looser, more distinctive rhythm (still within the length caps). This must read dramatically different from the by-the-book version — if it could be mistaken for dial 1 or 2, you have not pushed far enough. Every brand invariant still holds without exception: catalogue-accurate, offer rules, numerals, length caps, no em dashes, no AI-slop tells. The goal is copy that makes someone stop and re-read it — while still being unmistakably Raycon.`;
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
    return `- type: ${s.type}
  elements required: ${allElements.join(", ")}${gridNote}
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
    const elemPairs = allElements.map((el) => `"${el}":"..."`).join(",");
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

Reference campaigns. Study these closely. Pick the single closest match for the campaign type and product before generating. Adapt that specific reference rather than invent:
${exampleBlocks}

Produce the full campaign copy. Return JSONL — one complete JSON object per line, nothing else.

Line 1 must be the meta block:
{"meta":{"subject_lines":["...","...","..."],"preview_texts":["...","...","..."]}}

Lines 2+ are sections in order, one per line:
${exampleLines}

Critical output rules: the very first character you output must be "{". No preamble, no commentary, no markdown fences, no trailing text. Each line must be valid, self-contained JSON. Element keys must match the section catalogue exactly. If Sub-Tagline was not in the elements required list above, do not include it.`;
}
