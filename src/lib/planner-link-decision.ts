import type { PlannerRow } from "./planner-types";

// Should this copy be stamped onto this planner row? Spec:
// docs/PLANNER_AUTOLINK_BUGFIX_SPEC.md §3.3.
//
// PURE, and deliberately its own module. The bug being fixed is that the decision
// was never made anywhere: the row id was read out of ambient state at save time
// (`plannerLink?.rowId ?? currentBriefInput?.planner_row_id`) and written
// immediately. Both of those sources outlive the campaign that created them, so a
// campaign written weeks later inherited a link the writer never chose — and
// because the link is single-owner, stamping it also unlinked whatever copy the row
// legitimately owned.
//
// The governing principle: a planner link is an EXPLICIT ACT, not an inherited
// default. This function is where that judgement lives, so it can be tested without
// a browser and can't be forgotten by a future caller.

export type LinkDecision =
  /** Nothing to do — no row was chosen. The common case. */
  | { action: "none"; reason: string }
  /** The row is gone. Don't link, and clear the stale handoff. */
  | { action: "missing"; reason: string }
  /** Safe: the row owns nothing, or already owns this very copy. */
  | { action: "link" }
  /** The row belongs to a DIFFERENT copy. Ask before stealing it. */
  | { action: "confirm"; ownerCopyId: string; reason: string };

export function decideLink(args: {
  /** The row the client believes it should link to. */
  rowId: string | null | undefined;
  /** The row as the server has it, or null when it no longer exists. */
  row: Pick<PlannerRow, "id" | "name" | "copy_campaign_id"> | null;
  /** The copy being saved. */
  copyCampaignId: string;
}): LinkDecision {
  const { rowId, row, copyCampaignId } = args;

  if (!rowId) return { action: "none", reason: "No planner row is linked to this campaign." };
  if (!copyCampaignId) return { action: "none", reason: "The copy has no id yet." };
  if (!row) {
    return { action: "missing", reason: "That planner row no longer exists." };
  }
  const owner = row.copy_campaign_id;
  if (!owner || owner === copyCampaignId) return { action: "link" };

  // The branch that used to cause the collateral damage: silently stealing a row
  // from another campaign, which also wiped that campaign's back-reference.
  return {
    action: "confirm",
    ownerCopyId: owner,
    reason: `That planner row is already linked to "${owner}".`,
  };
}

/**
 * Sanitise a restored brief form. A persisted form is a CONTENT draft; its planner
 * association died with the session that created it (spec §3.1).
 *
 * The form is written to localStorage on every keystroke, `planner_row_id` included,
 * so without this a single visit to `?planner=<row>` contaminates every campaign
 * written afterwards on that machine — which is exactly how the bug reproduced.
 */
export function stripPlannerLinkFromRestoredForm<T extends { planner_row_id?: string }>(form: T): T {
  if (!form || typeof form !== "object" || form.planner_row_id === undefined) return form;
  const next = { ...form };
  delete next.planner_row_id;
  return next;
}
