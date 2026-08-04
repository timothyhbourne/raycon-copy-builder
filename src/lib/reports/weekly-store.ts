import path from "path";
import { getAdapter } from "../storage";
import { parseWeeklyReports, stampAll } from "../validation";
import type { WeeklyReport } from "./weekly";

// Store for weekly report snapshots, mirroring lib/planner.ts and lib/library.ts.
// One JSON array behind the single canonical storage seam (lib/storage.ts),
// keyed by isoWeek ("2026-W27"). File-backed locally (data/weekly-reports.json)
// and Upstash Redis when configured — durable across Vercel's ephemeral,
// read-only-except-/tmp serverless FS. The CRUD surface is async because the KV
// backend is a network call.

const DATA_ROOT = path.join(process.cwd(), "data");
const STORE_KEY = "weekly-reports.json";
const store = getAdapter(DATA_ROOT, "weekly");

// isoWeek is the store key and comes from network input on the read routes;
// validate its exact shape so store keys stay clean.
export function isValidIsoWeek(w: unknown): w is string {
  return typeof w === "string" && /^\d{4}-W\d{2}$/.test(w);
}

async function readAll(): Promise<WeeklyReport[]> {
  const raw = await store.read(STORE_KEY);
  if (raw == null) return []; // absent store → no reports yet
  try {
    // Validate the identifying `week` block at the boundary; a malformed report
    // is logged and skipped instead of breaking the picker / WoW lookup.
    return parseWeeklyReports(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function writeAll(rows: WeeklyReport[]): Promise<void> {
  // File backend absorbs read-only-FS failures (logs, no-op); Redis makes the
  // write durable across serverless invocations. stampAll records schema_version.
  await store.write(STORE_KEY, JSON.stringify(stampAll(rows), null, 2));
}

// Sorted oldest → newest by week start, so "latest"/"previous" are unambiguous.
function sorted(rows: WeeklyReport[]): WeeklyReport[] {
  return [...rows].sort((a, b) => a.week.startYMD.localeCompare(b.week.startYMD));
}

export async function listWeeklyReports(): Promise<WeeklyReport[]> {
  return sorted(await readAll());
}

export async function getWeeklyReport(isoWeek: string): Promise<WeeklyReport | null> {
  if (!isValidIsoWeek(isoWeek)) return null;
  return (await readAll()).find((r) => r.week.isoWeek === isoWeek) ?? null;
}

export async function getLatestWeeklyReport(): Promise<WeeklyReport | null> {
  const rows = sorted(await readAll());
  return rows.length ? rows[rows.length - 1] : null;
}

// The stored report immediately preceding `isoWeek` (by week start) — used to
// fill week-over-week. Compares by date, not array position, so an out-of-order
// insert still resolves the true prior week.
export async function getPreviousWeeklyReport(isoWeek: string): Promise<WeeklyReport | null> {
  const rows = sorted(await readAll());
  const target = rows.find((r) => r.week.isoWeek === isoWeek);
  const cutoff = target?.week.startYMD;
  const priors = cutoff
    ? rows.filter((r) => r.week.startYMD < cutoff)
    : rows; // isoWeek not stored yet → everything on disk is "prior"
  return priors.length ? priors[priors.length - 1] : null;
}

// Upsert by isoWeek (replace same-week snapshot in place).
export async function upsertWeeklyReport(report: WeeklyReport): Promise<WeeklyReport> {
  const rows = await readAll();
  const idx = rows.findIndex((r) => r.week.isoWeek === report.week.isoWeek);
  if (idx === -1) rows.push(report);
  else rows[idx] = report;
  await writeAll(rows);
  return report;
}
