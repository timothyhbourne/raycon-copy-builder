import { NextRequest, NextResponse } from "next/server";
import { listCampaigns, saveCampaign, loadCampaign, deleteCampaign } from "@/lib/campaigns";
import { parseBody } from "@/lib/validation/api";
import { campaignPostBody } from "@/lib/validation/requests";
import type { SavedCampaign } from "@/lib/schemas";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const campaign = await loadCampaign(id);
    if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ campaign });
  }
  return NextResponse.json({ campaigns: await listCampaigns() });
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseBody(req, campaignPostBody);
    if (parsed.error) return parsed.error;
    await saveCampaign(parsed.data as SavedCampaign);
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
  const ok = await deleteCampaign(id);
  return NextResponse.json({ ok });
}
