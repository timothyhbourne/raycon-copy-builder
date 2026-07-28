import { NextRequest, NextResponse } from "next/server";
import { isNorthbeamConfigured, listNorthbeamCampaignNames, northbeamPlatformLabels } from "@/lib/northbeam";

// Campaign names Northbeam reported for one platform over a recent window —
// feeds the planner's Northbeam-campaign picker (the typo-proof join key for
// the NB rev match; see docs/SMS_PLANNER_NB_LINK_AND_MANUAL_METRICS_SPEC.md).
//
//   GET /api/planner/northbeam-campaigns?platform=postscript[&start=YMD&end=YMD][&refresh=1]
//     platform: "postscript" (default) | "klaviyo"
//     window default: last 30 days ending YESTERDAY (Northbeam's last fully
//     processed day — same pinning as the sync).
//
// Northbeam exports take minutes, so results are cached in-process ~1h per
// (platform, window); &refresh=1 bypasses the cache.
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { ts: number; names: { name: string; revenue: number }[] }>();

function ymdDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  if (!isNorthbeamConfigured()) {
    return NextResponse.json({ error: "Northbeam not configured — set NORTHBEAM_API_KEY / NORTHBEAM_CLIENT_ID." }, { status: 400 });
  }
  const { searchParams } = new URL(req.url);
  const labels = northbeamPlatformLabels();
  const platform = (searchParams.get("platform") || "postscript").toLowerCase() === "klaviyo" ? labels.email : labels.sms;
  const start = searchParams.get("start") || ymdDaysAgo(31);
  const end = searchParams.get("end") || ymdDaysAgo(1); // yesterday — last fully processed day
  const refresh = searchParams.get("refresh") === "1";

  const key = `${platform}|${start}|${end}`;
  const hit = cache.get(key);
  if (hit && !refresh && Date.now() - hit.ts < CACHE_TTL_MS) {
    return NextResponse.json({ platform, window: { start, end }, cached: true, fetched_at: new Date(hit.ts).toISOString(), names: hit.names });
  }
  try {
    const names = await listNorthbeamCampaignNames(platform, `${start}T00:00:00`, `${end}T23:59:59`);
    cache.set(key, { ts: Date.now(), names });
    return NextResponse.json({ platform, window: { start, end }, cached: false, fetched_at: new Date().toISOString(), names });
  } catch (e) {
    // A failed export shouldn't dead-end the picker: serve a stale cache if one
    // exists (the free-text fallback still works regardless).
    if (hit) {
      return NextResponse.json({ platform, window: { start, end }, cached: true, stale: true, fetched_at: new Date(hit.ts).toISOString(), names: hit.names });
    }
    const msg = e instanceof Error ? e.message : "Northbeam campaign list failed";
    console.error("[planner/northbeam-campaigns]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
