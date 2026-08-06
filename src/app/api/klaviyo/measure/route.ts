import { NextRequest, NextResponse } from "next/server";
import { isRateLimited } from "@/lib/measure";
import { getRangeOverview } from "@/lib/measure-cache";

// LIVE, on-demand measurement (spec: MEASUREMENT_LIVE_FETCH_SPEC + ANALYTICS_RATE_
// LIMIT_SPEC). Thin route over the SHARED, Redis-cached accessor getRangeOverview
// (measure-cache.ts): an identical range is fetched from Klaviyo once per TTL and
// served from cache to every user/tab/instance thereafter, and a throttle serves
// the last known figures (labeled `stale`) instead of erroring. Returns the
// aggregated payload plus `fetched_at` + `stale` so the UI can show freshness.

export const dynamic = "force-dynamic";
export const maxDuration = 60; // headroom for patient rate-limit back-off

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const startYMD = searchParams.get("start");
  const endYMD = searchParams.get("end");

  if (!startYMD || !endYMD || !YMD_RE.test(startYMD) || !YMD_RE.test(endYMD)) {
    return NextResponse.json({ error: "start and end query params required (YYYY-MM-DD)" }, { status: 400 });
  }
  if (startYMD > endYMD) {
    return NextResponse.json({ error: "start must be on or before end" }, { status: 400 });
  }

  try {
    const { overview, fetched_at, stale } = await getRangeOverview(startYMD, endYMD);
    return NextResponse.json({ ...overview, fetched_at, stale });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[klaviyo/measure]", msg);
    if (isRateLimited(msg)) {
      return NextResponse.json(
        { error: "Klaviyo is rate-limiting us right now — give it a moment and hit Refresh." },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
