import type {
  BriefInput, ExpandedBrief, Conceit, ConceitArchitecture,
  Angle, SendStage, UrgencyTier, SectionSpec, CampaignType,
} from "../schemas";
import type { Promotion } from "../promo/consolidate";
import { getProductName } from "../products";
import { PLAYBOOKS } from "../prompts/playbooks";
import { AUDIENCE_MINDSET, ANGLE_DIRECTIVE, STAGE_DIRECTIVE, BRIEF_TEMPLATES } from "./blocks";

// The deterministic brief compiler. Replaces the LLM brief-expansion + conceits
// steps: structured field picks → the exact ExpandedBrief + Conceit the
// generator already consumes. PURE (no LLM, no I/O beyond the passed-in
// promotion). Same inputs → identical brief; that consistency is the point.
//
// Worked example — promotion "Mother's Day" (2026-05-04 → 2026-05-08),
// angle=offer_led, audience=engaged, today=2026-05-08 (final day):
//   send_stage = "last_call", urgency = 3
//   expanded_brief.headline_thesis = "A Mother's Day sale where the deal is the
//     reason to open: 20% off sitewide."
//   expanded_brief.key_message = "20% off sitewide. Act before May 8, 2026."
//   expanded_brief.tonal_direction = "Confident and plain. The deal is the star,
//     stated proudly and kept warm, never pushy. This is the deadline send. Lead
//     with the real end time … (Tier 3) …"
//   expanded_brief.rewritten_hero_angle = "20% off sitewide for Mother's Day.
//     Lead with the Everyday Earbuds."
//   conceit = { architecture: "offer_led", name: "Mother's Day · Mother's Day
//     Sale", description: <headline_thesis> }

const DAY_MS = 86_400_000;

// Fill {slots}; strip any slot left blank, then tidy the orphaned punctuation /
// double spaces the stripping can leave behind.
function fill(template: string, slots: Record<string, string>): string {
  const out = template.replace(/\{(\w+)\}/g, (_, k) => (slots[k] ?? "").trim());
  return out
    .replace(/\s+([.,;:])/g, "$1")   // space before punctuation
    .replace(/([(:])\s*([.,;])/g, "$2")
    .replace(/\bfor\s*\./g, ".")      // "… for ." when occasion blank
    .replace(/:\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+$/gm, "")
    .trim();
}

// Human date range for the {dates} slot, e.g. "May 1 to May 8, 2026". Falls back
// to the end date alone (the deadline) when only that is known.
function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00Z");
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function dateSlot(promotion?: Promotion): string {
  if (!promotion) return "";
  const s = fmtDate(promotion.startDate);
  const e = fmtDate(promotion.endDate);
  if (s && e) return `${s} to ${e}`;
  return e || s || "";
}

// Auto-derive the send stage from the promotion window vs. today. No promotion /
// no dates → launch. Caller may override via input.send_stage.
export function deriveSendStage(promotion?: Promotion, today?: Date): SendStage {
  const start = promotion?.startDate ? Date.parse(promotion.startDate + "T00:00:00Z") : NaN;
  const now = (today ?? new Date()).getTime();
  const end = promotion?.endDate ? Date.parse(promotion.endDate + "T00:00:00Z") : NaN;
  // The final day is last call no matter how the window opened — a one-day
  // flash sale (start = end = today) must never read as "launch".
  if (Number.isFinite(end) && now >= end && (!Number.isFinite(start) || now >= start)) return "last_call";
  if (!Number.isFinite(start)) return "launch";
  if (now <= start + DAY_MS) return "launch"; // within ~1 day of the start
  if (Number.isFinite(end) && end >= start) {
    if (now >= end - DAY_MS) return "last_call";          // final day or after
    if ((now - start) / (end - start) >= 0.7) return "last_call"; // 70-100% elapsed
    return "reminder";
  }
  return "reminder"; // started, past the launch window, no usable end date
}

// Urgency ladder from stage (launch is the calmest, last_call the loudest).
function urgencyForStage(stage: SendStage): UrgencyTier {
  return stage === "last_call" ? 3 : stage === "reminder" ? 2 : 1;
}

/**
 * Honest deadline phrasing from the send date vs. the end date. A last-call
 * send that goes out 48h early must never say "tonight" — compute what is
 * actually true and let the prompt enforce it verbatim.
 * daysToEnd: calendar days from send_date to endDate (0 = send day IS the last day).
 */
export function deadlineLanguage(sendDate: string, endDate: string): { phrase: string; urgency: UrgencyTier } {
  const send = Date.parse(sendDate + "T00:00:00Z");
  const end = Date.parse(endDate + "T00:00:00Z");
  const daysToEnd = Math.max(0, Math.round((end - send) / DAY_MS));
  if (daysToEnd === 0) return { phrase: "tonight", urgency: 3 };
  if (daysToEnd === 1) return { phrase: "tomorrow night", urgency: 3 };
  if (daysToEnd === 2) return { phrase: "in 48 hours", urgency: 2 };
  // 3+ days out: name the real day. The UI suggests stage "reminder" here.
  const d = new Date(end);
  return {
    phrase: d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }),
    urgency: 2,
  };
}

