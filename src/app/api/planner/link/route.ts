import { NextRequest, NextResponse } from "next/server";
import { linkCopyCampaign, unlinkCopyCampaign } from "@/lib/planner";

// Dedicated endpoint for attaching / detaching a Copy Builder campaign to a
// planner row. Kept separate from the main planner POST so the copy-builder
// doesn't have to resend name/channel just to record a link.

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      row_id?: string;
      copy_campaign_id?: string;
      copy_status?: string;
    };
    if (!body.row_id || !body.copy_campaign_id) {
      return NextResponse.json({ error: "row_id and copy_campaign_id are required" }, { status: 400 });
    }
    if (body.copy_status !== "draft" && body.copy_status !== "final") {
      return NextResponse.json({ error: "copy_status must be 'draft' or 'final'" }, { status: 400 });
    }
    const row = linkCopyCampaign(body.row_id, body.copy_campaign_id, body.copy_status);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ row });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Link failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Heal a stale link (the saved campaign was deleted): clears the copy fields.
export async function DELETE(req: NextRequest) {
  const rowId = new URL(req.url).searchParams.get("row_id");
  if (!rowId) return NextResponse.json({ error: "row_id required" }, { status: 400 });
  const row = unlinkCopyCampaign(rowId);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ row });
}
