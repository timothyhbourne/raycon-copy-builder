import fs from "fs";
import path from "path";

// Daily metrics store — the read side of the "sync-then-read" dashboard. The
// sync engine (lib/metrics/sync.ts) writes per-day snapshots here; the overview
// route reads and sums them with ZERO Klaviyo calls. Recipients / opens_unique /
// clicks_unique / conversion_value are additive across days, so a range total is
// just the sum of its daily rows.
//
// Layout:
//   data/metrics/daily/YYYY-MM-DD.json   one snapshot per day
//   data/metrics/dimensions.json         global (flow/campaign names, draft/
//                                         scheduled lists, timezone, synced_at)
//
// PERSISTENCE / PRODUCTION: this mirrors the repo's existing file-store idiom
// (lib/reports/weekly-store.ts, lib/planner.ts) — plain JSON on the working-dir
// disk. That persists on a single long-lived instance (a VM/container running
// `next start`) but NOT on Vercel's serverless runtime, where the FS is
// read-only except /tmp and /tmp is per-invocation ephemeral. All writes here go
// through `adapter` and are wrapped so a read-only FS degrades gracefully (logs,
// never crashes) — but data will not survive between serverless invocations. To
// run this on serverless, implement `StorageAdapter` against Vercel KV / Postgres
// / S3 and swap the `adapter` binding below; nothing else changes. Move to a real
// DB once this outgrows a single writer.

export interface DayFlowStat { flow_id: string; recipients: number; opens: number; clicks: number; revenue: number }
export interface DayCampaignStat { campaign_id: string; recipients: number; opens: number; clicks: number; revenue: number }

export interface DaySnapshot {
  date: string;       // YYYY-MM-DD
  synced_at: string;  // ISO timestamp of the sync that produced this snapshot
  frozen: boolean;    // older than the resync window → never re-fetched
  revenue: { total: number; order_count: number };
  flows: DayFlowStat[];
  campaigns: DayCampaignStat[];
}

export interface FlowDim { flow_id: string; name: string; status?: string }
export interface CampaignDim {
  campaign_id: string;
  name: string;
  status: string;
  send_time: string | null;
  audience_count: number;
}

export interface Dimensions {
  synced_at: string | null;
  timezone: string;
  flows: FlowDim[];
  campaigns: CampaignDim[]; // metadata for campaigns that appear in daily data
  draft: CampaignDim[];
  scheduled: CampaignDim[];
}

// ---------------------------------------------------------------------------
// Storage seam. The store logic below is backend-agnostic; only this adapter
// touches the filesystem. Implement the same three methods against KV/Postgres/
// S3 and reassign `adapter` to run on serverless. Keys are POSIX-relative paths
// under the metrics root (e.g. "daily/2026-07-08.json", "dimensions.json").
// ---------------------------------------------------------------------------
export interface StorageAdapter {
  read(key: string): string | null;        // null when absent
  write(key: string, contents: string): void;
  list(dirKey: string): string[];           // immediate entries in a "directory"
}

const METRICS_ROOT = path.join(process.cwd(), "data/metrics");

const fileAdapter: StorageAdapter = {
  read(key) {
    try {
      return fs.readFileSync(path.join(METRICS_ROOT, key), "utf8");
    } catch {
      return null; // missing / unreadable
    }
  },
  write(key, contents) {
    try {
      const full = path.join(METRICS_ROOT, key);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, contents, "utf8");
    } catch (e) {
      // Read-only FS (e.g. Vercel serverless): don't crash the sync run. The
      // caller still gets a summary; the data just isn't durable here.
      console.warn(`[metrics/store] write failed for ${key}: ${e instanceof Error ? e.message : e}`);
    }
  },
  list(dirKey) {
    try {
      return fs.readdirSync(path.join(METRICS_ROOT, dirKey));
    } catch {
      return [];
    }
  },
};

// Swap this binding to run on a non-file backend.
const adapter: StorageAdapter = fileAdapter;

const DAILY_DIR = "daily";
const DIMENSIONS_KEY = "dimensions.json";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isValidYMD(d: unknown): d is string {
  return typeof d === "string" && YMD_RE.test(d);
}

function dayKey(date: string): string { return `${DAILY_DIR}/${date}.json`; }

