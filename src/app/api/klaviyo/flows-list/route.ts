import { NextResponse } from "next/server";
import { listFlows, type FlowListItem } from "@/lib/klaviyo";

// Real Klaviyo flows for the flow builder's "link to a real flow" typeahead
// (reference only — authoring stays in-app). Mirrors campaigns-list: cached
// in-process for 5 minutes, sequential, in-process cache only.
const TTL_MS = 5 * 60 * 1000;
let cache: { ts: number; flows: FlowListItem[] } | null = null;

export async function GET() {
  try {
    if (cache && Date.now() - cache.ts < TTL_MS) {
      return NextResponse.json({ flows: cache.flows, cached: true });
    }
    const flows = await listFlows();
    cache = { ts: Date.now(), flows };
    return NextResponse.json({ flows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load flows";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
