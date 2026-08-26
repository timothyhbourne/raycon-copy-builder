import { NextResponse } from "next/server";
import { readSnapshot } from "@/lib/klaviyo-snapshot";

// The whole snapshot, once. The dashboard fetches this on mount and then slices
// every range IN THE BROWSER with lib/klaviyo-slice.ts, which is what makes a
// date-range change instant and free of any network call at all — the acceptance
// criterion docs/KLAVIYO_RATE_LIMIT_SPEC.md §4 sets.
//
// Zero Klaviyo calls: this reads Redis and nothing else.
export const dynamic = "force-dynamic";

export async function GET() {
  const snap = await readSnapshot();
  if (!snap) {
    return NextResponse.json(
      { error: "No Klaviyo snapshot yet. Run the sync (POST /api/klaviyo/sync) and reload." },
      { status: 503 },
    );
  }
  return NextResponse.json(snap);
}
