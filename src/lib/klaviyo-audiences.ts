import path from "path";
import { getAdapter } from "./storage";
import { fetchAudienceSize, listLists, listSegments, type AudienceItem } from "./klaviyo";

// The segment/list catalogue, synced rather than fetched on demand
// (spec: PLANNER_AUDIENCE_BRIEF_SPEC.md §4).
//
// MEASURED on this account, 2026-08-29: 90 segments over 9 pages and 261 lists
// over 27 — 36 sequential requests, 17.5 seconds. The old endpoint cached that
// in-process for 10 minutes, which on Vercel means every cold lambda paid the full
// 17.5s again, and to the user it read as a hang. Two further things that measured
// worse than the spec assumed:
//
//  - lists take 27 pages against a 30-page cap, so the catalogue was one growth
//    spurt away from silently truncating.
//  - `profile_count` is NOT available on /segments/ or /lists/ at all (revision
//    2026-04-15 rejects it: "fields must be in [created, definition, id, is_active,
//    is_processing, is_starred, name, updated]"). It IS available per-resource, but
//    that variant is separately and hard throttled — 429 with Retry-After 1 on
//    alternating calls even at 120ms spacing. So sizes are a paced, resumable,
//    best-effort extra rather than part of the catalogue fetch.
//
// These endpoints are 75/s with no daily cap, so none of this is a quota problem —
// it is latency, and the fix is to stop doing it on the read path.

const DATA_ROOT = path.join(process.cwd(), "data");
const store = getAdapter(DATA_ROOT, "klaviyo-audiences");
const STORE_KEY = "audiences:v1";
const REFRESH_LOCK_KEY = "audiences:refresh_at";

/**
 * MEASURED 2026-08-29: 9 pages of segments + 27 of lists = 36 sequential
 * requests, 17.5s. Callers reserve against this so they can size a following
 * size pass to the time they actually have, instead of discovering the total as a
 * function timeout. Rounded up from the measurement for headroom.
 */
export const CATALOGUE_FETCH_MS = 20_000;

/**
 * The largest size budget that still fits `fnLimitMs`, given the catalogue has to
 * run first and the result still has to be written and serialised.
 *
 * Returns 0 rather than a negative number: a caller with no room left does the
 * catalogue only, and the size pass resumes on the next run.
 */
export function sizeBudgetFor(fnLimitMs: number, reserveMs = 8_000): number {
  return Math.max(0, fnLimitMs - CATALOGUE_FETCH_MS - reserveMs);
}

/** On-demand refresh is rate-limited to once a minute (§4). */
export const REFRESH_COOLDOWN_MS = 60_000;

export interface AudienceCatalogue {
  audiences: AudienceItem[];
  synced_at: string;
  /** True when a page cap stopped the fetch — the catalogue is incomplete and the
   * picker says so rather than quietly missing audiences. */
  truncated: boolean;
  /** How many audiences carry a size, for the picker's own honesty. */
  sized: number;
}

