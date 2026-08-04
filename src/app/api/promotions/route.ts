import { NextRequest, NextResponse } from "next/server";
import { readPromoStore, syncPromotions, isStale, type PromoStore } from "@/lib/promo/store";

// Read the consolidated Promotional Calendar, optionally filtered by year/month.
// Daily-cache-on-read: if the store is missing or >24h stale, sync first (same
// pattern as the metrics overview). Also returns the distinct years present so
// the UI can build the Year toggle.
//
//   GET /api/promotions?year=2026&month=July
//   GET /api/promotions?active=1   — current/upcoming only (the occasion picker):
//     endDate >= today, or (no endDate) startDate >= today - 7d. Undated rows
//     are dropped (no dates → no stage/urgency/deadline language). Sorted
//     soonest-first, capped at 15.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const yearParam = searchParams.get("year");
  const monthParam = (searchParams.get("month") || "").trim().toLowerCase();
  const activeOnly = searchParams.get("active") === "1";

  try {
    let data: PromoStore | null = await readPromoStore();
    if (!data || isStale(data.synced_at)) {
      try {
        data = await syncPromotions();
      } catch (e) {
        // If a refresh fails but we have stale data, serve the stale copy rather
        // than error out; only fail hard when there's nothing cached at all.
        if (!data) throw e;
        console.warn("[promotions] refresh failed, serving stale:", e instanceof Error ? e.message : e);
      }
    }

    const all = data?.promotions ?? [];
    const years = Array.from(new Set(all.map((p) => p.year))).sort((a, b) => a - b);
    let promotions = all;
    if (yearParam) {
      const y = Number(yearParam);
      promotions = promotions.filter((p) => p.year === y);
    }
    if (monthParam) {
      promotions = promotions.filter((p) => p.month.toLowerCase() === monthParam);
    }
    if (activeOnly) {
      const today = new Date().toISOString().slice(0, 10);
      const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
      promotions = promotions
        .filter((p) => (p.endDate ? p.endDate >= today : !!p.startDate && p.startDate >= weekAgo))
        .sort((a, b) => (a.startDate ?? a.endDate ?? "").localeCompare(b.startDate ?? b.endDate ?? ""))
        .slice(0, 15);
    }

    return NextResponse.json({
      promotions,
      years,
      synced_at: data?.synced_at ?? null,
      warnings: data?.warnings ?? [],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load promotions";
    console.error("[promotions]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
