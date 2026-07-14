import { NextRequest, NextResponse } from "next/server";
import { saveToLibrary, getLibraryCampaignById } from "@/lib/library";
import { updateCampaign } from "@/lib/constructions";
import { deleteCampaign } from "@/lib/campaigns";
import type { BriefInput, Conceit, GeneratedCampaign, SectionSpec } from "@/lib/schemas";

export async function POST(req: NextRequest) {
  try {
    const body: {
      id: string;
      brief_input: BriefInput;
      conceit: Conceit | null;
      campaign: GeneratedCampaign;
      section_structure?: SectionSpec[];
      draft_id?: string;
    } = await req.json();

    saveToLibrary(body.id, body.brief_input, body.conceit, body.campaign, body.section_structure ?? []);

    // Keep the construction index in step with the library (covers manual saves
    // AND the autosave path, which also posts here). Re-read the just-written
    // entry so extraction sees the persisted structured snapshot + date.
    const saved = getLibraryCampaignById(body.id);
    if (saved) updateCampaign(saved);

    // Delete the draft from /generated/ if it exists
    if (body.draft_id) {
      deleteCampaign(body.draft_id);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Finalize failed" }, { status: 500 });
  }
}
