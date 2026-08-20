#!/usr/bin/env tsx
// Read-only audit of planner ↔ copy links. Spec:
// docs/PLANNER_AUTOLINK_BUGFIX_SPEC.md §6, "Data cleanup".
//
// The autolink bug silently stamped copy onto rows the writer never chose, and
// existing mislinks won't self-heal: the planner's stale-link reconciliation only
// clears links whose COPY no longer exists, not links pointing at the wrong copy.
// This finds the suspicious ones so they can be reviewed by hand.
//
// WRITES NOTHING. It reports; a human decides.
//
//   set -a; . ./.env.local; set +a; npx tsx scripts/audit-planner-links.ts
//
// (The env must be exported BEFORE the process starts: storage.ts picks its backend
// at module load, and an import evaluated before dotenv.config() silently falls back
// to the local files.)

import { listPlannerRows } from "../src/lib/planner";
import { loadCampaign } from "../src/lib/campaigns";
import { getLibraryCampaigns } from "../src/lib/library";
import { getSmsCampaigns } from "../src/lib/sms";

/** Word overlap between a row name and a copy name, 0..1. Names are written by the
 * same person for the same send, so a legitimate pair almost always shares
 * something; near-zero overlap is the signature of an inherited link. */
function nameOverlap(a: string, b: string): number {
  const words = (s: string) =>
    new Set(
      s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
        .filter((w) => w.length > 2 && !["the", "and", "for", "ray", "off", "sale"].includes(w)),
    );
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return 1; // nothing to judge on — don't cry wolf
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}

async function main() {
  const [rows, library, sms] = await Promise.all([listPlannerRows(), getLibraryCampaigns(), getSmsCampaigns()]);
  const libById = new Map(library.map((c) => [c.id, c]));
  const smsById = new Map(sms.map((c) => [c.id, c]));

  const linked = rows.filter((r) => r.copy_campaign_id);
  console.log(`Planner rows: ${rows.length} · linked to copy: ${linked.length}\n`);

  const suspicious: string[] = [];
  const dangling: string[] = [];
  const backrefBroken: string[] = [];

  for (const row of linked) {
    const id = row.copy_campaign_id as string;
    const draft = await loadCampaign(id).catch(() => null);
    const lib = libById.get(id);
    const smsCopy = smsById.get(id);
    const copyName = draft?.campaign_name ?? lib?.title ?? smsCopy?.name;
    const backref = draft?.planner_row_id ?? lib?.planner_row_id ?? smsCopy?.planner_row_id;

    if (!copyName) {
      dangling.push(`  ${row.id}  "${row.name}"  →  ${id} (copy not found)`);
      continue;
    }
    if (backref !== row.id) {
      backrefBroken.push(`  ${row.id}  "${row.name}"  →  "${copyName}" — the copy points at ${backref ?? "nothing"}`);
    }
    const overlap = nameOverlap(row.name, copyName);
    if (overlap < 0.2) {
      suspicious.push(`  ${row.id}\n      row : "${row.name}"\n      copy: "${copyName}"   (name overlap ${(overlap * 100).toFixed(0)}%)`);
    }
  }

  const section = (title: string, lines: string[], note: string) => {
    console.log(`${title}: ${lines.length}`);
    if (lines.length) { console.log(lines.join("\n")); console.log(`  → ${note}\n`); } else console.log("");
  };

  section("Materially different names (review these by hand)", suspicious,
    "These are what an inherited link looks like. Check each, then unlink from the planner row if wrong.");
  section("Links whose copy no longer exists", dangling,
    "The planner page already clears these on load; listed for completeness.");
  section("One-sided links (row → copy, but the copy disagrees)", backrefBroken,
    "The row was reassigned away from this copy, or the back-reference was cleared by a bad save.");

  if (!suspicious.length && !dangling.length && !backrefBroken.length) {
    console.log("Nothing suspicious. No cleanup needed.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
