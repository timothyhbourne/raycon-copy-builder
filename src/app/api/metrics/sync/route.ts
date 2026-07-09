import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { syncMetrics } from "@/lib/metrics/sync";
import { AUTH_COOKIE, authEnabled, tokenValid } from "@/lib/auth";

// Background metrics sync trigger. Two callers, same dual auth as the weekly job:
//  - Vercel cron (no app cookie) → presents CRON_SECRET (Authorization: Bearer,
//    or ?key=). Cron issues GET, so we expose GET too.
//  - In-app "Sync now" (logged-in team member) → the app auth cookie suffices;
//    the UI POSTs with { backfill_days? }.
// Allowlisted in the proxy so the cron reaches it; the checks here keep it closed.

export const dynamic = "force-dynamic";
// A sync can run dozens of sequential Klaviyo calls (with 429 back-off). Give it
// headroom on Vercel; the platform clamps this to the plan's max.
export const maxDuration = 300;

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
  if (!authEnabled) return true; // whole app open in local/dev
  const secret = cronSecret();
  if (secret) {
    const bearer = req.headers.get("authorization");
    const key = new URL(req.url).searchParams.get("key");
    if (bearer === `Bearer ${secret}` || key === secret) return true;
  }
  if (tokenValid(req.cookies.get(AUTH_COOKIE)?.value)) return true;
  return false;
}

async function backfillDaysFrom(req: NextRequest): Promise<number | undefined> {
  const q = new URL(req.url).searchParams.get("backfill_days");
  if (q != null && q !== "") { const n = Number(q); if (Number.isFinite(n)) return n; }
  try {
    const body = await req.json();
    const n = Number(body?.backfill_days);
    if (Number.isFinite(n)) return n;
  } catch { /* no/invalid JSON body — use default */ }
  return undefined;
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const backfillDays = await backfillDaysFrom(req);
    const summary = await syncMetrics(backfillDays != null ? { backfillDays } : {});
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    console.error("[metrics/sync]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export const GET = handle;   // Vercel cron + manual curl
export const POST = handle;  // in-app "Sync now"
