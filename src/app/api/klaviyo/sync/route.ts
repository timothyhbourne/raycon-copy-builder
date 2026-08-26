import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { syncKlaviyoSnapshot, DEFAULT_SNAPSHOT_DAYS, type SyncMode } from "@/lib/klaviyo-sync";
import { AUTH_COOKIE, authEnabled, safeEqual, tokenValid } from "@/lib/auth";
import { readEnv } from "@/lib/env";

// Writes the snapshot. The ONLY thing in the app that makes Klaviyo reporting
// calls (docs/KLAVIYO_RATE_LIMIT_SPEC.md §3.1).
//
// WHY THIS CHAINS. Every reporting page waits on the shared limiter, which paces
// them 31s apart to stay inside Klaviyo's 2-per-minute steady quota. A refresh is
// ~5 reporting calls, so it takes ~2.5 minutes — longer than any serverless
// invocation. So a run does what fits in its budget, records which steps it paid
// for, and then hands off to a fresh invocation to continue. Progress is stored
// (see readProgress), so a hop never re-buys a page an earlier hop already got,
// and merging is idempotent, so N partial runs equal one long one.
//
// The chain is bounded by MAX_HOPS and stops early when the work is done or the
// circuit breaker is open — it cannot spin.
//
// - Cron (daily) hits this bare: incremental mode, ~5 calls across ~4 hops.
// - `?mode=full` covers the whole window. From a shell, prefer
//   `npm run sync:klaviyo -- --full`, which has no timeout and needs no chaining.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Two callers, exactly like the weekly-report cron: Vercel's scheduler (no app
// cookie, presents CRON_SECRET) and a logged-in team member. The route is
// allowlisted in proxy.ts as SELF_PROTECTED so the cron can reach it at all,
// which makes closing it here this handler's job.
//
// A hand-off hop forwards the caller's credentials — the cookie for a human, the
// Authorization header for the cron — so a chain never dies on a 401 halfway.
function authorized(req: NextRequest): boolean {
  if (!authEnabled) return true;   // whole app is open in this mode (local/dev)
  const secret = readEnv("CRON_SECRET");
  if (secret) {
    const bearer = req.headers.get("authorization") ?? "";
    const key = new URL(req.url).searchParams.get("key") ?? "";
    if (safeEqual(bearer, `Bearer ${secret}`) || safeEqual(key, secret)) return true;
  }
  return tokenValid(req.cookies.get(AUTH_COOKIE)?.value);
}

/** Leave room inside the invocation to write the snapshot and respond. */
const BUDGET_MS = 45_000;
/** Enough for a full 60-day refresh (5 reporting calls) with slack. */
const MAX_HOPS = 8;

async function run(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const mode = (searchParams.get("mode") === "full" ? "full" : "incremental") as SyncMode;
  const days = Number(searchParams.get("days")) || DEFAULT_SNAPSHOT_DAYS;
  const budgetMs = Number(searchParams.get("budget_ms")) || BUDGET_MS;
  const reset = searchParams.get("reset") === "1";
  const hop = Number(searchParams.get("hop")) || 0;

  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const lines: string[] = [];
  try {
    const result = await syncKlaviyoSnapshot({
      mode, days, budgetMs, reset,
      log: (l) => { lines.push(l); console.log(`[klaviyo/sync hop=${hop}] ${l}`); },
    });

    // Hand off to a fresh invocation if there is more to do. Fire-and-forget,
    // AFTER the response, so the cron's request isn't held open.
    let handedOff = false;
    if (!result.completed && !result.blocked.blocked && hop + 1 < MAX_HOPS) {
      const next = new URL("/api/klaviyo/sync", origin);
      next.searchParams.set("mode", mode);
      next.searchParams.set("days", String(days));
      next.searchParams.set("hop", String(hop + 1));
      handedOff = true;
      after(async () => {
        try {
          // Forward whichever credential the caller used, or the chain dies on a
          // 401 at hop 1 and the snapshot silently stops refreshing.
          const headers: Record<string, string> = {};
          const cookie = req.headers.get("cookie");
          const auth = req.headers.get("authorization");
          if (cookie) headers.cookie = cookie;
          if (auth) headers.authorization = auth;
          await fetch(next.toString(), { headers, cache: "no-store" });
        } catch (e) {
          console.error("[klaviyo/sync] hand-off failed", e);
        }
      });
    }

    return NextResponse.json({ ...result, hop, handed_off: handedOff, log: lines });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[klaviyo/sync]", msg);
    return NextResponse.json({ error: msg, hop, log: lines }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
