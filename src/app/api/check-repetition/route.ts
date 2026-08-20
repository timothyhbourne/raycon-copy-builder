import { NextRequest, NextResponse } from "next/server";
import { checkRepetition, type CheckElement, type CheckMatch } from "@/lib/constructions";
import { scanCorpusForms, type FormCheckElement } from "@/lib/corpus/repetition";
import { parseBody } from "@/lib/validation/api";
import { checkRepetitionBody } from "@/lib/validation/requests";

// Post-generation repetition check. TWO scans, both of which can flag
// (docs/RECURSIVE_LEARNING_FRAMEWORK_SPEC.md §2.3):
//
//   1. LEXICAL (src/lib/constructions.ts) — character-trigram / token overlap
//      against the constructions index. Catches near-verbatim reuse.
//   2. FORM (src/lib/corpus/repetition.ts) — form-signature agreement against the
//      tiered corpus. Catches "Motion Never Stops" vs "Sound Never Quits": no
//      shared words, identical construction. This is the repetition a reader
//      actually feels, and the lexical scan is blind to it.
//
// A form match ALSO covers copy that is approved but not yet sent — the tier the
// old check could not see at all, and the one where an echo reads as a duplicate
// send. Both scans fail open: a store error returns no matches, never an error.
export async function POST(req: NextRequest) {
  try {
    const parsed = await parseBody(req, checkRepetitionBody);
    if (parsed.error) return parsed.error;
    const body = parsed.data as { elements: CheckElement[]; exclude_id?: string };

    const [lexical, form] = await Promise.all([
      checkRepetition(body.elements, body.exclude_id),
      scanCorpusForms(body.elements as FormCheckElement[], body.exclude_id),
    ]);

    // One flag per element: a lexical hit is the more actionable finding (the
    // words are literally reused), so it wins a tie.
    const byId = new Map<string, CheckMatch>();
    for (const m of form) byId.set(m.id, m);
    for (const m of lexical) byId.set(m.id, m);

    return NextResponse.json({ matches: [...byId.values()] });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Repetition check failed" }, { status: 500 });
  }
}
