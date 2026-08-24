import { describe, it, expect } from "vitest";
import {
  expandedBriefForFlowEmail, productsFromStructure, FLOW_CAMPAIGN_TYPE, FLOW_AUDIENCE,
} from "./flow-brief";
import { FLOW_PLAYBOOKS } from "./flow-playbooks";
import { FLOW_TYPES } from "./schemas";
import type { Flow, FlowEmail, FlowType, SectionSpec } from "./schemas";

const email = (patch: Partial<FlowEmail> = {}): FlowEmail => ({
  id: "e1",
  position: 2,
  job: "Handle the hesitation with reassurance.",
  delay: "1 day later",
  section_structure: [{ id: "s1", type: "header" }],
  status: "draft",
  ...patch,
});

const flow = (patch: Partial<Flow> = {}): Flow => ({
  id: "2026-08-24-welcome-abc123",
  name: "Welcome flow",
  type: "welcome",
  channel: "email",
  emails: [email({ id: "a", position: 1 }), email({ id: "e1", position: 2 }), email({ id: "c", position: 3 })],
  splits: [],
  created_at: "2026-08-24T00:00:00.000Z",
  updated_at: "2026-08-24T00:00:00.000Z",
  ...patch,
});

describe("flow type mappings", () => {
  it("every FlowType maps to a campaign type and an audience", () => {
    for (const t of FLOW_TYPES) {
      expect(FLOW_CAMPAIGN_TYPE[t], `campaign type for ${t}`).toBeTruthy();
      expect(FLOW_AUDIENCE[t], `audience for ${t}`).toBeTruthy();
    }
  });

  it("maps each flow type to the campaign shape closest to its job", () => {
    const expected: Record<FlowType, string> = {
      welcome: "story", abandoned_cart: "promo", abandoned_checkout: "promo",
      browse_abandonment: "story", site_abandonment: "story", post_purchase: "story",
      winback: "winback", sunset: "newsletter", back_in_stock: "restock", custom: "story",
    };
    for (const t of FLOW_TYPES) {
      expect(expandedBriefForFlowEmail(flow({ type: t }), email()).campaign_type).toBe(expected[t]);
    }
  });

  it("infers the audience from the trigger, falling back to all", () => {
    expect(expandedBriefForFlowEmail(flow({ type: "post_purchase" }), email()).audience).toBe("post_purchase");
    expect(expandedBriefForFlowEmail(flow({ type: "winback" }), email()).audience).toBe("lapsed");
    expect(expandedBriefForFlowEmail(flow({ type: "site_abandonment" }), email()).audience).toBe("all");
    expect(expandedBriefForFlowEmail(flow({ type: "custom" }), email()).audience).toBe("all");
  });
});

describe("expandedBriefForFlowEmail", () => {
  it("NEVER carries a deadline_language, for any flow type", () => {
    for (const t of FLOW_TYPES) {
      const brief = expandedBriefForFlowEmail(flow({ type: t }), email());
      expect(brief.deadline_language, `deadline for ${t}`).toBeUndefined();
    }
  });

  it("takes the mindset and tone from the flow's playbook", () => {
    const brief = expandedBriefForFlowEmail(flow({ type: "abandoned_cart" }), email());
    expect(brief.audience_mindset).toBe(FLOW_PLAYBOOKS.abandoned_cart.job);
    expect(brief.tonal_direction).toBe(FLOW_PLAYBOOKS.abandoned_cart.shape);
  });

  it("key_message is the email's job", () => {
    const brief = expandedBriefForFlowEmail(flow(), email({ job: "Recover the sale." }));
    expect(brief.key_message).toBe("Recover the sale.");
  });

  it("highlights outrank the job for the thesis / hero angle, and are carried verbatim", () => {
    const brief = expandedBriefForFlowEmail(
      flow(),
      email({ job: "Nudge them back.", highlights: "Lead with the 6-month warranty" }),
    );
    expect(brief.headline_thesis).toBe("Lead with the 6-month warranty");
    expect(brief.rewritten_hero_angle).toBe("Lead with the 6-month warranty");
    expect(brief.hero_angle_verbatim).toBe("Lead with the 6-month warranty");
  });

  it("falls back to the job when there are no highlights, with no verbatim block", () => {
    const brief = expandedBriefForFlowEmail(flow(), email({ job: "Nudge them back.", highlights: "   " }));
    expect(brief.headline_thesis).toBe("Nudge them back.");
    expect(brief.rewritten_hero_angle).toBe("Nudge them back.");
    expect(brief.hero_angle_verbatim).toBeUndefined();
  });

  it("names the email's position, delay and section order in structural_notes", () => {
    const structure: SectionSpec[] = [
      { id: "s1", type: "header" }, { id: "s2", type: "body" }, { id: "s3", type: "footer_cta" },
    ];
    const brief = expandedBriefForFlowEmail(flow(), email({ section_structure: structure }));
    expect(brief.structural_notes).toContain("Email 2 of 3");
    expect(brief.structural_notes).toContain("Welcome");
    expect(brief.structural_notes).toContain("1 day later");
    expect(brief.structural_notes).toContain("header → body → footer_cta");
  });

  it("carries the flow's goal as a literal instruction, and omits it when unset", () => {
    expect(expandedBriefForFlowEmail(flow({ goal: "Get to the first order" }), email()).campaign_specific_rules)
      .toBe("Get to the first order");
    expect(expandedBriefForFlowEmail(flow({ goal: "  " }), email()).campaign_specific_rules).toBeUndefined();
    expect(expandedBriefForFlowEmail(flow(), email()).campaign_specific_rules).toBeUndefined();
  });
});

describe("productsFromStructure", () => {
  it("collects pinned card SKUs and bundle contents, in order, deduped", () => {
    const structure: SectionSpec[] = [
      { id: "s1", type: "header" },
      { id: "s2", type: "product_card", product_slug: "everyday-earbuds" },
      { id: "s3", type: "bundle", bundle_products: ["everyday-earbuds", "fitness-earbuds"] },
      { id: "s4", type: "product_card", product_slug: "the-magic-earbuds" },
    ];
    expect(productsFromStructure(structure)).toEqual([
      "everyday-earbuds", "fitness-earbuds", "the-magic-earbuds",
    ]);
  });

  it("is empty for a structure with no pinned products", () => {
    expect(productsFromStructure([{ id: "s1", type: "header" }])).toEqual([]);
    expect(productsFromStructure(undefined)).toEqual([]);
  });

  it("feeds products_featured on the brief", () => {
    const brief = expandedBriefForFlowEmail(flow(), email({
      section_structure: [{ id: "s1", type: "product_card", product_slug: "everyday-earbuds" }],
    }));
    expect(brief.products_featured).toEqual(["everyday-earbuds"]);
  });
});
