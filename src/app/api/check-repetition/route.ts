import { NextRequest, NextResponse } from "next/server";
import { checkRepetition, type CheckElement } from "@/lib/constructions";
import { parseBody } from "@/lib/validation/api";
import { checkRepetitionBody } from "@/lib/validation/requests";

// Post-generation similarity check: scan generated elements against the
// construction index and return near-duplicates (score >= 0.65). The index read
// goes through the storage seam; the scoring itself is in-memory string math.
export async function POST(req: NextRequest) {
  try {
    const parsed = await parseBody(req, checkRepetitionBody);
    if (parsed.error) return parsed.error;
    const body = parsed.data as { elements: CheckElement[]; exclude_id?: string };
    const matches = await checkRepetition(body.elements, body.exclude_id);
    return NextResponse.json({ matches });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Repetition check failed" }, { status: 500 });
  }
}
