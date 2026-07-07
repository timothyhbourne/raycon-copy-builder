import fs from "fs";
import path from "path";
import type { WeeklyReport } from "./weekly";

// File-backed store for weekly report snapshots, mirroring lib/planner.ts. One
// JSON array on disk keyed by isoWeek ("2026-W27"). Persisting to the user's
// disk means the team keeps a running history for free.
//
// Same single-process limitation as the planner store — fine for one server
// instance; move to a DB if this becomes multi-writer.

const STORE_PATH = path.join(process.cwd(), "data/weekly-reports.json");

// isoWeek is the store key and comes from network input on the read routes;
// validate its exact shape so store keys stay clean.
export function isValidIsoWeek(w: unknown): w is string {
  return typeof w === "string" && /^\d{4}-W\d{2}$/.test(w);
}

function ensureStore(): void {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, "[]", "utf8");
}

function readAll(): WeeklyReport[] {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    return Array.isArray(parsed) ? (parsed as WeeklyReport[]) : [];
  } catch {
    return [];
  }
}

function writeAll(rows: WeeklyReport[]): void {
  ensureStore();
  fs.writeFileSync(STORE_PATH, JSON.stringify(rows, null, 2), "utf8");
}

// Sorted oldest → newest by week start, so "latest"/"previous" are unambiguous.
function sorted(rows: WeeklyReport[]): WeeklyReport[] {
  return [...rows].sort((a, b) => a.week.startYMD.localeCompare(b.week.startYMD));
}

export function listWeeklyReports(): WeeklyReport[] {
  return sorted(readAll());
}

export function getWeeklyReport(isoWeek: string): WeeklyReport | null {
  if (!isValidIsoWeek(isoWeek)) return null;
  return readAll().find((r) => r.week.isoWeek === isoWeek) ?? null;
}

export function getLatestWeeklyReport(): WeeklyReport | null {
  const rows = sorted(readAll());
  return rows.length ? rows[rows.length - 1] : null;
}

// The stored report immediately preceding `isoWeek` (by week start) — used to
// fill week-over-week. Compares by date, not array position, so an out-of-order
// insert still resolves the true prior week.
export function getPreviousWeeklyReport(isoWeek: string): WeeklyReport | null {
  const target = getWeeklyReport(isoWeek);
  const rows = sorted(readAll());
  const cutoff = target?.week.startYMD;
  const priors = cutoff
    ? rows.filter((r) => r.week.startYMD < cutoff)
    : rows; // isoWeek not stored yet → everything on disk is "prior"
  return priors.length ? priors[priors.length - 1] : null;
}

// Upsert by isoWeek (replace same-week snapshot in place).
export function upsertWeeklyReport(report: WeeklyReport): WeeklyReport {
  const rows = readAll();
  const idx = rows.findIndex((r) => r.week.isoWeek === report.week.isoWeek);
  if (idx === -1) rows.push(report);
  else rows[idx] = report;
  writeAll(rows);
  return report;
}
