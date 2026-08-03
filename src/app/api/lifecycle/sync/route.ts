import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authEnabled, tokenValid, safeEqual } from "@/lib/auth";
import { readEnv } from "@/lib/env";
import { readCustomerFacts } from "@/lib/lifecycle/store";
import { computeSnapshot, readSnapshot, writeSnapshot } from "@/lib/lifecycle/snapshot";

// Daily lifecycle recompute (see lifecycle_inapp_build_brief.md §2), a
// sync→store→read shape. Two callers:
//   - Vercel cron (no app cookie) → presents CRON_SECRET (Bearer or ?key=). Cron
//     issues GET, so GET is exposed too.
//   - In-app "Sync now" (logged-in team member) → the app auth cookie suffices.
// Recomputes the snapshot from the per-customer order-facts store. Until that
// store has data, it no-ops and leaves the seed/last snapshot in place — it never
// overwrites real figures with an empty recompute.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  if (!authEnabled) return true; // whole app open in local/dev
  const secret = readEnv("CRON_SECRET");
  if (secret) {
    const bearer = req.headers.get("authorization") ?? "";
    const key = new URL(req.url).searchParams.get("key") ?? "";
    if (safeEqual(bearer, `Bearer ${secret}`) || safeEqual(key, secret)) return true;
  }
  if (tokenValid(req.cookies.get(AUTH_COOKIE)?.value)) return true;
  return false;
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const facts = await readCustomerFacts();
    const count = Object.keys(facts).length;
    if (count === 0) {
      // No per-customer store yet — keep whatever is live (seed or last worker run).
      const current = await readSnapshot();
      return NextResponse.json({
        ok: true,
        recomputed: false,
        source: current.source,
        note: "No per-customer order-facts store yet — run `npm run ingest:orders` (or the worker). Seed figures left in place.",
      });
    }
    const nowISO = new Date().toISOString();
    const snapshot = computeSnapshot(facts, nowISO);
    await writeSnapshot(snapshot);
    return NextResponse.json({
      ok: true,
      recomputed: true,
      source: snapshot.source,
      generated_at: snapshot.generated_at,
      total_audience: snapshot.total_audience,
      cohorts: snapshot.cohorts.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    console.error("[lifecycle/sync]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export const GET = handle; // Vercel cron + manual curl
export const POST = handle; // in-app "Sync now"
