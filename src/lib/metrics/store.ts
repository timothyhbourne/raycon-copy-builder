import path from "path";
import { getAdapter } from "../storage";
import { stamp } from "../validation";

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
// PERSISTENCE / PRODUCTION: all reads/writes go through the single canonical
// storage seam (lib/storage.ts), exactly like lib/planner.ts and
// lib/library.ts. It is file-backed locally (data/metrics/...) and Upstash
// Redis when its env is configured — durable across Vercel's ephemeral,
// read-only-except-/tmp serverless FS. Because the seam is async (a network KV
// can't be synchronous) the store functions below are async; callers await.
// Key layout is preserved (daily/YYYY-MM-DD.json, dimensions.json) so existing
// seed data and Redis keys keep working.

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

// Storage seam — the single canonical adapter from lib/storage.ts. Keys are
// POSIX-relative paths under the metrics root (e.g. "daily/2026-07-08.json",
// "dimensions.json"); the namespace "metrics" scopes them in Redis.
const METRICS_ROOT = path.join(process.cwd(), "data/metrics");
const adapter = getAdapter(METRICS_ROOT, "metrics");

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
// (null), never a throw. This is the metrics store's boundary validator — it
// intentionally COERCES (Number()) and defaults rather than rejecting, because a
// snapshot with one odd field is still summable. That tolerance is stronger than
// a strict schema parse here, so metrics keeps this purpose-built validator; the
// zod DaySnapshot/Dimensions schemas (lib/validation) mirror the shape for tests
// and lockstep. Writes are stamped with schema_version via stamp().
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

export async function readDay(date: string): Promise<DaySnapshot | null> {
  if (!isValidYMD(date)) return null;
  return parseDay(await adapter.read(dayKey(date)));
}

export async function writeDay(snapshot: DaySnapshot): Promise<void> {
  if (!isValidYMD(snapshot.date)) throw new Error(`writeDay: invalid date ${snapshot.date}`);
  await adapter.write(dayKey(snapshot.date), JSON.stringify(stamp(snapshot), null, 2));
}

// Read every day in [start, end]. Returns the snapshots found plus the dates
// that have no (valid) snapshot yet, so callers can surface coverage / trigger a
// backfill.
export async function readRange(startYMD: string, endYMD: string): Promise<{ days: DaySnapshot[]; missing: string[] }> {
  const days: DaySnapshot[] = [];
  const missing: string[] = [];
  // Read days in parallel — each is an independent adapter round-trip.
  const results = await Promise.all(
    eachDay(startYMD, endYMD).map(async (d) => ({ d, snap: await readDay(d) }))
  );
  for (const { d, snap } of results) {
    if (snap) days.push(snap); else missing.push(d);
  }
  return { days, missing };
}

// All dates that currently have a snapshot on disk (valid filename only).
export async function listSyncedDates(): Promise<string[]> {
  return (await adapter.list(DAILY_DIR))
    .filter((f) => f.endsWith(".json") && isValidYMD(f.slice(0, -5)))
    .map((f) => f.slice(0, -5))
    .sort();
}

const EMPTY_DIMENSIONS: Dimensions = { synced_at: null, timezone: "UTC", flows: [], campaigns: [], draft: [], scheduled: [] };

export async function readDimensions(): Promise<Dimensions> {
  const raw = await adapter.read(DIMENSIONS_KEY);
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

export async function writeDimensions(dims: Dimensions): Promise<void> {
  await adapter.write(DIMENSIONS_KEY, JSON.stringify(stamp(dims), null, 2));
}
