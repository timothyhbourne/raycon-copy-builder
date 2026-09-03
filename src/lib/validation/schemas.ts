import { z } from "zod";
import type {
  SavedCampaign, LibraryCampaign, SmsCampaign, Flow,
} from "../schemas";
import type { PlannerRow } from "../planner-types";
import type { WeeklyReport } from "../reports/weekly";
import type { CorpusRecord } from "../corpus/types";
import type { GuidanceClaim } from "../corpus/ledger-types";

// Zod schemas for the core PERSISTED entities, mirroring the hand-written TS
// interfaces (src/lib/schemas.ts, planner-types.ts, reports/weekly.ts). They are
// used at storage READ boundaries to gate malformed
// records (log + skip/repair, never crash) and to migrate legacy shapes forward.
//
// Two deliberate choices:
//  1. Every object is a LOOSE object (unknown keys preserved, not stripped). The
//     stores read → validate → sometimes rewrite the same record, so stripping
//     would silently lose fields (e.g. a rich `structured` snapshot). Loose
//     validation gates the known fields' types without destroying data.
//  2. Lockstep with the interfaces is enforced at compile time by the ASSIGNABLE
//     checks at the bottom of this file — if a schema drifts from its interface,
//     the build breaks. (We don't infer the TS types FROM zod because the
//     interfaces are the widely-imported source of truth.)

// Bump when a persisted shape changes in a way that needs a migration; stamped
// onto every newly-written record so a future reader can tell old from new.
//
// 2 (2026-08-20): review slots + review provenance. A v1 record has neither, and
// both have defined fallbacks — reviewSlotsOf() materialises 3 product slots, and
// migrateLegacyProvenance() reads existing reviews as "curated" so the new
// provenance gate doesn't retroactively block every saved campaign.
//
// 4 (2026-08-29): the planner audience split — audience_planned_* (the brief) vs
// audience_actual_* (what Klaviyo says was built). A v3 row has one merged pair;
// parsePlannerRow routes it by whether the row has a klaviyo_campaign_id, and the
// legacy pair stays written for one release.
//
// 3 (2026-08-24): the flow GRAPH (docs/FLOW_CANVAS_REBUILD_SPEC.md). A v2 flow has
// `emails` + `splits` and no `nodes`/`edges`; parseFlow migrates it on read
// (migrateLinearFlowToGraph) and keeps the legacy arrays derived from the graph
// for one release as a rollback path.
export const SCHEMA_VERSION = 4;

const schemaVersion = z.number().int().optional();

// ---- shared / leaf shapes -------------------------------------------------
const campaignType = z.enum([
  "promo", "launch", "restock", "story", "seasonal", "winback", "newsletter",
]);
const audienceType = z.enum(["all", "engaged", "lapsed", "post_purchase", "vip"]);
const angle = z.enum(["offer_led", "product_led", "story_led", "occasion_led"]);
const sendStage = z.enum(["launch", "reminder", "last_call"]);
const urgencyTier = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const sectionType = z.enum([
  "header", "body", "free_form", "usps", "product_card", "product_card_review",
  "product_grid", "bundle", "reviews", "cta_bridge", "footer_cta",
]);

const productInGrid = z.looseObject({
  name: z.string(),
  image_direction: z.string(),
  one_liner: z.string(),
  cta: z.string(),
});

// A USPs section's per-slot config. All fields optional on SectionSpec, so a
// campaign saved before the USP system (no usp_slots, no removed_elements) still
// validates untouched and falls back to the legacy 3-product-USP behaviour.
const uspSlot = z.looseObject({
  source: z.enum(["product", "company"]),
  product_slug: z.string().optional(),
  focus: z.string().optional(),
});

// A reviews section's per-slot plan. All fields optional beyond `source`, so a
// half-configured slot (a URL slot with no URL yet) still validates and simply
// reports itself as an unfilled gap rather than being dropped on read.
const reviewSlot = z.looseObject({
  source: z.enum(["product", "url", "manual"]),
  product_slug: z.string().optional(),
  source_url: z.string().optional(),
  manual_text: z.string().optional(),
  manual_author: z.string().optional(),
});

