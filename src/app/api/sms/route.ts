import { NextRequest, NextResponse } from "next/server";
import { listSmsCampaigns, saveSmsCampaign, loadSmsCampaign, deleteSmsCampaign } from "@/lib/sms";
import { recordSms, removeCampaign } from "@/lib/constructions";
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
    // Feed finalized SMS variants into the construction index so future SMS
    // generation is told not to echo them (mirrors email finalize → updateCampaign).
    if (campaign.status === "final") {
      recordSms({
        id: campaign.id,
        date: (campaign.created_at || campaign.updated_at || "").slice(0, 10),
        campaign_type: "sms",
        title: campaign.name,
        lines: (campaign.variants ?? []).map((v) => v?.text ?? ""),
      });
    }
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
  if (ok) removeCampaign(id); // drop its SMS entry from the construction index
  return NextResponse.json({ ok });
}
