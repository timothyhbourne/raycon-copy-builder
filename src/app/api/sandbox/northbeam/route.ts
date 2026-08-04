import { NextRequest, NextResponse } from "next/server";
import { isNorthbeamConfigured, runPlatformProbe } from "@/lib/northbeam";
import { debugRoutesEnabled } from "@/lib/env";

// Sandbox probe: fetch ONE number from Northbeam — the Klaviyo platform-level
// revenue for a window — with full debug detail so failures are diagnosable on
// sight. Reconciliation target: the CRM Campaign (v2) view's Klaviyo
// "Revenue (CO, Cash)" total (Clicks-only model, cash, month to date).
//
// NOTE: there is NO /attribution-models endpoint (confirmed live: 404). The
// documented model ids (docs.northbeam.io/docs/attribution-models) are:
//   northbeam_custom       = "Clicks only"   ← the dashboard's CO metric
//   northbeam_custom__va   = "Clicks + Modeled Views"
//   last_touch             = "Last touch"
//   last_touch_non_direct  = "Last non-direct touch"
//   first_touch            = "First touch"
//   linear                 = "Linear"
//
//   GET /api/sandbox/northbeam[?model=<id>][&window=<days>][&start=YYYY-MM-DD][&end=YYYY-MM-DD]
//     Defaults: month-to-date, the client's configured model + window.
//
// Errors return the raw Northbeam message verbatim (422 bodies name the valid
// enum values — that is how every other id in this client was confirmed).
export const dynamic = "force-dynamic";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  if (!debugRoutesEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isNorthbeamConfigured()) {
    return NextResponse.json({ error: "Northbeam not configured — set NORTHBEAM_API_KEY / NORTHBEAM_CLIENT_ID." }, { status: 400 });
  }
  const { searchParams } = new URL(req.url);
  const t0 = Date.now();

  // Default window: month-to-date (matches the dashboard's "Mo to date" pill).
  const now = new Date();
  const start = searchParams.get("start") || ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const end = searchParams.get("end") || ymd(now);
  const model = searchParams.get("model") || undefined;
  const window = searchParams.get("window") || undefined;
  const granularity = searchParams.get("granularity") || undefined; // default DAILY (see runPlatformProbe)

  try {
    const out = await runPlatformProbe(`${start}T00:00:00`, `${end}T23:59:59`, model, window, granularity);
    return NextResponse.json({
      elapsedMs: Date.now() - t0,
      window: { start, end },
      modelRequested: model ?? "(client default)",
      attributionWindowRequested: window ?? "(client default)",
      granularityRequested: granularity ?? "DAILY",
      klaviyoRevenue: out.klaviyoRevenue,
      totalsByPlatform: out.totalsByPlatform,
      platforms: out.platforms,
      columns: out.columns,
      rowCount: out.rowCount,
      requestBody: out.requestBody,
      rows: out.rows,
    });
  } catch (e) {
    return NextResponse.json({
      elapsedMs: Date.now() - t0,
      window: { start, end },
      modelRequested: model ?? "(client default)",
      attributionWindowRequested: window ?? "(client default)",
      error: e instanceof Error ? e.message : String(e),
    }, { status: 500 });
  }
}
