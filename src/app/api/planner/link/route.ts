import { NextRequest, NextResponse } from "next/server";
import { linkCopyCampaign, unlinkCopyCampaign, listPlannerRows, getPlannerRow } from "@/lib/planner";
import { loadCampaign, setCampaignPlannerRow } from "@/lib/campaigns";
import { getLibraryCampaignById, setLibraryPlannerRow } from "@/lib/library";
import { loadSmsCampaign, setSmsPlannerRow } from "@/lib/sms";

// Attach / detach a Copy Builder campaign to a planner row. Kept separate from
// the main planner POST so the copy-builder doesn't have to resend name/channel
// just to record a link. The link is BIDIRECTIONAL and SINGLE-OWNER:
//  - the row stores copy_campaign_id / copy_status (planner side)
//  - the copy record stores planner_row_id (copy side)
//  - a copy belongs to at most one row: linking a copy already owned by another
//    row unlinks that other row.
// All writes go through the store modules — no direct fs here.

// Write (or clear) the copy record's planner_row_id back-reference, trying the
// drafts store first, then the library, then the SMS store.
function setCopyBackref(copyCampaignId: string, plannerRowId: string | null): void {
  if (setCampaignPlannerRow(copyCampaignId, plannerRowId)) return;
  if (setSmsPlannerRow(copyCampaignId, plannerRowId)) return;
  setLibraryPlannerRow(copyCampaignId, plannerRowId);
}

// True if the id resolves to a draft, library, or SMS copy.
function copyExists(copyCampaignId: string): boolean {
  return !!loadCampaign(copyCampaignId) || !!getLibraryCampaignById(copyCampaignId) || !!loadSmsCampaign(copyCampaignId);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      row_id?: string;
      copy_campaign_id?: string;
      copy_status?: string;
      unlink?: boolean;
    };

    // POST with unlink:true is an alias for DELETE (some clients can't send a body on DELETE).
    if (body.unlink) return doUnlink(body.row_id);

    if (!body.row_id || !body.copy_campaign_id) {
      return NextResponse.json({ error: "row_id and copy_campaign_id are required" }, { status: 400 });
    }
    if (body.copy_status !== "draft" && body.copy_status !== "final") {
      return NextResponse.json({ error: "copy_status must be 'draft' or 'final'" }, { status: 400 });
    }
    const { row_id, copy_campaign_id, copy_status } = body;

    const rows = listPlannerRows();

    // Single-owner: unlink any OTHER row currently pointing at this copy.
    for (const r of rows) {
      if (r.id !== row_id && r.copy_campaign_id === copy_campaign_id) unlinkCopyCampaign(r.id);
    }
    // If the target row previously pointed at a DIFFERENT copy, clear that copy's
    // stale back-reference so it doesn't claim ownership of a row it no longer has.
    const target = rows.find((r) => r.id === row_id);
    if (target?.copy_campaign_id && target.copy_campaign_id !== copy_campaign_id) {
      setCopyBackref(target.copy_campaign_id, null);
    }

    // Stamp the row (planner side), then write the copy-side back-reference.
    const row = linkCopyCampaign(row_id, copy_campaign_id, copy_status);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (copyExists(copy_campaign_id)) setCopyBackref(copy_campaign_id, row_id);

    return NextResponse.json({ row });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Link failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Unlink: clear the row's copy fields AND the copy record's planner_row_id.
function doUnlink(rowId: string | undefined) {
  if (!rowId) return NextResponse.json({ error: "row_id required" }, { status: 400 });
  const prev = getPlannerRow(rowId);
  const row = unlinkCopyCampaign(rowId);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (prev?.copy_campaign_id) setCopyBackref(prev.copy_campaign_id, null);
  return NextResponse.json({ row });
}

export async function DELETE(req: NextRequest) {
  const rowId = new URL(req.url).searchParams.get("row_id") ?? undefined;
  return doUnlink(rowId);
}
