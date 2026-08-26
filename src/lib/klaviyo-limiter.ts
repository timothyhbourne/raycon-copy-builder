import { Redis } from "@upstash/redis";
import { redisCreds } from "./storage";

// The reporting-tier gate (spec: KLAVIYO_RATE_LIMIT_SPEC §3.2, §3.3).
//
// Klaviyo's reporting endpoints are the tight tier, and the account's own
// response headers state the limits exactly:
//
//     RateLimit-Limit: 1;w=1, 2;w=60, 225;w=86400
//
// One per second, TWO PER MINUTE, 225 per day — per account, shared with every
// other private-key integration (§2.3). Two per minute is the binding constraint
// and the reason this module exists.
//
// klaviyo-budget.ts was explicitly a soft COUNTER, and its own header said so. On
// Vercel every request is its own process, so an in-memory count protects
// nothing. This is a real gate: a Redis lock that serialises reporting calls
// across processes, a durable daily counter keyed to the account's timezone, and
// a circuit breaker that stops calling entirely when Klaviyo hands back a long
// Retry-After.
//
// It deliberately does NOT cover metric-aggregates: that endpoint is 3/s, 60/min
// with no daily cap, and counting it here would spend headroom we don't need to.

/** Klaviyo's documented daily cap for the reporting tier, confirmed by the
 * account's own RateLimit-Limit header (225;w=86400). */
export const DAILY_CAP = 225;

/** Warn at this many calls in a day — well under the cap, per spec §3.2. */
export const DAILY_ALERT_AT = 180;

/** Minimum spacing between two reporting calls. The steady limit is 2/60s; 31s
 * keeps us just inside it with a margin for clock skew between instances. */
export const MIN_SPACING_MS = 31_000;

/** A Retry-After above this means a long throttle, not a burst: open the breaker
 * rather than sleeping. Matches Airbyte's threshold (spec §3.3). */
export const BREAKER_THRESHOLD_S = 600;

const KEY_GATE = "klaviyo:rq:gate";
const KEY_BLOCKED = "klaviyo:blocked_until";
const KEY_COUNT = (day: string) => `klaviyo:rq:count:${day}`;
const KEY_LAST_429 = "klaviyo:rq:last_429";

let client: Redis | null | undefined;
function redis(): Redis | null {
  if (client !== undefined) return client;
  const creds = redisCreds();
  client = creds ? new Redis({ ...creds, automaticDeserialization: false }) : null;
  return client;
}

// ---------------------------------------------------------------------------
// Local fallback. With no Redis configured (a dev machine, a plain script) there
// is exactly one process, so an in-memory gate is genuinely sufficient — and
// silently doing nothing would be worse, because the pacing is what makes a
// paginated flow report possible at all.
// ---------------------------------------------------------------------------
const local = { lastCallAt: 0, counts: new Map<string, number>(), blockedUntil: 0 };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface LimiterState {
  blocked_until: string | null;
  blocked_for_s: number;
  calls_today: number;
  daily_cap: number;
  daily_remaining: number;
  over_alert_threshold: boolean;
  last_429: string | null;
  backend: "redis" | "memory";
}

async function getNumber(key: string): Promise<number> {
  const r = redis();
  if (!r) return 0;
  try {
    const v = await r.get<string>(key);
    return Number(v ?? 0) || 0;
  } catch {
    return 0;
  }
}

async function blockedUntilMs(): Promise<number> {
  const r = redis();
  if (!r) return local.blockedUntil;
  return await getNumber(KEY_BLOCKED);
}

/** Open the breaker until `untilMs`. Every process sees it, so fifty lambdas
 * don't each independently rediscover the same throttle (spec §3.3). */
export async function openBreaker(retryAfterS: number): Promise<void> {
  const until = Date.now() + Math.max(1, retryAfterS) * 1000;
  const r = redis();
  if (!r) { local.blockedUntil = Math.max(local.blockedUntil, until); return; }
  try {
    // Expire the key when the block does, so it cleans itself up.
    await r.set(KEY_BLOCKED, String(until), { ex: Math.ceil(Math.max(1, retryAfterS)) + 5 });
    await r.set(KEY_LAST_429, new Date().toISOString(), { ex: 7 * 86_400 });
  } catch { /* telemetry/best-effort — never break the caller */ }
}

/** Record a 429 that was short enough to ride out, for observability. */
export async function noteThrottle(): Promise<void> {
  const r = redis();
  if (!r) return;
  try { await r.set(KEY_LAST_429, new Date().toISOString(), { ex: 7 * 86_400 }); } catch { /* ignore */ }
}

export async function isBlocked(): Promise<{ blocked: boolean; forS: number }> {
  const until = await blockedUntilMs();
  const forS = Math.max(0, Math.ceil((until - Date.now()) / 1000));
  return { blocked: forS > 0, forS };
}

