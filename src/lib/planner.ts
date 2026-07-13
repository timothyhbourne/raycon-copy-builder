import path from "path";
import { getAdapter } from "./storage";
import type { PlannerRow, SyncedMetrics, AudienceRef } from "./planner-types";

// Store for the Campaign Planner: a single JSON array behind the shared storage
// adapter (lib/storage.ts). The adapter is file-backed today and swaps to a KV
// backend (Stage 1) with no change here — the CRUD surface below is deliberately
// small so that swap stays localized. On a read-only filesystem the file adapter
// degrades gracefully (read → empty, write → no-op + warn) rather than crashing.

const DATA_ROOT = path.join(process.cwd(), "data");
const STORE_KEY = "campaign-planner.json";
const store = getAdapter(DATA_ROOT, "planner");

// ids come from network input and are interpolated nowhere unsafe, but we still
// validate to keep the store keys clean and predictable.
function isSafeId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_-]+$/.test(id);
}

// Read-time backfill so rows saved under older shapes keep working without a
// manual data wipe: (1) audiences that were free-typed strings become
// AudienceRef objects; (2) offer_type is inferred from whether a promo_code
// exists.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function backfillAudience(raw: any): AudienceRef[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a): AudienceRef | null => {
      if (typeof a === "string") return a.trim() ? { id: "", name: a.trim(), type: "segment" } : null;
      if (a && typeof a === "object" && typeof a.name === "string") {
        return { id: typeof a.id === "string" ? a.id : "", name: a.name, type: a.type === "list" ? "list" : "segment" };
      }
      return null;
    })
    .filter((a): a is AudienceRef => a !== null);
}

