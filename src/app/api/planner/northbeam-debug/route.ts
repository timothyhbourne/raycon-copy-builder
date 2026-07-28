import { NextRequest, NextResponse } from "next/server";
import { runRawCampaignExport, isNorthbeamConfigured, normalizeCampaignName } from "@/lib/northbeam";
import { previousCompletedWeek, weekWindowForIsoWeek } from "@/lib/reports/weekly";
import { debugRoutesEnabled } from "@/lib/env";

// Phase-1 confirmation helper for the campaign-level Northbeam export that backs
// the planner's "NB rev (1d click)" column. Cookie-gated by the app proxy (same
// as reports/weekly/debug). Runs a campaign-level export for a window and dumps:
//   - requestBody      : the exact export body sent (level + breakdown keys)
//   - columns          : discovered column names (confirm the campaign-name key)
//   - campaignNames    : distinct campaign-name strings Northbeam reports
//   - normalizedSample : raw → normalized, to eyeball the match rule
//   - platforms        : distinct platform labels
//   - totalsByPlatform : per-platform revenue totals for reconciling against the
//                        weekly report's channel totals and the CRM v2 view
//   - rows             : the raw parsed rows
//
//   ?week=YYYY-Www  → that ISO week   (default: previous completed week)
//
// The recipe is CONFIRMED live (2026-07-23, see buildCampaignExportBody) — this
// route stays as the reconciliation/diagnostic dump for the planner column.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!debugRoutesEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isNorthbeamConfigured()) {
    return NextResponse.json({ error: "Northbeam not configured — set NORTHBEAM_API_KEY / NORTHBEAM_CLIENT_ID." }, { status: 400 });
  }
  const { searchParams } = new URL(req.url);
  const week = searchParams.get("week");
  const win = week ? weekWindowForIsoWeek(week) : previousCompletedWeek(new Date().toISOString().slice(0, 10));
  if (!win) return NextResponse.json({ error: `bad week "${week}"` }, { status: 400 });
  try {
    const out = await runRawCampaignExport(`${win.startYMD}T00:00:00`, `${win.endYMD}T23:59:59`);
    return NextResponse.json({
      window: win,
      requestBody: out.requestBody,
      columns: out.columns,
      platforms: out.platforms,
      totalsByPlatform: out.totalsByPlatform,
      campaignNames: out.campaignNames,
      normalizedSample: out.campaignNames.slice(0, 25).map((n) => ({ raw: n, normalized: normalizeCampaignName(n) })),
      rowCount: out.rows.length,
      rows: out.rows,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "debug failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
