import { NextRequest, NextResponse } from "next/server";
import { readCustomerFacts } from "@/lib/lifecycle/store";
import { cohortMemberEmails, isKnownCohort } from "@/lib/lifecycle/snapshot";

// Export a cohort's audience as CSV (see lifecycle_inapp_build_brief.md §2).
// Members come from the per-customer order-facts store; until it is populated
// (npm run ingest:orders / the worker), returns 410 — never fabricated members.
//
//   GET /api/lifecycle/cohort/<id>/export

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!isKnownCohort(id)) {
      return NextResponse.json({ error: "Unknown cohort" }, { status: 400 });
    }
    const facts = await readCustomerFacts();
    if (Object.keys(facts).length === 0) {
      return NextResponse.json(
        { error: "No member data yet — available after the daily sync populates the order-facts store." },
        { status: 410 },
      );
    }
    const emails = cohortMemberEmails(facts, id, Date.now());
    const csv = ["email", ...emails].join("\n");
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="lifecycle-${id}.csv"`,
      },
    });
  } catch (e) {
    console.error("[lifecycle/cohort/export]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