// Migrate a legacy status literal to the current model. New values pass through;
// anything unrecognised falls back to the first stage.
//   idea → writing_brief, draft → planned, sent → scheduled,
//   scheduled_in_klaviyo (prior model) → scheduled, cancelled → cancelled
function backfillStatus(s: unknown): PlannerRow["status"] {
  switch (s) {
    case "writing_brief": case "planned": case "scheduled": case "cancelled":
      return s;
    case "idea": return "writing_brief";
    case "draft": return "planned";
    case "sent": case "scheduled_in_klaviyo": return "scheduled";
    default: return "writing_brief";
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function backfillRow(r: any): PlannerRow {
  const offer_type = r.offer_type === "evergreen" || r.offer_type === "promo"
    ? r.offer_type
    : (r.promo_code ? "promo" : "evergreen");
  return {
    ...r,
    offer_type,
    status: backfillStatus(r.status),
    audience_included: backfillAudience(r.audience_included),
    audience_excluded: backfillAudience(r.audience_excluded),
  } as PlannerRow;
}

async function readAll(): Promise<PlannerRow[]> {
  const raw = await store.read(STORE_KEY);
  if (raw == null) return []; // absent store → empty planner
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(backfillRow) : [];
  } catch {
    return [];
  }
}

async function writeAll(rows: PlannerRow[]): Promise<void> {
  // On the file backend the adapter absorbs read-only-FS failures (logs, no-op),
  // so a save on a file-only deploy doesn't crash — it just isn't durable. The
  // Redis backend makes it durable across serverless invocations.
  await store.write(STORE_KEY, JSON.stringify(rows, null, 2));
}

export async function listPlannerRows(): Promise<PlannerRow[]> {
  return (await readAll()).sort((a, b) => (a.planned_send_at || "").localeCompare(b.planned_send_at || ""));
}

export async function getPlannerRow(id: string): Promise<PlannerRow | null> {
  if (!isSafeId(id)) return null;
  return (await readAll()).find((r) => r.id === id) ?? null;
}

// Upsert by id. Callers may omit id for a new row — we mint a safe one from the
// name. created_at/updated_at are managed here; synced metric fields are
// preserved from the existing row unless explicitly provided.
export async function upsertPlannerRow(input: Partial<PlannerRow> & { name: string; channel: PlannerRow["channel"] }): Promise<PlannerRow> {
  const rows = await readAll();
  const now = new Date().toISOString();

  let id = input.id;
  if (!id || !isSafeId(id)) {
    const base = slugify(input.name) || "campaign";
    id = uniqueId(base, rows);
  }

  const existing = rows.find((r) => r.id === id);
  const merged: PlannerRow = {
    // defaults
    recipients: null,
    open_rate: null,
    click_rate: null,
    revenue: null,
    revenue_per_recipient: null,
    metrics_synced_at: null,
    ...existing,
    ...input,
    id,
    name: input.name,
    channel: input.channel,
    offer_type: input.offer_type ?? existing?.offer_type ?? "evergreen",
    offer: input.offer ?? existing?.offer ?? "",
    planned_send_at: input.planned_send_at ?? existing?.planned_send_at ?? now,
    status: input.status ?? existing?.status ?? "writing_brief",
    audience_included: input.audience_included ?? existing?.audience_included ?? [],
    audience_excluded: input.audience_excluded ?? existing?.audience_excluded ?? [],
    notes: input.notes ?? existing?.notes ?? "",
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  const next = existing ? rows.map((r) => (r.id === id ? merged : r)) : [...rows, merged];
  await writeAll(next);
  return merged;
}

export async function deletePlannerRow(id: string): Promise<boolean> {
  if (!isSafeId(id)) return false;
  const rows = await readAll();
  const next = rows.filter((r) => r.id !== id);
  if (next.length === rows.length) return false;
  await writeAll(next);
  return true;
}

// Write back synced metrics onto a row (used by the sync route). Leaves plan
// fields untouched.
export async function writeSyncedMetrics(id: string, metrics: SyncedMetrics): Promise<PlannerRow | null> {
  if (!isSafeId(id)) return null;
  const rows = await readAll();
  const idx = rows.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  rows[idx] = { ...rows[idx], ...metrics, updated_at: new Date().toISOString() };
  await writeAll(rows);
  return rows[idx];
}

// Attach a Copy Builder campaign to a row (used by the /api/planner/link route).
// Merges only the copy-link fields + a gentle status nudge; leaves every plan
// field AND every synced-metric field untouched (same discipline as
// writeSyncedMetrics — a link write must never wipe metrics).
export async function linkCopyCampaign(
  rowId: string,
  copyCampaignId: string,
  copyStatus: "draft" | "final",
): Promise<PlannerRow | null> {
  if (!isSafeId(rowId)) return null;
  const rows = await readAll();
  const idx = rows.findIndex((r) => r.id === rowId);
  if (idx === -1) return null;
  const now = new Date().toISOString();
  rows[idx] = {
    ...rows[idx],
    copy_campaign_id: copyCampaignId,
    copy_status: copyStatus,
    copy_linked_at: now,
    // Nudge the plan forward only from the initial "writing brief" stage. Never
    // downgrade a row that's already scheduled in Klaviyo (or cancelled).
    status: rows[idx].status === "writing_brief" ? "planned" : rows[idx].status,
    updated_at: now,
  };
  await writeAll(rows);
  return rows[idx];
}

// Clear a stale/broken copy link (used to heal when the saved campaign was
// deleted). Only touches the three copy-link fields.
export async function unlinkCopyCampaign(rowId: string): Promise<PlannerRow | null> {
  if (!isSafeId(rowId)) return null;
  const rows = await readAll();
  const idx = rows.findIndex((r) => r.id === rowId);
  if (idx === -1) return null;
  rows[idx] = {
    ...rows[idx],
    copy_campaign_id: undefined,
    copy_status: undefined,
    copy_linked_at: null,
    updated_at: new Date().toISOString(),
  };
  await writeAll(rows);
  return rows[idx];
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

function uniqueId(base: string, rows: PlannerRow[]): string {
  const taken = new Set(rows.map((r) => r.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
