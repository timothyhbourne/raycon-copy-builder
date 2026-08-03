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

export const designSectionBody = looseObj({
  section_type: z.string(),
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

// ---- persistence: bodies that ARE an entity -------------------------------
export const campaignPostBody = savedCampaignSchema;
export const smsPostBody = smsCampaignSchema;
export const flowPostBody = flowSchema;

export const finalizeBody = looseObj({
  id: safeIdSchema,
  brief_input: z.unknown(),
  campaign: z.unknown(),
  draft_id: safeIdSchema.optional(),
});

// ---- metrics sync: optional supplementary body (query params also allowed) --
export const metricsSyncBody = looseObj({
  backfill_days: z.union([z.number(), z.string()]).optional(),
  start: z.string().optional(),
  end: z.string().optional(),
});
