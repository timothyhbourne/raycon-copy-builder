import { NextRequest, NextResponse } from "next/server";
import { listPlannerRows, getPlannerRow, upsertPlannerRow, deletePlannerRow } from "@/lib/planner";
import { PLANNER_CHANNELS, PLANNER_STATUSES } from "@/lib/planner-types";
import type { PlannerRow } from "@/lib/planner-types";

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const row = getPlannerRow(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ row });
  }
  return NextResponse.json({ rows: listPlannerRows() });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<PlannerRow>;
    if (!body.name || typeof body.name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (!body.channel || !PLANNER_CHANNELS.includes(body.channel)) {
      return NextResponse.json({ error: "channel must be 'email' or 'sms'" }, { status: 400 });
    }
    if (body.status && !PLANNER_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: `status must be one of ${PLANNER_STATUSES.join(", ")}` }, { status: 400 });
    }
    const row = upsertPlannerRow({ ...body, name: body.name, channel: body.channel });
    return NextResponse.json({ row });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Save failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const ok = deletePlannerRow(id);
  return NextResponse.json({ ok });
}
