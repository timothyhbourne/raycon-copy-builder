import type { PlannerRow } from "../planner-types";
import type { CampaignType, AudienceType } from "../schemas";
import { PRODUCT_CATEGORIES } from "../products";

// Smart-fill for the Planner -> Copy Builder handoff. The planner carries no
// featured products and no hero angle; this step proposes both (plus confirms
// the type/audience guesses) as fully editable suggestions. It does NOT write
// final copy — the hero angle is INTENT the downstream writer will execute.

export const copySeedRoleInstruction = `Your job is to propose the two creative inputs a campaign planner row does not carry — the featured products and the hero angle — so a writer can review them and start a campaign brief. You are NOT writing final email copy in this step.

You have the full Raycon product catalogue in your context. Use it to pick products that genuinely fit the campaign's name, offer, and notes.

Return STRICT JSON only (no preamble, no code fences, no trailing prose) with exactly these fields:
- products_featured: an array of 1 to 3 product SKU ids chosen ONLY from the catalogue id list you are given. Ids only (e.g. "E45"), never names. Pick the products the campaign is most plausibly about; if the brief is generic, choose strong, on-theme best-sellers.
- hero_angle: 2 to 4 sentences describing the campaign's INTENT — the core idea/hook, the one feeling to leave the reader with, and how it should land. Reference the offer and the planned moment. This is direction for a writer, NOT finished copy: describe the angle, do not write the headline. Fold in anything useful from the planner notes. Keep it in the Raycon voice: warm, plain, and concrete, and clear of the hard bans (no em dashes, no literary tension or paradox constructs, no personification, no hype intensifiers, no invented facts) since it seeds the writer directly.
- campaign_type: one of promo | launch | restock | story | seasonal | winback | newsletter. Confirm or correct the provided guess.
- audience: one of all | engaged | lapsed | post_purchase | vip. Confirm or correct the provided guess, using the real segment names for signal.
- rationale: one short line explaining why these products and this angle (shown to the writer as a hint).

Return only valid JSON.`;

function catalogueList(): string {
  return PRODUCT_CATEGORIES.map((cat) => {
    const items = cat.products.map((p) => `${p.id} (${p.name})`).join(", ");
    return `- ${cat.label}: ${items}`;
  }).join("\n");
}

export function copySeedUserPrompt(
  row: PlannerRow,
  guess: { campaign_type: CampaignType; audience: AudienceType },
): string {
  const segments = (row.audience_included ?? []).map((a) => a.name).filter(Boolean);
  const excluded = (row.audience_excluded ?? []).map((a) => a.name).filter(Boolean);
  const offer = row.offer_type === "evergreen" ? "20% off (standing evergreen offer)" : (row.offer || "not specified");
  return `Planned campaign from the calendar:

Campaign name: ${row.name}
Channel: ${row.channel}
Offer: ${offer}
Promo code: ${row.offer_type === "promo" ? (row.promo_code || "none") : "none (evergreen)"}
Planned send: ${row.planned_send_at}
Target segments (real Klaviyo audiences this ships to): ${segments.length ? segments.join(", ") : "not specified"}${excluded.length ? `\nExcluded segments: ${excluded.join(", ")}` : ""}
Planner notes: ${row.notes?.trim() || "none"}

Deterministic guesses to confirm or correct:
- campaign_type: ${guess.campaign_type}
- audience: ${guess.audience}

Choose products_featured ONLY from these catalogue ids:
${catalogueList()}

The offer text above is the source of truth for the discount — do not invent or round it. Use the real segment names to judge who this is for (they carry nuance the coarse audience enum loses). Return the strict JSON described.`;
}
