import { NextRequest, NextResponse } from "next/server";
import { aggregate, type CopyPerformanceResult } from "@/lib/copy-performance";
import { resolvePerformanceRecords } from "@/lib/performance-records";
import { copyPerformanceQuery } from "@/lib/validation/requests";

// Copy Performance read + aggregation (spec: COPY_PERFORMANCE_SPEC.md §6).
// READ-ONLY: joins already-synced planner-row metrics to the copy attributes of
// the linked SavedCampaign (or LibraryCampaign fallback), then aggregates RPR by
// copy dimension. Zero Klaviyo calls on this path — pure Redis store reads — so
// it's fast. It mutates nothing.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const parsed = copyPerformanceQuery.safeParse({
    start: searchParams.get("start") ?? undefined,
    end: searchParams.get("end") ?? undefined,
    channel: searchParams.get("channel") ?? undefined,
    basis: searchParams.get("basis") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "start and end (YYYY-MM-DD) required; channel=email|sms|all, basis=platform|northbeam" }, { status: 400 });
  }
  const { start, end, channel, basis } = parsed.data;
  if (start > end) {
    return NextResponse.json({ error: "start must be on or before end" }, { status: 400 });
  }

  try {
    // The join lives in src/lib/performance-records.ts so this dashboard and the
    // PERFORMANCE prompt block can never disagree about what a send earned.
    const records = await resolvePerformanceRecords({ start, end, channel });

    const { aggregates, coverage } = aggregate(records, basis);

    const result: CopyPerformanceResult = {
      records, aggregates, coverage, range: { start, end }, basis, channel,
    };
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[copy-performance]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
