import { describe, it, expect } from "vitest";
import { flowRoleInstruction, flowUserPrompt, type FlowEmailContext } from "./flows";
import { FLOW_PLAYBOOKS, scaffoldSections } from "../flow-playbooks";
import { FLOW_TYPES } from "../schemas";
import type { SectionSpec } from "../schemas";

describe("FLOW_PLAYBOOKS", () => {
  it("has an entry for every FlowType", () => {
    for (const t of FLOW_TYPES) {
      expect(FLOW_PLAYBOOKS[t], `missing playbook for ${t}`).toBeTruthy();
    }
  });

  it("covers the distinct lifecycle triggers (cart vs checkout, browse vs site, winback vs sunset, custom)", () => {
    for (const t of ["abandoned_checkout", "site_abandonment", "sunset", "custom"] as const) {
      expect(FLOW_TYPES).toContain(t);
      expect(FLOW_PLAYBOOKS[t]).toBeTruthy();
    }
    // Cart and checkout abandonment are separate flows with distinct triggers.
    expect(FLOW_PLAYBOOKS.abandoned_cart.trigger).not.toBe(FLOW_PLAYBOOKS.abandoned_checkout.trigger);
    // Win-back (reactivation) and sunset (unengaged goodbye) are separate.
    expect(FLOW_PLAYBOOKS.winback.trigger).not.toBe(FLOW_PLAYBOOKS.sunset.trigger);
  });

  it("numbers each flow's emails 1..n contiguously and gives each a job + structure", () => {
    for (const t of FLOW_TYPES) {
      const pb = FLOW_PLAYBOOKS[t];
      expect(pb.job.length, `${t} flow job`).toBeGreaterThan(0);
      expect(pb.trigger.length, `${t} trigger label (map node)`).toBeGreaterThan(0);
      expect(pb.emails.length, `${t} has emails`).toBeGreaterThan(0);
      pb.emails.forEach((e, i) => {
        expect(e.position, `${t} email ${i} position`).toBe(i + 1);
        expect(e.job.length, `${t} email ${i} job`).toBeGreaterThan(0);
        expect(e.default_structure.length, `${t} email ${i} structure`).toBeGreaterThan(0);
      });
    }
  });
});

describe("scaffoldSections", () => {
  it("gives every scaffolded section a unique id and preserves type/focus/grid", () => {
    let n = 0;
    const mkId = () => `id-${n++}`;
    const out = scaffoldSections(FLOW_PLAYBOOKS.welcome.emails[2].default_structure, mkId);
    const ids = out.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length); // unique
    // The welcome[3] email has a product_grid with grid dimensions — carry them.
    const grid = out.find((s) => s.type === "product_grid");
    expect(grid?.grid_cols).toBe(2);
    expect(grid?.grid_rows).toBe(2);
  });
});

describe("flowRoleInstruction", () => {
  it("frames flow psychology, not broadcast promo", () => {
    expect(flowRoleInstruction).toMatch(/triggered/i);
    expect(flowRoleInstruction).toMatch(/relationship arc|relationship-driven|arc/i);
    // A flow email must never invent a broadcast deadline.
    expect(flowRoleInstruction).toMatch(/no sitewide sale clock|anchored to the reader/i);
  });
});

describe("flowUserPrompt", () => {
  const sections: SectionSpec[] = [
    { id: "s1", type: "header" },
    { id: "s2", type: "body" },
    { id: "s3", type: "footer_cta" },
  ];
  const ctx: FlowEmailContext = {
    flowType: "welcome",
    flowName: "Welcome flow",
    channel: "email",
    position: 2,
    totalEmails: 3,
    job: "Introduce the hero product and the reason to believe.",
    delay: "1 day later",
    highlights: "Lead with the 6-month warranty; name the Everyday Earbuds.",
    siblings: [
      { position: 1, job: "Warm welcome.", summary: 'subject "Welcome to Raycon" — header: Glad you\'re here' },
      { position: 3, job: "First-order nudge.", summary: undefined },
    ],
  };

  it("places the email in its sequence and carries job + highlights + siblings", () => {
    const prompt = flowUserPrompt(ctx, sections);
    expect(prompt).toMatch(/EMAIL 2 of 3/);
    expect(prompt).toContain("Introduce the hero product");
    expect(prompt).toContain("6-month warranty");
    expect(prompt).toContain("Welcome to Raycon"); // sibling summary for cohesion
    expect(prompt).toMatch(/not written yet/i); // sibling 3 has no summary
  });

  it("requests exactly sections.length + 1 JSONL lines (meta + one per section)", () => {
    const prompt = flowUserPrompt(ctx, sections);
    expect(prompt).toContain(`exactly ${sections.length + 1} JSON lines`);
    // The meta line skeleton and each section skeleton are present.
    expect(prompt).toContain('"meta"');
    expect(prompt).toContain('"type":"header"');
    expect(prompt).toContain('"type":"footer_cta"');
  });

  it("injects the shared hard-rules gate (brand invariants never fork)", () => {
    const prompt = flowUserPrompt(ctx, sections);
    expect(prompt).toMatch(/HARD RULES: FINAL GATE/);
  });
});
