import { NextRequest, NextResponse } from "next/server";
import { listPlannerRows } from "@/lib/planner";
import { isEffectivelySent } from "@/lib/planner-types";
import { loadCampaign } from "@/lib/campaigns";
import { getLibraryCampaigns } from "@/lib/library";
import {
  toRecord, attributesFromSaved, attributesFromLibrary, aggregate,
  type PerformanceRecord, type CopyPerformanceResult,
} from "@/lib/copy-performance";
import { copyPerformanceQuery } from "@/lib/validation/requests";

// Copy Performance read + aggregation (spec: COPY_PERFORMANCE_SPEC.md §6).
// READ-ONLY: joins already-synced planner-row metrics to the copy attributes of
// the linked SavedCampaign (or LibraryCampaign fallback), then aggregates RPR by
// copy dimension. Zero Klaviyo calls on this path — pure Redis store reads — so
// it's fast. It mutates nothing.

export const dynamic = "force-dynamic";

function sendYMD(row: { klaviyo_send_time?: string | null; planned_send_at: string }): string {
  const iso = row.klaviyo_send_time || row.planned_send_at || "";
  return iso.slice(0, 10);
}

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
    const rows = await listPlannerRows();
    const sentInRange = rows.filter((r) => {
      if (!isEffectivelySent(r)) return false;
      if (channel !== "all" && r.channel !== channel) return false;
      const d = sendYMD(r);
      return d >= start && d <= end;
    });

    // Library, loaded once, indexed by the planner row it was written for — the
    // attribute fallback when the saved draft no longer resolves.
    const library = await getLibraryCampaigns();
    const libByRow = new Map(
      library.filter((l) => l.planner_row_id).map((l) => [l.planner_row_id as string, l]),
    );

    const records: PerformanceRecord[] = await Promise.all(
      sentInRange.map(async (row) => {
        // Prefer the linked SavedCampaign (richest attributes)…
        if (row.copy_campaign_id) {
          const saved = await loadCampaign(row.copy_campaign_id);
          if (saved) return toRecord(row, { source: "saved", attributes: attributesFromSaved(saved, row) });
        }
        // …else the library entry written for this row…
        const lib = libByRow.get(row.id);
        if (lib) return toRecord(row, { source: "library", attributes: attributesFromLibrary(lib, row) });
        // …else it's a sent send with no app-written copy: unattributed.
        return toRecord(row, null);
      }),
    );

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
