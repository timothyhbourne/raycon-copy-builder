import { NextRequest, NextResponse } from "next/server";
import { listWeeklyReports, getWeeklyReport, getLatestWeeklyReport } from "@/lib/reports/weekly-store";

// Read-only snapshot endpoint for the /reports view. Cookie-gated by the proxy
// like the rest of the in-app API. Returns the latest snapshot by default, a
// specific week with ?week=, and always the list of available weeks for the
// picker.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const week = new URL(req.url).searchParams.get("week");
  const weeks = listWeeklyReports().map((r) => r.week.isoWeek);
  if (week) {
    const report = getWeeklyReport(week);
    if (!report) return NextResponse.json({ error: "Not found", weeks }, { status: 404 });
    return NextResponse.json({ report, weeks });
  }
  return NextResponse.json({ report: getLatestWeeklyReport(), weeks });
}
