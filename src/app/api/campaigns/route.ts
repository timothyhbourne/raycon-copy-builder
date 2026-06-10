import { NextRequest, NextResponse } from "next/server";
import { listCampaigns, saveCampaign, loadCampaign, deleteCampaign } from "@/lib/campaigns";
import type { SavedCampaign } from "@/lib/schemas";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const campaign = loadCampaign(id);
    if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ campaign });
  }
  return NextResponse.json({ campaigns: listCampaigns() });
}

export async function POST(req: NextRequest) {
  try {
    const campaign: SavedCampaign = await req.json();
    saveCampaign(campaign);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const ok = deleteCampaign(id);
  return NextResponse.json({ ok });
}
