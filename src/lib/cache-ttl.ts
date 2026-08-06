// Pure cache-key + TTL logic for the analytics caches (spec: ANALYTICS_RATE_
// LIMIT_SPEC §4 Layer 1). No imports, no I/O — unit-tested. The whole rate-limit
// fix hinges on caching WHOLE RANGES keyed by range, with a TTL chosen by how
// mutable the range is: a range fully in the past is effectively immutable and
// cached for a week; a range that includes today moves and is cached briefly.

const DAY_MS = 86_400_000;

export function addDaysYMD(ymd: string, delta: number): string {
  const t = Date.parse(`${ymd}T00:00:00.000Z`);
  return new Date(t + delta * DAY_MS).toISOString().slice(0, 10);
}

/** Today's date (YYYY-MM-DD) in a given IANA timezone. en-CA formats as ISO. */
export function todayYMDInTz(tz: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export type Mutability = "past" | "trailing" | "current";

/** How mutable a range is, relative to `today`:
 *  - current  → includes today (numbers still moving)
 *  - trailing → ended within the last ~3 days (late-attributing conversions land)
 *  - past     → ended earlier (effectively immutable) */
export function rangeMutability(start: string, end: string, today: string): Mutability {
  if (end >= today) return "current";
  return end >= addDaysYMD(today, -3) ? "trailing" : "past";
}

// TTLs (env-tunable for the today window; the others are fixed by the domain).
const CURRENT_TTL_MS = (() => {
  const m = Number(process.env.MEASURE_TODAY_TTL_MIN);
  return (Number.isFinite(m) && m > 0 ? m : 15) * 60_000;
})();
const TRAILING_TTL_MS = 60 * 60_000; // 1 hour
const PAST_TTL_MS = 7 * DAY_MS; // 7 days (effectively permanent for immutable ranges)

export function ttlForMutability(m: Mutability): number {
  return m === "current" ? CURRENT_TTL_MS : m === "trailing" ? TRAILING_TTL_MS : PAST_TTL_MS;
}

export function rangeTtlMs(start: string, end: string, today: string): number {
  return ttlForMutability(rangeMutability(start, end, today));
}

/** Versioned so a payload-shape change can invalidate every entry at once. */
export function overviewCacheKey(start: string, end: string): string {
  return `overview:v1:${start}..${end}`;
}

/** A cached entry is fresh while now − fetched_at < ttl. */
export function isFresh(fetchedAtIso: string, ttlMs: number, now: number = Date.now()): boolean {
  const t = Date.parse(fetchedAtIso);
  return Number.isFinite(t) && now - t < ttlMs;
}
