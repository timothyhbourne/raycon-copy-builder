import { NextResponse } from "next/server";
import { budgetStatus } from "@/lib/klaviyo-budget";

// Observability for the reporting budget (spec: ANALYTICS_RATE_LIMIT_SPEC §6).
// How many tight-tier Klaviyo reporting calls we've spent today vs the 225/day
// cap — the signal that the shared cache is doing its job (this should read
// single/low-double digits in normal use, not ~2 per dashboard view).
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await budgetStatus());
}
