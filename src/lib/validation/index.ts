import type { ZodType } from "zod";
import type { SavedCampaign, LibraryCampaign, SmsCampaign, Flow } from "../schemas";
import type { PlannerRow, AudienceRef } from "../planner-types";
import type { WeeklyReport } from "../reports/weekly";
import {
  SCHEMA_VERSION,
  plannerRowSchema, libraryCampaignSchema, savedCampaignSchema,
  smsCampaignSchema, flowSchema, weeklyReportSchema,
  corpusRecordSchema, guidanceClaimSchema,
} from "./schemas";
import type { CorpusRecord } from "../corpus/types";
import type { GuidanceClaim } from "../corpus/ledger-types";
import { migrateLinearFlowToGraph, withGraph } from "../flow-graph";
import { FLOW_PLAYBOOKS } from "../flow-playbooks";
import { nanoid } from "../nanoid";

export { SCHEMA_VERSION } from "./schemas";

// Validation layer for persisted data. Every storage READ boundary parses raw
// JSON through a schema here: a malformed record is logged and dropped/repaired
// rather than becoming a wrongly-typed object (the old `as Partial<X>` hazard) or
// crashing a whole list. Every WRITE stamps `schema_version` so future shape
// changes can be migrated explicitly.

// Structured, rate-friendly warning — one line per bad record, never a throw.
function warnBad(entity: string, id: unknown, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  console.warn(`[validation] dropped malformed ${entity}${id != null ? ` (${String(id)})` : ""}: ${detail.slice(0, 300)}`);
}

// Validate one record against `schema`. Returns the (loose-preserved) value typed
// as T, or null on failure. The schema is loose so unknown/rich fields survive.
function parseOne<T>(schema: ZodType, raw: unknown, entity: string): T | null {
  const res = schema.safeParse(raw);
  if (!res.success) {
    warnBad(entity, (raw as { id?: unknown })?.id, res.error);
    return null;
  }
  return res.data as T;
}

// Validate a list, dropping (and logging) only the bad rows — one corrupt record
// never takes down the whole collection.
function parseList<T>(schema: ZodType, raw: unknown, entity: string): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const item of raw) {
    const parsed = parseOne<T>(schema, item, entity);
    if (parsed) out.push(parsed);
  }
  return out;
}

// Stamp the current schema_version onto a record about to be written.
export function stamp<T extends object>(record: T): T & { schema_version: number } {
  return { ...record, schema_version: SCHEMA_VERSION };
}
export function stampAll<T extends object>(records: T[]): (T & { schema_version: number })[] {
  return records.map(stamp);
}

// ---- Planner: validate + MIGRATE legacy shapes ----------------------------
// Folds the former `backfillRow` / `backfillAudience` / `backfillStatus` (which
// were `any`-typed) into one typed migration: normalise a raw row to the current
// shape, THEN validate. Unknown records are dropped with a warning.
function migrateAudience(raw: unknown): AudienceRef[] {
  if (!Array.isArray(raw)) return [];
  const out: AudienceRef[] = [];
  for (const a of raw) {
    if (typeof a === "string") {
      if (a.trim()) out.push({ id: "", name: a.trim(), type: "segment" });
    } else if (a && typeof a === "object") {
      const o = a as { id?: unknown; name?: unknown; type?: unknown };
      if (typeof o.name === "string") {
        out.push({ id: typeof o.id === "string" ? o.id : "", name: o.name, type: o.type === "list" ? "list" : "segment" });
      }
    }
  }
  return out;
}

function migrateStatus(s: unknown): PlannerRow["status"] {
  switch (s) {
    case "writing_brief": case "ready_for_design": case "scheduled": case "cancelled":
      return s;
    // "planned" was removed — legacy rows (and old "idea"/"draft") fold back to
    // the working state; the writer bumps them to ready_for_design explicitly.
    case "idea": case "planned": case "draft": return "writing_brief";
    case "sent": case "scheduled_in_klaviyo": return "scheduled";
    default: return "writing_brief";
  }
}

export function parsePlannerRow(raw: unknown): PlannerRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const offer_type = r.offer_type === "evergreen" || r.offer_type === "promo"
    ? r.offer_type
    : (r.promo_code ? "promo" : "evergreen");
  const migrated = {
    ...r,
    offer_type,
    status: migrateStatus(r.status),
    audience_included: migrateAudience(r.audience_included),
    audience_excluded: migrateAudience(r.audience_excluded),
  };
  return parseOne<PlannerRow>(plannerRowSchema, migrated, "planner_row");
}

export function parsePlannerRows(raw: unknown): PlannerRow[] {
  if (!Array.isArray(raw)) return [];
  const out: PlannerRow[] = [];
  for (const item of raw) {
    const row = parsePlannerRow(item);
    if (row) out.push(row);
  }
  return out;
}

// ---- The rest: straight validation ----------------------------------------
export const parseLibraryCampaigns = (raw: unknown): LibraryCampaign[] =>
  parseList<LibraryCampaign>(libraryCampaignSchema, raw, "library_campaign");

export const parseSavedCampaign = (raw: unknown): SavedCampaign | null =>
  parseOne<SavedCampaign>(savedCampaignSchema, raw, "saved_campaign");

export const parseSmsCampaign = (raw: unknown): SmsCampaign | null =>
  parseOne<SmsCampaign>(smsCampaignSchema, raw, "sms_campaign");

export const parseSmsCampaigns = (raw: unknown): SmsCampaign[] =>
  parseList<SmsCampaign>(smsCampaignSchema, raw, "sms_campaign");

// ---- Flows: validate, then MIGRATE to the graph model ----------------------
// A flow written before docs/FLOW_CANVAS_REBUILD_SPEC.md is a linear `emails`
// array plus `splits` whose branches were two strings. Migration happens HERE, at
// the read boundary, so a flow gains its graph the first time it is opened and
// every consumer downstream can assume `nodes`/`edges` are present.
//
// Order matters: validate FIRST (the graph is derived from the validated emails
// and splits), then migrate. `ensureGraph` is idempotent, so a flow that already
// has a graph passes through untouched.
//
// The legacy `emails`/`splits` are re-derived from the graph rather than left as
// they were, so the rollback copy can never drift from the structure it mirrors.
export const parseFlow = (raw: unknown): Flow | null => {
  const flow = parseOne<Flow>(flowSchema, raw, "flow");
  if (!flow) return null;
  if (flow.nodes?.length) return flow;
  return withGraph(flow, migrateLinearFlowToGraph(flow, nanoid, FLOW_PLAYBOOKS[flow.type]?.trigger));
};

export const parseFlows = (raw: unknown): Flow[] => {
  if (!Array.isArray(raw)) return [];
  const out: Flow[] = [];
  for (const item of raw) {
    const flow = parseFlow(item);
    if (flow) out.push(flow);
  }
  return out;
};

export const parseWeeklyReports = (raw: unknown): WeeklyReport[] =>
  parseList<WeeklyReport>(weeklyReportSchema, raw, "weekly_report");

export const parseCorpusRecords = (raw: unknown): CorpusRecord[] =>
  parseList<CorpusRecord>(corpusRecordSchema, raw, "corpus_record");

export const parseGuidanceClaims = (raw: unknown): GuidanceClaim[] =>
  parseList<GuidanceClaim>(guidanceClaimSchema, raw, "guidance_claim");
