import { NextResponse } from "next/server";
import { limiterState } from "@/lib/klaviyo-limiter";
import { readSnapshot } from "@/lib/klaviyo-snapshot";
import { getAccountTimezoneCached } from "@/lib/klaviyo-cache";
import { todayYMDInTz } from "@/lib/cache-ttl";

// Observability for the reporting tier (spec §3.2, §3.3): how much of the 225/day
// we have spent, whether the circuit breaker is open and for how long, and how
// fresh the snapshot is. The breaker being visible here is an acceptance criterion
// — a block that nobody can see is a block nobody fixes.
export const dynamic = "force-dynamic";

export async function GET() {
  const tz = await getAccountTimezoneCached();
  const day = todayYMDInTz(tz);
  const [limiter, snap] = await Promise.all([limiterState(day), readSnapshot()]);
  const ageMs = snap?.synced_at ? Date.now() - Date.parse(snap.synced_at) : null;
  return NextResponse.json({
    ...limiter,
    account_timezone: tz,
    account_day: day,
    snapshot: snap
      ? {
          synced_at: snap.synced_at,
          age_hours: ageMs != null ? Number((ageMs / 3_600_000).toFixed(2)) : null,
          window: snap.window,
          campaigns: snap.campaigns.length,
          campaigns_final: snap.campaigns.filter((c) => c.final).length,
          flow_days: snap.flow_days.length,
          day_totals: snap.day_totals.length,
          warnings: snap.warnings,
        }
      : null,
  });
}
