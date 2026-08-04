import { NextResponse } from "next/server";
import { readSnapshot } from "@/lib/lifecycle/snapshot";

// Instant read of the lifecycle snapshot (see lifecycle_inapp_build_brief.md §2).
// No Klaviyo call — reads the store, falling back to the bundled seed so the page
// always has live figures. Cookie-gated by the app proxy like the rest of /api/*.
//
//   GET /api/lifecycle/snapshot

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await readSnapshot();
    return NextResponse.json(snapshot);
  } catch (e) {
    console.error("[api/lifecycle/snapshot]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Failed to read lifecycle snapshot" }, { status: 500 });
  }
}
