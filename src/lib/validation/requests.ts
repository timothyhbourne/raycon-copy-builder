import { z } from "zod";
import { safeIdSchema } from "./api";
import { savedCampaignSchema, smsCampaignSchema, flowSchema } from "./schemas";

// Request-body schemas for the mutating API routes. Deliberately LOOSE: each one
// validates the fields its handler actually reads (so malformed/missing input is
// a 400, not a downstream crash) while letting extra fields through, so a valid
// but richer payload is never rejected. Entity POSTs reuse the persisted-entity
// schemas from ./schemas.

const looseObj = <T extends z.ZodRawShape>(shape: T) => z.looseObject(shape);

// ---- auth -----------------------------------------------------------------
export const loginBody = looseObj({
  username: z.string().optional(),
  password: z.string().optional(),
});

// ---- planner --------------------------------------------------------------
export const plannerUpsertBody = looseObj({
  name: z.string().min(1, "name is required"),
  channel: z.enum(["email", "sms"]),
  status: z.enum(["writing_brief", "ready_for_design", "scheduled", "cancelled"]).optional(),
});

const nnum = z.number().nullable().optional();
export const manualMetricsBody = looseObj({
  id: safeIdSchema,
  recipients: nnum,
  click_rate: nnum,
  revenue: nnum,
  revenue_per_recipient: nnum,
});

export const plannerLinkBody = looseObj({
  row_id: z.string().optional(),
  copy_campaign_id: z.string().optional(),
  copy_status: z.string().optional(),
  unlink: z.boolean().optional(),
});

export const copySeedBody = looseObj({
  row: looseObj({ name: z.string() }),
  /** Skip the smart-fill model call and return only the deterministic seed —
   *  used by the Copy Builder's "refresh notes from the planner". */
  notes_only: z.boolean().optional(),
});

// ---- copy generation ------------------------------------------------------
// brief_input is rich; validate the fields the pipeline dereferences.
const briefInputLoose = looseObj({
  campaign_type: z.string(),
  products_featured: z.array(z.string()),
  section_structure: z.array(z.unknown()),
});
export const generateBody = looseObj({
  brief_input: briefInputLoose,
  retrieved_examples: z.array(z.unknown()).optional(),
});

export const hardRulesCheckBody = looseObj({
  elements: z.array(z.unknown()),
});

export const checkRepetitionBody = looseObj({
  elements: z.array(z.unknown()),
  exclude_id: z.string().optional(),
});

export const regenerateSectionBody = looseObj({
  section_to_regenerate: looseObj({ type: z.string() }),
});

// One element of one section. `element_key` is the element name ("Body Copy",
// "USP 2") or a grid-item compound key ("Products[2].one_liner").
export const regenerateElementBody = looseObj({
  element_key: z.string().min(1, "element_key is required"),
  section: looseObj({ type: z.string(), elements: z.record(z.string(), z.unknown()) }),
  full_campaign: looseObj({ sections: z.array(z.unknown()) }),
  expanded_brief: looseObj({ campaign_type: z.string() }),
  chosen_conceit: looseObj({ name: z.string() }),
  section_spec: z.unknown().optional(),
  steering: z.string().optional(),
  tone_dial: z.number().optional(),
  retrieved_examples: z.array(z.unknown()).optional(),
});

export const regenerateMetaBody = looseObj({
  expanded_brief: looseObj({ campaign_type: z.string() }),
  library_id: z.string().optional(),
});

const smsBriefLoose = looseObj({ offer: z.string() });
export const smsGenerateBody = looseObj({
  brief: smsBriefLoose,
});
export const smsVariationsBody = looseObj({
  current_sms: z.string(),
  brief: smsBriefLoose,
  feedback: z.string().optional(),
});

// ---- flows ----------------------------------------------------------------
// Generate ONE flow email. `context` carries the email's place in the sequence;
// validate the fields the flow brain dereferences, stay loose on the rest.
const flowContextLoose = looseObj({
  flow_type: z.string(),
  position: z.number(),
  job: z.string(),
});
export const flowGenerateBody = looseObj({
  context: flowContextLoose,
  section_structure: z.array(z.unknown()),
  products_featured: z.array(z.string()).optional(),
});

// ---- copy performance (analytics read) ------------------------------------
// GET query params for /api/copy-performance. Strict (not loose): unknown params
// are ignored by the route, and the four it reads are gated here. channel/basis
// default so a bare ?start&end works.
const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
export const copyPerformanceQuery = z.object({
  start: YMD,
  end: YMD,
  channel: z.enum(["email", "sms", "all"]).default("all"),
  basis: z.enum(["platform", "northbeam"]).default("platform"),
});

// ---- dashboard briefing ----------------------------------------------------
// The client posts the CURRENT range's OverviewData (from its session cache) so
// the route only fetches the prior window. `current` is rich — validate the
// range + that it's an object; the fact-pack builder reads its known fields.
export const briefingBody = looseObj({
  range: looseObj({ start: z.string(), end: z.string() }),
  channel: z.enum(["email", "sms", "all"]).optional(),
  current: looseObj({ revenue: z.unknown(), flows: z.array(z.unknown()), campaigns: z.array(z.unknown()) }),
  includePrior: z.boolean().optional(),
});

// ---- persistence: bodies that ARE an entity -------------------------------
export const campaignPostBody = savedCampaignSchema;
export const smsPostBody = smsCampaignSchema;
export const flowPostBody = flowSchema;

export const finalizeBody = looseObj({
  id: safeIdSchema,
  brief_input: z.unknown(),
  campaign: z.unknown(),
  // nullish, not just optional: the client may send null (no draft yet) and that
  // must not 400 the finalize — it simply means "no draft to clean up".
  draft_id: safeIdSchema.nullish(),
});

// ---- metrics sync: optional supplementary body (query params also allowed) --
export const metricsSyncBody = looseObj({
  backfill_days: z.union([z.number(), z.string()]).optional(),
  start: z.string().optional(),
  end: z.string().optional(),
});