// Clean, creative-safe label per campaign type. Used when there is no occasion
// and the campaign name is an internal ops string — NEVER let an ops filename
// become the creative angle.
const CAMPAIGN_TYPE_LABEL: Record<CampaignType, string> = {
  promo: "Sale",
  launch: "Launch",
  restock: "Back in stock",
  story: "Story",
  seasonal: "Seasonal",
  winback: "Win-back",
  newsletter: "Newsletter",
};

/**
 * Campaign names are internal ops labels ("FS - 30% OFF E95 + H20 + H10 - LAST
 * CALL"), not creative ideas. Feeding one to the model hands it the headline
 * ("Last Call") by construction. Strip SKUs, percentages, ops prefixes, and
 * urgency tags; if what remains is too thin to be an idea, return "" so the
 * caller falls back to a clean campaign-type label.
 */
export function cleanCampaignName(raw: string | undefined): string {
  const s = (raw || "")
    .replace(/\b[A-Z]{1,3}\d{2,3}\b/gi, " ")                       // SKUs: E95, H20, O55, B42
    .replace(/\b(RACSPN\d+|ADAPTER\d+|NOTETAKER)\b/gi, " ")        // other SKU shapes
    .replace(/\d+\s*%\s*(off)?/gi, " ")                            // "30% OFF", "30%"
    .replace(/\b(FS|BFCM|CRM|EM|SMS)\b/gi, " ")                    // ops prefixes
    .replace(/\b(last call|final call|final hours|last chance|time'?s up|ends tonight|closing soon)\b/gi, " ")
    .replace(/[+|/]/g, " ")
    .replace(/[-–—]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—:,]+|[\s\-–—:,]+$/g, "")
    .trim();
  // Fewer than two real words left → it was all ops noise; unusable as an idea.
  return s.split(/\s+/).filter(Boolean).length >= 2 ? s : "";
}

const ANGLE_TO_ARCHITECTURE: Record<Angle, ConceitArchitecture> = {
  offer_led: "offer_led",
  product_led: "product_truth_led",
  story_led: "story_led",
  occasion_led: "offer_led", // the moment leads, but the deal is the through-line
};

// A deterministic 1-2 line hook SEED (never model-written) from occasion + angle
// + hero product + offer.
function heroSeed(angle: Angle, occasion: string, heroProduct: string, offer: string): string {
  const hp = heroProduct || "the featured product";
  switch (angle) {
    case "offer_led":
      return fill("{offer} for {occasion}. Lead with {hero}.", { offer, occasion, hero: hp });
    case "product_led":
      return fill("{hero}: what it does for your day, then the deal ({offer}).", { hero: hp, offer });
    case "story_led":
      return fill("{occasion}: land the idea first, then {hero}.", { occasion: occasion || "A moment worth a pause", hero: hp });
    case "occasion_led":
      return fill("{occasion}: the fit is {hero}, the reason is {offer}.", { occasion: occasion || "The moment", hero: hp, offer });
  }
}

// Walk the requested section structure into a per-module blueprint, prefixed with
// the hero-above-the-fold rule + the angle directive.
function buildStructuralNotes(
  scaffold: string,
  structure: SectionSpec[],
  angle: Angle,
  heroProduct: string,
): string {
  const lines = structure.map((s) => {
    const playbookFocus = ""; // section.focus already carries any per-section steering
    return `- ${s.type}${s.focus ? `: ${s.focus}` : playbookFocus ? `: ${playbookFocus}` : ""}`;
  });
  const heroRule = heroProduct
    ? `Lead above the fold with ${heroProduct}; any grid or multi-option block goes below the fold. End with a storefront link.`
    : `Lead above the fold with a single featured product; any grid goes below the fold. End with a storefront link.`;
  return [scaffold, ANGLE_DIRECTIVE[angle], heroRule, "Module blueprint (in order):", ...lines].join("\n");
}

export interface CompiledBrief {
  expanded_brief: ExpandedBrief;
  conceit: Conceit;
  send_stage: SendStage;
  urgency: UrgencyTier;
}

export function compileBrief(input: BriefInput, promotion?: Promotion, today?: Date): CompiledBrief {
  // 1. Resolve facts. User-typed offer/code always win; the promotion only fills
  //    blanks. Featured products come from the catalogue (input) only.
  const offer = (input.offer || "").trim() || (promotion?.promotion || "").trim();
  const code = (input.promo_code || "").trim();

  // An ad-hoc flash sale never lives on the promo calendar: synthesize a
  // promotion from the typed window so the existing stage/slot/deadline logic
  // runs unchanged and the conceit gets a real thesis (not "Sale — Sale").
  const promo: Promotion | undefined = input.occasion_kind === "flash_sale"
    ? {
        id: "flash_sale",
        year: new Date((input.flash_sale_start || input.flash_sale_end || "1970-01-01") + "T00:00:00Z").getUTCFullYear(),
        month: "",
        sale: "Flash Sale",
        promotion: offer,
        startDate: input.flash_sale_start,
        endDate: input.flash_sale_end,
        products: [],
      }
    : promotion;

  const occasion = (input.occasion || "").trim() || (promo?.sale || "").trim();
  const heroSlug = input.hero_product_slug || input.products_featured[0];
  const heroProduct = heroSlug ? getProductName(heroSlug) : "";
  const productNames = input.products_featured.map(getProductName).join(", ");
  const dates = dateSlot(promo);

  // 2 + 3. Stage + urgency (respect an explicit UI override). The planned send
  // date (defaulting to today) drives honest deadline phrasing; when the send
  // lands days before the window closes, urgency steps DOWN to match — the
  // deadline-derived tier caps the stage tier, never raises it.
  const send_stage: SendStage = input.send_stage ?? deriveSendStage(promo, today);
  const sendDateIso = (input.send_date || "").trim() || (today ?? new Date()).toISOString().slice(0, 10);
  const dl = promo?.endDate ? deadlineLanguage(sendDateIso, promo.endDate) : undefined;
  const stageUrgency = urgencyForStage(send_stage);
  const urgency: UrgencyTier = input.urgency ?? (dl ? (Math.min(stageUrgency, dl.urgency) as UrgencyTier) : stageUrgency);

  // `subject` is the always-present leading noun (occasion, else the campaign
  // name) so a template never opens on a blank or a duplicated word like
  // "Mother's Day Sale sale". `deadline` is the END date — what a last-call send
  // actually counts down to — as opposed to `dates` (the full range).
  // NEVER the raw campaign_name — that is an internal ops label and handing it
  // to the model dictates the headline (see cleanCampaignName).
  const subject = occasion || cleanCampaignName(input.campaign_name) || CAMPAIGN_TYPE_LABEL[input.campaign_type];
  const deadline = fmtDate(promo?.endDate) || dates || "the deadline";
  const slots: Record<string, string> = {
    offer, code, occasion, subject, deadline,
    hero_product: heroProduct, products: productNames, dates, stage: send_stage,
  };
  const tpl = BRIEF_TEMPLATES[input.campaign_type];

  // 4. Assemble the ExpandedBrief from the curated blocks.
  const structure = input.section_structure.length
    ? input.section_structure
    : PLAYBOOKS[input.campaign_type].default_structure.map((s, i) => ({ id: `s${i}`, ...s }));

  const expanded_brief: ExpandedBrief = {
    headline_thesis: fill(tpl.headline_thesis, slots),
    audience_mindset: AUDIENCE_MINDSET[input.audience],
    key_message: fill(tpl.key_message, slots),
    tonal_direction: `${fill(tpl.tonal_direction, slots)} ${STAGE_DIRECTIVE[send_stage]}`,
    structural_notes: buildStructuralNotes(fill(tpl.structural_notes, slots), structure, input.angle, heroProduct),
    rewritten_hero_angle: heroSeed(input.angle, occasion, heroProduct, offer),
    // Honest deadline phrasing (B: date-aware urgency) — set whenever an end
    // date is known; the generator injects it as a literal constraint.
    deadline_language: dl?.phrase,
    campaign_type: input.campaign_type,
    audience: input.audience,
    products_featured: input.products_featured,
    // The literal-instruction tier: the planner's notes/learnings first, then
    // the writer's own nudge (typed last, so it reads last). Both carried
    // VERBATIM so the generator honors them above everything.
    campaign_specific_rules: [
      (input.planner_notes || "").trim(),
      (input.campaign_specific_rules || "").trim(),
    ].filter(Boolean).join("\n\n") || undefined,
  };

  // 5. Synthesize the Conceit so /api/generate is unchanged.
  const label = occasion || cleanCampaignName(input.campaign_name) || CAMPAIGN_TYPE_LABEL[input.campaign_type];
  const conceit: Conceit = {
    id: `compiled_${input.campaign_type}_${input.angle}`,
    // Avoid "X · X" when the occasion IS the promotion's sale name.
    name: promo?.sale && promo.sale !== label ? `${label} · ${promo.sale}` : label,
    description: expanded_brief.headline_thesis,
    architecture: ANGLE_TO_ARCHITECTURE[input.angle],
  };

  return { expanded_brief, conceit, send_stage, urgency };
}