// Inclusive list of YYYY-MM-DD strings from start to end (UTC-safe iteration).
export function eachDay(startYMD: string, endYMD: string): string[] {
  if (!isValidYMD(startYMD) || !isValidYMD(endYMD)) return [];
  const out: string[] = [];
  const cur = new Date(`${startYMD}T00:00:00Z`);
  const end = new Date(`${endYMD}T00:00:00Z`);
  while (cur.getTime() <= end.getTime()) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// Defensive parse: a missing/corrupt/mis-shaped file is treated as "no snapshot"
// (null), never a throw. Normalizes arrays so downstream summing is safe.
function parseDay(raw: string | null): DaySnapshot | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (!p || !isValidYMD(p.date)) return null;
    return {
      date: p.date,
      synced_at: typeof p.synced_at === "string" ? p.synced_at : "",
      frozen: p.frozen === true,
      revenue: {
        total: Number(p.revenue?.total) || 0,
        order_count: Number(p.revenue?.order_count) || 0,
      },
      flows: Array.isArray(p.flows) ? p.flows.map(normFlow).filter(Boolean) as DayFlowStat[] : [],
      campaigns: Array.isArray(p.campaigns) ? p.campaigns.map(normCampaign).filter(Boolean) as DayCampaignStat[] : [],
    };
  } catch {
    return null;
  }
}

function normFlow(f: unknown): DayFlowStat | null {
  const r = f as Record<string, unknown>;
  if (!r || typeof r.flow_id !== "string") return null;
  return { flow_id: r.flow_id, recipients: Number(r.recipients) || 0, opens: Number(r.opens) || 0, clicks: Number(r.clicks) || 0, revenue: Number(r.revenue) || 0 };
}
function normCampaign(c: unknown): DayCampaignStat | null {
  const r = c as Record<string, unknown>;
  if (!r || typeof r.campaign_id !== "string") return null;
  return { campaign_id: r.campaign_id, recipients: Number(r.recipients) || 0, opens: Number(r.opens) || 0, clicks: Number(r.clicks) || 0, revenue: Number(r.revenue) || 0 };
}

export function readDay(date: string): DaySnapshot | null {
  if (!isValidYMD(date)) return null;
  return parseDay(adapter.read(dayKey(date)));
}

export function writeDay(snapshot: DaySnapshot): void {
  if (!isValidYMD(snapshot.date)) throw new Error(`writeDay: invalid date ${snapshot.date}`);
  adapter.write(dayKey(snapshot.date), JSON.stringify(snapshot, null, 2));
}

// Read every day in [start, end]. Returns the snapshots found plus the dates
// that have no (valid) snapshot yet, so callers can surface coverage / trigger a
// backfill.
export function readRange(startYMD: string, endYMD: string): { days: DaySnapshot[]; missing: string[] } {
  const days: DaySnapshot[] = [];
  const missing: string[] = [];
  for (const d of eachDay(startYMD, endYMD)) {
    const snap = readDay(d);
    if (snap) days.push(snap); else missing.push(d);
  }
  return { days, missing };
}

// All dates that currently have a snapshot on disk (valid filename only).
export function listSyncedDates(): string[] {
  return adapter
    .list(DAILY_DIR)
    .filter((f) => f.endsWith(".json") && isValidYMD(f.slice(0, -5)))
    .map((f) => f.slice(0, -5))
    .sort();
}

const EMPTY_DIMENSIONS: Dimensions = { synced_at: null, timezone: "UTC", flows: [], campaigns: [], draft: [], scheduled: [] };

export function readDimensions(): Dimensions {
  const raw = adapter.read(DIMENSIONS_KEY);
  if (!raw) return { ...EMPTY_DIMENSIONS };
  try {
    const p = JSON.parse(raw);
    return {
      synced_at: typeof p.synced_at === "string" ? p.synced_at : null,
      timezone: typeof p.timezone === "string" ? p.timezone : "UTC",
      flows: Array.isArray(p.flows) ? p.flows : [],
      campaigns: Array.isArray(p.campaigns) ? p.campaigns : [],
      draft: Array.isArray(p.draft) ? p.draft : [],
      scheduled: Array.isArray(p.scheduled) ? p.scheduled : [],
    };
  } catch {
    return { ...EMPTY_DIMENSIONS };
  }
}

export function writeDimensions(dims: Dimensions): void {
  adapter.write(DIMENSIONS_KEY, JSON.stringify(dims, null, 2));
}
