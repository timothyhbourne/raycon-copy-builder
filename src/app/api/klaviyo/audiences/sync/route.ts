import { NextRequest, NextResponse } from "next/server";
import { refreshAudiences, syncAudiences } from "@/lib/klaviyo-audiences";
import { AUTH_COOKIE, authEnabled, safeEqual, tokenValid } from "@/lib/auth";
import { readEnv } from "@/lib/env";

// Writes the audience catalogue (spec §4).
//
// Two callers: the picker's Refresh control (rate-limited to once a minute, so a
// segment created five minutes ago can be pulled in on demand) and the nightly
// Klaviyo sync, which calls syncAudiences() directly as one of its steps rather
// than taking a cron slot of its own — Hobby allows two and both are in use.
//
// Cheap tier (75/s, no daily cap), so this never touches the reporting limiter.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  if (!authEnabled) return true;
  const secret = readEnv("CRON_SECRET");
  if (secret) {
    const bearer = req.headers.get("authorization") ?? "";
    if (safeEqual(bearer, `Bearer ${secret}`)) return true;
  }
  return tokenValid(req.cookies.get(AUTH_COOKIE)?.value);
}

async function run(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  // Sizes are opt-in: ~1.1s of pacing per segment against a hard throttle, so the
  // interactive Refresh skips them and keeps the ones already stored.
  const withSizes = searchParams.get("sizes") === "1";
  const force = searchParams.get("force") === "1";

  try {
    if (force) {
      const result = await syncAudiences({ withSizes, sizeBudgetMs: 40_000 });
      return NextResponse.json({ ok: true, ...result });
    }
    const res = await refreshAudiences({ withSizes, sizeBudgetMs: 40_000 });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `Just refreshed — try again in ${Math.ceil(res.waitMs / 1000)}s.`, wait_ms: res.waitMs },
        { status: 429 },
      );
    }
    return NextResponse.json({ ok: true, ...res.result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Audience sync failed";
    console.error("[klaviyo/audiences/sync]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
