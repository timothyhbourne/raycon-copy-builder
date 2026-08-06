import type { ExpandedBrief, Conceit, SectionSpec, LibraryCampaign } from "../schemas";
import { isProductCardType, sectionElementNames, uspSlotsOf } from "../schemas";
import { getProductName } from "../products";
import { getProductUsps, getCompanyUsps, formatUsp } from "../usps";
import { getBundle } from "../bundles";
import { rayconVoice, hardRulesGate } from "./voice";
import { playbookBlock } from "./playbooks";

export const generateRoleInstruction = `Your job in this step is to write the full email campaign copy.

${rayconVoice()}

Campaign angle. The chosen conceit is the campaign's angle: an occasion, a product truth, or a customer moment, expressed in plain retail language. Let it shape the headline and body naturally. Do not force it into every module, and never treat it as a literary theme to develop. Each module's first job is to sell clearly.

Email structure hierarchy. Single-product-led emails convert faster than emails that open with multiple options , a clean hero module focused on the one product the team most wants action on moves readers down the funnel before they have to make a choice. Follow this hierarchy:
- Lead above the fold with a single featured product, not a grid or multi-option layout.
- Other products or options belong below the fold, after the hero has landed.
- If the campaign is part of a multi-send sale series, save the multi-option or product-grid treatment for the second send. The first send earns attention on one thing; the second can broaden.
- At the very bottom of the email, include a link to the storefront so readers who want to browse all options can find their own way.
If a product_grid or multi-option section appears before the hero in the requested structure, write the hero module first and push the grid below it regardless of the section order specified , single-product focus above the fold is the higher-priority rule.

Cohesion across sections. You are writing ONE email, not a stack of independent modules. You have every section in view as you write, so treat them as a single arc: each section should be aware of what the ones before it already said and add something new rather than restate it. A later section may deliberately build on, answer, or call back to an earlier one to make the whole email read as a connected piece , this is encouraged, not a violation of the "don't repeat" rule (callbacks that advance the argument are cohesion; saying the same thing twice is repetition). When a section's focus note asks it to reference or follow on from another section (e.g. "tie back to the body", "pay off the header's promise", "reference section 1"), honor that literally: read what that other section says and write this one so the two connect.

Bundle sections. A bundle section sells a COMBINATION of products as one offer. The Bundle Name and Subheader lead with the bundle as a whole (the combined value, the occasion, or the shared use-case) , never list two product names in the Bundle Name or Subheader (the individual products get their own allocated lines: USPs, items, or add-ons per the section's layout note). Each per-product line stays true to that exact catalogue product. Sell why the pieces belong together, not just each piece on its own.

Element craft. LENGTH CAPS ARE NOT RESTATED HERE , every cap lives once, in the Length caps table of the HARD RULES gate at the end of this prompt. Obey that table; if anything here seems to imply a different number, the table wins.
- Headline: the HOOK, within the Headline cap. Draft one candidate per headline pattern in the voice (idiom remix, product-truth pun, rhyme/parallel, bold claim , 4 minimum), pick the strongest. Never a discount number, promo code, or urgency tag; the offer lives in the tagline.
- Tagline: ONE line, within the Tagline cap. The plain PAYOFF of the headline's hook: it states the offer and what it covers, naming products per the count rule in the HARD RULES gate (1 → name it; 2 → both exact names; 3+ → characterful category or "sitewide"). A light wink at most; never a code, an urgency tag, or a counting construction.
- Headline and Tagline are a PAIR, not two independent elements. The headline carries the play, the tagline answers it with the deal, and the two read as ONE thought said out loud: "Summer Just Got Louder" + "20% off sitewide" is one thought; two playful lines in a row is two hooks and no payoff.
- Never list two or more product names in a Headline, Tagline, or Subheader. In a multi-product sale (combo, bundle, sitewide) the hero leads with the OFFER or the OCCASION; the individual products get their own cards below the fold. A single-product send may name that one product.
- Subheader: a benefit FRAGMENT within the Subheader cap, per the shipped reference #8 register ("A battery that keeps you going") , the spec proof belongs in the supporting line below, never inside the subheader. Where a section's required-elements list includes a Subheader, this element is an array of EXACTLY 3 distinct options (see output shape) , each a genuinely different angle (one benefit-led, one product/feature-led, one occasion/emotion-led), each within the cap and clean of every hard ban, ordered strongest-first. Offer mechanics ("30% off. Closes tonight.") are never a subheader , the offer already lives in the tagline, CTA, and body. All other elements are single strings.
- Body copy per module: 2-4 short sentences in the voice. May restate the offer or code at the end.
- One-liners: 5-12 words, benefit-led and plain, per the voice rules. Never any offer mechanics.
- Review (product_card_review only): a REAL customer review supplied to you below. Use it VERBATIM (you may trim length only), never reword, summarize, or invent one. It may end with an attribution like "… — Jordan M." — KEEP that reviewer name exactly; never add, change, or invent a name. If no review was supplied for the card's product, leave the Review element empty (empty string). Never fabricate a review.
- CTAs: 2-4 word action phrases (4 words MAX). A discount phrase belongs here ("Get 30% Off", "Shop the Sale"), but the promo CODE never does , codes live in body copy, a callout, or the tagline, never in a CTA (no "Get 30% off, code COMBO30"). Never put a product name inside a CTA , the surrounding section already names what the reader is shopping for.
- Closing line: one plain sentence, max 12 words.

Subject lines and preview texts. Produce THREE of each, distinct in rhythm and opening word, each within the caps (subject lines under 50 characters, preview texts under 90). Assign by slot:
1. DIRECT , the offer stated plainly, at the offer's TRUE scope. Single-product sale: "Fitness Earbuds: 30% off ends tonight." Multi-product sale: name the category or the count, never just one product ("30% off our top earbuds and headphones." / "Three of our best, all 30% off.").
2. FRIENDLY / PLAYFUL , warm and human; the one light pun may live here if it comes easily.
3. CONVERSATIONAL / CURIOSITY , sounds like a real person; opens a small gap without shouting the discount.
At tone dial 4 or 5, slots 2 and 3 draw on the approved dial 4-5 example register in the voice, not just a softened slot 1.
A preview text complements its paired subject line (adds the code, the deadline, the second product, or the human reason); it never just repeats it.

References. Study the reference campaigns for register and rhythm. At low tone dials, stay close to the closest match; at higher dials, write fresh copy in the same voice.

Number and unit formatting. Always use numerals and symbols, never words: "56 hours" not "fifty-six hours", "30%" not "thirty percent", "$79.99" not "seventy-nine dollars", "Bluetooth 5.3" / "IPX7" exactly as the catalogue lists them.

Final pass. One output-shape requirement not covered by the gate: every Subheader element is a JSON array of 3 genuinely distinct options, strongest first. Everything else (length caps, banned words and structures, offer integrity, catalogue accuracy) is governed by the HARD RULES: FINAL GATE at the very end of this prompt. Run that gate against your draft and fix anything that fails before returning.`;

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
Fresh copy in the Raycon voice. Natural, conversational, warm. No tracing, no straining , write the friendly-salesperson version of this email.`;

  if (d === 4) return `${header}
