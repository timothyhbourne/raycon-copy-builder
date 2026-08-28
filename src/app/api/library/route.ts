import { NextRequest, NextResponse } from "next/server";
import { getLibraryCampaigns, getLibraryCampaignById, deleteFromLibrary, renameLibraryCampaign } from "@/lib/library";
import { removeCampaign } from "@/lib/constructions";
import { parseBody } from "@/lib/validation/api";
import { libraryRenameBody } from "@/lib/validation/requests";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (id) {
      const campaign = await getLibraryCampaignById(id);
      if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ campaign });
    }
    const campaigns = await getLibraryCampaigns();
    // ?all=true — return full bodies in one shot, avoids N individual fetches in the client
    if (url.searchParams.get("all") === "true") return NextResponse.json({ campaigns });
    const meta = campaigns.map(({ body: _body, structured: _structured, ...rest }) => rest);
    return NextResponse.json({ campaigns: meta });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to load library" }, { status: 500 });
  }
}

/**
 * Rename a library entry in place. Title only — the id stays as it is, because
 * planner rows, corpus records and deep links all reference it
 * (docs/CAMPAIGN_NAMING_FIX_SPEC.md §3d).
 */
export async function PATCH(req: NextRequest) {
  try {
    const parsed = await parseBody(req, libraryRenameBody);
    if (parsed.error) return parsed.error;
    const { id, title } = parsed.data as { id: string; title: string };
    if (!title.trim()) {
      return NextResponse.json({ error: "A campaign needs a name." }, { status: 400 });
    }
    const renamed = await renameLibraryCampaign(id, title);
    if (!renamed) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, id, title: title.trim() });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Rename failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const deleted = await deleteFromLibrary(id);
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await removeCampaign(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
