import fs from "fs";
import path from "path";
import type { PlannerRow, SyncedMetrics } from "./planner-types";

// File-backed store for the Campaign Planner. Single JSON array on disk,
// mirroring the repo's existing file-store pattern (lib/campaigns.ts).
//
// LIMITATION: this is single-process and file-based — fine for one editor in
// dev / a single server instance. If the planner becomes multi-editor in
// production (concurrent writes, multiple workers), move it to SQLite/Postgres;
// the CRUD surface here is intentionally small so that swap is localized.

const STORE_PATH = path.join(process.cwd(), "data/campaign-planner.json");

// ids come from network input and are interpolated nowhere unsafe, but we still
// validate to keep the store keys clean and predictable.
function isSafeId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_-]+$/.test(id);
}

function ensureStore(): void {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, "[]", "utf8");
}

function readAll(): PlannerRow[] {
  ensureStore();
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PlannerRow[]) : [];
  } catch {
    return [];
  }
}

function writeAll(rows: PlannerRow[]): void {
  ensureStore();
  fs.writeFileSync(STORE_PATH, JSON.stringify(rows, null, 2), "utf8");
}

export function listPlannerRows(): PlannerRow[] {
  return readAll().sort((a, b) => (a.planned_send_at || "").localeCompare(b.planned_send_at || ""));
}

export function getPlannerRow(id: string): PlannerRow | null {
  if (!isSafeId(id)) return null;
  return readAll().find((r) => r.id === id) ?? null;
}

// Upsert by id. Callers may omit id for a new row — we mint a safe one from the
// name. created_at/updated_at are managed here; synced metric fields are
// preserved from the existing row unless explicitly provided.
export function upsertPlannerRow(input: Partial<PlannerRow> & { name: string; channel: PlannerRow["channel"] }): PlannerRow {
  const rows = readAll();
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
    offer: input.offer ?? existing?.offer ?? "",
    planned_send_at: input.planned_send_at ?? existing?.planned_send_at ?? now,
    status: input.status ?? existing?.status ?? "idea",
    audience_included: input.audience_included ?? existing?.audience_included ?? [],
    audience_excluded: input.audience_excluded ?? existing?.audience_excluded ?? [],
    notes: input.notes ?? existing?.notes ?? "",
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  const next = existing ? rows.map((r) => (r.id === id ? merged : r)) : [...rows, merged];
  writeAll(next);
  return merged;
}

export function deletePlannerRow(id: string): boolean {
  if (!isSafeId(id)) return false;
  const rows = readAll();
  const next = rows.filter((r) => r.id !== id);
  if (next.length === rows.length) return false;
  writeAll(next);
  return true;
}

// Write back synced metrics onto a row (used by the sync route). Leaves plan
// fields untouched.
export function writeSyncedMetrics(id: string, metrics: SyncedMetrics): PlannerRow | null {
  if (!isSafeId(id)) return null;
  const rows = readAll();
  const idx = rows.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  rows[idx] = { ...rows[idx], ...metrics, updated_at: new Date().toISOString() };
  writeAll(rows);
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