Personality on. Playful headlines built from the four headline patterns, one pun or turn of phrase where it comes easily; taglines stay the plain payoff of the hook (a light wink at most). Draw on the shipped reference set in the voice for register. Every hard ban stays intact.`;

  // d === 5
  return `${header}
Maximum personality within the bans, concentrated in the headline. Wordplay, light metaphor, an editorial turn where it earns its place; the tagline still answers the hook with the deal, plainly. The shipped reference set IS the register: match its wit level, no further. Clever that needs a second read is a fail, not a flex.`;
}

// Render the ordered section list injected into a generation prompt: per section
// its required elements, grid/product/review/bundle notes, and the user's focus.
// Shared by the campaign brain (generateUserPrompt) and the flow brain
// (src/lib/prompts/flows.ts) so both drive the SAME output shape — which is what
// lets the client stream parser and the canvas render either unchanged.
/** Optional per-call context for the USPs section. */
export interface SectionListOpts {
  /** The live promotion, as one line ("30% off sitewide, code GOALS, ends Thursday
   * night"). Injected into COMPANY-sourced USP slots only, so the offer can be
   * expressed as a benefit there and never gets tacked onto a product spec. */
  offerContext?: string;
  /** USP lines already sent for a product SKU (and under the "company" key), from
   * the constructions recency index. A soft preference to draw on a bank entry
   * these did not already cover — never a hard block. */
  recentUspsBySlug?: Record<string, string[]>;
}

/**
 * Per-slot instructions for a `usps` section, with each slot's bank injected and
 * NOTHING else. This is the fix for the core bug: a usps section previously had no
 * product binding at all, so the model picked features out of whichever product it
 * had last seen in the wholesale catalogue blob.
 */
function uspSectionNote(s: SectionSpec, opts: SectionListOpts): string {
  const slots = uspSlotsOf(s);
  const companyBank = getCompanyUsps();
  // Two slots bound to the same product (or two company slots) share one bank —
  // print it once and point later slots at it rather than repeating hundreds of
  // tokens. Maps a bank key to the USP number that already carries it.
  const emittedAt = new Map<string, number>();

  const slotLines = slots.map((slot, idx) => {
    const n = idx + 1;
    const focus = slot.focus?.trim() ? `\n    focus for this USP (from the user): ${slot.focus.trim()}` : "";

    if (slot.source === "company") {
      const seenAt = emittedAt.get("company");
      const bank = !companyBank.length
        ? `\n    (No company USP bank is available. Do NOT claim any shipping, returns, or warranty term.)`
        : seenAt
          ? `\n    Company USP bank: the same one listed under USP ${seenAt} above. Pick a DIFFERENT entry from it.`
          : `\n    Verified company USP bank , the ONLY sanctioned source for shipping, returns, warranty, and brand-proof claims:\n${companyBank.map((u) => `      ${formatUsp(u)}`).join("\n")}`;
      if (companyBank.length && !seenAt) emittedAt.set("company", n);
      const offer = opts.offerContext?.trim()
        ? `\n    Live offer for this campaign: ${opts.offerContext.trim()}`
        : "";
      const recent = seenAt ? [] : (opts.recentUspsBySlug?.company ?? []).slice(0, 6);
      const recentLine = recent.length
        ? `\n    Company USPs used in recent sends (prefer a different entry): ${recent.map((r) => `"${r}"`).join("; ")}`
        : "";
      return `  USP ${n} , COMPANY USP. Draw from the verified company bank below and/or express the live offer as a benefit. Never invent shipping terms, returns terms, warranty length, or certifications that are not listed here.${focus}${bank}${offer}${recentLine}`;
    }

    if (!slot.product_slug) {
      return `  USP ${n} , PRODUCT USP, but no product is bound to this slot and no featured product was selected. Write a benefit that is true of the campaign's subject without naming a specific product spec.${focus}`;
    }
    const name = getProductName(slot.product_slug);
    const bank = getProductUsps(slot.product_slug);
    if (!bank.length) {
      return `  USP ${n} , PRODUCT USP for ${name} (SKU ${slot.product_slug}). No USP bank is recorded for this product, so write a benefit drawn ONLY from this product's entry in the product catalogue. Invent nothing.${focus}`;
    }
    const seenAt = emittedAt.get(slot.product_slug);
    if (seenAt) {
      return `  USP ${n} , PRODUCT USP for ${name} (SKU ${slot.product_slug}). Same bank as USP ${seenAt} above , choose a DIFFERENT entry from it. This USP must be about this product and no other.${focus}`;
    }
    emittedAt.set(slot.product_slug, n);
    const recent = (opts.recentUspsBySlug?.[slot.product_slug] ?? []).slice(0, 6);
    const recentLine = recent.length
      ? `\n    USPs already sent for this product (prefer a bank entry these did not cover): ${recent.map((r) => `"${r}"`).join("; ")}`
      : "";
    return `  USP ${n} , PRODUCT USP for ${name} (SKU ${slot.product_slug}). Choose the single strongest unused benefit from this product's USP bank below and write it in Raycon voice. This USP must be about this product and no other.${focus}
    Available USPs for ${slot.product_slug} (draw from these only):
${bank.map((u) => `      ${formatUsp(u)}`).join("\n")}${recentLine}`;
  });

  return `\n${slotLines.join("\n")}
  USP rules for this section:
    - Each USP must draw from a DIFFERENT bank entry. No two USPs may restate the same benefit.
    - A product USP must not reference any product other than the one bound to its slot.
    - Offer mechanics belong ONLY in a company USP, woven INTO the benefit. Never tack a discount or code onto the end of a product spec.
    - The bank entries are source material, not finished copy. Rewrite each in the voice; never paste a bank line verbatim.`;
}

