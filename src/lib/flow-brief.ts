import type {
  AudienceType, CampaignType, ExpandedBrief, Flow, FlowEmail, FlowType, SectionSpec,
} from "./schemas";
import { FLOW_TYPE_META } from "./schemas";
import { FLOW_PLAYBOOKS } from "./flow-playbooks";

// A flow email's ExpandedBrief (spec: FLOW_BUILDER_FIXES_SPEC.md Part 1).
//
// /api/flows/generate has no deterministic brief compile step — a flow email is
// evergreen, with no offer, send date or deadline, so there is nothing to compile
// FROM. That is sound for generation, but every REGENERATION route requires an
// ExpandedBrief (the request schemas demand `expanded_brief.campaign_type` and
// the routes dereference `key_message` / `deadline_language`), and the canvas
// gates all four AI assists on having one. Passing `null` — which the flows page
// did from the day flows shipped — silently disabled element rewrite, the
// 5-register section variations and subject/preview regeneration.
//
// So we build the FLOW-SHAPED brief rather than faking a campaign one. Pure: no
// LLM, no network, no fs — tested like brief/compile.ts and safe on the client.

/**
 * Flow type → CampaignType. An explicit table, not a cast: the two enums overlap
 * on exactly one member ("winback") and a cast would compile while producing an
 * invalid campaign_type for the other nine, which the request schemas gate on.
 * The mapping picks the campaign shape whose VOICE is closest to the flow's job.
 */
export const FLOW_CAMPAIGN_TYPE: Record<FlowType, CampaignType> = {
  welcome: "story",              // relationship-building, never an offer send
  abandoned_cart: "promo",       // recovering a sale; may carry an incentive
  abandoned_checkout: "promo",
  browse_abandonment: "story",   // interest, not intent — lead with the reason to look
  site_abandonment: "story",
  post_purchase: "story",        // reassure / onboard / cross-sell
  winback: "winback",
  sunset: "newsletter",          // plain re-permission ask, zero promotional lift
  back_in_stock: "restock",
  custom: "story",               // the neutral default; the author's job text steers it
};

/**
 * Flow type → AudienceType. A flow's audience is implied by its trigger (someone
 * who just bought IS post_purchase); `all` is the honest fallback where the
 * trigger says nothing about the reader's relationship with the brand.
 */
export const FLOW_AUDIENCE: Record<FlowType, AudienceType> = {
  welcome: "engaged",            // just opted in — as engaged as it gets
  abandoned_cart: "engaged",
  abandoned_checkout: "engaged",
  browse_abandonment: "engaged",
  site_abandonment: "all",       // a bare visit implies nothing
  post_purchase: "post_purchase",
  winback: "lapsed",
  sunset: "lapsed",
  back_in_stock: "engaged",
  custom: "all",
};

/** Every SKU pinned on the email's section structure, in order, deduped. This is
 * the flow analogue of BriefInput.products_featured: nobody types a product list
 * for a flow email, but the product cards / grids / bundles on its canvas have
 * already been bound to real SKUs, and that binding is what a rewrite needs. */
export function productsFromStructure(structure: SectionSpec[] | undefined): string[] {
  const out: string[] = [];
  for (const spec of structure ?? []) {
    if (spec.product_slug) out.push(spec.product_slug);
    for (const slug of spec.bundle_products ?? []) out.push(slug);
  }
  return [...new Set(out)];
}

function structuralNotes(flow: Flow, email: FlowEmail): string {
  const label = FLOW_TYPE_META[flow.type]?.label ?? flow.type;
  const parts = [`Email ${email.position} of ${flow.emails.length} in the ${label} flow.`];
  if (email.delay?.trim()) parts.push(`Fires ${email.delay.trim()}.`);
  const shape = (email.section_structure ?? []).map((s) => s.type).join(" → ");
  if (shape) parts.push(`Section order: ${shape}.`);
  return parts.join(" ");
}

/**
 * The ExpandedBrief for one email of one flow.
 *
 * `deadline_language` is ALWAYS undefined, and that is the single most important
 * line in this module. A flow email must never inherit a campaign deadline: the
 * hard rules ban urgency outright in Welcome 1, Post-Purchase 1 and Win-Back 1,
 * and the playbooks anchor urgency to the reader's own action rather than a
 * sitewide clock. Undefined is the correct VALUE here, not an omission — set it
 * and every rewrite starts counting down to a sale that does not exist.
 */
export function expandedBriefForFlowEmail(flow: Flow, email: FlowEmail): ExpandedBrief {
  const playbook = FLOW_PLAYBOOKS[flow.type] ?? FLOW_PLAYBOOKS.custom;
  const highlights = email.highlights?.trim();
  const job = email.job?.trim() ?? "";

  return {
    // The writer's own emphasis outranks the playbook's job wherever both could
    // answer the same question — it is the more specific instruction.
    headline_thesis: highlights || job,
    audience_mindset: playbook.job,
    key_message: job,
    tonal_direction: playbook.shape,
    structural_notes: structuralNotes(flow, email),
    rewritten_hero_angle: highlights || job,
    // Never a deadline. See the doc comment above.
    deadline_language: undefined,
    campaign_type: FLOW_CAMPAIGN_TYPE[flow.type] ?? "story",
    audience: FLOW_AUDIENCE[flow.type] ?? "all",
    products_featured: productsFromStructure(email.section_structure),
    // Carried verbatim so a rewrite honours the writer's literal wording, the
    // same contract compileBrief() gives a campaign's hero angle.
    ...(highlights ? { hero_angle_verbatim: highlights } : {}),
    // The flow's overall goal is the author's steering for every email in it, so
    // it belongs in the literal-instruction tier rather than being dropped.
    ...(flow.goal?.trim() ? { campaign_specific_rules: flow.goal.trim() } : {}),
  };
}
