export type CampaignType = "promo" | "launch" | "restock" | "story" | "seasonal" | "winback" | "newsletter";
export type AudienceType = "all" | "engaged" | "lapsed" | "post_purchase" | "vip";
export type SectionType =
  | "header"
  | "body"
  | "usps"
  | "product_card"
  | "product_grid"
  | "reviews"
  | "cta_bridge"
  | "footer_cta";

export interface SectionSpec {
  id: string;
  type: SectionType;
  focus?: string;
  /** User-opted-in optional elements (e.g. Sub-Tagline for header) */
  optional_elements?: string[];
  /** Product grid layout — only meaningful for product_grid sections */
  grid_cols?: number;
  grid_rows?: number;
  /** For product_card sections only: which featured product (SKU id) this card showcases.
   * Populated by expandProductCardSections() before generation so each card maps to
   * exactly one product from the user's products_featured list. */
  product_slug?: string;
}

export interface LibraryCampaign {
  id: string;
  title: string;
  date: string;
  campaign_type: CampaignType;
  offer: string;
  promo_code?: string;
  hero_angle: string;
  audience: AudienceType;
  products_featured: string[];
  conceit: string;
  // Provenance tag: "doc" / "design" (ingested), "generated" (from the app),
  // "sent-email-benchmark" (imported past sends). Free-form — never narrowed.
  source: string;
  body: string;
  /** Back-reference to the Planner row this campaign was written for (if any). */
  planner_row_id?: string;
  /**
   * Faithful structured snapshot of the campaign as it appeared on the canvas.
   * Present for library entries saved from the app (lets the canvas reload
   * losslessly — grids, section types, element grouping all intact).
   * Absent for legacy / doc-sourced entries, which fall back to parsing `body`.
   */
  structured?: { campaign: GeneratedCampaign; section_structure: SectionSpec[] };
}

export interface ExpandedBrief {
  headline_thesis: string;
  audience_mindset: string;
  key_message: string;
  tonal_direction: string;
  structural_notes: string;
  rewritten_hero_angle: string;
  // original brief fields retained for retrieval
  campaign_type: CampaignType;
  audience: AudienceType;
  products_featured: string[];
  /**
   * The user's hero angle / hook exactly as they typed it, carried through
   * unmodified. May contain must-use literal content (specific reviews, quotes,
   * names, exact copy). The downstream writer must honour this verbatim.
   */
  hero_angle_verbatim?: string;
  /** The user's campaign-specific rules, verbatim. */
  campaign_specific_rules?: string;
}

// How a conceit is CONSTRUCTED (not just its angle): the deal, a moment/story, or
// one concrete product truth as the hook. Optional for backward-compatible parse.
export type ConceitArchitecture = "offer_led" | "story_led" | "product_truth_led";

export interface Conceit {
  id: string;
  name: string;
  description: string;
  architecture?: ConceitArchitecture;
}

export interface ProductInGrid {
  name: string;
  image_direction: string;
  one_liner: string;
  cta: string;
}

export type SectionElements = Record<string, string | ProductInGrid[]>;

export interface GeneratedSection {
  id: string;
  type: SectionType;
  elements: SectionElements;
  /** Three distinct Subheader options (tone/framing differ, all obey the cap + hard rules).
   * Present only for sections that have a Subheader element. elements.Subheader always
   * mirrors the currently-selected variant so all downstream consumers see a plain string. */
  subheader_variants?: string[];
  /** Index into subheader_variants of the currently-selected option. Defaults to 0. */
  subheader_selected?: number;
  /** Saved AI-generated PNG mockup (base64 data URI). Persists with the campaign. */
  design_image?: string;
}

export interface CampaignMeta {
  subject_lines: string[];
  preview_texts: string[];
}

export interface GeneratedCampaign {
  meta: CampaignMeta;
  sections: GeneratedSection[];
}

export interface SavedCampaign {
  id: string;
  campaign_name: string;
  campaign_type: CampaignType;
  offer: string;
  promo_code?: string;
  audience: AudienceType;
  hero_angle: string;
  products_featured: string[];
  section_structure: SectionSpec[];
  expanded_brief?: ExpandedBrief;
  chosen_conceit?: Conceit;
  campaign: GeneratedCampaign;
  status: "draft" | "final";
  /** Back-reference to the Planner row this campaign was written for (if any). */
  planner_row_id?: string;
  created_at: string;
  updated_at: string;
}

export interface SmsVariant {
  text: string;
}

/** The SMS brief fields — shared by the form, the prompt, and the store. */
export interface SmsBrief {
  name?: string;
  offer: string;
  promo_code?: string;
  deadline?: string;
  angle?: string;
  audience?: string;
}

/**
 * An SMS campaign — a distinct copy record from SavedCampaign (email). SMS copy
 * is three construction-distinct variants (Direct / Friendly / Angle); one ships.
 * Persisted as one JSON file per campaign under data/sms/.
 */
export interface SmsCampaign {
  id: string; // date-slug, same shape as SavedCampaign ids
  name: string;
  /** Library/draft id this was distilled from (from-email path only). */
  source_email_id?: string;
  brief: {
    offer: string;
    promo_code?: string;
    deadline?: string;
    angle?: string;
    audience?: string;
  };
  variants: [SmsVariant, SmsVariant, SmsVariant];
  selected_variant: number; // 0–2, the one that ships
  planner_row_id?: string;
  status: "draft" | "final";
  created_at: string;
  updated_at: string;
}

/** The three SMS variant slots, in fixed order. Shared by prompt + UI labels. */
export const SMS_VARIANT_LABELS = ["Direct", "Friendly", "Angle"] as const;

export interface BriefInput {
  campaign_name: string;
  campaign_type: CampaignType;
  offer: string;
  promo_code?: string;
  audience: AudienceType;
  hero_angle: string;
  products_featured: string[];
  section_structure: SectionSpec[];
  campaign_specific_rules?: string;
  /** 1 = conservative / strict imitation, 5 = experimental / more humor + edge */
  tone_dial?: number;
  /** Back-reference to the Planner row this campaign was written for (if any). */
  planner_row_id?: string;
}

export const SECTION_CATALOGUE: Record<SectionType, string[]> = {
  header: ["Headline", "Tagline", "Hero Image Direction", "CTA"],
  body: ["Subheader", "Body Copy", "CTA"],
  usps: ["Subheader", "USP 1", "USP 2", "USP 3", "CTA"],
  product_card: ["Product Name", "Image Direction", "One-Liner", "CTA"],
  product_grid: ["Subheader", "Products"],
  reviews: ["Subheader", "Review 1", "Review 2", "Review 3"],
  cta_bridge: ["Subheader", "CTA"],
  footer_cta: ["Closing Line", "CTA"],
};

/** Elements that are off by default but can be toggled on per-section by the user. */
export const OPTIONAL_ELEMENTS: Partial<Record<SectionType, string[]>> = {
  header: ["Sub-Tagline"],
};

export const DEFAULT_SECTION_STRUCTURE: SectionSpec[] = [
  { id: "s1", type: "header" },
  { id: "s2", type: "body" },
  { id: "s3", type: "usps" },
  { id: "s4", type: "footer_cta" },
];