export async function readAudienceCatalogue(): Promise<AudienceCatalogue | null> {
  try {
    const raw = await store.read(STORE_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as AudienceCatalogue;
    if (!parsed || !Array.isArray(parsed.audiences)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeAudienceCatalogue(c: AudienceCatalogue): Promise<void> {
  await store.write(STORE_KEY, JSON.stringify(c));
}

/** Whether an on-demand refresh may run now, and how long until it may. */
export async function refreshAllowed(): Promise<{ allowed: boolean; waitMs: number }> {
  try {
    const raw = await store.read(REFRESH_LOCK_KEY);
    const last = Number(raw ?? 0) || 0;
    const waitMs = Math.max(0, REFRESH_COOLDOWN_MS - (Date.now() - last));
    return { allowed: waitMs === 0, waitMs };
  } catch {
    return { allowed: true, waitMs: 0 };
  }
}

async function stampRefresh(): Promise<void> {
  try { await store.write(REFRESH_LOCK_KEY, String(Date.now())); } catch { /* best effort */ }
}

export interface SyncAudiencesOpts {
  /** Also fetch profile counts. Paced and time-boxed; off by default because it
   * costs ~1 request per audience against a hard throttle. */
  withSizes?: boolean;
  /** Wall-clock ceiling for the SIZE pass only. The catalogue fetch always
   * completes — a partial catalogue would be worse than a slow one. */
  sizeBudgetMs?: number;
  log?: (line: string) => void;
}

export interface SyncAudiencesResult {
  audiences: number;
  segments: number;
  lists: number;
  sized: number;
  truncated: boolean;
  synced_at: string;
  size_pass_complete: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Fetch the catalogue and write it to the store.
 *
 * Sizes are layered on best-effort and PRESERVED from the previous catalogue when
 * this run doesn't reach them, so a time-boxed size pass improves coverage over
 * successive runs instead of losing what it had.
 */
export async function syncAudiences(opts: SyncAudiencesOpts = {}): Promise<SyncAudiencesResult> {
  const log = opts.log ?? (() => {});
  const previous = await readAudienceCatalogue();
  const prevSizes = new Map((previous?.audiences ?? []).filter((a) => a.size != null).map((a) => [a.id, a]));

  const segResult = await listSegments();
  const listResult = await listLists();
  const segments = segResult.items;
  const lists = listResult.items;
  const truncated = segResult.truncated || listResult.truncated;
  log(`segments: ${segments.length}${segResult.truncated ? " (TRUNCATED)" : ""}`);
  log(`lists: ${lists.length}${listResult.truncated ? " (TRUNCATED)" : ""}`);

  const byId = new Map<string, AudienceItem>();
  for (const a of [...segments, ...lists]) {
    if (byId.has(a.id)) continue;
    const prev = prevSizes.get(a.id);
    byId.set(a.id, prev ? { ...a, size: prev.size, size_synced_at: prev.size_synced_at } : a);
  }

  let sizePassComplete = true;
  if (opts.withSizes) {
    // Segments only. A segment's size is the thing that makes the choice hard —
    // "is this the 400-person one?" — while a list's membership is usually known.
    // 90 segments at ~1.1s of pacing is ~100s; 351 would be six minutes.
    const deadline = Date.now() + (opts.sizeBudgetMs ?? 120_000);
    // Oldest-sized first, so repeated runs rotate through rather than always
    // re-reading the same head of the list.
    const targets = segments
      .map((a) => byId.get(a.id)!)
      .sort((x, y) => (x.size_synced_at ?? "").localeCompare(y.size_synced_at ?? ""));
    let done = 0;
    for (const a of targets) {
      if (Date.now() > deadline) { sizePassComplete = false; break; }
      const size = await fetchAudienceSize(a.id, a.type);
      if (size != null) {
        byId.set(a.id, { ...a, size, size_synced_at: new Date().toISOString() });
        done++;
      }
      // The sized variant 429s at ~1/s, so pace it rather than burning retries.
      await sleep(1_100);
    }
    log(`sizes: ${done}/${targets.length} segments${sizePassComplete ? "" : " (budget reached, will continue next run)"}`);
  }

  const audiences = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  const catalogue: AudienceCatalogue = {
    audiences,
    synced_at: new Date().toISOString(),
    // If either side hit the page cap we are missing audiences, and the picker
    // must say so instead of looking complete.
    truncated,
    sized: audiences.filter((a) => a.size != null).length,
  };
  await writeAudienceCatalogue(catalogue);

  return {
    audiences: audiences.length,
    segments: segments.length,
    lists: lists.length,
    sized: catalogue.sized,
    truncated: catalogue.truncated,
    synced_at: catalogue.synced_at,
    size_pass_complete: sizePassComplete,
  };
}

/** On-demand refresh for the picker's Refresh control, rate-limited (§4). */
export async function refreshAudiences(
  opts: SyncAudiencesOpts = {},
): Promise<{ ok: true; result: SyncAudiencesResult } | { ok: false; waitMs: number }> {
  const gate = await refreshAllowed();
  if (!gate.allowed) return { ok: false, waitMs: gate.waitMs };
  await stampRefresh();
  return { ok: true, result: await syncAudiences(opts) };
}
