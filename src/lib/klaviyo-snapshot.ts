import path from "path";
import { getAdapter } from "./storage";
import {
  attributionDays, emptySnapshot, isFinalOn,
  type CampaignMetaRow, type CampaignSnapshotRow, type DayTotalRow, type FlowDayRow,
  type FlowMetaRow, type KlaviyoSnapshot,
} from "./klaviyo-slice";

// THE architectural fix (spec: KLAVIYO_RATE_LIMIT_SPEC §3.1) — the server half.
//
// The old measure path made a reporting call PER DATE RANGE. Every distinct range
// was its own cache key, so a manager dragging the date picker twice spent six
// reporting calls in one minute against a 2-per-minute quota. The date picker was
// a rate-limit landmine.
//
// A campaign values report is scoped by SEND DATE and every row carries its own
// send_time, so a report for a wide window is a strict superset of every narrower
// window inside it. Flows have no send date, so their sub-range totals come from a
// flow-series report at a daily interval — which also gives us per-day flow
// numbers the app could not produce at all before.
//
// So: pull ONE wide window on a schedule, store the rows, and compute any range
// the user picks by filtering locally. This module is the store and the merge; the
// PURE types and slicing live in lib/klaviyo-slice.ts so the browser can use them
// too, and are re-exported here.

export * from "./klaviyo-slice";

const DATA_ROOT = path.join(process.cwd(), "data");
const store = getAdapter(DATA_ROOT, "measure");
// v2: the day-bucket alignment fix. v1 read a flow-series bucket label as a UTC
// instant, which shifted every flow day one day earlier, and used naive bounds for
// the metric aggregate, which made both edge days partial. Bumping the key
// abandons the misaligned rows rather than letting the merge carry them forward
// forever — the same versioned-key idiom the other caches here use.
const SNAPSHOT_KEY = "snapshot:v2";

