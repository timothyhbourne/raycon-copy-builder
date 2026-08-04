import { NextRequest, NextResponse } from "next/server";
import { saveToLibrary, getLibraryCampaignById } from "@/lib/library";
import { updateCampaign } from "@/lib/constructions";
import { deleteCampaign } from "@/lib/campaigns";
import { parseBody } from "@/lib/validation/api";
import { finalizeBody } from "@/lib/validation/requests";
import type { BriefInput, Conceit, GeneratedCampaign, SectionSpec } from "@/lib/schemas";

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseBody(req, finalizeBody);
    if (parsed.error) return parsed.error;
    const body = parsed.data as {
      id: string;
      brief_input: BriefInput;
      conceit: Conceit | null;
      campaign: GeneratedCampaign;
      section_structure?: SectionSpec[];
      draft_id?: string;
    };

    await saveToLibrary(body.id, body.brief_input, body.conceit, body.campaign, body.section_structure ?? []);

    // Keep the construction index in step with the library (covers manual saves
    // AND the autosave path, which also posts here). Re-read the just-written
    // entry so extraction sees the persisted structured snapshot + date.
    const saved = await getLibraryCampaignById(body.id);
    if (saved) await updateCampaign(saved);

    // Delete the draft from /generated/ if it exists
    if (body.draft_id) {
      await deleteCampaign(body.draft_id);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Finalize failed" }, { status: 500 });
  }
}
