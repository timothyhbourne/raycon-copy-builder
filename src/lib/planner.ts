import path from "path";
import { getAdapter } from "./storage";
import { parsePlannerRows, stampAll } from "./validation";
import type { PlannerRow, SyncedMetrics, ManualMetricsPatch } from "./planner-types";

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

async function readAll(): Promise<PlannerRow[]> {
  const raw = await store.read(STORE_KEY);
  if (raw == null) return []; // absent store → empty planner
  try {
    // Validate + migrate every row at the boundary (lib/validation): legacy
    // shapes (free-typed audiences, old status/offer_type) are repaired, and a
    // malformed row is logged and dropped instead of poisoning the list.
    return parsePlannerRows(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function writeAll(rows: PlannerRow[]): Promise<void> {
  // On the file backend the adapter absorbs read-only-FS failures (logs, no-op),
  // so a save on a file-only deploy doesn't crash — it just isn't durable. The
  // Redis backend makes it durable across serverless invocations. stampAll marks
  // each row with the current schema_version for future migrations.
  await store.write(STORE_KEY, JSON.stringify(stampAll(rows), null, 2));
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
    // The brief is never touched by anything but an explicit edit — that is the
    // guarantee the whole split exists for, so a sync writing `actual` cannot
    // clobber it (spec §5.2).
    audience_planned_included: input.audience_planned_included ?? existing?.audience_planned_included ?? [],
    audience_planned_excluded: input.audience_planned_excluded ?? existing?.audience_planned_excluded ?? [],
    notes: input.notes ?? existing?.notes ?? "",
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  // The legacy audience pair is DERIVED for one release
  // (docs/PLANNER_AUDIENCE_BRIEF_SPEC.md §3): what was built if we know it, else
  // the brief. Anything still reading the old fields therefore sees the best
  // available answer, and the two can't drift apart while both exist.
  const actualIn = merged.audience_actual_included;
  const actualEx = merged.audience_actual_excluded;
  const derived: PlannerRow = {
    ...merged,
    audience_included: (actualIn?.length ? actualIn : merged.audience_planned_included) ?? merged.audience_included ?? [],
    audience_excluded: (actualEx?.length ? actualEx : merged.audience_planned_excluded) ?? merged.audience_excluded ?? [],
  };

  const next = existing ? rows.map((r) => (r.id === id ? derived : r)) : [...rows, derived];
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
// fields untouched. Accepts a Partial so the independent Northbeam pass can
// write just { northbeam_revenue, northbeam_synced_at } without clobbering the
// Klaviyo/Postscript metrics written earlier in the same sync (each call re-reads
// the store, so a later partial write merges onto the earlier one).
export async function writeSyncedMetrics(id: string, metrics: Partial<SyncedMetrics>): Promise<PlannerRow | null> {
  if (!isSafeId(id)) return null;
  const rows = await readAll();
  const idx = rows.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  rows[idx] = { ...rows[idx], ...metrics, updated_at: new Date().toISOString() };
  await writeAll(rows);
  return rows[idx];
}

// Manually-entered platform metrics (SMS rows: numbers typed in from the
// Postscript dashboard — its public API has no analytics; see the SMS spec).
// Rules:
//   - Only the fields present in the patch change; `null` clears a value
//     (empty ≠ 0 — zero is a real entered value).
//   - revenue_per_recipient: a number in the patch is a manual OVERRIDE and
//     sticks; `null` clears the override; while un-overridden it re-derives
//     from revenue/recipients on every write (and clears when either is empty).
//   - Every write stamps metrics_source: "manual" + metrics_entered_at, which
//     structurally blocks the sync route from ever overwriting these fields.
export async function writeManualMetrics(id: string, patch: ManualMetricsPatch): Promise<PlannerRow | null> {
  if (!isSafeId(id)) return null;
  const rows = await readAll();
  const idx = rows.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const row = rows[idx];

  const next: PlannerRow = { ...row };
  if ("recipients" in patch) next.recipients = patch.recipients ?? null;
  if ("click_rate" in patch) next.click_rate = patch.click_rate ?? null;
  if ("revenue" in patch) next.revenue = patch.revenue ?? null;
  if ("revenue_per_recipient" in patch) {
    if (patch.revenue_per_recipient == null) {
      next.rpr_override = false; // cleared → back to derived
    } else {
      next.rpr_override = true;
      next.revenue_per_recipient = patch.revenue_per_recipient;
    }
  }
  if (!next.rpr_override) {
    next.revenue_per_recipient = next.revenue != null && next.recipients != null && next.recipients > 0
      ? next.revenue / next.recipients
      : null;
  }
  next.metrics_source = "manual";
  next.metrics_entered_at = new Date().toISOString();
  next.updated_at = next.metrics_entered_at;

  rows[idx] = next;
  await writeAll(rows);
  return next;
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
    // Status is left untouched: attaching copy no longer auto-advances the plan.
    // The writer bumps it to "ready_for_design" explicitly (the design-handoff
    // action), so linking a draft mid-write doesn't jump the stage.
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
