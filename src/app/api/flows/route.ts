import { NextRequest, NextResponse } from "next/server";
import { listFlows, loadFlow, saveFlow, deleteFlow } from "@/lib/flows";
import { parseBody } from "@/lib/validation/api";
import { flowPostBody } from "@/lib/validation/requests";
import type { Flow } from "@/lib/schemas";

// Flows collection: mirrors /api/sms. GET (list, or one via ?id), POST (save the
// whole Flow), DELETE (?id). The store validates at its boundary; a genuine
// backend write failure surfaces as a 500 rather than a cheerful { ok: true }.

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const flow = await loadFlow(id);
    if (!flow) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ flow });
  }
  return NextResponse.json({ flows: await listFlows() });
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseBody(req, flowPostBody);
    if (parsed.error) return parsed.error;
    await saveFlow(parsed.data as Flow);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const ok = await deleteFlow(id);
  return NextResponse.json({ ok });
}
