import { NextRequest, NextResponse } from "next/server";
import { isNorthbeamConfigured, listBreakdowns, northbeamPlatformLabels, runCampaignProbe } from "@/lib/northbeam";
import { debugRoutesEnabled } from "@/lib/env";

// Sandbox probe #2: ONE campaign's Klaviyo revenue from the campaign-level
// Northbeam export. The recipe is CONFIRMED live (2026-07-23) and shared with
// the planner sync via buildCampaignExportBody — this probe stays as the
// diagnostic for reconciling any window/model against CRM Campaign (v2).
//
//   GET /api/sandbox/northbeam-campaign?campaign=<name>[&model=][&window=][&start=][&end=]
//     Defaults: month-to-date, model/window = client defaults, DAILY granularity.
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

  // Discovery mode: the account's valid breakdown keys (GET /breakdowns exists,
  // unlike /attribution-models). Use this to lock the campaign breakdown key.
  if (searchParams.get("breakdowns") === "1") {
    try {
      const breakdowns = await listBreakdowns();
      return NextResponse.json({ elapsedMs: Date.now() - t0, breakdowns });
    } catch (e) {
      return NextResponse.json({ elapsedMs: Date.now() - t0, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  const campaign = (searchParams.get("campaign") || "").trim();
  if (!campaign) {
    return NextResponse.json({ error: "Pass ?campaign=<Klaviyo campaign name>." }, { status: 400 });
  }
  const now = new Date();
  const start = searchParams.get("start") || ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const end = searchParams.get("end") || ymd(now);
  const model = searchParams.get("model") || undefined;
  const window = searchParams.get("window") || undefined;
  const key = searchParams.get("key") || undefined; // campaign breakdown key override
  // ?platform=postscript matches the SMS platform's rows (campaign flows via
  // utm_campaign); default is the email platform (Klaviyo).
  const labels = northbeamPlatformLabels();
  const platformLabel = (searchParams.get("platform") || "").toLowerCase() === "postscript" ? labels.sms : labels.email;

  try {
    const out = await runCampaignProbe(`${start}T00:00:00`, `${end}T23:59:59`, campaign, model, window, undefined, key, platformLabel);
    return NextResponse.json({
      elapsedMs: Date.now() - t0,
      window: { start, end },
      campaignQuery: campaign,
      platformLabel,
      modelRequested: model ?? "(client default)",
      attributionWindowRequested: window ?? "(client default)",
      strategyUsed: out.strategyUsed,
      attempts: out.attempts,
      matchType: out.matchType,
      matchedName: out.matchedName,
      matchedRevenue: out.matchedRevenue,
      candidates: out.candidates,
      platforms: out.platforms,
      columns: out.columns,
      rowCount: out.rowCount,
      requestBody: out.requestBody,
    });
  } catch (e) {
    return NextResponse.json({
      elapsedMs: Date.now() - t0,
      window: { start, end },
      campaignQuery: campaign,
      modelRequested: model ?? "(client default)",
      attributionWindowRequested: window ?? "(client default)",
      error: e instanceof Error ? e.message : String(e),
    }, { status: 500 });
  }
}
