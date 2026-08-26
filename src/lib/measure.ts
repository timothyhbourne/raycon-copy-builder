import { readSnapshot } from "./klaviyo-snapshot";
import { overviewFromSnapshot, type RangeOverview } from "./overview-from-snapshot";

// Range aggregation for the dashboard and the briefing.
//
// This used to make ~3 sequential Klaviyo reporting calls PER RANGE, which is the
// defect docs/KLAVIYO_RATE_LIMIT_SPEC.md was written about: two reporting calls is
// the entire minute's quota, so a manager comparing three periods was guaranteed a
// 429. It now reads the nightly snapshot and slices it locally — ZERO Klaviyo
// calls, for any range, however many times it is asked.
//
// The fetching lives in lib/klaviyo-sync.ts; the pure slicing in
// lib/klaviyo-slice.ts, which the browser also uses so a range change costs not
// even a round trip to us.

// Re-exported so server callers keep one import site; the fold itself lives in
// lib/overview-from-snapshot.ts because the dashboard runs it in the browser.
export { overviewFromSnapshot } from "./overview-from-snapshot";
export type { RangeOverview } from "./overview-from-snapshot";

/** True when an error message looks like a Klaviyo rate-limit (429). Callers use
 * it to surface a friendly "try again" instead of a raw 500. */
export function isRateLimited(msg: string): boolean {
  return /429|rate.?limit|too many requests|throttl/i.test(msg);
}

/** Thrown when no snapshot exists yet — the one honest failure mode left, and it
 * is an operational state ("the sync has not run") rather than an upstream error. */
export class SnapshotMissing extends Error {
  constructor() {
    super("No Klaviyo snapshot yet — run the sync (POST /api/klaviyo/sync) and reload.");
    this.name = "SnapshotMissing";
  }
}

/** The range, from the snapshot. Makes no Klaviyo calls; throws only when the
 * snapshot has never been written. */
export async function fetchRangeOverview(startYMD: string, endYMD: string): Promise<RangeOverview> {
  const snap = await readSnapshot();
  if (!snap) throw new SnapshotMissing();
  return overviewFromSnapshot(snap, startYMD, endYMD);
}