export function buildSectionList(
  sectionStructure: SectionSpec[],
  reviewsBySlug: Record<string, string[]> = {},
  opts: SectionListOpts = {}
): string {
  return sectionStructure.map((s, i) => {
    const isBundle = s.type === "bundle";
    const bundleProducts = s.bundle_products ?? [];
    const bundleTemplate = s.bundle_template ?? "unified";
    // Single source of truth: honours the bundle template, the USP slot count,
    // opted-in optional elements, and switched-off removable elements.
    const allElements = sectionElementNames(s);
    // Only sections carrying an explicit slot plan get per-slot instructions.
    // Campaigns always do (expandUspSections writes one before generation); FLOWS
    // never run through that expansion and have no featured products, so they keep
    // the original free-form USPs behaviour rather than being told "no product is
    // bound to this slot" three times.
    const uspNote = s.type === "usps" && s.usp_slots?.length ? uspSectionNote(s, opts) : "";
    const bundleNote = isBundle ? (() => {
      const names = bundleProducts.map(getProductName);
      const existing = s.bundle_mode === "existing" ? getBundle(s.bundle_id) : undefined;
      const nameLine = existing
        ? `This is Raycon's existing "${existing.name}" bundle${existing.price ? ` (bundle price $${existing.price})` : ""}. Use that exact name in the Bundle Name element.`
        : `This is a CUSTOM bundle. Coin a short, appealing bundle name for the Bundle Name element (never a promo code or a fake product name).`;
      const allocation =
        bundleTemplate === "unified"
          ? `Layout , unified card: write ONE USP per product, in order (${names.map((n, idx) => `USP ${idx + 1} = ${n}`).join("; ")}). Each USP leads with that product's standout benefit; together they make the bundle read as greater than the sum.`
          : bundleTemplate === "checklist"
          ? `Layout , what's-inside checklist: write ONE item line per product, in order (${names.map((n, idx) => `Item ${idx + 1} = ${n}`).join("; ")}), each the product name plus a short one-liner. Value Line anchors the combined value or saving of buying them together${existing?.price ? ` (bundle price $${existing.price})` : ""}.`
          : bundleTemplate === "pairing"
          ? `Layout , better-together pairing of ${names.join(" + ")}: Pairing Line = how these specific products complete each other in real use; Combined Benefit = the payoff of owning both. Narrative, not a spec list.`
          : `Layout , hero + add-ons: the hero is ${names[0] ?? "the first product"} (Hero Line sells it). The rest are add-ons, in order (${names.slice(1).map((n, idx) => `Add-On ${idx + 1} = ${n}`).join("; ") || "none"}). Bundle Offer states the combined deal.`;
      return `\n  bundle products: ${names.join(", ") || "(none chosen)"}\n  ${nameLine}\n  ${allocation}`;
    })() : "";
    const gridNote = s.type === "product_grid"
      ? `\n  grid layout: ${s.grid_cols ?? 2} columns × ${s.grid_rows ?? 2} rows = ${(s.grid_cols ?? 2) * (s.grid_rows ?? 2)} products total (Products array must have exactly this many entries)`
      : "";
    const productNote = isProductCardType(s.type) && s.product_slug
      ? `\n  product to feature in this card: ${getProductName(s.product_slug)} (SKU ${s.product_slug}) , the Product Name element MUST be exactly "${getProductName(s.product_slug)}" (copy it verbatim from the catalogue; never coin a variant like "Everyday Pro Earbuds" or append words). One-Liner and every element must be about this product and no other.`
      : "";
    const suppliedReview = s.type === "product_card_review" && s.product_slug
      ? (reviewsBySlug[s.product_slug]?.[0] ?? "").trim()
      : "";
    const reviewNote = s.type === "product_card_review"
      ? (suppliedReview
          ? `\n  Review element: use this REAL customer review VERBATIM (trim length only, never reword or invent): "${suppliedReview}"`
          : `\n  Review element: no real review was supplied for this product , leave "Review" as an empty string. Never write or invent a review.`)
      : "";
    return `- section ${i + 1} , type: ${s.type}
  elements required: ${allElements.join(", ")}${gridNote}${productNote}${reviewNote}${bundleNote}${uspNote}
  focus (optional steering from user , may reference another section by number, e.g. "build on section 1"): ${s.focus || "none"}`;
  }).join("\n");
}

