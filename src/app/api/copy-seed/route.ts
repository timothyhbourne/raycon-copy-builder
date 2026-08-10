import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, FAST_MODEL } from "@/lib/anthropic";
import { getBrandContext, buildSystemBlocks } from "@/lib/data";
import { copySeedRoleInstruction, copySeedUserPrompt } from "@/lib/prompts/copy-seed";
import { plannerRowToBriefSeed } from "@/lib/planner-copy-link";
import { readPromoStore } from "@/lib/promo/store";
import { promoOnDate } from "@/lib/promo/window";
import { VALID_PRODUCT_IDS } from "@/lib/products";
import { parseBody } from "@/lib/validation/api";
import { copySeedBody } from "@/lib/validation/requests";
import type { PlannerRow } from "@/lib/planner-types";
import type { BriefInput, CampaignType, AudienceType } from "@/lib/schemas";

const CAMPAIGN_TYPES: CampaignType[] = ["promo", "launch", "restock", "story", "seasonal", "winback", "newsletter"];
const AUDIENCES: AudienceType[] = ["all", "engaged", "lapsed", "post_purchase", "vip"];

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, copySeedBody);
  if (parsed.error) return parsed.error;
  const { row, notes_only } = parsed.data as unknown as { row: PlannerRow; notes_only?: boolean };

  // A planner row carries no promotion id, so the honest link is the calendar:
  // the promotion running on the planned send date. Its `learnings` are the
  // second half of the notes block. A promo-store failure must never block the
  // handoff — we just carry the row's own notes.
  let promotion: { sale?: string; learnings?: string } | undefined;
  try {
    const store = await readPromoStore();
    promotion = store ? promoOnDate(store.promotions, (row.planned_send_at || "").slice(0, 10)) : undefined;
  } catch (e) {
    console.warn("copy-seed: promo lookup failed:", e instanceof Error ? e.message : e);
  }

  // Deterministic mapping first — this is what we return no matter what.
  const seed = plannerRowToBriefSeed(row, promotion);

  // Re-sync path: the Copy Builder asking for the CURRENT notes on a row whose
  // copy already exists. Deterministic only — no model call, no cost.
  if (notes_only) return NextResponse.json({ seed, rationale: "" });

  try {
    const systemBlocks = buildSystemBlocks(getBrandContext(), copySeedRoleInstruction);
    const userPrompt = copySeedUserPrompt(row, {
      campaign_type: (seed.campaign_type ?? "promo") as CampaignType,
      audience: (seed.audience ?? "all") as AudienceType,
    }, promotion);

    const response = await getAnthropic().messages.create({
      model: FAST_MODEL,
      max_tokens: 1024,
      system: systemBlocks,
      messages: [{ role: "user", content: userPrompt }],
    });

    if (response.stop_reason === "max_tokens") {
      throw new Error("copy-seed hit max_tokens (output truncated). Raise max_tokens.");
    }
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const json = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const ai = JSON.parse(json) as {
      products_featured?: unknown;
      hero_angle?: unknown;
      campaign_type?: unknown;
      audience?: unknown;
      rationale?: unknown;
    };

    // Validate AI SKUs against the real catalogue; drop anything invalid.
    const products = Array.isArray(ai.products_featured)
      ? ai.products_featured.filter((id): id is string => typeof id === "string" && VALID_PRODUCT_IDS.has(id)).slice(0, 3)
      : [];

    // AI may confirm or override the enum guesses; coerce to valid values,
    // falling back to the deterministic seed when the model returns junk.
    const campaign_type = CAMPAIGN_TYPES.includes(ai.campaign_type as CampaignType)
      ? (ai.campaign_type as CampaignType)
      : seed.campaign_type;
    const audience = AUDIENCES.includes(ai.audience as AudienceType)
      ? (ai.audience as AudienceType)
      : seed.audience;

    const heroAngle = typeof ai.hero_angle === "string" ? ai.hero_angle.trim() : "";
    const rationale = typeof ai.rationale === "string" ? ai.rationale.trim() : "";

    // AI wins for products, hero angle, and confirmed type/audience. Merge is
    // done here so the client stays dumb.
    const mergedSeed: Partial<BriefInput> = {
      ...seed,
      products_featured: products,
      campaign_type,
      audience,
      ...(heroAngle ? { hero_angle: heroAngle } : {}),
    };

    return NextResponse.json({ seed: mergedSeed, rationale });
  } catch (e) {
    // A smart-fill failure must never block the handoff — return the
    // deterministic seed (products empty, hero angle blank) with 200.
    console.error("copy-seed failed:", e);
    return NextResponse.json({ seed, rationale: "", ai_failed: true });
  }
}
