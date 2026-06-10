import { NextRequest, NextResponse } from "next/server";
import { getLibraryCampaigns, getLibraryCampaignById, deleteFromLibrary } from "@/lib/library";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (id) {
      const campaign = getLibraryCampaignById(id);
      if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ campaign });
    }
    const campaigns = getLibraryCampaigns();
    // ?all=true — return full bodies in one shot, avoids N individual fetches in the client
    if (url.searchParams.get("all") === "true") return NextResponse.json({ campaigns });
    const meta = campaigns.map(({ body: _body, structured: _structured, ...rest }) => rest);
    return NextResponse.json({ campaigns: meta });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to load library" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const deleted = deleteFromLibrary(id);
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
