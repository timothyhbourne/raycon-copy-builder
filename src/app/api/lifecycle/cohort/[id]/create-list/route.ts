import { NextRequest, NextResponse } from "next/server";
import { klaviyoFetch } from "@/lib/klaviyo";
import { readCustomerFacts } from "@/lib/lifecycle/store";
import { cohortMemberEmails, COHORT_CATALOG, isKnownCohort } from "@/lib/lifecycle/snapshot";

// Create a static Klaviyo LIST from a cohort and push its members (see
// lifecycle_inapp_build_brief.md §2; segments can't be pushed — lists can). Cookie-
// gated by the app proxy. Members come from the order-facts store; until it is
// populated, returns 410 (the UI keeps the button disabled).
//
//   POST /api/lifecycle/cohort/<id>/create-list
//
// Members are added via Klaviyo's bulk profile-import job (the correct primitive
// for many profiles + list membership). One job takes up to 10k profiles; for v1
// we push the first BULK_CAP and report any remainder (use Export CSV → Klaviyo
// import for the full set). NOTE: not verified against a live Klaviyo account here.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BULK_CAP = 10_000; // Klaviyo bulk-import job limit per request

interface CreatedList {
  data: { id: string };
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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
    if (emails.length === 0) {
      return NextResponse.json({ error: "Cohort is currently empty." }, { status: 409 });
    }
    const listName = COHORT_CATALOG.find((c) => c.meta.id === id)!.meta.klaviyo_segment;

    // 1) Create the static list.
    const created = await klaviyoFetch<CreatedList>("/lists/", {
      method: "POST",
      body: JSON.stringify({ data: { type: "list", attributes: { name: listName } } }),
    });
    const listId = created?.data?.id;
    if (!listId) throw new Error("Klaviyo list creation returned no id");

    // 2) Push the first batch via a bulk profile-import job (upsert by email +
    //    add to the list). Remainder is reported for CSV import.
    const batch = emails.slice(0, BULK_CAP);
    await klaviyoFetch("/profile-bulk-import-jobs/", {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "profile-bulk-import-job",
          attributes: { profiles: { data: batch.map((email) => ({ type: "profile", attributes: { email } })) } },
          relationships: { lists: { data: [{ type: "list", id: listId }] } },
        },
      }),
    });

    const remaining = Math.max(0, emails.length - batch.length);
    return NextResponse.json({
      ok: true,
      list_id: listId,
      list_name: listName,
      total_members: emails.length,
      queued: batch.length,
      remaining,
      note:
        remaining > 0
          ? `Queued the first ${batch.length.toLocaleString()} members. Export CSV and import the remaining ${remaining.toLocaleString()} in Klaviyo.`
          : "All members queued for import (async — allow a few minutes to appear in the list).",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Create-list failed";
    console.error("[lifecycle/cohort/create-list]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
