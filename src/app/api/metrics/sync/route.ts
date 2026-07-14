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

interface SyncParams { backfillDays?: number; rangeStart?: string; rangeEnd?: string }

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

async function paramsFrom(req: NextRequest): Promise<SyncParams> {
  const out: SyncParams = {};
  const sp = new URL(req.url).searchParams;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* no/invalid JSON body */ }

  const backfill = sp.get("backfill_days") ?? body?.backfill_days;
  const n = Number(backfill);
  if (backfill != null && backfill !== "" && Number.isFinite(n)) out.backfillDays = n;

  // Range mode: sync exactly these days (how historical/custom dashboard ranges
  // get filled — the default backfill is anchored at today and can't reach them).
  const start = (sp.get("start") ?? body?.start) as string | undefined;
  const end = (sp.get("end") ?? body?.end) as string | undefined;
  if (start && end && YMD_RE.test(start) && YMD_RE.test(end)) {
    out.rangeStart = start;
    out.rangeEnd = end;
  }
  return out;
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const params = await paramsFrom(req);
    const summary = await syncMetrics(params);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    console.error("[metrics/sync]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export const GET = handle;   // Vercel cron + manual curl
export const POST = handle;  // in-app "Sync now"
