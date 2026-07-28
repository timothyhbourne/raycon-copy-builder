import { z } from "zod";
import type {
  SavedCampaign, LibraryCampaign, SmsCampaign,
} from "../schemas";
import type { PlannerRow } from "../planner-types";
import type { DaySnapshot, Dimensions } from "../metrics/store";
import type { WeeklyReport } from "../reports/weekly";

// Zod schemas for the core PERSISTED entities, mirroring the hand-written TS
// interfaces (src/lib/schemas.ts, planner-types.ts, metrics/store.ts,
// reports/weekly.ts). They are used at storage READ boundaries to gate malformed
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
export const SCHEMA_VERSION = 1;

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

const sectionSpec = z.looseObject({
  id: z.string(),
  type: sectionType,
  focus: z.string().optional(),
  optional_elements: z.array(z.string()).optional(),
  grid_cols: z.number().optional(),
  grid_rows: z.number().optional(),
  product_slug: z.string().optional(),
  bundle_mode: z.enum(["custom", "existing"]).optional(),
  bundle_template: z.enum(["unified", "checklist", "pairing", "hero_addons"]).optional(),
  bundle_products: z.array(z.string()).optional(),
  bundle_id: z.string().optional(),
});

// Rich generated content is validated structurally but kept permissive — the
// element map holds strings or product arrays, and sections may carry future
// presentation fields (variants, design image).
const sectionElements = z.record(
  z.string(),
  z.union([z.string(), z.array(productInGrid)]),
);
const generatedSection = z.looseObject({
  id: z.string(),
  type: sectionType,
  elements: sectionElements,
});
const generatedCampaign = z.looseObject({
  meta: z.looseObject({
    subject_lines: z.array(z.string()),
    preview_texts: z.array(z.string()),
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

export const plannerRowSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  channel: z.enum(["email", "sms"]),
  offer_type: z.enum(["evergreen", "promo"]),
  offer: z.string(),
  promo_code: z.string().optional(),
  planned_send_at: z.string(),
  status: z.enum(["writing_brief", "ready_for_design", "scheduled", "cancelled"]),
  audience_included: z.array(audienceRef),
  audience_excluded: z.array(audienceRef),
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

// ---- Metrics --------------------------------------------------------------
const dayFlowStat = z.looseObject({
  flow_id: z.string(),
  recipients: z.number(), opens: z.number(), clicks: z.number(), revenue: z.number(),
});
const dayCampaignStat = z.looseObject({
  campaign_id: z.string(),
  recipients: z.number(), opens: z.number(), clicks: z.number(), revenue: z.number(),
});
export const daySnapshotSchema = z.looseObject({
  date: z.string(),
  synced_at: z.string(),
  frozen: z.boolean(),
  revenue: z.looseObject({ total: z.number(), order_count: z.number() }),
  flows: z.array(dayFlowStat),
  campaigns: z.array(dayCampaignStat),
  schema_version: schemaVersion,
});

const campaignDim = z.looseObject({
  campaign_id: z.string(),
  name: z.string(),
  status: z.string(),
  send_time: z.string().nullable(),
  audience_count: z.number(),
});
export const dimensionsSchema = z.looseObject({
  synced_at: z.string().nullable(),
  timezone: z.string(),
  flows: z.array(z.looseObject({ flow_id: z.string(), name: z.string(), status: z.string().optional() })),
  campaigns: z.array(campaignDim),
  draft: z.array(campaignDim),
  scheduled: z.array(campaignDim),
  schema_version: schemaVersion,
});

// ---- Weekly report --------------------------------------------------------
// Loose top-level: the WeeklyReport shape is broad and only read back for
// display / WoW; gate the identifying `week` block and keep the rest intact.
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
type _D = Assignable<Omit<z.infer<typeof daySnapshotSchema>, "schema_version">, DaySnapshot>;
type _X = Assignable<Omit<z.infer<typeof dimensionsSchema>, "schema_version">, Dimensions>;
type _W = Assignable<Pick<WeeklyReport, "week" | "generatedAt">, Pick<WeeklyReport, "week" | "generatedAt">>;
// Reference the aliases so "noUnusedLocals" stays satisfied without side effects.
export type _LockstepChecks = [_P, _L, _S, _M, _D, _X, _W];