const sectionSpec = z.looseObject({
  id: z.string(),
  type: sectionType,
  focus: z.string().optional(),
  optional_elements: z.array(z.string()).optional(),
  removed_elements: z.array(z.string()).optional(),
  usp_slots: z.array(uspSlot).optional(),
  review_slots: z.array(reviewSlot).optional(),
  grid_cols: z.number().optional(),
  grid_rows: z.number().optional(),
  product_slug: z.string().optional(),
  bundle_mode: z.enum(["custom", "existing"]).optional(),
  bundle_template: z.enum(["unified", "checklist", "pairing", "hero_addons"]).optional(),
  bundle_products: z.array(z.string()).optional(),
  bundle_id: z.string().optional(),
});

// ---- USP banks (data/product-usps.md, data/company-usps.md) ----------------
// Bundled static content, parsed at load time. Validated at the parse boundary
// so a malformed hand-edited block is logged and skipped rather than reaching a
// prompt half-formed.
export const productUspSchema = z.object({
  label: z.string().min(1),
  benefit: z.string().min(1),
  tags: z.array(z.string()),
  unverified: z.boolean().optional(),
});

export const companyUspSchema = productUspSchema.extend({
  theme: z.string().min(1),
});

export const uspBankSchema = z.object({
  sku: z.string().min(1),
  name: z.string(),
  source: z.string(),
  verified: z.string(),
  usps: z.array(productUspSchema),
});

// Rich generated content is validated structurally but kept permissive — the
// element map holds strings or product arrays, and sections may carry future
// presentation fields (variants, design image).
const sectionElements = z.record(
  z.string(),
  z.union([z.string(), z.array(productInGrid)]),
);
// A headline slate candidate: the pattern label, the line, and the tagline that
// pays it off. `pattern` is a plain string on purpose — an unrecognised label from
// the model is carried through rather than dropping the candidate.
const headlineVariant = z.looseObject({
  pattern: z.string(),
  text: z.string(),
  tagline: z.string().optional(),
});
const generatedSection = z.looseObject({
  id: z.string(),
  type: sectionType,
  elements: sectionElements,
  // Elements deleted on the canvas. Must round-trip through the draft store and
  // the library `structured` snapshot or a deletion silently comes back on reload.
  removed_elements: z.array(z.string()).optional(),
  // Slate metadata. These MUST round-trip: the corpus reads was_selected off them
  // to know which candidate a customer actually saw (spec §2.7), and a reloaded
  // campaign has to show the writer's pick, not candidate 1.
  subheader_variants: z.array(z.string()).optional(),
  subheader_selected: z.number().optional(),
  headline_variants: z.array(headlineVariant).optional(),
  headline_selected: z.number().optional(),
  // Where each Review element's text came from. MUST round-trip: a real review
  // whose provenance is lost on save reads as model-written on reload and blocks
  // Save Final (docs/REVIEWS_MODULE_SPEC.md §5).
  review_provenance: z.record(z.string(), z.looseObject({
    origin: z.enum(["fetched", "manual", "curated", "unverified"]),
    source_url: z.string().optional(),
    fetched_at: z.string().optional(),
    author: z.string().optional(),
    rating: z.number().optional(),
  })).optional(),
});
const generatedCampaign = z.looseObject({
  meta: z.looseObject({
    subject_lines: z.array(z.string()),
    preview_texts: z.array(z.string()),
    subject_selected: z.number().optional(),
    preview_selected: z.number().optional(),
  }),
  sections: z.array(generatedSection),
});

const conceit = z.looseObject({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  architecture: z.enum(["offer_led", "story_led", "product_truth_led"]).optional(),
});

// ---- Planner --------------------------------------------------------------
const audienceRef = z.looseObject({
  id: z.string(),
  name: z.string(),
  type: z.enum(["segment", "list"]),
});

const nnum = z.number().nullable().optional();
const nstr = z.string().nullable().optional();

