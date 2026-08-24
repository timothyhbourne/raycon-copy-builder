// Resolve PerformanceRecords from the stores. The I/O half of copy-performance.ts,
// factored out of /api/copy-performance so the generation path can reuse it: the
// dashboard and the PERFORMANCE prompt block must never disagree about what a send
// earned (docs/RECURSIVE_LEARNING_FRAMEWORK_SPEC.md §2.6.4).
//
// Server only (planner + library + saved-campaign stores). READ-ONLY, and zero
// Klaviyo calls — pure store reads, so it is cheap enough to sit on the generation
// path.

import { listPlannerRows } from "./planner";
import { isEffectivelySent, isSendableRow } from "./planner-types";
import type { PlannerRow } from "./planner-types";
import { loadCampaign } from "./campaigns";
import { getLibraryCampaigns } from "./library";
import {
  toRecord, attributesFromSaved, attributesFromLibrary,
  type PerformanceRecord, type ChannelFilter,
} from "./copy-performance";

export function sendYMD(row: Pick<PlannerRow, "klaviyo_send_time" | "planned_send_at">): string {
  return (row.klaviyo_send_time || row.planned_send_at || "").slice(0, 10);
}

export interface ResolveOpts {
  /** Inclusive YYYY-MM-DD bounds. Omit for "everything". */
  start?: string;
  end?: string;
  channel?: ChannelFilter;
}

/** YYYY-MM-DD `days` before today, for a rolling lookback window. */
export function ymdDaysAgo(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Every effectively-sent planner row in range, joined to the copy attributes of the
 * linked SavedCampaign (richest) or the library entry written for that row
 * (fallback). A sent row with no app-written copy comes back as `unattributed` — it
 * counts in coverage and contributes to no aggregate.
 */
export async function resolvePerformanceRecords(opts: ResolveOpts = {}): Promise<PerformanceRecord[]> {
  const { start, end, channel = "all" } = opts;
  const rows = await listPlannerRows();
  const sentInRange = rows.filter((r) => {
    // A flow-email row is a build/QA task, not a send: it has no real send date and
    // no metrics, so counting it would inflate the denominator this dashboard's
    // coverage figure is built on (docs/FLOW_BUILDER_FIXES_SPEC.md §3.2).
    if (!isSendableRow(r)) return false;
    if (!isEffectivelySent(r)) return false;
    if (channel !== "all" && r.channel !== channel) return false;
    const d = sendYMD(r);
    if (start && d < start) return false;
    if (end && d > end) return false;
    return true;
  });

  const library = await getLibraryCampaigns();
  const libByRow = new Map(
    library.filter((l) => l.planner_row_id).map((l) => [l.planner_row_id as string, l]),
  );

  return Promise.all(
    sentInRange.map(async (row) => {
      if (row.copy_campaign_id) {
        const saved = await loadCampaign(row.copy_campaign_id);
        if (saved) return toRecord(row, { source: "saved", attributes: attributesFromSaved(saved, row) });
      }
      const lib = libByRow.get(row.id);
      if (lib) return toRecord(row, { source: "library", attributes: attributesFromLibrary(lib, row) });
      return toRecord(row, null);
    }),
  );
}