async function incrementDaily(day: string): Promise<number> {
  const r = redis();
  if (!r) {
    const next = (local.counts.get(day) ?? 0) + 1;
    local.counts.set(day, next);
    return next;
  }
  try {
    const n = await r.incr(KEY_COUNT(day));
    // Two days of retention is plenty and keeps the keyspace tidy.
    if (n === 1) await r.expire(KEY_COUNT(day), 2 * 86_400);
    return n;
  } catch {
    return 0;   // a counter failure must not block a legitimate call
  }
}

async function decrementDaily(day: string): Promise<void> {
  const r = redis();
  if (!r) { local.counts.set(day, Math.max(0, (local.counts.get(day) ?? 1) - 1)); return; }
  try { await r.decr(KEY_COUNT(day)); } catch { /* ignore */ }
}

export async function callsToday(day: string): Promise<number> {
  const r = redis();
  if (!r) return local.counts.get(day) ?? 0;
  return await getNumber(KEY_COUNT(day));
}

/**
 * Claim the single reporting slot. Returns true when this process may issue one
 * reporting call now.
 *
 * `SET NX PX` is the whole mechanism: exactly one process can hold the gate, and
 * it auto-releases after MIN_SPACING_MS, which enforces both `maxConcurrent: 1`
 * and `minTime` in one primitive without a lock we could leak.
 */
async function claimGate(): Promise<boolean> {
  const r = redis();
  if (!r) {
    if (Date.now() - local.lastCallAt < MIN_SPACING_MS) return false;
    local.lastCallAt = Date.now();
    return true;
  }
  try {
    const res = await r.set(KEY_GATE, String(Date.now()), { nx: true, px: MIN_SPACING_MS });
    return res === "OK";
  } catch {
    // Redis unreachable: fall back to in-process pacing rather than either
    // blocking forever or letting an unpaced call through.
    if (Date.now() - local.lastCallAt < MIN_SPACING_MS) return false;
    local.lastCallAt = Date.now();
    return true;
  }
}

export type AcquireFailure = "blocked" | "daily_cap" | "timeout";

export interface AcquireOpts {
  /** Day key in the ACCOUNT's timezone (spec §3.2 — the daily quota rolls over
   * on Klaviyo's clock, not the server's). */
  day: string;
  /** How long to wait for the slot. 0 = don't wait (interactive callers). */
  waitMs?: number;
  /** Called while waiting, so a long sync can report progress. */
  onWait?: (remainingMs: number) => void;
}

/**
 * Acquire permission to make ONE reporting-tier call.
 *
 * Interactive callers pass `waitMs: 0` and get an immediate answer; the nightly
 * sync waits, because waiting 31 seconds is exactly what keeps it inside 2/min.
 */
export async function acquireReportingSlot(
  opts: AcquireOpts,
): Promise<{ ok: true } | { ok: false; reason: AcquireFailure; retryAfterS?: number }> {
  const blocked = await isBlocked();
  if (blocked.blocked) return { ok: false, reason: "blocked", retryAfterS: blocked.forS };

  const deadline = Date.now() + (opts.waitMs ?? 0);
  for (;;) {
    if (await claimGate()) {
      const n = await incrementDaily(opts.day);
      if (n > DAILY_CAP) {
        await decrementDaily(opts.day);
        return { ok: false, reason: "daily_cap" };
      }
      return { ok: true };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { ok: false, reason: "timeout" };
    opts.onWait?.(remaining);
    await sleep(Math.min(1_000, remaining));
    // Re-check the breaker while waiting: another process may have hit a throttle.
    const b = await isBlocked();
    if (b.blocked) return { ok: false, reason: "blocked", retryAfterS: b.forS };
  }
}

export async function limiterState(day: string): Promise<LimiterState> {
  const until = await blockedUntilMs();
  const forS = Math.max(0, Math.ceil((until - Date.now()) / 1000));
  const calls = await callsToday(day);
  const r = redis();
  let last429: string | null = null;
  if (r) { try { last429 = (await r.get<string>(KEY_LAST_429)) ?? null; } catch { /* ignore */ } }
  return {
    blocked_until: forS > 0 ? new Date(until).toISOString() : null,
    blocked_for_s: forS,
    calls_today: calls,
    daily_cap: DAILY_CAP,
    daily_remaining: Math.max(0, DAILY_CAP - calls),
    over_alert_threshold: calls >= DAILY_ALERT_AT,
    last_429: last429,
    backend: r ? "redis" : "memory",
  };
}

/** Test seam: clear the in-memory fallback between cases. */
export function __resetLocalLimiter(): void {
  local.lastCallAt = 0;
  local.counts.clear();
  local.blockedUntil = 0;
}
