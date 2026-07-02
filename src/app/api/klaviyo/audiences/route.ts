import { NextResponse } from "next/server";
import { listSegments, listLists, type AudienceItem } from "@/lib/klaviyo";

// Combined Klaviyo segments + lists for the planner's audience picker. Audiences
// change rarely, so we cache in-process for 10 minutes. Sequential calls (rate
// limits). In-process only — see the note in klaviyo/overview/route.ts.
const TTL_MS = 10 * 60 * 1000;
let cache: { ts: number; audiences: AudienceItem[] } | null = null;

export async function GET() {
  try {
    if (cache && Date.now() - cache.ts < TTL_MS) {
      return NextResponse.json({ audiences: cache.audiences, cached: true });
    }
    const segments = await listSegments();
    const lists = await listLists();
    // De-duplicate by id (a segment and list never share an id, but guard anyway)
    const byId = new Map<string, AudienceItem>();
    for (const a of [...segments, ...lists]) if (!byId.has(a.id)) byId.set(a.id, a);
    const audiences = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
    cache = { ts: Date.now(), audiences };
    return NextResponse.json({ audiences });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load audiences";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
