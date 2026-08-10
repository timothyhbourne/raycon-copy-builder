import { describe, it, expect } from "vitest";
import { plannerNotesBlock, plannerRowToBriefSeed } from "./planner-copy-link";
import { compileBrief } from "./brief/compile";
import { DEFAULT_SECTION_STRUCTURE } from "./schemas";
import type { BriefInput } from "./schemas";
import type { PlannerRow } from "./planner-types";

const LEARNING = "Last time the 30% code confused people. State it in the body, not the subject.";

function row(over: Partial<PlannerRow> = {}): PlannerRow {
  return {
    id: "r1", name: "Back-to-School Push", channel: "email",
    offer_type: "promo", offer: "30% off", promo_code: "SCHOOL30",
    planned_send_at: "2026-08-20T09:00:00.000Z", status: "writing_brief",
    audience_included: [], audience_excluded: [], notes: "",
    created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

describe("plannerNotesBlock", () => {
  it("carries the row's notes verbatim", () => {
    const block = plannerNotesBlock(row({ notes: LEARNING }));
    expect(block).toContain(LEARNING);
    expect(block).toContain("Back-to-School Push");
  });

  it("adds the promotion's learnings as a clearly-delimited second source", () => {
    const block = plannerNotesBlock(row({ notes: "Lead with the sleep buds." }), {
      sale: "Back-to-School Sale", learnings: LEARNING,
    })!;
    expect(block).toContain("Lead with the sleep buds.");
    expect(block).toContain("Back-to-School Sale");
    expect(block).toContain(LEARNING);
    // Two labelled sections, blank-line separated — never run together.
    expect(block.split("\n\n")).toHaveLength(2);
  });

  it("works with only promotion learnings, and is undefined when there is nothing", () => {
    expect(plannerNotesBlock(row(), { sale: "BTS", learnings: LEARNING })).toContain(LEARNING);
    expect(plannerNotesBlock(row())).toBeUndefined();
    expect(plannerNotesBlock(row({ notes: "   " }), { learnings: "  " })).toBeUndefined();
  });
});

describe("plannerRowToBriefSeed", () => {
  it("puts the notes on planner_notes, not blurred into other fields", () => {
    const seed = plannerRowToBriefSeed(row({ notes: LEARNING }));
    expect(seed.planner_notes).toContain(LEARNING);
    expect(seed.campaign_name).toBe("Back-to-School Push");
    expect(seed.promo_code).toBe("SCHOOL30");
  });

  it("leaves planner_notes unset for a row with no notes", () => {
    expect(plannerRowToBriefSeed(row()).planner_notes).toBeUndefined();
  });
});

describe("notes reach generation as a literal instruction", () => {
  const base: BriefInput = {
    campaign_name: "Back-to-School Push",
    campaign_type: "promo",
    offer: "30% off",
    audience: "all",
    angle: "offer_led",
    products_featured: [],
    section_structure: DEFAULT_SECTION_STRUCTURE,
  };

  it("compiles planner_notes into campaign_specific_rules verbatim", () => {
    const { expanded_brief } = compileBrief({ ...base, planner_notes: LEARNING });
    expect(expanded_brief.campaign_specific_rules).toBe(LEARNING);
  });

  it("keeps the writer's own nudge too, planner notes first", () => {
    const { expanded_brief } = compileBrief({
      ...base, planner_notes: LEARNING, campaign_specific_rules: "No emojis.",
    });
    expect(expanded_brief.campaign_specific_rules).toBe(`${LEARNING}\n\nNo emojis.`);
  });

  it("is undefined when neither is present, and unaffected by blank notes", () => {
    expect(compileBrief(base).expanded_brief.campaign_specific_rules).toBeUndefined();
    expect(compileBrief({ ...base, planner_notes: "   " }).expanded_brief.campaign_specific_rules).toBeUndefined();
    expect(compileBrief({ ...base, planner_notes: "  ", campaign_specific_rules: "No emojis." })
      .expanded_brief.campaign_specific_rules).toBe("No emojis.");
  });
});
