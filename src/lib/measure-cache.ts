import path from "path";
import { getAdapter } from "./storage";
import { fetchRangeOverview, isRateLimited, type RangeOverview } from "./measure";
import { getAccountTimezoneCached } from "./klaviyo-cache";
import { canSpendReporting } from "./klaviyo-budget";
import { overviewCacheKey, rangeTtlMs, isFresh, todayYMDInTz } from "./cache-ttl";

// THE rate-limit fix (spec: ANALYTICS_RATE_LIMIT_SPEC §4 Layers 1–2). A shared,
// Redis-backed L2 cache in front of fetchRangeOverview, keyed by whole range.
// Every consumer goes through getRangeOverview — no one calls fetchRangeOverview
// directly. Effect: an identical range is fetched from Klaviyo ONCE per TTL and
// served to every user/tab/instance thereafter; past ranges are effectively
// permanent; and when Klaviyo throttles, we serve the last known figures
// (labeled) instead of erroring.

const DATA_ROOT = path.join(process.cwd(), "data");
const store = getAdapter(DATA_ROOT, "measure");

export interface CachedOverview {
  overview: RangeOverview;
  fetched_at: string;
  /** True when the payload is being served past its TTL or during a throttle. */
  stale: boolean;
}
interface StoredEntry { payload: RangeOverview; fetched_at: string }

async function readEntry(key: string): Promise<StoredEntry | null> {
  try {
    const raw = await store.read(key);
    return raw == null ? null : (JSON.parse(raw) as StoredEntry);
  } catch {
    return null;
  }
}
async function writeEntry(key: string, payload: RangeOverview): Promise<string> {
  const fetched_at = new Date().toISOString();
  try { await store.write(key, JSON.stringify({ payload, fetched_at } satisfies StoredEntry)); } catch { /* best-effort */ }
  return fetched_at;
}

// In-process single-flight (spec §2.6 restored, pragmatically): concurrent
// identical range fetches within one instance share one upstream call. Combined
// with the shared Redis cache this covers the real collision cases without a
// fragile cross-instance lock.
const inflight = new Map<string, Promise<RangeOverview>>();
function runSingleFlight(key: string, fn: () => Promise<RangeOverview>): Promise<RangeOverview> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// Stale-while-revalidate: refresh a past-TTL entry in the background (Next's
// after() → post-response), budget-gated so it can never itself cause a 429. If
// we're not in a request scope (script/cron) or the budget is spent, we simply
// skip — the stale value was already served, which is the point.
function scheduleRevalidate(key: string, start: string, end: string): void {
  const task = async () => {
    try {
      if (!(await canSpendReporting())) return;
      const payload = await runSingleFlight(key, () => fetchRangeOverview(start, end));
      await writeEntry(key, payload);
    } catch { /* stale stays; a later miss will retry */ }
  };
  import("next/server")
    .then(({ after }) => { try { after(task); } catch { /* not in a request scope */ } })
    .catch(() => { /* next/server unavailable (e.g. a plain script) */ });
}

export interface GetRangeOpts { forceRefresh?: boolean }

export async function getRangeOverview(start: string, end: string, opts: GetRangeOpts = {}): Promise<CachedOverview> {
  const key = overviewCacheKey(start, end);
  const cached = await readEntry(key);
  const today = todayYMDInTz(await getAccountTimezoneCached());
  const ttl = rangeTtlMs(start, end, today);
  const fresh = cached ? isFresh(cached.fetched_at, ttl) : false;

  // Fresh hit → serve, zero upstream calls.
  if (cached && fresh && !opts.forceRefresh) {
    return { overview: cached.payload, fetched_at: cached.fetched_at, stale: false };
  }
  // Stale hit (not forced) → serve stale immediately, revalidate in the background.
  if (cached && !opts.forceRefresh) {
    scheduleRevalidate(key, start, end);
    return { overview: cached.payload, fetched_at: cached.fetched_at, stale: true };
  }

  // Miss or forced refresh → fetch live (single-flighted).
  try {
    const payload = await runSingleFlight(key, () => fetchRangeOverview(start, end));
    const fetched_at = await writeEntry(key, payload);
    return { overview: payload, fetched_at, stale: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Serve-stale-on-throttle: a 429 with ANY cached entry → last known figures,
    // labeled stale. Only hard-fail when there is nothing cached at all.
    if (cached && isRateLimited(msg)) {
      return { overview: cached.payload, fetched_at: cached.fetched_at, stale: true };
    }
    throw e;
  }
}
