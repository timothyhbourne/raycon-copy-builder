import { NextResponse } from "next/server";
import { listKlaviyoCampaigns, type KlaviyoCampaignItem } from "@/lib/klaviyo";

// Recent email campaigns for the planner's campaign picker (typeahead). Cached
// in-process for 5 minutes. Sequential; in-process cache only.
const TTL_MS = 5 * 60 * 1000;
let cache: { ts: number; campaigns: KlaviyoCampaignItem[] } | null = null;

export async function GET() {
  try {
    if (cache && Date.now() - cache.ts < TTL_MS) {
      return NextResponse.json({ campaigns: cache.campaigns, cached: true });
    }
    const campaigns = await listKlaviyoCampaigns();
    cache = { ts: Date.now(), campaigns };
    return NextResponse.json({ campaigns });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load campaigns";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
