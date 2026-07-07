// The deterministic half of the Planner -> Copy Builder mapping. This is the
// single home for it so the copy-builder page (client) and the /api/copy-seed
// route (server) agree on how a PlannerRow becomes a BriefInput seed. AI fills
// the two gaps the planner can't carry (products + hero angle) on top of this.
//
// PURE MODULE: type-only imports, no fs / server / Anthropic imports, so it is
// safe to import from both client and server.

import { EVERGREEN_OFFER } from "./planner-types";
import type { PlannerRow } from "./planner-types";
import { DEFAULT_SECTION_STRUCTURE } from "./schemas";
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
 * Deterministic PlannerRow -> partial BriefInput. No AI. Never throws.
 *
 * Leaves `hero_angle` unset and `products_featured` empty — those are the two
 * gaps the planner can't carry, filled by the AI smart-fill step (and always
 * editable by the writer).
 */
export function plannerRowToBriefSeed(row: PlannerRow): Partial<BriefInput> {
  const isEvergreen = row.offer_type === "evergreen";
  return {
    campaign_name: row.name ?? "",
    campaign_type: inferCampaignType(row),
    offer: isEvergreen ? EVERGREEN_OFFER : (row.offer ?? ""),
    promo_code: row.offer_type === "promo" ? row.promo_code : undefined,
    audience: inferAudience(row),
    products_featured: [],
    section_structure: DEFAULT_SECTION_STRUCTURE,
    tone_dial: 1,
    planner_row_id: row.id,
  };
}
