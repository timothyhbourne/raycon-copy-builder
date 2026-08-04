import { NextResponse } from "next/server";
import { syncPromotions } from "@/lib/promo/store";

// Pull the live Promotional Calendar tab, consolidate, and persist. Called by
// the daily Vercel cron (vercel.json) and the manual "Sync now" button.
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const data = await syncPromotions();
    return NextResponse.json({
      ok: true,
      count: data.promotions.length,
      synced_at: data.synced_at,
      warnings: data.warnings ?? [],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Promo sync failed";
    console.error("[promotions/sync]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Allow GET too so the cron (which issues GET) can trigger it.
export const GET = POST;
