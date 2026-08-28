import { NextRequest, NextResponse } from "next/server";
import { getCampaignAudiences, type CampaignAudiences } from "@/lib/klaviyo";
import { readAudienceCatalogue } from "@/lib/klaviyo-audiences";

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
    // Resolve ids → names from the SYNCED catalogue. Without it
    // getCampaignAudiences re-fetches every segment and list (36 requests, 17.5s
    // measured) just to name a handful of ids
    // (docs/PLANNER_AUDIENCE_BRIEF_SPEC.md §2.4).
    const catalogue = await readAudienceCatalogue();
    const known = new Map((catalogue?.audiences ?? []).map((a) => [a.id, { id: a.id, name: a.name, type: a.type }]));
    const data = await getCampaignAudiences(campaignId, known);
    cache.set(campaignId, { ts: Date.now(), data });
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load audiences";
    console.error("[planner/audiences]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