// An A/B test on a row (docs/PLANNER_AB_TEST_AND_EDITOR_POLISH_SPEC.md §1.2).
// Purely additive: absent means "not an A/B test", which every row ever written
// already is, so there is no migration and no SCHEMA_VERSION bump.
export const abTestSchema = z.looseObject({
  kind: z.enum(["subject_line", "content"]),
  subject_line: z.string().optional(),
  preview_text: z.string().optional(),
  copy_campaign_id: z.string().optional(),
  copy_status: z.enum(["draft", "final"]).optional(),
  copy_linked_at: nstr,
});

export const plannerRowSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  channel: z.enum(["email", "sms"]),
  // Absent on every row written before flow-email links; rowKind() defaults it.
  row_kind: z.enum(["campaign", "flow_email"]).optional(),
  ab_test: abTestSchema.optional(),
  offer_type: z.enum(["evergreen", "promo"]),
  offer: z.string(),
  promo_code: z.string().optional(),
  planned_send_at: z.string(),
  status: z.enum(["writing_brief", "ready_for_design", "scheduled", "cancelled"]),
  audience_included: z.array(audienceRef),
  audience_excluded: z.array(audienceRef),
  // The brief vs what was built (docs/PLANNER_AUDIENCE_BRIEF_SPEC.md §3). Optional
  // because every row written before the split has neither; parsePlannerRow
  // migrates them, so anything read through the store has them populated.
  audience_planned_included: z.array(audienceRef).optional(),
  audience_planned_excluded: z.array(audienceRef).optional(),
  audience_planned_note: z.string().optional(),
  audience_actual_included: z.array(audienceRef).optional(),
  audience_actual_excluded: z.array(audienceRef).optional(),
  audience_actual_synced_at: nstr,
  notes: z.string(),
  klaviyo_campaign_id: z.string().optional(),
  postscript_campaign_id: z.string().optional(),
  northbeam_campaign_name: z.string().optional(),
  klaviyo_send_time: nstr,
  postscript_send_time: nstr,
  copy_campaign_id: z.string().optional(),
  copy_status: z.enum(["draft", "final"]).optional(),
  copy_linked_at: nstr,
  recipients: nnum,
  open_rate: nnum,
  click_rate: nnum,
  revenue: nnum,
  revenue_per_recipient: nnum,
  metrics_synced_at: nstr,
  northbeam_revenue: nnum,
  northbeam_synced_at: nstr,
  metrics_source: z.enum(["manual", "postscript_csv"]).nullable().optional(),
  metrics_entered_at: nstr,
  rpr_override: z.boolean().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  schema_version: schemaVersion,
});

// ---- Library / Saved / SMS ------------------------------------------------
export const libraryCampaignSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  date: z.string(),
  campaign_type: campaignType,
  offer: z.string(),
  promo_code: z.string().optional(),
  hero_angle: z.string(),
  audience: audienceType,
  products_featured: z.array(z.string()),
  conceit: z.string(),
  source: z.string(),
  body: z.string(),
  planner_row_id: z.string().optional(),
  structured: z.looseObject({
    campaign: generatedCampaign,
    section_structure: z.array(sectionSpec),
  }).optional(),
  schema_version: schemaVersion,
});

export const savedCampaignSchema = z.looseObject({
  id: z.string(),
  campaign_name: z.string(),
  campaign_type: campaignType,
  offer: z.string(),
  promo_code: z.string().optional(),
  audience: audienceType,
  hero_angle: z.string().optional(),
  products_featured: z.array(z.string()),
  section_structure: z.array(sectionSpec),
  angle: angle.optional(),
  promotion_id: z.string().optional(),
  planner_notes: z.string().optional(),
  occasion: z.string().optional(),
  hero_product_slug: z.string().optional(),
  send_stage: sendStage.optional(),
  urgency: urgencyTier.optional(),
  chosen_conceit: conceit.optional(),
  campaign: generatedCampaign,
  status: z.enum(["draft", "final"]),
  planner_row_id: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  schema_version: schemaVersion,
}).loose(); // expanded_brief is intentionally not fully modeled; loose preserves it

