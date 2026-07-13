import { NextRequest, NextResponse } from "next/server";
import { listSmsCampaigns, saveSmsCampaign, loadSmsCampaign, deleteSmsCampaign } from "@/lib/sms";
import type { SmsCampaign } from "@/lib/schemas";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const campaign = loadSmsCampaign(id);
    if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ campaign });
  }
  return NextResponse.json({ campaigns: listSmsCampaigns() });
}

export async function POST(req: NextRequest) {
  try {
    const campaign: SmsCampaign = await req.json();
    saveSmsCampaign(campaign);
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
  const ok = deleteSmsCampaign(id);
  return NextResponse.json({ ok });
}
