import type { CampaignType, SectionType } from "../schemas";

// Per-campaign-type playbooks: a short job + shape that modulate STRUCTURE and
// pacing, plus an editable default section structure. This is deliberately small
// — it never duplicates or overrides the brand voice (src/lib/prompts/voice.ts)
// or the user's literal instructions.

export interface PlaybookSection {
  type: SectionType;
  focus?: string;
  grid_cols?: number;
  grid_rows?: number;
}

export interface Playbook {
  job: string;
  shape: string;
  default_structure: PlaybookSection[];
}

export const PLAYBOOKS: Record<CampaignType, Playbook> = {
  promo: {
    job: "Make the deal unmissable. The offer is the story.",
    shape: "Offer-first: short hero stating the deal, offer/code block early, product grid welcome, deadline named plainly near the top and again at the close. Short overall — a promo send earns its click fast or not at all.",
    default_structure: [
      { type: "header", focus: "State the deal plainly." },
      { type: "cta_bridge", focus: "Offer and promo code, deadline named." },
      { type: "product_grid", grid_cols: 2, grid_rows: 2, focus: "Best-sellers to grab fast." },
      { type: "footer_cta", focus: "Restate the deadline and the offer." },
    ],
  },
  launch: {
    job: "Introduce the product. Desire first, discount second.",
    shape: "Story-first: hero names the product and its one big promise, body tells why it exists / what it solves, USPs prove it, ONE product card. Any offer waits until after the story and stays secondary. No product grid.",
    default_structure: [
      { type: "header", focus: "Name the product and its one big promise." },
      { type: "body", focus: "Why it exists / what it solves." },
      { type: "usps", focus: "Prove the promise." },
      { type: "product_card", focus: "The one product; any offer stays secondary." },
      { type: "footer_cta" },
    ],
  },
  restock: {
    job: "It's back because people bought it out. Lead with proof.",
    shape: "Popularity-first: hero announces the return, body leans on reputation and social proof (supplied reviews if any), single product focus, CTA to grab it before it goes again — stated as fact, not panic.",
    default_structure: [
      { type: "header", focus: "Announce the return." },
      { type: "body", focus: "Reputation and why it sold out." },
      { type: "reviews", focus: "Supplied reviews only, if any." },
      { type: "product_card", focus: "Single product focus." },
      { type: "footer_cta", focus: "Grab it before it goes again — stated as fact." },
    ],
  },
  story: {
    job: "Give the reader something worth reading. Sell gently.",
    shape: "Editorial: the conceit carries the email. Body-forward with the longest copy of any type, product enters as the natural conclusion, offer appears only in the footer CTA if at all.",
    default_structure: [
      { type: "header", focus: "The conceit, not the offer." },
      { type: "body", focus: "The longest copy of any type — let the idea breathe." },
      { type: "product_card", focus: "The product as the natural conclusion." },
      { type: "footer_cta", focus: "Gentle close; offer only if at all." },
    ],
  },
  seasonal: {
    job: "Connect the moment to the product.",
    shape: "Occasion-first: hero names the moment (holiday, season, event), body bridges from the reader's occasion to the products that fit it, grid or cards fine, offer and dates close it out.",
    default_structure: [
      { type: "header", focus: "Name the moment." },
      { type: "body", focus: "Bridge the occasion to the products that fit it." },
      { type: "product_grid", grid_cols: 2, grid_rows: 2, focus: "Products for the moment." },
      { type: "footer_cta", focus: "Offer and dates." },
    ],
  },
  winback: {
    job: "Reopen the relationship warmly. No guilt.",
    shape: "Welcome-first: open warm and human (never 'we miss you' clichés or guilt), lead with what's new or improved since they left, the offer lands as a welcome-back gesture, single clear CTA. Short.",
    default_structure: [
      { type: "header", focus: "Warm, human open — no guilt." },
      { type: "body", focus: "What's new or improved since they left." },
      { type: "footer_cta", focus: "Offer as a welcome-back gesture; one clear CTA." },
    ],
  },
  newsletter: {
    job: "Inform first, sell lightly.",
    shape: "Multi-topic: sectioned like a briefing, each section standalone, product mentions woven in rather than pitched, storefront link at the end. No hard offer blocks.",
    default_structure: [
      { type: "header", focus: "Briefing headline." },
      { type: "body", focus: "Topic one — standalone." },
      { type: "body", focus: "Topic two — standalone; weave the product in, don't pitch." },
      { type: "footer_cta", focus: "Storefront link; no hard offer block." },
    ],
  },
};

// Short block injected into the brief + generation prompts.
export function playbookBlock(type: CampaignType): string {
  const p = PLAYBOOKS[type];
  return `CAMPAIGN PLAYBOOK (${type})\nJob: ${p.job}\nShape: ${p.shape}`;
}
