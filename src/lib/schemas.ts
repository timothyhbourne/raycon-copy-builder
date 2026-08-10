export type CampaignType = "promo" | "launch" | "restock" | "story" | "seasonal" | "winback" | "newsletter";
export type AudienceType = "all" | "engaged" | "lapsed" | "post_purchase" | "vip";

// Selection-driven brief model (deterministic compiler — see src/lib/brief/).
// `angle` is how the arc is shaped; `SendStage`/`UrgencyTier` are COMPUTED by the
// compiler from the promotion dates, never hand-entered (a manual override is
// allowed in the UI but still flows through these fields).
export type Angle = "offer_led" | "product_led" | "story_led" | "occasion_led";
export type SendStage = "launch" | "reminder" | "last_call";
export type UrgencyTier = 1 | 2 | 3;
export type SectionType =
  | "header"
  | "body"
  | "free_form"
  | "usps"
  | "product_card"
  | "product_card_review"
  | "product_grid"
  | "bundle"
  | "reviews"
  | "cta_bridge"
  | "footer_cta";

/** How a bundle section is laid out. See BUNDLE_TEMPLATES for descriptions. */
export type BundleTemplate = "unified" | "checklist" | "pairing" | "hero_addons";
/** Where a bundle's product list comes from. */
export type BundleMode = "custom" | "existing";

/** Section types that showcase exactly ONE featured product (get a product_slug). */
export const PRODUCT_CARD_TYPES: SectionType[] = ["product_card", "product_card_review"];
export function isProductCardType(t: SectionType): boolean {
  return t === "product_card" || t === "product_card_review";
}

/** Where a single USP's material comes from. */
export type UspSource = "product" | "company";

/**
 * One USP slot in a `usps` section. The slot list is what makes the section
 * modular: its LENGTH is the USP count, and each entry decides independently
 * whether that USP sells a product or the brand.
 */
export interface UspSlot {
  source: UspSource;
  /** Product-sourced slots only. Undefined = Auto (hero product, else first featured). */
  product_slug?: string;
  /** Optional steering for this single USP, e.g. "lead on battery". */
  focus?: string;
}

/** A usps section must keep at least 2 slots and at most 5. */
export const USP_SLOT_MIN = 2;
export const USP_SLOT_MAX = 5;
/** The USP count a section falls back to when `usp_slots` is absent (legacy shape). */
export const USP_SLOT_DEFAULT = 3;

