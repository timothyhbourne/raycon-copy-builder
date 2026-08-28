import { NextResponse } from "next/server";
import { readAudienceCatalogue } from "@/lib/klaviyo-audiences";

// The picker's audience list, READ FROM THE STORE
// (docs/PLANNER_AUDIENCE_BRIEF_SPEC.md §4).
//
// This used to fetch segments and lists live behind a 10-minute IN-PROCESS cache.
// On Vercel every cold lambda starts with that cache empty, and the fetch measures
// at 36 sequential requests / 17.5 seconds on this account — so the picker often
// blew the function timeout and, to the user, simply hung. It makes ZERO Klaviyo
// calls now; lib/klaviyo-audiences.ts writes the catalogue on a schedule.
export const dynamic = "force-dynamic";

export async function GET() {
  const catalogue = await readAudienceCatalogue();
  if (!catalogue) {
    // Not an error: the sync hasn't run yet. The picker says so and offers Refresh,
    // which is a fix the user can actually act on.
    return NextResponse.json(
      { audiences: [], synced_at: null, truncated: false, sized: 0, empty: true },
      { status: 200 },
    );
  }
  return NextResponse.json(catalogue);
}
