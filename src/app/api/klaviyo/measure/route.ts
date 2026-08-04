import { NextRequest, NextResponse } from "next/server";
import { fetchRangeOverview, isRateLimited } from "@/lib/measure";

// LIVE, on-demand measurement (spec: MEASUREMENT_LIVE_FETCH_SPEC.md). Thin route
// over the shared aggregation in src/lib/measure.ts (fetchRangeOverview) — the
// same function the dashboard-briefing route uses for prior-period comparison,
// so a range is computed one way. Makes live Klaviyo calls for EXACTLY the
// requested range and returns the fully aggregated dashboard payload, or a clear
// error. Completeness or nothing — never a partial total.

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
    const overview = await fetchRangeOverview(startYMD, endYMD);
    return NextResponse.json(overview);
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
