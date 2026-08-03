import type { FlowType, SectionSpec, SectionType } from "./schemas";

// Client-safe flow scaffolding data. Lives apart from src/lib/prompts/flows.ts
// (the flow BRAIN) because the brain transitively imports data.ts → `fs`, which
// can't be bundled into a client component. Both the brain (server) and the flow
// builder page (client) import FLOW_PLAYBOOKS + scaffoldSections from HERE. This
// is the sibling of PLAYBOOKS (campaigns) in src/lib/prompts/playbooks.ts —
// strategy/structure only; it never duplicates the brand voice or the rules.

// A default section in a flow email's scaffold (subset of SectionSpec — no id
// until scaffolded). Mirrors PlaybookSection in prompts/playbooks.ts.
export interface FlowPlaybookSection {
  type: SectionType;
  focus?: string;
  grid_cols?: number;
  grid_rows?: number;
}

export interface FlowEmailJob {
  position: number;
  /** The email's role in the sequence (seeds FlowEmail.job; editable). */
  job: string;
  /** Default delay before this email fires (human label). */
  delay: string;
  /** Starting section structure for the canvas (editable after scaffolding). */
  default_structure: FlowPlaybookSection[];
}

export interface FlowPlaybook {
  /** What fires this flow — labels the map's trigger node. */
  trigger: string;
  job: string;
  shape: string;
  emails: FlowEmailJob[];
}

