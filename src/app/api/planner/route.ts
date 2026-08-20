import { NextRequest, NextResponse } from "next/server";
import { listPlannerRows, getPlannerRow, upsertPlannerRow, deletePlannerRow } from "@/lib/planner";
import { refreshCorpusSafely } from "@/lib/corpus/ingest";
import { parseBody } from "@/lib/validation/api";
import { plannerUpsertBody } from "@/lib/validation/requests";
import type { PlannerRow } from "@/lib/planner-types";

export async function GET(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (id) {
      const row = await getPlannerRow(id);
      if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ row });
    }
    return NextResponse.json({ rows: await listPlannerRows() });
  } catch (e) {
    // Never fall through to an empty-bodied 500 — the client calls res.json()
    // and an empty body surfaces as "Unexpected end of JSON input".
    const msg = e instanceof Error ? e.message : "Failed to load planner";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseBody(req, plannerUpsertBody);
    if (parsed.error) return parsed.error;
    const body = parsed.data as Partial<PlannerRow> & { name: string; channel: PlannerRow["channel"] };
    const row = await upsertPlannerRow({ ...body, name: body.name, channel: body.channel });
    // status: "scheduled" IS the approval signal the corpus is tiered on
    // (docs/RECURSIVE_LEARNING_FRAMEWORK_SPEC.md §2.2), so a write that touches a
    // scheduled row re-tiers the corpus. Cheap, low-frequency, never blocks the
    // save (refreshCorpusSafely swallows its own failures).
    if (row.status === "scheduled") await refreshCorpusSafely("planner scheduled-row write");
    return NextResponse.json({ row });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Save failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const ok = await deletePlannerRow(id);
  return NextResponse.json({ ok });
}