// Per-section JSONL shape examples (one skeleton line per section, in order),
// so the model returns exactly the lines the client parser expects. Shared by
// both brains for the same reason as buildSectionList.
export function buildSectionExampleLines(sectionStructure: SectionSpec[]): string {
  return sectionStructure.map((s) => {
    if (s.type === "product_grid") {
      const cols = s.grid_cols ?? 2;
      const rows = s.grid_rows ?? 2;
      const count = cols * rows;
      const products = Array.from({ length: count }, () =>
        `{"name":"...","image_direction":"...","one_liner":"...","cta":"..."}`
      ).join(",");
      return `{"type":"product_grid","elements":{"Subheader":"...","Products":[${products}]}}`;
    }
    // Same derivation as buildSectionList, so the skeleton can never disagree with
    // the required-elements list (a removed Subheader is absent from BOTH).
    const elemPairs = sectionElementNames(s).map((el) =>
      el === "Subheader"
        ? `"Subheader":["option 1","option 2","option 3"]`
        : `"${el}":"..."`
    ).join(",");
    return `{"type":"${s.type}","elements":{${elemPairs}}}`;
  }).join("\n");
}

export function generateUserPrompt(
  expandedBrief: ExpandedBrief,
  chosenConceit: Conceit,
  sectionStructure: SectionSpec[],
  examples: LibraryCampaign[],
  avoidBlock = "",
  /** Real reviews supplied per product SKU (best-first), used VERBATIM for the
   * Review element of product_card_review cards. Populated by the generate route
   * (see reviews service). Empty when none were found — never invent one. */
  reviewsBySlug: Record<string, string[]> = {},
  /** Offer + USP-recency context for `usps` sections (see SectionListOpts). */
  uspOpts: SectionListOpts = {}
): string {
  const sectionList = buildSectionList(sectionStructure, reviewsBySlug, uspOpts);

  const exampleBlocks = examples.map((e) => `---
${e.title} (${e.date}, ${e.campaign_type})
Conceit: ${e.conceit}

${e.body}
---`).join("\n");

  // Build per-section JSONL shape examples
  const exampleLines = buildSectionExampleLines(sectionStructure);

  const verbatimParts: string[] = [];
  if (expandedBrief.hero_angle_verbatim?.trim()) {
    verbatimParts.push(`Hero angle / hook (exactly as the user wrote it):\n${expandedBrief.hero_angle_verbatim.trim()}`);
  }
  if (expandedBrief.campaign_specific_rules?.trim()) {
    verbatimParts.push(`Campaign-specific rules (the user's, follow exactly):\n${expandedBrief.campaign_specific_rules.trim()}`);
  }
  const archLine =
    chosenConceit.architecture === "offer_led" ? "Architecture: offer-led , the deal is the through-line; state it early and let sections reinforce it."
    : chosenConceit.architecture === "story_led" ? "Architecture: story-led , hold the offer until the narrative has landed."
    : chosenConceit.architecture === "product_truth_led" ? "Architecture: product-truth-led , one concrete product truth anchors every section; the offer supports it."
    : "";
  const verbatimBlock = verbatimParts.length
    ? `\nUSER'S LITERAL INSTRUCTIONS , these outrank the references and your own invention. If they name specific reviews, quotes, people, products, or exact copy, use those EXACTLY and do not substitute your own:\n${verbatimParts.join("\n\n")}\n`
    : "";

  return `Expanded brief:
${JSON.stringify(expandedBrief, null, 2)}
${verbatimBlock}
Chosen conceit:
Name: ${chosenConceit.name}
Description: ${chosenConceit.description}${archLine ? `\n${archLine}` : ""}

${playbookBlock(expandedBrief.campaign_type)}
This send type has a defined job and shape , let it govern pacing and structure. It never overrides the voice rules or the user's literal instructions.
${avoidBlock ? `\n${avoidBlock}\n` : ""}
Section structure to produce (in order):
${sectionList}

Reference campaigns , recent or similar past Raycon sends. Study them for register and rhythm. At low tone dials, stay close to the closest match; at higher dials, write fresh copy in the same voice.
${exampleBlocks}

${expandedBrief.deadline_language ? `DEADLINE LANGUAGE: the sale ends ${expandedBrief.deadline_language}. Use this exact time frame everywhere a deadline is named. "Tonight"/"today" are FORBIDDEN unless the supplied phrase is "tonight".

` : ""}${hardRulesGate()}

Produce the full campaign copy. Return JSONL, one complete JSON object per line, nothing else.

Line 1 must be the meta block:
{"meta":{"subject_lines":["...","...","..."],"preview_texts":["...","...","..."]}}

Lines 2+ are sections in order, one per line:
${exampleLines}

Critical output rules: the very first character you output must be "{". No preamble, no commentary, no markdown fences, no trailing text. Each line must be valid, self-contained JSON. Element keys must match that section's "elements required" list above EXACTLY , produce every element listed there and NO element that is absent from it. A section whose list omits "Subheader" or "CTA" must not contain that key at all; do not helpfully add one back. If Sub-Tagline was not in the elements required list above, do not include it. Wherever "Subheader" IS in a section's required list it must be a JSON array of EXACTLY 3 distinct option strings (see the Subheader variants rule) , never a single string. All other elements are single strings.

COMPLETENESS REQUIREMENT , read carefully. The section structure above lists ${sectionStructure.length} section${sectionStructure.length === 1 ? "" : "s"}. Your output must contain exactly ${sectionStructure.length + 1} JSON lines in total: the meta block, then one line per section, in the order listed, every section included. If the same section type appears multiple times (e.g. three product_card sections in a row), you must produce a separate JSON line for EACH one , do not collapse, merge, or skip any of them, even when their content looks similar. Do not stop early because the email "feels done." The output is incomplete unless every section in the list above has its own line. Before you finish, count your output lines and confirm there are ${sectionStructure.length + 1}.`;
}
