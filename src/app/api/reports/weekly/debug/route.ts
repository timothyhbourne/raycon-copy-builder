import { NextRequest, NextResponse } from "next/server";
import { listMetrics, listAttributionModels, runRawExport, isNorthbeamConfigured } from "@/lib/northbeam";
import { previousCompletedWeek, weekWindowForIsoWeek } from "@/lib/reports/weekly";

// Confirmation helper for the remaining live unknowns (cookie-gated by the proxy):
//   ?what=metrics  → GET /metrics            (find the total_sales metric id)
//   ?what=models   → GET /attribution-models (find the clicks-only 1-day model id)
//   ?what=export   → run one real export and dump parsed rows + platform labels
//                    (confirm NORTHBEAM_EMAIL/SMS_PLATFORM_LABEL + total_sales)
//   (default)      → metrics + models together
// Once confirmed, set the ids/labels in .env.local and restart.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isNorthbeamConfigured()) {
    return NextResponse.json({ error: "Northbeam not configured — set NORTHBEAM_API_KEY / NORTHBEAM_CLIENT_ID." }, { status: 400 });
  }
  const { searchParams } = new URL(req.url);
  const what = searchParams.get("what") || "ids";
  try {
    if (what === "metrics") return NextResponse.json({ metrics: await listMetrics() });
    if (what === "models") return NextResponse.json({ models: await listAttributionModels() });
    if (what === "export") {
      const week = searchParams.get("week");
      const win = week ? weekWindowForIsoWeek(week) : previousCompletedWeek(new Date().toISOString().slice(0, 10));
      if (!win) return NextResponse.json({ error: `bad week "${week}"` }, { status: 400 });
      const out = await runRawExport(`${win.startYMD}T00:00:00`, `${win.endYMD}T23:59:59`);
      return NextResponse.json({ window: win, ...out });
    }
    const [metrics, models] = await Promise.all([listMetrics(), listAttributionModels()]);
    return NextResponse.json({ metrics, models });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "debug failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