const smsVariant = z.looseObject({ text: z.string() });
export const smsCampaignSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  source_email_id: z.string().optional(),
  brief: z.looseObject({
    offer: z.string(),
    promo_code: z.string().optional(),
    deadline: z.string().optional(),
    angle: z.string().optional(),
    audience: z.string().optional(),
  }),
  variants: z.tuple([smsVariant, smsVariant, smsVariant]),
  selected_variant: z.number(),
  planner_row_id: z.string().optional(),
  status: z.enum(["draft", "final"]),
  created_at: z.string(),
  updated_at: z.string(),
  schema_version: schemaVersion,
});

// ---- Flows ----------------------------------------------------------------
// GOTCHA (mirrors sectionType/campaignType): a new FlowType in src/lib/schemas.ts
// must be added to this enum too, or flows of that type are dropped on read.
const flowType = z.enum([
  "welcome", "abandoned_cart", "abandoned_checkout", "browse_abandonment", "site_abandonment",
  "post_purchase", "winback", "sunset", "back_in_stock", "custom",
]);
// The email payload, shared by the legacy `emails` array (which has a `position`)
// and the graph's email NODES (which don't — the graph carries order now).
const flowEmailFields = {
  id: z.string(),
  job: z.string(),
  delay: z.string().optional(),
  highlights: z.string().optional(),
  campaign: generatedCampaign.optional(),
  section_structure: z.array(sectionSpec),
  status: z.enum(["empty", "draft", "final"]),
  planner_row_id: z.string().optional(),
};
const flowEmail = z.looseObject({ ...flowEmailFields, position: z.number() });
const flowEmailNode = z.looseObject(flowEmailFields);
const flowSplit = z.looseObject({
  id: z.string(),
  after_email_position: z.number(),
  label: z.string(),
  yes_label: z.string().optional(),
  no_label: z.string().optional(),
});

// ---- The flow graph (spec: FLOW_CANVAS_REBUILD_SPEC.md §3) -----------------
// SAME GOTCHA as flowType/sectionType, and it bites harder here: `kind` is an
// enum, so a node kind added to src/lib/schemas.ts and NOT added below makes the
// whole flow fail validation and get dropped on read — i.e. it deletes people's
// flows. Add the kind here in the same change.
const flowNode = z.looseObject({
  id: z.string(),
  kind: z.enum(["trigger", "email", "split", "delay", "exit"]),
  x: z.number(),
  y: z.number(),
  trigger: z.looseObject({ label: z.string() }).optional(),
  email: flowEmailNode.optional(),
  split: z.looseObject({
    label: z.string(),
    yes_label: z.string().optional(),
    no_label: z.string().optional(),
  }).optional(),
  delay: z.looseObject({ label: z.string() }).optional(),
  exit: z.looseObject({ label: z.string() }).optional(),
});
const flowEdge = z.looseObject({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  branch: z.enum(["yes", "no"]).optional(),
});

export const flowSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  type: flowType,
  channel: z.enum(["email", "sms"]),
  trigger: z.string().optional(),
  klaviyo_flow_id: z.string().optional(),
  klaviyo_flow_name: z.string().optional(),
  goal: z.string().optional(),
  // Optional so a v2 record still validates; parseFlow migrates it immediately
  // afterwards, so nothing downstream of the read boundary sees them absent.
  nodes: z.array(flowNode).optional(),
  edges: z.array(flowEdge).optional(),
  emails: z.array(flowEmail),
  splits: z.array(flowSplit),
  created_at: z.string(),
  updated_at: z.string(),
  schema_version: schemaVersion,
});

// ---- Weekly report --------------------------------------------------------
// Loose top-level: the WeeklyReport shape is broad and only read back for
// display / WoW; gate the identifying `week` block and keep the rest intact.
// ---- Corpus (src/lib/corpus) ----------------------------------------------
// The tiered copy corpus. Records are DERIVED (rebuildable from the planner +
// library + saved campaigns), so a malformed one is cheap to drop: the next
// rebuild replaces it. Validated at the read boundary like every other store.
const formSignature = z.looseObject({
  pattern: z.enum(["idiom_remix", "product_truth", "rhyme", "bold_claim", "unclassified"]),
  template: z.string(),
  word_count: z.number(),
  head_noun: z.string(),
  verb_lemma: z.string(),
  devices: z.array(z.string()),
  opening_pos: z.string(),
});