export const FLOW_PLAYBOOKS: Record<FlowType, FlowPlaybook> = {
  welcome: {
    trigger: "Someone subscribes",
    job: "Start a relationship, not a sale. Earn the second open before you earn the first order.",
    shape: "Warm and human first, proof second, offer last. The sequence moves a brand-new subscriber from 'who is this' to 'I get why people buy this' to 'I'll try it' — never leading with a discount.",
    emails: [
      { position: 1, delay: "Immediately", job: "Welcome them and say the one thing Raycon is about in plain language. Set the tone of the relationship. No hard sell, no discount.",
        default_structure: [{ type: "header", focus: "Warm, human welcome — the one thing Raycon stands for." }, { type: "body", focus: "Why Raycon exists / what to expect from these emails." }, { type: "footer_cta", focus: "Soft invitation to explore; no offer." }] },
      { position: 2, delay: "1 day later", job: "The proof: why people choose Raycon (sound, battery, price honesty). Introduce the hero product.",
        default_structure: [{ type: "header", focus: "The reason to believe." }, { type: "usps", focus: "The three things that win people over." }, { type: "product_card", focus: "The hero product; offer stays secondary." }, { type: "footer_cta" }] },
      { position: 3, delay: "3 days later", job: "First-order nudge — the welcome gesture (offer) lands here as a thank-you for joining, not a fire sale.",
        default_structure: [{ type: "header", focus: "A reason to make the first order now." }, { type: "product_grid", grid_cols: 2, grid_rows: 2, focus: "A few best-sellers to choose from." }, { type: "footer_cta", focus: "Welcome offer as a gesture; one clear CTA." }] },
    ],
  },
  abandoned_cart: {
    trigger: "Added to cart, didn't check out",
    job: "Recover the sale by removing the reason they hesitated — not by shouting a countdown.",
    shape: "Reminder → reassurance → light incentive. Any urgency is anchored to the reader's OWN cart ('your items are still saved'), never a sitewide sale clock.",
    emails: [
      { position: 1, delay: "1 hour later", job: "Gentle reminder — their items are still waiting. Make returning to the cart one tap. No pressure, no discount yet.",
        default_structure: [{ type: "header", focus: "Your cart is still here — friendly, low-pressure." }, { type: "product_card", focus: "The item(s) they left; make it easy to picture owning it." }, { type: "footer_cta", focus: "Return to cart; frictionless." }] },
      { position: 2, delay: "1 day later", job: "Handle the hesitation with reassurance — warranty, real reviews, easy shipping/returns. Urgency stays cart-anchored.",
        default_structure: [{ type: "header", focus: "Address the doubt, not the deadline." }, { type: "body", focus: "The reassurance: warranty, returns, why it's a safe buy." }, { type: "product_card_review", focus: "A real review of the item they left." }, { type: "footer_cta", focus: "Finish checkout." }] },
      { position: 3, delay: "2 days later", job: "Last nudge — a small incentive if policy allows, and make completing the order effortless.",
        default_structure: [{ type: "header", focus: "One last, easy nudge." }, { type: "cta_bridge", focus: "The incentive (if any), stated plainly and cart-anchored." }, { type: "product_card", focus: "The item, ready to check out." }, { type: "footer_cta" }] },
    ],
  },
  abandoned_checkout: {
    trigger: "Reached checkout, didn't complete",
    job: "Close a high-intent sale — they were one step from buying. Remove the last friction, fast.",
    shape: "Faster and more direct than cart abandonment: they nearly bought. A near-immediate reminder, then reassurance on the last doubt, then one final easy nudge. Urgency stays anchored to their own in-progress order.",
    emails: [
      { position: 1, delay: "30 minutes later", job: "Immediate, friendly nudge — their order is almost done; one tap to finish. No discount.",
        default_structure: [{ type: "header", focus: "You're almost there — finish your order." }, { type: "product_card", focus: "What's waiting in their checkout." }, { type: "footer_cta", focus: "Complete checkout; one tap." }] },
      { position: 2, delay: "6 hours later", job: "Remove the last hesitation — shipping, returns, secure payment. Keep it order-anchored.",
        default_structure: [{ type: "header", focus: "The reason it's safe to finish now." }, { type: "body", focus: "Shipping, returns, warranty, secure checkout." }, { type: "footer_cta", focus: "Finish checkout." }] },
      { position: 3, delay: "1 day later", job: "Final easy nudge; a small incentive if policy allows. Make finishing effortless.",
        default_structure: [{ type: "header", focus: "One last nudge." }, { type: "cta_bridge", focus: "The incentive (if any), plainly, order-anchored." }, { type: "footer_cta" }] },
    ],
  },
  browse_abandonment: {
    trigger: "Viewed a product, didn't add to cart",
    job: "Bring back someone who looked but didn't add — be helpful, never creepy.",
    shape: "Nudge back to what caught their eye, then add one genuine reason (a benefit or social proof) to return. Lighter touch than cart — they showed interest, not intent.",
    emails: [
      { position: 1, delay: "4 hours later", job: "Nudge back to the product/category they viewed. Helpful and casual — 'still thinking it over?' — not 'we saw you looking'.",
        default_structure: [{ type: "header", focus: "Casual return to what they viewed." }, { type: "product_card", focus: "The viewed product; make it easy to revisit." }, { type: "footer_cta", focus: "Take another look." }] },
      { position: 2, delay: "1 day later", job: "Add a reason to come back — a benefit or social proof on the category they browsed.",
        default_structure: [{ type: "header", focus: "The reason it's worth another look." }, { type: "usps", focus: "What makes this category stand out." }, { type: "product_grid", grid_cols: 2, grid_rows: 1, focus: "A couple of options in what they browsed." }, { type: "footer_cta" }] },
    ],
  },
  site_abandonment: {
    trigger: "Visited the site, didn't browse a product",
    job: "Turn a passive visit into a first real browse — welcoming and low-pressure. They didn't signal a specific interest, so lead with the brand and best sellers, not one product.",
    shape: "Broad and inviting. A warm 'thanks for stopping by', then an easy entry point (best sellers / categories) to give them a reason to come back and look properly.",
    emails: [
      { position: 1, delay: "1 day later", job: "Warm 'thanks for stopping by' — point them to what Raycon is known for. No pressure.",
        default_structure: [{ type: "header", focus: "Glad you stopped by — here's what Raycon is about." }, { type: "body", focus: "The one thing that wins people over; invite them to look." }, { type: "footer_cta", focus: "Explore the storefront." }] },
      { position: 2, delay: "3 days later", job: "Give them an entry point — best sellers or categories worth exploring.",
        default_structure: [{ type: "header", focus: "A good place to start." }, { type: "product_grid", grid_cols: 2, grid_rows: 2, focus: "Best sellers across categories." }, { type: "footer_cta", focus: "Shop the range." }] },
    ],
  },
  post_purchase: {
    trigger: "Order placed",
    job: "Turn a buyer into a fan. Reassure first, delight second, cross-sell only once they're happy.",
    shape: "Thank/reassure → onboarding tips → cross-sell + review request. The offer is never the point; the relationship and the next purchase are.",
    emails: [
      { position: 1, delay: "Immediately", job: "Thank them and reassure — order confirmed, what happens next, that they made a good call.",
        default_structure: [{ type: "header", focus: "Thank you + reassurance." }, { type: "body", focus: "What happens next; how to get the most out of it." }, { type: "footer_cta", focus: "Track order / get started." }] },
      { position: 2, delay: "3 days later", job: "Onboarding — quick tips to love the product, set expectations, reduce buyer's remorse.",
        default_structure: [{ type: "header", focus: "Get the best out of it." }, { type: "usps", focus: "Three tips or features worth knowing." }, { type: "footer_cta", focus: "Support / how-to link." }] },
      { position: 3, delay: "14 days later", job: "Cross-sell the natural next product and ask for a review, now that they've had time with it.",
        default_structure: [{ type: "header", focus: "The natural next step." }, { type: "product_card", focus: "The complementary product." }, { type: "reviews", focus: "Real reviews only, if supplied; else omit." }, { type: "footer_cta", focus: "Shop the add-on / leave a review." }] },
    ],
  },
  winback: {
    trigger: "Lapsed — no purchase in a while (still recoverable)",
    job: "Reactivate a recoverable customer. Reopen the relationship warmly and give a real reason to come back. No guilt, no 'we miss you'.",
    shape: "Warm re-open leading with what's new/improved since they left, then a welcome-back gesture as the reason to return. Short and human. This is a reactivation flow — the reader is worth winning back, so lead with value, not pleading.",
    emails: [
      { position: 1, delay: "Trigger: lapsed", job: "Warm re-open — lead with what's new or improved since they left. Never guilt, never 'we miss you' clichés.",
        default_structure: [{ type: "header", focus: "Warm, human open — no guilt." }, { type: "body", focus: "What's new or improved since they last shopped." }, { type: "footer_cta", focus: "See what's new." }] },
      { position: 2, delay: "5 days later", job: "The welcome-back gesture (offer) as the reason to return; one clear CTA.",
        default_structure: [{ type: "header", focus: "A reason to come back now." }, { type: "cta_bridge", focus: "The welcome-back offer, stated as a gesture." }, { type: "product_grid", grid_cols: 2, grid_rows: 1, focus: "A couple of things worth returning for." }, { type: "footer_cta" }] },
    ],
  },
  sunset: {
    trigger: "Highly unengaged for a long stretch",
    job: "One honest last try, then let them go. Protect deliverability; never beg.",
    shape: "Direct and respectful. Ask plainly whether they still want to hear from Raycon and make leaving as easy as staying. No hype, no guilt, no fake urgency — the goal is a clean re-permission or a graceful goodbye, both of which protect sender reputation.",
    emails: [
      { position: 1, delay: "Trigger: long-term unengaged", job: "Ask honestly: do they still want these emails? Make staying and leaving equally easy. No guilt.",
        default_structure: [{ type: "header", focus: "A plain, honest question — still want to hear from us?" }, { type: "body", focus: "Why we're asking; make staying or leaving both one click." }, { type: "footer_cta", focus: "Stay subscribed / no pressure to." }] },
      { position: 2, delay: "7 days later", job: "Final goodbye — confirm emails will pause unless they act. Warm, brief, zero pressure.",
        default_structure: [{ type: "header", focus: "We'll pause your emails soon." }, { type: "footer_cta", focus: "One tap to stay; otherwise a quiet goodbye." }] },
    ],
  },
  back_in_stock: {
    trigger: "A saved / wishlisted item is restocked",
    job: "Tell them plainly the thing they wanted is back — before it goes again.",
    shape: "Single, direct message: the item they wanted is available. Scarcity is stated as fact ('it sold out last time'), never manufactured panic.",
    emails: [
      { position: 1, delay: "Trigger: item restocked", job: "The item they wanted is back. Say it plainly, make buying immediate, note it went fast last time — as fact, not panic.",
        default_structure: [{ type: "header", focus: "It's back." }, { type: "product_card", focus: "The restocked item; buy it now." }, { type: "footer_cta", focus: "Grab it before it's gone again — stated as fact." }] },
    ],
  },
  custom: {
    trigger: "Describe when this flow fires",
    job: "A custom flow — you define the trigger and each email's job. The shared Raycon voice and hard rules still apply.",
    shape: "You control the sequence: add emails, set the delays, and give each one its job. Keep the flow mindset — triggered and evergreen, an arc across emails, urgency anchored to the reader's own action.",
    emails: [
      { position: 1, delay: "Immediately", job: "The first message. Set its job in the brief, then write it.",
        default_structure: [{ type: "header" }, { type: "body" }, { type: "footer_cta" }] },
    ],
  },
};

/** Starting structure for a brand-new email (an added email, or a custom flow's
 * next email) when there's no playbook default to draw on. */
export const DEFAULT_EMAIL_STRUCTURE: FlowPlaybookSection[] = [
  { type: "header" }, { type: "body" }, { type: "footer_cta" },
];

/** Scaffold a flow email's default section structure into real SectionSpecs
 * (with ids). `mkId` supplies collision-free ids (pass nanoid). */
export function scaffoldSections(sections: FlowPlaybookSection[], mkId: () => string): SectionSpec[] {
  return sections.map((s) => ({
    id: mkId(),
    type: s.type,
    ...(s.focus ? { focus: s.focus } : {}),
    ...(s.grid_cols ? { grid_cols: s.grid_cols } : {}),
    ...(s.grid_rows ? { grid_rows: s.grid_rows } : {}),
  }));
}

/** Short strategy block injected into the flow user prompt (server-side). */
export function flowPlaybookBlock(type: FlowType): string {
  const p = FLOW_PLAYBOOKS[type];
  return `FLOW PLAYBOOK (${type})\nJob of the whole flow: ${p.job}\nArc/shape: ${p.shape}`;
}
