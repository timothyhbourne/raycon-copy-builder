import { fetchRangeOverview, isRateLimited, SnapshotMissing, type RangeOverview } from "./measure";
import { readSnapshot } from "./klaviyo-snapshot";

// Thin accessor over the snapshot. What used to live here was a Redis cache in
// front of a PER-RANGE Klaviyo fetch, with single-flight, stale-while-revalidate,
// budget gating and serve-stale-on-429 — an elaborate apparatus for surviving a
// call that should never have been made per range in the first place
// (docs/KLAVIYO_RATE_LIMIT_SPEC.md §3.1).
//
// The snapshot IS the cache now: one nightly pull, every range sliced from it. So
// there is no upstream call to single-flight, no TTL to revalidate, and no 429 to
// serve stale around. `fetched_at` is the snapshot's sync time, and `stale` means
// the sync hasn't run recently — which is honest, and visible in the UI.

/** A snapshot older than this is reported stale. The sync runs daily, so a day
 * and a half means a run was missed. */
const STALE_AFTER_MS = 36 * 60 * 60_000;

export interface CachedOverview {
  overview: RangeOverview;
  fetched_at: string;
  /** True when the snapshot is older than a missed sync — the numbers are the
   * last known figures, not today's. */
  stale: boolean;
}

export interface GetRangeOpts {
  /** Retained for call-site compatibility. There is nothing to force any more:
   * a range is computed from the snapshot, so it is always as fresh as the
   * snapshot is. Refreshing DATA means running the sync. */
  forceRefresh?: boolean;
}

export async function getRangeOverview(start: string, end: string, _opts: GetRangeOpts = {}): Promise<CachedOverview> {
  const snap = await readSnapshot();
  if (!snap) throw new SnapshotMissing();
  const overview = await fetchRangeOverview(start, end);
  const age = Date.now() - Date.parse(snap.synced_at || "");
  return {
    overview,
    fetched_at: snap.synced_at,
    stale: !Number.isFinite(age) || age > STALE_AFTER_MS,
  };
}

export { isRateLimited, SnapshotMissing };