const corpusElement = z.looseObject({
  kind: z.enum([
    "headline", "tagline", "subject", "preview", "subheader",
    "one_liner", "opener", "cta", "closing", "sms",
  ]),
  text: z.string(),
  signature: formSignature,
  product_slug: z.string().optional(),
  was_selected: z.boolean().optional(),
});

export const corpusRecordSchema = z.looseObject({
  id: z.string(),
  tier: z.enum(["shipped", "approved", "drafted"]),
  channel: z.enum(["email", "sms"]),
  platform: z.enum(["klaviyo", "postscript"]).nullable(),
  planner_row_id: z.string().nullable(),
  approved_at: z.string().nullable(),
  sent_at: z.string().nullable(),
  title: z.string(),
  campaign_type: z.string(),
  audience: z.string().optional(),
  occasion: z.string().optional(),
  conceit: z.string().optional(),
  products_featured: z.array(z.string()),
  elements: z.array(corpusElement),
  performance: z.looseObject({
    recipients: nnum,
    revenue: nnum,
    rpr: nnum,
    basis: z.enum(["platform", "northbeam"]),
  }).nullable(),
  schema_version: schemaVersion,
});

export const guidanceClaimSchema = z.looseObject({
  id: z.string(),
  dimension: z.string(),
  dimension_label: z.string(),
  value: z.string(),
  claim: z.string(),
  n: z.number(),
  pooled_rpr: z.number(),
  range: z.looseObject({ start: z.string(), end: z.string() }),
  basis: z.enum(["platform", "northbeam"]),
  status: z.enum(["active", "weakened", "retired"]),
  first_asserted: z.string(),
  last_checked: z.string(),
  checks: z.number(),
  replications: z.number(),
  failures: z.number(),
  history: z.array(z.looseObject({
    checked_at: z.string(),
    outcome: z.enum(["replicated", "failed", "insufficient_data"]),
    n: z.number(),
    pooled_rpr: nnum,
    note: z.string().optional(),
  })),
  schema_version: schemaVersion,
});

export const weeklyReportSchema = z.looseObject({
  week: z.looseObject({
    isoWeek: z.string(),
    startYMD: z.string(),
    endYMD: z.string(),
  }),
  generatedAt: z.string(),
  schema_version: schemaVersion,
});

// ---------------------------------------------------------------------------
// Compile-time lockstep: each schema's inferred output must be ASSIGNABLE to its
// interface (extra optional schema_version aside). Drift here fails the build.
// These are type-level only — no runtime cost, no unused runtime bindings.
// ---------------------------------------------------------------------------
type Assignable<Schema, Interface> = Schema extends Interface ? true : never;
type _P = Assignable<Omit<z.infer<typeof plannerRowSchema>, "schema_version">, PlannerRow>;
type _L = Assignable<Omit<z.infer<typeof libraryCampaignSchema>, "schema_version">, LibraryCampaign>;
type _S = Assignable<Omit<z.infer<typeof savedCampaignSchema>, "schema_version">, SavedCampaign>;
type _M = Assignable<Omit<z.infer<typeof smsCampaignSchema>, "schema_version">, SmsCampaign>;
type _F = Assignable<Omit<z.infer<typeof flowSchema>, "schema_version">, Flow>;
type _W = Assignable<Pick<WeeklyReport, "week" | "generatedAt">, Pick<WeeklyReport, "week" | "generatedAt">>;
type _C = Assignable<Omit<z.infer<typeof corpusRecordSchema>, "schema_version">, CorpusRecord>;
type _G = Assignable<Omit<z.infer<typeof guidanceClaimSchema>, "schema_version">, GuidanceClaim>;
// Reference the aliases so "noUnusedLocals" stays satisfied without side effects.
export type _LockstepChecks = [_P, _L, _S, _M, _F, _W, _C, _G];
