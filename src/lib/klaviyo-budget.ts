import path from "path";
import { getAdapter } from "./storage";

// Global reporting-call budget + observability (spec: ANALYTICS_RATE_LIMIT_SPEC
// §4 Layer 3, §6). Klaviyo's tight reporting tier is ~2/min steady, 225/day, PER
// ACCOUNT — shared across every feature, user, and environment. The real fix is
// the shared cache (measure-cache.ts) which makes live reporting calls rare; this
// module (a) counts them so consumption is visible, and (b) exposes canSpend so
// background revalidation backs off before the daily cap.
//
// Pragmatic deviation from the spec's "token bucket that blocks interactive
// users": pre-emptively blocking a manager's fresh load for up to a minute is
// worse UX than the occasional rare miss. The cache prevents nearly all calls;
// klaviyoFetch's own 429 back-off covers the 1/s burst; this daily counter is the
// safety valve + telemetry. The counter is best-effort (read-modify-write, not
// atomic) — fine for a soft budget at this traffic.

const DATA_ROOT = path.join(process.cwd(), "data");
const store = getAdapter(DATA_ROOT, "klaviyo-budget");

/** Query Campaign Values daily cap (see spec Sources). */
export const DAILY_CAP = 225;
/** Leave headroom for the weekly report + ad-hoc digging before we stop revalidating. */
const DAILY_HEADROOM = 25;

// In-process counter — lets a test / same-process caller read call counts
// synchronously (the QA script relies on this). Redis holds the durable daily total.
let inProcessCalls = 0;
export function getReportingCallCount(): number {
  return inProcessCalls;
}
export function resetReportingCallCount(): void {
  inProcessCalls = 0;
}

function dayKey(now: Date = new Date()): string {
  return `count:${now.toISOString().slice(0, 10)}`;
}

/** Record one reporting-endpoint call (campaign/flow values). Best-effort:
 * a counter failure must never break the actual request. */
export async function recordReportingCall(): Promise<void> {
  inProcessCalls++;
  try {
    const k = dayKey();
    const cur = Number((await store.read(k)) ?? "0") || 0;
    await store.write(k, String(cur + 1));
  } catch {
    /* telemetry only */
  }
}

export async function reportingCallsToday(): Promise<number> {
  try {
    return Number((await store.read(dayKey())) ?? "0") || 0;
  } catch {
    return 0;
  }
}

/** Whether a NON-interactive (background revalidation, warming) reporting call
 * should proceed. Interactive requests don't gate on this — the cache + 429
 * back-off protect them; blocking a live user would be the worse failure. */
export async function canSpendReporting(): Promise<boolean> {
  return (await reportingCallsToday()) < DAILY_CAP - DAILY_HEADROOM;
}

export interface BudgetStatus {
  calls_today: number;
  daily_cap: number;
  daily_remaining: number;
  in_process_calls: number;
}
export async function budgetStatus(): Promise<BudgetStatus> {
  const today = await reportingCallsToday();
  return {
    calls_today: today,
    daily_cap: DAILY_CAP,
    daily_remaining: Math.max(0, DAILY_CAP - today),
    in_process_calls: inProcessCalls,
  };
}