export async function readSnapshot(): Promise<KlaviyoSnapshot | null> {
  try {
    const raw = await store.read(SNAPSHOT_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as KlaviyoSnapshot;
    // Shape-gate at the boundary: a snapshot missing its arrays would produce a
    // confidently-wrong zero rather than an obvious failure.
    if (!parsed || !Array.isArray(parsed.campaigns) || !Array.isArray(parsed.flow_days)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeSnapshot(snap: KlaviyoSnapshot): Promise<void> {
  await store.write(SNAPSHOT_KEY, JSON.stringify(snap));
}

// ---- sync progress -------------------------------------------------------
// Which steps of the current window are already done. The reporting tier paces
// calls 31s apart, so a full run takes minutes and cannot fit one serverless
// invocation; runs therefore CHAIN, and without this each hop would re-fetch the
// steps the previous hop already paid for.

const PROGRESS_KEY = "snapshot:progress:v1";

export interface SyncProgress {
  /** Scopes the progress to one window, so a new day starts clean. */
  key: string;
  done: string[];
  /** Live pagination cursor per step, for a report part-way through its pages. A
   * flow report is 4 pages at 31s apart — longer than any serverless invocation —
   * so a hop keeps the rows it paid for and hands the cursor to the next one. */
  cursors?: Record<string, string>;
  updated_at: string;
}

export async function readProgress(key: string): Promise<SyncProgress | null> {
  try {
    const raw = await store.read(PROGRESS_KEY);
    if (raw == null) return null;
    const p = JSON.parse(raw) as SyncProgress;
    if (!p || p.key !== key || !Array.isArray(p.done)) return null;
    // Stale progress from a previous day must not suppress today's work.
    if (Date.now() - Date.parse(p.updated_at) > 12 * 60 * 60_000) return null;
    return p;
  } catch {
    return null;
  }
}

export async function writeProgress(key: string, done: string[], cursors: Record<string, string> = {}): Promise<void> {
  try {
    await store.write(PROGRESS_KEY, JSON.stringify({
      key, done, cursors, updated_at: new Date().toISOString(),
    } satisfies SyncProgress));
  } catch { /* progress is an optimisation, never a requirement */ }
}

export async function clearProgress(): Promise<void> {
  try { await store.remove(PROGRESS_KEY); } catch { /* ignore */ }
}

/** Drop the snapshot so the next sync rebuilds it from nothing. For a change that
 * invalidates stored rows (a bucket-alignment fix, a new statistic) without a key
 * bump — merging would otherwise carry the old rows forward forever. */
export async function clearSnapshot(): Promise<void> {
  await store.remove(SNAPSHOT_KEY);
}

// ---------------------------------------------------------------------------
// Merging a fetched window onto an existing snapshot
// ---------------------------------------------------------------------------

export interface MergeInput {
  window: { start: string; end: string };
  timezone: string;
  todayYmd: string;
  campaigns?: CampaignSnapshotRow[];
  flow_days?: FlowDayRow[];
  day_totals?: DayTotalRow[];
  flow_meta?: FlowMetaRow[];
  draft?: CampaignMetaRow[];
  scheduled?: CampaignMetaRow[];
  warnings?: string[];
}

/**
 * Merge a freshly fetched window into the snapshot.
 *
 * The rules that matter:
 *  - A row already SEALED is never overwritten. That is what makes an incremental
 *    sync safe: it fetches only the trailing window, and history survives.
 *  - Rows are replaced by key (campaign id; flow id × day), so a re-fetch of the
 *    same window updates rather than duplicates.
 *  - Rows outside the merged window are left alone, so a narrow incremental sync
 *    never deletes the wide backfill it is layered on.
 */
export function mergeSnapshot(prev: KlaviyoSnapshot | null, input: MergeInput): KlaviyoSnapshot {
  const base = prev ?? emptySnapshot(input.timezone);
  const days = attributionDays();

  // ---- campaigns: keyed by id, sealed rows win ----
  const campaigns = new Map<string, CampaignSnapshotRow>();
  for (const row of base.campaigns) campaigns.set(row.campaign_id, row);
  for (const row of input.campaigns ?? []) {
    const existing = campaigns.get(row.campaign_id);
    if (existing?.final) continue;   // sealed: never re-write
    campaigns.set(row.campaign_id, { ...row, final: isFinalOn(row.send_ymd, input.todayYmd, days) });
  }
  // Re-seal anything that has aged past the window since the last sync.
  for (const [id, row] of campaigns) {
    if (!row.final && isFinalOn(row.send_ymd, input.todayYmd, days)) campaigns.set(id, { ...row, final: true });
  }

  // ---- flow days + day totals: keyed by day, the fetched window wins ----
  const flowDays = new Map<string, FlowDayRow>();
  for (const row of base.flow_days) flowDays.set(`${row.flow_id}|${row.ymd}`, row);
  for (const row of input.flow_days ?? []) flowDays.set(`${row.flow_id}|${row.ymd}`, row);

  const dayTotals = new Map<string, DayTotalRow>();
  for (const row of base.day_totals) dayTotals.set(row.ymd, row);
  for (const row of input.day_totals ?? []) dayTotals.set(row.ymd, row);

  const window = {
    start: [base.window.start, input.window.start].filter(Boolean).sort()[0] ?? input.window.start,
    end: [base.window.end, input.window.end].filter(Boolean).sort().at(-1) ?? input.window.end,
  };

  return {
    window,
    timezone: input.timezone || base.timezone,
    synced_at: new Date().toISOString(),
    attribution_days: days,
    campaigns: [...campaigns.values()].sort((a, b) => (b.send_ymd ?? "").localeCompare(a.send_ymd ?? "")),
    flow_days: [...flowDays.values()].sort((a, b) => (a.ymd === b.ymd ? a.flow_id.localeCompare(b.flow_id) : a.ymd.localeCompare(b.ymd))),
    day_totals: [...dayTotals.values()].sort((a, b) => a.ymd.localeCompare(b.ymd)),
    flow_meta: input.flow_meta?.length ? input.flow_meta : base.flow_meta,
    draft: input.draft ?? base.draft,
    scheduled: input.scheduled ?? base.scheduled,
    warnings: input.warnings ?? [],
  };
}

