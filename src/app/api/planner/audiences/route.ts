import { NextRequest, NextResponse } from "next/server";
import { getCampaignAudiences, type CampaignAudiences } from "@/lib/klaviyo";

// Audiences of a linked Klaviyo campaign, id→name resolved. The planner editor
// calls this when a campaign is linked (and on open for an already-linked row)
// to auto-populate the row's audiences. Auth: relies on the app-wide proxy gate,
// same posture as the other /api/planner routes. Cached per campaign id for 10
// minutes since a scheduled campaign's audiences rarely change.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { ts: number; data: CampaignAudiences }>();

export async function GET(req: NextRequest) {
  const campaignId = new URL(req.url).searchParams.get("campaign_id");
  if (!campaignId) {
    return NextResponse.json({ error: "campaign_id query param required" }, { status: 400 });
  }
  try {
    const hit = cache.get(campaignId);
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return NextResponse.json(hit.data);
    const data = await getCampaignAudiences(campaignId);
    cache.set(campaignId, { ts: Date.now(), data });
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load audiences";
    console.error("[planner/audiences]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
