// Unit test for the deterministic brief compiler.
//   npx tsx scripts/brief-compile-test.ts
// Covers: (1) the full campaign_type × angle × audience × send_stage matrix
// returns a fully-populated ExpandedBrief + valid Conceit, (2) date → send_stage
// derivation at the start / middle / final day of a window, (3) golden snapshots
// (including the Mother's Day / last_call worked example), and (4) determinism.
import type { BriefInput, CampaignType, AudienceType, Angle, SendStage } from "../src/lib/schemas";
import type { Promotion } from "../src/lib/promo/consolidate";
import { compileBrief, deriveSendStage, deadlineLanguage } from "../src/lib/brief/compile";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (!cond) { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const TYPES: CampaignType[] = ["promo", "launch", "restock", "story", "seasonal", "winback", "newsletter"];
const ANGLES: Angle[] = ["offer_led", "product_led", "story_led", "occasion_led"];
const AUDIENCES: AudienceType[] = ["all", "engaged", "lapsed", "post_purchase", "vip"];
const STAGES: SendStage[] = ["launch", "reminder", "last_call"];

function baseInput(over: Partial<BriefInput> = {}): BriefInput {
  return {
    campaign_name: "Test Campaign",
    campaign_type: "promo",
    offer: "20% off sitewide",
    promo_code: "TEST20",
    audience: "all",
    angle: "offer_led",
    products_featured: ["E25", "E45"],
    hero_product_slug: "E25",
    section_structure: [
      { id: "s1", type: "header" },
      { id: "s2", type: "body" },
      { id: "s3", type: "footer_cta" },
    ],
    tone_dial: 1,
    ...over,
  };
}

const mothersDay: Promotion = {
  id: "p_test",
  year: 2026,
  month: "May",
  sale: "Mother's Day Sale",
  promotion: "20% off sitewide",
  startDate: "2026-05-01",
  endDate: "2026-05-08",
  startTime: "10:00 AM",
  endTime: "11:00 PM",
  days: 8,
  products: [],
};

// --- 1. Matrix: every combination yields a fully-populated brief -------------
console.log("1. Matrix (type × angle × audience × stage)");
let combos = 0;
for (const campaign_type of TYPES) {
  for (const angle of ANGLES) {
    for (const audience of AUDIENCES) {
      for (const send_stage of STAGES) {
        combos++;
        const { expanded_brief: b, conceit, urgency } = compileBrief(
          baseInput({ campaign_type, angle, audience, send_stage })
        );
        const label = `${campaign_type}/${angle}/${audience}/${send_stage}`;
        for (const [k, v] of Object.entries({
          headline_thesis: b.headline_thesis,
          audience_mindset: b.audience_mindset,
          key_message: b.key_message,
          tonal_direction: b.tonal_direction,
          structural_notes: b.structural_notes,
          rewritten_hero_angle: b.rewritten_hero_angle,
        })) {
          check(`${label}: ${k} populated`, typeof v === "string" && v.trim().length > 0);
        }
        check(`${label}: no unfilled {slot}`, !/\{\w+\}/.test(
          [b.headline_thesis, b.key_message, b.tonal_direction, b.structural_notes, b.rewritten_hero_angle].join(" ")
        ), "template slot left unreplaced");
        check(`${label}: conceit valid`, !!conceit.id && !!conceit.name && !!conceit.description && !!conceit.architecture);
        check(`${label}: urgency in range`, [1, 2, 3].includes(urgency));
      }
    }
  }
}
console.log(`   ${combos} combinations checked`);

// --- 2. date → send_stage derivation ----------------------------------------
console.log("2. Date → send_stage derivation");
const d = (s: string) => new Date(`${s}T12:00:00Z`);
check("start day → launch", deriveSendStage(mothersDay, d("2026-05-01")) === "launch", deriveSendStage(mothersDay, d("2026-05-01")));
check("middle → reminder", deriveSendStage(mothersDay, d("2026-05-04")) === "reminder", deriveSendStage(mothersDay, d("2026-05-04")));
check("final day → last_call", deriveSendStage(mothersDay, d("2026-05-08")) === "last_call", deriveSendStage(mothersDay, d("2026-05-08")));
check("after end → last_call", deriveSendStage(mothersDay, d("2026-05-20")) === "last_call", deriveSendStage(mothersDay, d("2026-05-20")));
check("no promotion → launch", deriveSendStage(undefined, d("2026-05-04")) === "launch");

// --- 3. Golden: Mother's Day / offer_led / last_call -------------------------
console.log("3. Golden snapshot — Mother's Day · offer_led · final day");
const golden = compileBrief(
  baseInput({ campaign_type: "promo", angle: "offer_led", audience: "engaged", offer: "20% off sitewide" }),
  mothersDay,
  d("2026-05-08"),
);
check("golden stage = last_call", golden.send_stage === "last_call", golden.send_stage);
check("golden urgency = 3", golden.urgency === 3, String(golden.urgency));
check("golden mentions the occasion", golden.expanded_brief.headline_thesis.includes("Mother's Day"));
check("golden keeps the offer verbatim", golden.expanded_brief.key_message.includes("20% off sitewide"));
check("golden conceit architecture", golden.conceit.architecture === "offer_led", golden.conceit.architecture);
console.log("   headline_thesis:", golden.expanded_brief.headline_thesis);
console.log("   key_message    :", golden.expanded_brief.key_message);
console.log("   hero seed      :", golden.expanded_brief.rewritten_hero_angle);
console.log("   conceit        :", `${golden.conceit.name} [${golden.conceit.architecture}]`);

// --- 4. Determinism + the offer-wins rule ------------------------------------
console.log("4. Determinism + offer precedence");
const a = compileBrief(baseInput(), mothersDay, d("2026-05-04"));
const b2 = compileBrief(baseInput(), mothersDay, d("2026-05-04"));
check("same inputs → identical output", JSON.stringify(a) === JSON.stringify(b2));
const typed = compileBrief(baseInput({ offer: "BOGO 50%" }), mothersDay, d("2026-05-04"));
check("user-typed offer wins over the promotion's", typed.expanded_brief.key_message.includes("BOGO 50%"));
const blank = compileBrief(baseInput({ offer: "" }), mothersDay, d("2026-05-04"));
check("blank offer falls back to the promotion's", blank.expanded_brief.key_message.includes("20% off sitewide"));

// --- 5. Flash sale (synthetic promotion) + deadline language -----------------
console.log("5. Flash sale + deadline language");
const flash = (over: Partial<BriefInput> = {}) => baseInput({
  campaign_type: "promo", angle: "offer_led", offer: "30% off our top three",
  occasion_kind: "flash_sale", occasion: "Flash Sale",
  flash_sale_start: "2026-07-22", flash_sale_end: "2026-07-23", send_date: "2026-07-23",
  promotion_id: undefined,
  ...over,
});
// A. End date = today → conceit "Flash Sale", stage last_call, urgency 3.
const fsToday = compileBrief(flash(), undefined, d("2026-07-23"));
check("flash: conceit name = Flash Sale", fsToday.conceit.name === "Flash Sale", fsToday.conceit.name);
check("flash: stage = last_call", fsToday.send_stage === "last_call", fsToday.send_stage);
check("flash: urgency = 3", fsToday.urgency === 3, String(fsToday.urgency));
check("flash: deadline language = tonight", fsToday.expanded_brief.deadline_language === "tonight", fsToday.expanded_brief.deadline_language);
check("flash: thesis has a real angle (no 'Sale — Sale')", fsToday.expanded_brief.headline_thesis.includes("Flash Sale"));
// One-day flash sale (start = end = today) is still last_call, never "launch".
const fsOneDay = compileBrief(flash({ flash_sale_start: "2026-07-23" }), undefined, d("2026-07-23"));
check("flash: one-day sale → last_call", fsOneDay.send_stage === "last_call", fsOneDay.send_stage);
// B. deadlineLanguage ladder: 0 / 1 / 2 / 3+ days out.
check("dl 0 days", JSON.stringify(deadlineLanguage("2026-07-23", "2026-07-23")) === JSON.stringify({ phrase: "tonight", urgency: 3 }));
check("dl 1 day", JSON.stringify(deadlineLanguage("2026-07-22", "2026-07-23")) === JSON.stringify({ phrase: "tomorrow night", urgency: 3 }));
check("dl 2 days", JSON.stringify(deadlineLanguage("2026-07-21", "2026-07-23")) === JSON.stringify({ phrase: "in 48 hours", urgency: 2 }));
const dl3 = deadlineLanguage("2026-07-20", "2026-07-24");
check("dl 3+ days names the real day", dl3.phrase === "Friday, Jul 24" && dl3.urgency === 2, JSON.stringify(dl3));
// Sent 2 days early: honest phrase, urgency stepped down to 2 even at last_call framing.
const fsEarly = compileBrief(flash({ flash_sale_start: "2026-07-20", flash_sale_end: "2026-07-25", send_date: "2026-07-23", send_stage: "last_call" }), undefined, d("2026-07-23"));
check("flash early: deadline language = in 48 hours", fsEarly.expanded_brief.deadline_language === "in 48 hours", fsEarly.expanded_brief.deadline_language);
check("flash early: urgency stepped down to 2", fsEarly.urgency === 2, String(fsEarly.urgency));
// Manual urgency override still wins.
const fsOverride = compileBrief(flash({ send_date: "2026-07-21", urgency: 3 }), undefined, d("2026-07-21"));
check("flash: manual urgency override wins", fsOverride.urgency === 3, String(fsOverride.urgency));
// Calendar promotions also get deadline language (no flash sale involved).
const calDl = compileBrief(baseInput({ send_date: "2026-05-07" }), mothersDay, d("2026-05-07"));
check("calendar promo: deadline language set", calDl.expanded_brief.deadline_language === "tomorrow night", calDl.expanded_brief.deadline_language);

console.log(failures === 0 ? "\n✅ all checks passed" : `\n❌ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
