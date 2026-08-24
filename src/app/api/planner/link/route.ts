import { NextRequest, NextResponse } from "next/server";
import { linkCopyCampaign, unlinkCopyCampaign, listPlannerRows, getPlannerRow } from "@/lib/planner";
import { loadCampaign, setCampaignPlannerRow } from "@/lib/campaigns";
import { getLibraryCampaignById, setLibraryPlannerRow } from "@/lib/library";
import { loadSmsCampaign, setSmsPlannerRow } from "@/lib/sms";
import { loadFlowEmail, setFlowEmailPlannerRow, parseFlowEmailId } from "@/lib/flows";
import { parseBody } from "@/lib/validation/api";
import { plannerLinkBody } from "@/lib/validation/requests";

// Attach / detach a Copy Builder campaign to a planner row. Kept separate from
// the main planner POST so the copy-builder doesn't have to resend name/channel
// just to record a link. The link is BIDIRECTIONAL and SINGLE-OWNER:
//  - the row stores copy_campaign_id / copy_status (planner side)
//  - the copy record stores planner_row_id (copy side)
//  - a copy belongs to at most one row: linking a copy already owned by another
//    row unlinks that other row.
// All writes go through the store modules — no direct fs here.

// Write (or clear) the copy record's planner_row_id back-reference: flow emails
// first (their composite id is unmistakable), then the drafts store, the SMS
// store, and the library.
async function setCopyBackref(copyCampaignId: string, plannerRowId: string | null): Promise<void> {
  // Flows FIRST: a composite "<flowId>::<emailId>" id cannot be anything else
  // (parseFlowEmailId rejects every other id shape), and the check is cheap.
  if (parseFlowEmailId(copyCampaignId)) {
    await setFlowEmailPlannerRow(copyCampaignId, plannerRowId);
    return;
  }
  if (await setCampaignPlannerRow(copyCampaignId, plannerRowId)) return;
  if (await setSmsPlannerRow(copyCampaignId, plannerRowId)) return;
  await setLibraryPlannerRow(copyCampaignId, plannerRowId);
}

// True if the id resolves to a flow email, draft, library, or SMS copy.
async function copyExists(copyCampaignId: string): Promise<boolean> {
  if (parseFlowEmailId(copyCampaignId)) return !!(await loadFlowEmail(copyCampaignId));
  return !!(await loadCampaign(copyCampaignId)) || !!(await getLibraryCampaignById(copyCampaignId)) || !!(await loadSmsCampaign(copyCampaignId));
}

// Human name for the copy record that currently owns a row, for the 409 message.
// A flow email names its flow and its position, since "email 2" alone says nothing.
async function copyOwnerName(id: string): Promise<string> {
  const flowEmail = await loadFlowEmail(id);
  if (flowEmail) return `${flowEmail.flow.name} — email ${flowEmail.email.position}`;
  return (await loadCampaign(id))?.campaign_name
    ?? (await getLibraryCampaignById(id))?.title
    ?? (await loadSmsCampaign(id))?.name
    ?? id;
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseBody(req, plannerLinkBody);
    if (parsed.error) return parsed.error;
    const body = parsed.data as {
      row_id?: string;
      copy_campaign_id?: string;
      copy_status?: string;
      unlink?: boolean;
      reassign?: boolean;
    };

    // POST with unlink:true is an alias for DELETE (some clients can't send a body on DELETE).
    if (body.unlink) return await doUnlink(body.row_id);

    if (!body.row_id || !body.copy_campaign_id) {
      return NextResponse.json({ error: "row_id and copy_campaign_id are required" }, { status: 400 });
    }
    if (body.copy_status !== "draft" && body.copy_status !== "final") {
      return NextResponse.json({ error: "copy_status must be 'draft' or 'final'" }, { status: 400 });
    }
    const { row_id, copy_campaign_id, copy_status } = body;

    const rows = await listPlannerRows();
    const target = rows.find((r) => r.id === row_id);

    // DEFENCE IN DEPTH (spec §3.5). Reassigning a row is destructive: because the
    // link is single-owner, taking a row from another copy also clears THAT copy's
    // back-reference. That happened silently and it is how one bad save corrupted
    // two records. Now it requires stated intent, so the destructive path cannot be
    // reached by accident even if a future client regresses — which, this being the
    // second occurrence, is the point.
    if (
      target?.copy_campaign_id &&
      target.copy_campaign_id !== copy_campaign_id &&
      !body.reassign
    ) {
      const owner = target.copy_campaign_id;
      const ownerName = await copyOwnerName(owner);
      return NextResponse.json(
        {
          error: "That planner row is already linked to another copy.",
          conflict: { row_id, owner_copy_campaign_id: owner, owner_name: ownerName },
        },
        { status: 409 },
      );
    }

    // Single-owner: unlink any OTHER row currently pointing at this copy.
    for (const r of rows) {
      if (r.id !== row_id && r.copy_campaign_id === copy_campaign_id) await unlinkCopyCampaign(r.id);
    }
    // If the target row previously pointed at a DIFFERENT copy, clear that copy's
    // stale back-reference so it doesn't claim ownership of a row it no longer has.
    // Only reachable with reassign:true, per the guard above.
    if (target?.copy_campaign_id && target.copy_campaign_id !== copy_campaign_id) {
      await setCopyBackref(target.copy_campaign_id, null);
    }

    // Stamp the row (planner side), then write the copy-side back-reference.
    const row = await linkCopyCampaign(row_id, copy_campaign_id, copy_status);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (await copyExists(copy_campaign_id)) await setCopyBackref(copy_campaign_id, row_id);

    return NextResponse.json({ row });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Link failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Unlink: clear the row's copy fields AND the copy record's planner_row_id.
async function doUnlink(rowId: string | undefined) {
  if (!rowId) return NextResponse.json({ error: "row_id required" }, { status: 400 });
  const prev = await getPlannerRow(rowId);
  const row = await unlinkCopyCampaign(rowId);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (prev?.copy_campaign_id) await setCopyBackref(prev.copy_campaign_id, null);
  return NextResponse.json({ row });
}

export async function DELETE(req: NextRequest) {
  const rowId = new URL(req.url).searchParams.get("row_id") ?? undefined;
  return await doUnlink(rowId);
}
