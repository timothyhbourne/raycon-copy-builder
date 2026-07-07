import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { runWeeklyReport } from "@/lib/reports/run";
import { AUTH_COOKIE, authEnabled, tokenValid } from "@/lib/auth";

// The weekly run job. Two callers:
//  - external cron (no app cookie) → must present the CRON_SECRET.
//  - in-app "Run now" (logged-in team member) → the app auth cookie suffices.
// This route is allowlisted in the proxy so the cron reaches it; the checks
// below keep it closed. Never open when auth is enabled and no secret matches.
//
// Scheduling:
//  - On Vercel: vercel.json crons hits this Monday 13:00 UTC. Set CRON_SECRET in
//    the project env and Vercel sends `Authorization: Bearer <CRON_SECRET>`.
//  - Elsewhere: any scheduler, e.g. weekly:
//      curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
//        "https://<host>/api/reports/weekly/run"
//    Optionally pin a week: append `?week=2026-W27`.

export const dynamic = "force-dynamic";

function cronSecret(): string {
  const sys = process.env.CRON_SECRET;
  if (sys && sys.trim()) return sys.trim();
  try {
    const env = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    const m = env.match(/^CRON_SECRET=(.+)$/m);
    if (m) return m[1].trim();
  } catch { /* prod: rely on process.env */ }
  return "";
}

function authorized(req: NextRequest): boolean {
  if (!authEnabled) return true; // whole app is open in this mode (local/dev)
  const secret = cronSecret();
  if (secret) {
    const bearer = req.headers.get("authorization");
    const key = new URL(req.url).searchParams.get("key");
    if (bearer === `Bearer ${secret}` || key === secret) return true;
  }
  // Logged-in team member hitting "Run now" (cookie sent automatically).
  if (tokenValid(req.cookies.get(AUTH_COOKIE)?.value)) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const week = new URL(req.url).searchParams.get("week"); // optional ISO week; default = just-finished week
  try {
    const report = await runWeeklyReport(week || undefined);
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Weekly run failed";
    console.error("[reports/weekly/run]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