export interface SectionSpec {
  id: string;
  type: SectionType;
  focus?: string;
  /** User-opted-in optional elements (e.g. Sub-Tagline for header) */
  optional_elements?: string[];
  /** Otherwise-required elements the user switched OFF for this section (e.g. a
   * usps section with no Subheader). Only names listed in REMOVABLE_ELEMENTS for
   * this section type take effect. Absent = every catalogue element is present. */
  removed_elements?: string[];
  /** `usps` sections only: the per-USP plan. Its length is the USP count.
   * Absent = the legacy shape (3 product-sourced USPs, product auto-resolved). */
  usp_slots?: UspSlot[];
  /** Product grid layout — only meaningful for product_grid sections */
  grid_cols?: number;
  grid_rows?: number;
  /** For product_card sections only: which featured product (SKU id) this card showcases.
   * Populated by expandProductCardSections() before generation so each card maps to
   * exactly one product from the user's products_featured list. */
  product_slug?: string;
  /** Bundle section config — only meaningful for `bundle` sections. */
  bundle_mode?: BundleMode;
  /** Layout template for the bundle (governs which copy elements get written). */
  bundle_template?: BundleTemplate;
  /** SKU ids that make up the bundle. Set directly for a custom bundle, or
   * copied from the chosen existing bundle's contents. */
  bundle_products?: string[];
  /** For `existing` mode: which pre-built Raycon bundle (see lib/bundles). */
  bundle_id?: string;
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
  /** Honest deadline phrasing computed from send date vs. end date ("tonight",
   * "tomorrow night", "in 48 hours", "Friday, Aug 7"). Set by the compiler
   * whenever an end date is known; the generator injects it as a literal
   * constraint so copy never says "tonight" 48 hours early. */
  deadline_language?: string;
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
  /**
   * Elements deleted ON THE CANVAS, after generation.
   *
   * Deliberately here on the generated content and NOT on SectionSpec: the spec's
   * `removed_elements` means "don't generate this", while this one means "this was
   * removed on the canvas". Keeping it on GeneratedSection means it persists through
   * the draft store and the library `structured` snapshot for free, with no new
   * plumbing back up to the read-only sectionStructure prop.
   *
   * SectionBlock re-appends any catalogue element missing from `elements`, so a
   * deletion only sticks because the key is listed here. Absent = nothing removed.
   */
  removed_elements?: string[];
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
  hero_angle?: string; // legacy; no longer collected
  products_featured: string[];
  section_structure: SectionSpec[];
  // Selection-driven brief fields — persisted so a library reload rebuilds the
  // same brief (the form re-populates from these).
  angle?: Angle;
  promotion_id?: string;
  occasion?: string;
  hero_product_slug?: string;
  send_stage?: SendStage;
  urgency?: UrgencyTier;
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

// ---- Flows -----------------------------------------------------------------
// A flow is a TRIGGERED, evergreen sequence (Welcome, Abandoned Cart, …) — a
// distinct record type from campaigns/SMS. It's authored by the flow "brain"
// (src/lib/prompts/flows.ts) and persisted via src/lib/flows.ts. Each email's
// generated body reuses GeneratedCampaign so the existing canvas renders it
// unchanged. GOTCHA: a new FlowType must ALSO be added to the zod enum in
// src/lib/validation/schemas.ts (flowType), or every flow of that type is
// dropped at the read boundary.
export type FlowType =
  | "welcome"
  | "abandoned_cart"
  | "abandoned_checkout"
  | "browse_abandonment"
  | "site_abandonment"
  | "post_purchase"
  | "winback"
  | "sunset"
  | "back_in_stock"
  | "custom";

export const FLOW_TYPES: FlowType[] = [
  "welcome", "abandoned_cart", "abandoned_checkout", "browse_abandonment", "site_abandonment",
  "post_purchase", "winback", "sunset", "back_in_stock", "custom",
];

/** User-facing label + one-line description per flow type (for the picker). */
export const FLOW_TYPE_META: Record<FlowType, { label: string; hint: string }> = {
  welcome: { label: "Welcome", hint: "First impression for a new subscriber — set the relationship, not a deadline." },
  abandoned_cart: { label: "Abandoned Cart", hint: "Added to cart but didn't check out — recover the sale, urgency anchored to their own cart." },
  abandoned_checkout: { label: "Abandoned Checkout", hint: "Reached checkout but didn't finish — high intent; remove the last bit of friction fast." },
  browse_abandonment: { label: "Browse Abandonment", hint: "Viewed a product but didn't add it — nudge back to what caught their eye." },
  site_abandonment: { label: "Site Abandonment", hint: "Visited the site without browsing a product — a light, welcoming nudge to explore." },
  post_purchase: { label: "Post-Purchase", hint: "They just bought — onboard, reassure, and set up the next purchase." },
  winback: { label: "Win-Back", hint: "Lapsed but recoverable — reactivate warmly with a reason to return. No guilt." },
  sunset: { label: "Sunset", hint: "Highly unengaged for a long time — one honest last try, then let them go to protect deliverability." },
  back_in_stock: { label: "Back in Stock", hint: "The item they wanted returned — tell them plainly before it goes again." },
  custom: { label: "Custom", hint: "Build your own flow from scratch — set the trigger, emails, delays, and branches yourself." },
};

/** One email within a flow. `campaign` is absent until the email is written;
 * `section_structure` is scaffolded from FLOW_PLAYBOOKS so the canvas has a
 * shape to render into. `status` gains an "empty" state (unwritten) on top of
 * the draft/final pattern used elsewhere. */
export interface FlowEmail {
  id: string;
  /** 1-based position in the sequence. */
  position: number;
  /** This email's job in the arc (from the playbook; editable). */
  job: string;
  /** Human delay label before this email fires ("Immediately", "1 day later"). */
  delay?: string;
  /** What THIS specific email should emphasize (the writer's X/Y/Z). */
  highlights?: string;
  /** Generated body — reuses GeneratedCampaign so the canvas renders it as-is. */
  campaign?: GeneratedCampaign;
  section_structure: SectionSpec[];
  status: "empty" | "draft" | "final";
}

/** A free-text conditional split between emails — no logic engine. `label` is
 * the condition/question ("Opened Email 1?"); `yes_label`/`no_label` describe
 * what happens on each branch (optional — a split with neither is a plain note).
 * The node-map renders it as a fork and the canvas shows it in context. */
export interface FlowSplit {
  id: string;
  after_email_position: number;
  label: string;
  yes_label?: string;
  no_label?: string;
}

export interface Flow {
  id: string; // date-slug, same shape as SavedCampaign ids
  name: string;
  type: FlowType;
  channel: "email" | "sms";
  /** What fires this flow. Optional override of the playbook's default trigger;
   * primarily used by `custom` flows where the author defines it. */
  trigger?: string;
  /** Optional link to the real Klaviyo flow this authors copy for (reference only). */
  klaviyo_flow_id?: string;
  klaviyo_flow_name?: string;
  /** The flow's overall goal, in the author's words (optional steering). */
  goal?: string;
  emails: FlowEmail[];
  splits: FlowSplit[];
  created_at: string;
  updated_at: string;
}

export interface BriefInput {
  campaign_name: string;
  campaign_type: CampaignType;
  offer: string;
  promo_code?: string;
  audience: AudienceType;
  /** How the arc is shaped (replaces the free-text hero angle). */
  angle: Angle;
  /** Selected Promotional Calendar promotion id (occasion picker), if any. */
  promotion_id?: string;
  /** Occasion label — auto-set from the promotion, or manual. */
  occasion?: string;
  /** Which featured product leads above the fold. */
  hero_product_slug?: string;
  products_featured: string[];
  section_structure: SectionSpec[];
  /** Optional free-text NUDGE ("Anything special about this send?") — the only
   * free text left, mapped to the user's-literal-instructions priority tier. */
  campaign_specific_rules?: string;
  /** Notes + learnings carried over from the Planner row (and, when the send
   * falls inside a promotion window, that promotion's `learnings`). Kept as its
   * own field so the writer can see and exclude it independently of their own
   * nudge; compileBrief() merges the two into the same literal-instruction
   * tier. See plannerNotesBlock() in lib/planner-copy-link.ts. */
  planner_notes?: string;
  /** Legacy free-text hero angle — no longer collected; kept optional so saved
   * library items still type-check. The UI does not show it. */
  hero_angle?: string;
  /** "flash_sale" = evergreen ad-hoc occasion, decoupled from the promo calendar. */
  occasion_kind?: "promo_calendar" | "flash_sale";
  /** Flash sale window (ISO yyyy-mm-dd). Required when occasion_kind === "flash_sale". */
  flash_sale_start?: string;
  flash_sale_end?: string;
  /** Planned send date (ISO). Defaults to today at compile time. Drives deadline language. */
  send_date?: string;
  /** Computed by compileBrief() from the promotion dates; persisted so a saved
   * campaign reloads faithfully. A manual UI override still writes here. */
  send_stage?: SendStage;
  urgency?: UrgencyTier;
  /** 1 = conservative / strict imitation, 5 = experimental / more humor + edge */
  tone_dial?: number;
  /** Back-reference to the Planner row this campaign was written for (if any). */
  planner_row_id?: string;
}

export const SECTION_CATALOGUE: Record<SectionType, string[]> = {
  header: ["Headline", "Tagline", "CTA"],
  body: ["Subheader", "Body Copy", "CTA"],
  // General-purpose content block. Same shape as `body` but semantically a
  // free-form section the user can drop in anywhere.
  free_form: ["Subheader", "Body Copy", "CTA"],
  usps: ["Subheader", "USP 1", "USP 2", "USP 3", "CTA"],
  product_card: ["Product Name", "One-Liner", "CTA"],
  product_card_review: ["Product Name", "Subheader", "One-Liner", "Review", "CTA"],
  product_grid: ["Subheader", "Products"],
  // Bundle elements are TEMPLATE-driven and product-count-driven — see
  // bundleElements(). This base is only a fallback (e.g. an unconfigured bundle).
  bundle: ["Bundle Name", "Subheader", "CTA"],
  reviews: ["Subheader", "Review 1", "Review 2", "Review 3"],
  cta_bridge: ["Subheader", "CTA"],
  footer_cta: ["Closing Line", "CTA"],
};

/** User-facing metadata for each bundle layout template. */
export const BUNDLE_TEMPLATES: { id: BundleTemplate; label: string; hint: string }[] = [
  { id: "unified", label: "Unified card + per-product USPs", hint: "One card for the whole bundle, one USP line per product" },
  { id: "checklist", label: "What's-inside checklist", hint: "Itemized list of what's inside + a value line" },
  { id: "pairing", label: "Better-together pairing", hint: "Narrative on how the items complete each other" },
  { id: "hero_addons", label: "Hero + add-ons", hint: "One product leads, the rest are bonus add-ons" },
];

/**
 * The copy elements a bundle section should produce, given its template and how
 * many products are in the bundle. All flat string elements (Subheader keeps the
 * app-wide 3-variant convention), so the section renders through the generic
 * path with no special-casing. `n` is clamped to a sane 2–4 for numbered slots.
 */
export function bundleElements(template: BundleTemplate, productCount: number): string[] {
  const n = Math.max(2, Math.min(4, productCount || 2));
  const numbered = (label: string) => Array.from({ length: n }, (_, i) => `${label} ${i + 1}`);
  switch (template) {
    case "unified":
      // One USP per product in the bundle.
      return ["Bundle Name", "Subheader", ...numbered("USP"), "CTA"];
    case "checklist":
      // One "what's inside" line per product, then a value anchor.
      return ["Bundle Name", "Subheader", ...numbered("Item"), "Value Line", "CTA"];
    case "pairing":
      // Narrative pairing — not per-product numbered.
      return ["Bundle Name", "Subheader", "Pairing Line", "Combined Benefit", "CTA"];
    case "hero_addons":
      // Hero product leads; the remaining products are add-on lines.
      return ["Bundle Name", "Hero Line", ...Array.from({ length: Math.max(1, n - 1) }, (_, i) => `Add-On ${i + 1}`), "Bundle Offer", "CTA"];
  }
}

/** Elements that are off by default but can be toggled on per-section by the user. */
export const OPTIONAL_ELEMENTS: Partial<Record<SectionType, string[]>> = {
  header: ["Sub-Tagline"],
};

/**
 * Required elements that MAY be switched off per section — the mirror of
 * OPTIONAL_ELEMENTS. This is what lets a USPs section run directly after a
 * product card with no subheader of its own.
 */
export const REMOVABLE_ELEMENTS: Partial<Record<SectionType, string[]>> = {
  usps: ["Subheader", "CTA"],
  body: ["Subheader"],
  cta_bridge: ["Subheader"],
};

/**
 * Element families that can repeat within a section, with bounds.
 *
 * Members are named "<family> <n>" (Review 1, USP 3), matching the catalogue
 * convention, so the stream parser, canvas, and library body format need no
 * changes. `product_card_review` deliberately has a single `Review` (not a
 * family) and is absent here.
 */
export const REPEATABLE_ELEMENTS: Partial<Record<SectionType, { family: string; min: number; max: number }[]>> = {
  reviews: [{ family: "Review", min: 1, max: 6 }],
  // Bounds mirror the USP slot plan so the canvas and the section builder agree.
  usps: [{ family: "USP", min: USP_SLOT_MIN, max: USP_SLOT_MAX }],
};

/** The repeatable-family rule a given element key belongs to, if any. */
export function repeatableFamilyFor(type: SectionType, key: string): { family: string; min: number; max: number } | undefined {
  const m = key.match(/^(.+?)\s+\d+$/);
  if (!m) return undefined;
  return (REPEATABLE_ELEMENTS[type] ?? []).find((f) => f.family === m[1]);
}

/**
 * The effective USP slot plan for a section. A section saved before the USP
 * system (no `usp_slots`) yields USP_SLOT_DEFAULT product-sourced Auto slots,
 * i.e. exactly today's behaviour. Length is clamped to [MIN, MAX].
 */
export function uspSlotsOf(s: Pick<SectionSpec, "usp_slots">): UspSlot[] {
  const productSlot = (): UspSlot => ({ source: "product" });
  const slots = s.usp_slots?.length
    ? s.usp_slots.slice(0, USP_SLOT_MAX)
    : Array.from({ length: USP_SLOT_DEFAULT }, productSlot);
  // Pad a too-short list up to the minimum rather than rejecting it, so a
  // hand-edited or partially-migrated spec still renders a usable section.
  while (slots.length < USP_SLOT_MIN) slots.push(productSlot());
  return slots;
}

/** The base elements of a `usps` section with `n` USP slots: Subheader, USP 1…N, CTA. */
export function uspsElements(n: number): string[] {
  const count = Math.max(USP_SLOT_MIN, Math.min(USP_SLOT_MAX, n || USP_SLOT_DEFAULT));
  return ["Subheader", ...Array.from({ length: count }, (_, i) => `USP ${i + 1}`), "CTA"];
}

/**
 * THE single source of truth for which copy elements a section produces.
 *
 * Every consumer derives its element list from here — the generation prompt, its
 * JSONL skeleton, regeneration, section variations, and the canvas — so a section
 * with 5 USPs and no Subheader is described identically everywhere. Order:
 * base elements (type / bundle template / USP slot count), then opted-in
 * optional elements, minus anything the user removed.
 *
 * A removal only applies if the name is listed in REMOVABLE_ELEMENTS for the
 * type, and a removal is never allowed to empty a section.
 */
export function sectionElementNames(
  s: Pick<SectionSpec, "type" | "bundle_template" | "bundle_products" | "usp_slots" | "optional_elements" | "removed_elements">
): string[] {
  const base =
    s.type === "bundle" ? bundleElements(s.bundle_template ?? "unified", (s.bundle_products ?? []).length)
    : s.type === "usps" ? uspsElements(uspSlotsOf(s).length)
    : (SECTION_CATALOGUE[s.type] ?? []);

  const withOptional = [...base, ...(s.optional_elements ?? [])];

  const removable = new Set(REMOVABLE_ELEMENTS[s.type] ?? []);
  const removed = new Set((s.removed_elements ?? []).filter((e) => removable.has(e)));
  if (!removed.size) return withOptional;

  const kept = withOptional.filter((e) => !removed.has(e));
  return kept.length ? kept : withOptional;
}

export const DEFAULT_SECTION_STRUCTURE: SectionSpec[] = [
  { id: "s1", type: "header" },
  { id: "s2", type: "body" },
  { id: "s3", type: "usps" },
  { id: "s4", type: "footer_cta" },
];
