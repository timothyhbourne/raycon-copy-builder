import { NextRequest, NextResponse } from "next/server";
import { writeManualMetrics } from "@/lib/planner";
import { parseBody } from "@/lib/validation/api";
import { manualMetricsBody } from "@/lib/validation/requests";
import type { ManualMetricsPatch } from "@/lib/planner-types";

// Manual platform-metric entry for planner rows (SMS: numbers from the
// Postscript dashboard — its public API has no analytics endpoints; see
// docs/SMS_PLANNER_NB_LINK_AND_MANUAL_METRICS_SPEC.md).
//
//   PATCH { id, recipients?, click_rate?, revenue?, revenue_per_recipient? }
//     - fields absent from the body are untouched; null clears a value
//     - click_rate is a 0..1 fraction (the client converts "2.4%" → 0.024)
//     - revenue_per_recipient: number = manual override, null = clear override
// Validation is strict here (finite, non-negative, click_rate ≤ 1) — the
// client's forgiving parsing already canonicalized the input.

const FIELDS = ["recipients", "click_rate", "revenue", "revenue_per_recipient"] as const;

export async function PATCH(req: NextRequest) {
  try {
    const parsed = await parseBody(req, manualMetricsBody);
    if (parsed.error) return parsed.error;
    const body = parsed.data as Record<string, unknown> & { id: string };
    const id = body.id;

    const patch: ManualMetricsPatch = {};
    for (const f of FIELDS) {
      if (!(f in body)) continue;
      const v = body[f];
      if (v === null) { patch[f] = null; continue; }
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
        return NextResponse.json({ error: `Invalid ${f}: must be a non-negative number or null.` }, { status: 400 });
      }
      if (f === "click_rate" && v > 1) {
        return NextResponse.json({ error: "Invalid click_rate: expected a 0..1 fraction (e.g. 0.024 for 2.4%)." }, { status: 400 });
      }
      patch[f] = f === "recipients" ? Math.round(v) : v;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No metric fields in patch." }, { status: 400 });
    }

    const row = await writeManualMetrics(id, patch);
    if (!row) return NextResponse.json({ error: "Row not found." }, { status: 404 });
    return NextResponse.json({ ok: true, row });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Manual metrics write failed";
    console.error("[planner/manual-metrics]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
