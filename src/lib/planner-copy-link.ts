// The deterministic half of the Planner -> Copy Builder mapping. This is the
// single home for it so the copy-builder page (client) and the /api/copy-seed
// route (server) agree on how a PlannerRow becomes a BriefInput seed. AI fills
// the two gaps the planner can't carry (products + hero angle) on top of this.
//
// PURE MODULE: type-only imports, no fs / server / Anthropic imports, so it is
// safe to import from both client and server.

import { EVERGREEN_OFFER } from "./planner-types";
import type { PlannerRow } from "./planner-types";
import { DEFAULT_SECTION_STRUCTURE, DEFAULT_TONE_DIAL } from "./schemas";
import type { BriefInput, CampaignType, AudienceType } from "./schemas";

/** Case-insensitive substring test against a single haystack. */
function has(haystack: string, needle: string): boolean {
  return haystack.includes(needle);
}

/**
 * Keyword heuristic for campaign_type. Matches `name` + `offer`
 * case-insensitively. A starting point the AI and human both refine — default
 * "promo". Never throws.
 */
export function inferCampaignType(row: PlannerRow): CampaignType {
  const hay = `${row.name ?? ""} ${row.offer ?? ""}`.toLowerCase();
  if (has(hay, "launch")) return "launch";
  if (has(hay, "restock") || has(hay, "back in stock")) return "restock";
  if (has(hay, "winback") || has(hay, "win back") || has(hay, "we miss you")) return "winback";
  if (has(hay, "newsletter")) return "newsletter";
  if (has(hay, "% off") || has(hay, "promo") || has(hay, "sale")) return "promo";
  return "promo";
}

/**
 * Keyword heuristic for the 5-value audience enum. Scans the real Klaviyo
 * segment/list names on `audience_included` plus the campaign `name`. The real
 * segment names don't fit the enum, so they're carried into the hero-angle
 * context elsewhere — nothing is lost. Default "all". Never throws.
 */
export function inferAudience(row: PlannerRow): AudienceType {
  const included = Array.isArray(row.audience_included)
    ? row.audience_included.map((a) => a?.name ?? "").join(" ")
    : "";
  const hay = `${included} ${row.name ?? ""}`.toLowerCase();
  if (has(hay, "vip") || has(hay, "loyal")) return "vip";
  if (has(hay, "engaged") || has(hay, "active") || has(hay, "opener")) return "engaged";
  if (has(hay, "lapsed") || has(hay, "winback") || has(hay, "churn") || has(hay, "inactive")) return "lapsed";
  if (has(hay, "post purchase") || has(hay, "post-purchase") || has(hay, "buyer") || has(hay, "customer")) return "post_purchase";
  return "all";
}

/**
 * The row's notes plus, when the send falls inside a promotion window, that
 * promotion's `learnings` — one clearly-delimited block. This is the text the
 * writer's literal-instruction tier carries, so a learning like "last time the
 * 30% code confused people, state it in the body" survives verbatim into
 * generation instead of being blurred into an AI-proposed hero angle.
 *
 * The promotion is passed in structurally (not as a `Promotion`) to keep this
 * module free of the promo store's types. Returns undefined when there is
 * nothing to carry, so the caller can leave the field unset.
 */
export function plannerNotesBlock(
  row: PlannerRow,
  promotion?: { sale?: string; learnings?: string },
): string | undefined {
  const parts: string[] = [];
  const notes = (row.notes ?? "").trim();
  if (notes) parts.push(`Planner notes for "${row.name}":\n${notes}`);
  const learnings = (promotion?.learnings ?? "").trim();
  if (learnings) {
    const sale = (promotion?.sale ?? "").trim() || "this promotion";
    parts.push(`Learnings from the Promotional Calendar (${sale}):\n${learnings}`);
  }
  return parts.length ? parts.join("\n\n") : undefined;
}

/**
 * Deterministic PlannerRow -> partial BriefInput. No AI. Never throws.
 *
 * Leaves `hero_angle` unset and `products_featured` empty — those are the two
 * gaps the planner can't carry, filled by the AI smart-fill step (and always
 * editable by the writer).
 *
 * `promotion` is optional: the client seeds instantly without it, then the
 * copy-seed route re-seeds with the promotion it resolved from the send date.
 */
export function plannerRowToBriefSeed(
  row: PlannerRow,
  promotion?: { sale?: string; learnings?: string },
): Partial<BriefInput> {
  const isEvergreen = row.offer_type === "evergreen";
  return {
    planner_notes: plannerNotesBlock(row, promotion),
    campaign_name: row.name ?? "",
    campaign_type: inferCampaignType(row),
    offer: isEvergreen ? EVERGREEN_OFFER : (row.offer ?? ""),
    promo_code: row.offer_type === "promo" ? row.promo_code : undefined,
    audience: inferAudience(row),
    products_featured: [],
    section_structure: DEFAULT_SECTION_STRUCTURE,
    tone_dial: DEFAULT_TONE_DIAL,
    planner_row_id: row.id,
  };
}
