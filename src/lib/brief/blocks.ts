import type { AudienceType, Angle, SendStage, CampaignType } from "../schemas";

// Curated building blocks for the deterministic brief compiler. Written ONCE,
// well, and reused so output stays consistent. They obey the Raycon voice and
// hard rules (no clichés, no banned phrases, no em dashes). The compiler
// (compile.ts) interpolates the `{slot}` placeholders; blocks here never call an
// LLM. Edit these to change the compiled brief, not the generator.

// What the reader is thinking on open, per audience. One tight paragraph each.
// Drawn from the audience/flow tone notes in data/brand-voice.md.
export const AUDIENCE_MINDSET: Record<AudienceType, string> = {
  all: "A general Raycon reader opening a marketing email with mild curiosity, not deep loyalty. Earn attention fast with one concrete reason to look, and keep the read easy and friendly.",
  engaged: "An active, recent opener who already likes Raycon. They respond to specifics and a clear next step, so lead with the concrete thing and respect that they already know the brand.",
  lapsed: "Someone who has not engaged in a while. Open warm and low pressure, lead with what is genuinely new or better, and let any offer feel like a fresh reason to look rather than a guilt trip.",
  post_purchase: "A recent buyer. Reinforce that they chose well and add value (a tip, a companion product), with no urgency and no pressure to buy again right away.",
  vip: "A loyal, high-value customer. Speak to them as an insider who already trusts the product, reward that with early or exclusive framing, and skip the basics.",
};

// How each angle shapes the arc. `product_led` maps to the generator's
// `product_truth_led` architecture (see compile.ts).
export const ANGLE_DIRECTIVE: Record<Angle, string> = {
  offer_led: "The deal is the through-line. State the offer plainly and early, and let every section reinforce it. The reader should always know the deal and the deadline.",
  product_led: "One concrete product truth anchors every section. Lead with what the product does for the reader's day, back it with a spec or two, and let the offer support the product rather than the other way around.",
  story_led: "Hold the offer until the idea has landed. Open on the moment or thought, build it through the body, and let the product arrive as the natural conclusion.",
  occasion_led: "The moment leads. Name the occasion first, bridge from it to the products that fit, and bring the offer and dates in to close.",
};

// How the send stage sets pacing + urgency.
export const STAGE_DIRECTIVE: Record<SendStage, string> = {
  launch: "This is the announce send. Lead with what is new or the reason to look, favoring curiosity and clarity over pressure. Urgency stays light (Tier 1 to 2); mention the deadline once, if at all.",
  reminder: "This re-surfaces the value mid-window. Restate the core benefit and the offer once, add one fresh benefit, and keep a steady Tier 2 nudge toward the deadline.",
  last_call: "This is the deadline send. Lead with the real end time and make the closing window unmistakable (Tier 3). Name the actual deadline plainly; never imply false permanence.",
};

export interface BriefTemplate {
  headline_thesis: string;   // one-sentence core idea (slots interpolated)
  key_message: string;       // the single takeaway
  tonal_direction: string;   // how it should feel
  structural_notes: string;  // scaffold intro; compile.ts appends the section walk
}

// Per-campaign-type slotted templates. Slots: {offer} {code} {occasion}
// {subject} {deadline} {hero_product} {products} {dates} {stage}.
//   {subject}  — the occasion, else the campaign name. ALWAYS non-empty, so use
//                it as a leading noun (avoids "Mother's Day Sale sale").
//   {deadline} — the end date alone (what a last-call counts down to);
//                {dates} is the full range.
// Unfilled slots are stripped by the compiler so a blank never surfaces.
export const BRIEF_TEMPLATES: Record<CampaignType, BriefTemplate> = {
  promo: {
    headline_thesis: "{subject}: the deal is the reason to open. {offer}.",
    key_message: "{offer}. Act before {deadline}.",
    tonal_direction: "Confident and plain. The deal is the star, stated proudly and kept warm, never pushy.",
    structural_notes: "Offer-first build. Lead above the fold with {hero_product} and the deal; keep any product grid or multi-option block below the fold.",
  },
  launch: {
    headline_thesis: "Introduce {hero_product} and the one promise it delivers; desire first, discount second.",
    key_message: "{hero_product} is here and it is worth wanting on its own terms.",
    tonal_direction: "Excited but grounded. Sell the promise with concrete specifics, and let any offer stay secondary to the product.",
    structural_notes: "Story-first build. Hero names {hero_product} and its big promise; body explains why it exists; USPs prove it; one product card. Any offer waits until after the story.",
  },
  restock: {
    headline_thesis: "{hero_product} is back because it sold out; lead with proof, not panic.",
    key_message: "It is back, and it is popular for a reason. Grab it before it goes again.",
    tonal_direction: "Assured and factual. Popularity is stated as fact, urgency is real but calm.",
    structural_notes: "Popularity-first build. Hero announces the return; body leans on reputation and any supplied reviews; single product focus; close on availability as fact.",
  },
  story: {
    headline_thesis: "{subject} gives the reader something worth reading; sell {hero_product} gently.",
    key_message: "The idea carries the email; the product is the natural landing.",
    tonal_direction: "Editorial and warm. Let the idea breathe; the sell is soft and earned.",
    structural_notes: "Editorial build. The conceit carries the header and the longest body of any type; {hero_product} enters as the conclusion; offer only in the footer if at all.",
  },
  seasonal: {
    headline_thesis: "Connect {subject} to the products that fit it, closing on {offer}.",
    key_message: "{subject} is the reason; {hero_product} and the rest are the fit.",
    tonal_direction: "Warm and timely. The moment leads, the products follow, the offer closes.",
    structural_notes: "Occasion-first build. Hero names {subject}; body bridges to the products that fit; grid or cards; offer and {dates} close it out.",
  },
  winback: {
    headline_thesis: "Reopen the relationship warmly around {hero_product}; no guilt.",
    key_message: "Something is new or better since you left, and the offer is a welcome-back.",
    tonal_direction: "Warm and human, never guilt or we-miss-you clichés. Low pressure, one clear step.",
    structural_notes: "Welcome-first build. Warm human open; body leads with what is new or improved; the offer lands as a welcome-back gesture; one clear CTA.",
  },
  newsletter: {
    headline_thesis: "Inform first around {subject}; sell {hero_product} lightly.",
    key_message: "Useful first; the product is woven in, not pitched.",
    tonal_direction: "Briefing tone. Informative and friendly; product mentions are woven in, no hard offer blocks.",
    structural_notes: "Multi-topic build. Sectioned like a briefing, each section standalone; product mentions woven in; storefront link at the end.",
  },
};
