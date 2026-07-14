import { NextRequest, NextResponse } from "next/server";
import { checkRepetition, type CheckElement } from "@/lib/constructions";

// Post-generation similarity check: scan generated elements against the
// construction index and return near-duplicates (score >= 0.65). Pure in-memory
// string math — synchronous and fast.
export async function POST(req: NextRequest) {
  try {
    const body: { elements: CheckElement[]; exclude_id?: string } = await req.json();
    const elements = Array.isArray(body.elements) ? body.elements : [];
    const matches = checkRepetition(elements, body.exclude_id);
    return NextResponse.json({ matches });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Repetition check failed" }, { status: 500 });
  }
}
