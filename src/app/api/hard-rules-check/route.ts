import { NextRequest, NextResponse } from "next/server";
import { checkHardRules, type HardRuleElement } from "@/lib/hard-rules-check";
import { parseBody } from "@/lib/validation/api";
import { hardRulesCheckBody } from "@/lib/validation/requests";

// Deterministic hard-rules gate. Post-generation, mirrors /api/check-repetition:
// pure in-memory string math, synchronous and fast. Returns a per-element +
// email-level report. The client blocks/flags on report.ok === false.
export async function POST(req: NextRequest) {
  try {
    const parsed = await parseBody(req, hardRulesCheckBody);
    if (parsed.error) return parsed.error;
    const elements = (parsed.data as { elements: HardRuleElement[] }).elements;
    const report = checkHardRules(elements);
    return NextResponse.json({ report });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Hard-rules check failed" }, { status: 500 });
  }
}
