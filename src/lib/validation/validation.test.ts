import { describe, it, expect } from "vitest";
import {
  parsePlannerRow, parsePlannerRows, parseLibraryCampaigns,
  parseSavedCampaign, parseFlow, parseFlows, stamp, stampAll, SCHEMA_VERSION,
} from "./index";
import { emailNodesInOrder, nodeById, validateGraph } from "../flow-graph";

const baseRow = {
  id: "a", name: "A", channel: "email", offer: "20% off",
  planned_send_at: "2026-07-01", status: "planned",
  audience_included: [], audience_excluded: [], notes: "",
  created_at: "x", updated_at: "y",
};

describe("planner migration + validation", () => {
  it("migrates a legacy status and a free-typed audience string", () => {
    const row = parsePlannerRow({ ...baseRow, status: "idea", audience_included: ["VIPs"] });
    expect(row).not.toBeNull();
    expect(row!.status).toBe("writing_brief");
    expect(row!.audience_included).toEqual([{ id: "", name: "VIPs", type: "segment" }]);
    expect(row!.offer_type).toBe("evergreen");
  });

  it("infers offer_type = promo when a promo_code is present", () => {
    const row = parsePlannerRow({ ...baseRow, promo_code: "SAVE30" });
    expect(row!.offer_type).toBe("promo");
  });

  it("drops malformed rows while keeping valid ones", () => {
    const rows = parsePlannerRows([
      { ...baseRow, id: "good" },
      { id: "bad", channel: "carrier-pigeon" },
      "not even an object",
    ]);
    expect(rows.map((r) => r.id)).toEqual(["good"]);
  });

  it("returns [] for non-array input rather than throwing", () => {
    expect(parsePlannerRows("nope" as unknown)).toEqual([]);
    expect(parsePlannerRows(null)).toEqual([]);
  });

  it("preserves unknown fields (no data loss on round-trip)", () => {
    const row = parsePlannerRow({ ...baseRow, some_future_field: 42 });
    expect((row as unknown as { some_future_field: number }).some_future_field).toBe(42);
  });
});

describe("library / saved validation", () => {
  it("skips a malformed library entry but keeps the good one", () => {
    const list = parseLibraryCampaigns([
      { foo: 1 },
      {
        id: "c", title: "t", date: "2026-07-01", campaign_type: "promo", offer: "",
        hero_angle: "", audience: "all", products_featured: [], conceit: "",
        source: "generated", body: "",
      },
    ]);
    expect(list.map((c) => c.id)).toEqual(["c"]);
  });

  it("parseSavedCampaign returns null on garbage instead of throwing", () => {
    expect(parseSavedCampaign({})).toBeNull();
    expect(parseSavedCampaign(null)).toBeNull();
  });
});

describe("element-level editing / removed design feature", () => {
  const savedWith = (section: Record<string, unknown>) => ({
    id: "s", campaign_name: "n", campaign_type: "promo", offer: "30% off", audience: "all",
    products_featured: ["O25"], section_structure: [],
    campaign: { meta: { subject_lines: [], preview_texts: [] }, sections: [section] },
    status: "draft", created_at: "x", updated_at: "y",
  });

  it("still loads a campaign carrying the legacy design_image field", () => {
    // The "Design this" feature is gone and design_image is off the interface, but
    // saved drafts and library snapshots may still carry it. Loose validation must
    // preserve rather than reject — no migration, dead data is harmless.
    const saved = parseSavedCampaign(savedWith({
      id: "h", type: "header", elements: { Headline: "Hi" },
      design_image: "data:image/png;base64,AAAA",
    }));
    expect(saved).not.toBeNull();
    expect(saved!.campaign.sections[0].elements.Headline).toBe("Hi");
    expect((saved!.campaign.sections[0] as unknown as Record<string, unknown>).design_image)
      .toBe("data:image/png;base64,AAAA");
  });

  it("round-trips canvas-level removed_elements on a generated section", () => {
    const saved = parseSavedCampaign(savedWith({
      id: "r", type: "reviews",
      elements: { "Review 1": "a", "Review 2": "b" },
      removed_elements: ["Subheader", "Review 3"],
    }));
    expect(saved).not.toBeNull();
    expect(saved!.campaign.sections[0].removed_elements).toEqual(["Subheader", "Review 3"]);
  });

  it("accepts a section with no removed_elements (backward compatible)", () => {
    const saved = parseSavedCampaign(savedWith({ id: "b", type: "body", elements: { "Body Copy": "x" } }));
    expect(saved).not.toBeNull();
    expect(saved!.campaign.sections[0].removed_elements).toBeUndefined();
  });

  it("rejects a removed_elements that is not a string array", () => {
    expect(parseSavedCampaign(savedWith({
      id: "b", type: "body", elements: { "Body Copy": "x" }, removed_elements: "Subheader",
    }))).toBeNull();
  });
});

describe("schema_version stamping", () => {
  it("stamp adds the current version", () => {
    expect(stamp({ a: 1 }).schema_version).toBe(SCHEMA_VERSION);
  });
  it("stampAll stamps every record", () => {
    expect(stampAll([{ a: 1 }, { a: 2 }]).every((r) => r.schema_version === SCHEMA_VERSION)).toBe(true);
  });
});

// A flow record saved BEFORE flow emails could be linked to the planner: no
// planner_row_id anywhere, and no row_kind on the planner side. Both fields are
// additive and optional, but this file's standing rule is that a shape the schema
// doesn't know is at risk on read, so the compatibility is pinned by a test.
const legacyFlow = {
  id: "2026-08-19-welcome-abc123",
  name: "Welcome flow",
  type: "welcome",
  channel: "email",
  emails: [
    {
      id: "e1", position: 1, job: "Say hello.", delay: "Immediately",
      section_structure: [{ id: "s1", type: "header" }],
      status: "draft",
      campaign: { meta: { subject_lines: ["Hi"], preview_texts: [] }, sections: [] },
    },
  ],
  splits: [],
  created_at: "2026-08-19T00:00:00.000Z",
  updated_at: "2026-08-19T00:00:00.000Z",
};

describe("flows: planner_row_id is additive", () => {
  it("a flow saved before planner links still loads, with no planner_row_id", () => {
    const flow = parseFlow(legacyFlow);
    expect(flow).not.toBeNull();
    expect(flow!.emails).toHaveLength(1);
    expect(flow!.emails[0].planner_row_id).toBeUndefined();
    expect(flow!.emails[0].campaign?.meta.subject_lines).toEqual(["Hi"]);
  });

  it("reads back a planner_row_id when one is set", () => {
    const flow = parseFlow({
      ...legacyFlow,
      emails: [{ ...legacyFlow.emails[0], planner_row_id: "welcome-flow-email-1" }],
    });
    expect(flow!.emails[0].planner_row_id).toBe("welcome-flow-email-1");
  });

  it("drops a flow whose planner_row_id is the wrong type rather than mistyping it", () => {
    expect(parseFlow({
      ...legacyFlow,
      emails: [{ ...legacyFlow.emails[0], planner_row_id: 7 }],
    })).toBeNull();
  });
});

describe("planner rows: row_kind is additive", () => {
  it("a row saved before row_kind existed loads with row_kind undefined", () => {
    const row = parsePlannerRow(baseRow);
    expect(row).not.toBeNull();
    expect(row!.row_kind).toBeUndefined();
  });

  it("reads back a flow_email row", () => {
    expect(parsePlannerRow({ ...baseRow, row_kind: "flow_email" })!.row_kind).toBe("flow_email");
  });

  it("drops a row with an unknown row_kind rather than trusting it", () => {
    expect(parsePlannerRow({ ...baseRow, row_kind: "something_else" })).toBeNull();
  });
});

// ---- Flow graph migration at the READ boundary -----------------------------
// The acceptance criterion is that an existing linear flow migrates on open with
// every email, delay and split label intact and NOTHING dropped. A record that
// fails validation is dropped silently by design, so these tests assert on real
// v2-shaped records rather than hand-built graphs.
const v2Flow = {
  id: "2026-08-19-welcome-abc123",
  name: "Welcome flow",
  type: "welcome",
  channel: "email",
  trigger: "Someone subscribes",
  goal: "Earn the second open",
  schema_version: 2,
  emails: [
    { id: "e1", position: 1, job: "Say hello.", delay: "Immediately", section_structure: [{ id: "s1", type: "header" }], status: "draft",
      campaign: { meta: { subject_lines: ["Hi"], preview_texts: ["P"] }, sections: [] } },
    { id: "e2", position: 2, job: "Show the proof.", delay: "1 day later", highlights: "warranty", section_structure: [{ id: "s2", type: "usps" }], status: "empty" },
    { id: "e3", position: 3, job: "Ask for the order.", delay: "3 days later", section_structure: [{ id: "s3", type: "footer_cta" }], status: "empty" },
  ],
  splits: [
    { id: "sp1", after_email_position: 2, label: "Purchased?", yes_label: "stop emailing", no_label: "keep nudging" },
  ],
  created_at: "2026-08-19T00:00:00.000Z",
  updated_at: "2026-08-19T00:00:00.000Z",
};

describe("flow graph migration on read", () => {
  it("gives a v2 flow a valid graph", () => {
    const flow = parseFlow(v2Flow)!;
    expect(flow).not.toBeNull();
    expect(flow.nodes!.length).toBeGreaterThan(0);
    expect(validateGraph({ nodes: flow.nodes!, edges: flow.edges! })).toEqual([]);
  });

  it("keeps every email, in order, with its id, job, delay, highlights and body", () => {
    const flow = parseFlow(v2Flow)!;
    const nodes = emailNodesInOrder({ nodes: flow.nodes!, edges: flow.edges! });
    expect(nodes.map((n) => n.id)).toEqual(["e1", "e2", "e3"]);
    expect(nodes.map((n) => n.email!.job)).toEqual(["Say hello.", "Show the proof.", "Ask for the order."]);
    expect(nodes.map((n) => n.email!.delay)).toEqual(["Immediately", "1 day later", "3 days later"]);
    expect(nodes[1].email!.highlights).toBe("warranty");
    expect(nodes[0].email!.campaign!.meta.subject_lines).toEqual(["Hi"]);
    expect(nodes[0].email!.section_structure).toEqual([{ id: "s1", type: "header" }]);
  });

  it("keeps the trigger, and the split's condition and both branch labels", () => {
    const flow = parseFlow(v2Flow)!;
    const g = { nodes: flow.nodes!, edges: flow.edges! };
    expect(flow.nodes!.find((n) => n.kind === "trigger")!.trigger!.label).toBe("Someone subscribes");
    const split = flow.nodes!.find((n) => n.kind === "split")!;
    expect(split.split).toEqual({ label: "Purchased?", yes_label: "stop emailing", no_label: "keep nudging" });
    // The No branch becomes an exit carrying the old label verbatim.
    const noEdge = flow.edges!.find((e) => e.from === split.id && e.branch === "no")!;
    expect(nodeById(g, noEdge.to)!.exit!.label).toBe("keep nudging");
  });

  it("re-derives the legacy arrays so the rollback copy matches the graph", () => {
    const flow = parseFlow(v2Flow)!;
    expect(flow.emails.map((e) => [e.id, e.position])).toEqual([["e1", 1], ["e2", 2], ["e3", 3]]);
    expect(flow.splits[0].label).toBe("Purchased?");
    expect(flow.splits[0].after_email_position).toBe(2);
  });

  it("preserves flow-level fields the migration doesn't touch", () => {
    const flow = parseFlow(v2Flow)!;
    expect(flow.name).toBe("Welcome flow");
    expect(flow.goal).toBe("Earn the second open");
    expect(flow.type).toBe("welcome");
  });

  it("is idempotent — re-reading a migrated flow changes nothing", () => {
    const once = parseFlow(v2Flow)!;
    const twice = parseFlow(JSON.parse(JSON.stringify(once)))!;
    expect(twice.nodes).toEqual(once.nodes);
    expect(twice.edges).toEqual(once.edges);
  });

  it("falls back to the playbook trigger when the flow has none", () => {
    const flow = parseFlow({ ...v2Flow, trigger: undefined })!;
    // FLOW_PLAYBOOKS.welcome.trigger
    expect(flow.nodes!.find((n) => n.kind === "trigger")!.trigger!.label).toBe("Someone subscribes");
  });

  it("migrates a flow with no emails into a bare trigger rather than dropping it", () => {
    const flow = parseFlow({ ...v2Flow, emails: [], splits: [] })!;
    expect(flow).not.toBeNull();
    expect(flow.nodes).toHaveLength(1);
    expect(flow.emails).toEqual([]);
  });

  it("accepts a v3 flow that already carries a graph, untouched", () => {
    const migrated = parseFlow(v2Flow)!;
    const reparsed = parseFlow({ ...migrated, schema_version: 3 })!;
    expect(reparsed.nodes).toEqual(migrated.nodes);
  });

  it("drops a flow whose node kind is unknown — the enum gotcha, pinned", () => {
    const migrated = parseFlow(v2Flow)!;
    const bad = { ...migrated, nodes: [...migrated.nodes!, { id: "weird", kind: "webhook", x: 0, y: 0 }] };
    expect(parseFlow(bad)).toBeNull();
  });

  it("parseFlows migrates a list and drops only the bad record", () => {
    const flows = parseFlows([v2Flow, { id: "broken" }, { ...v2Flow, id: "second" }]);
    expect(flows.map((f) => f.id)).toEqual(["2026-08-19-welcome-abc123", "second"]);
    expect(flows.every((f) => (f.nodes?.length ?? 0) > 0)).toBe(true);
  });
});

// ---- The audience split migration (PLANNER_AUDIENCE_BRIEF_SPEC.md §3) --------
// The old pair meant two different things depending on how it got filled, and the
// presence of klaviyo_campaign_id is exactly the signal for which. Getting this
// wrong would either lose someone's brief or invent one they never wrote.
const AUD = { id: "Abc123", name: "US Subscribers", type: "segment" as const };
const EXC = { id: "Xyz789", name: "Purchasers 30d", type: "segment" as const };

describe("planner rows: ab_test is additive", () => {
  it("a row with no ab_test parses and is simply not a test — no migration needed", () => {
    // The reason SCHEMA_VERSION does not move: absent is already the correct value
    // for every row ever written (docs/PLANNER_AB_TEST_AND_EDITOR_POLISH_SPEC.md §1.2).
    const row = parsePlannerRow(baseRow);
    expect(row).not.toBeNull();
    expect(row!.ab_test).toBeUndefined();
  });

  it("survives the read boundary with BOTH copy links intact and distinct", () => {
    const row = parsePlannerRow({
      ...baseRow,
      copy_campaign_id: "copy-a", copy_status: "final",
      ab_test: { kind: "content", copy_campaign_id: "copy-b", copy_status: "draft", copy_linked_at: null },
    });
    expect(row!.copy_campaign_id).toBe("copy-a");     // variant A stays where every consumer reads it
    expect(row!.ab_test?.copy_campaign_id).toBe("copy-b");
  });

  it("keeps a subject-line test's alternate copy text", () => {
    const row = parsePlannerRow({
      ...baseRow,
      ab_test: { kind: "subject_line", subject_line: "Two days left", preview_text: "No code needed" },
    });
    expect(row!.ab_test).toMatchObject({ kind: "subject_line", subject_line: "Two days left" });
  });

  it("an unknown ab_test kind becomes NO test — it never takes the row with it", () => {
    // The row is the campaign. parsePlannerRows drops what fails to parse and the
    // next writeAll persists only the survivors, so rejecting here would DELETE a
    // planned send off the calendar because of one additive optional field. It
    // degrades to the default instead, which is a correct row by definition (§1.2).
    const bad = parsePlannerRow({ ...baseRow, ab_test: { kind: "colour" } });
    expect(bad).not.toBeNull();
    expect(bad!.ab_test).toBeUndefined();
    expect(bad!.name).toBe(baseRow.name);        // the campaign survives intact

    const noKind = parsePlannerRow({ ...baseRow, ab_test: { subject_line: "no kind" } });
    expect(noKind).not.toBeNull();
    expect(noKind!.ab_test).toBeUndefined();     // and is never typed as a real test

    // A null left by a client that cleared the test is the same story.
    const cleared = parsePlannerRow({ ...baseRow, ab_test: null });
    expect(cleared).not.toBeNull();
    expect(cleared!.ab_test).toBeUndefined();
  });
});

describe("planner audience split migration", () => {
  it("an UNLINKED row's hand-entered audiences become the BRIEF", () => {
    const row = parsePlannerRow({ ...baseRow, audience_included: [AUD], audience_excluded: [EXC] })!;
    expect(row.audience_planned_included).toEqual([AUD]);
    expect(row.audience_planned_excluded).toEqual([EXC]);
    // No campaign, so nothing was built — actual must stay absent, not empty.
    expect(row.audience_actual_included).toBeUndefined();
  });

  it("a LINKED row's derived audiences become ACTUAL, and the brief starts empty", () => {
    const row = parsePlannerRow({
      ...baseRow, klaviyo_campaign_id: "01ABC", audience_included: [AUD], audience_excluded: [EXC],
    })!;
    expect(row.audience_actual_included).toEqual([AUD]);
    expect(row.audience_actual_excluded).toEqual([EXC]);
    // We do NOT know what was intended, so claiming the built values as the brief
    // would fabricate one — and then the match check would always agree with itself.
    expect(row.audience_planned_included).toEqual([]);
  });

  it("migrates a legacy free-typed string audience into the brief", () => {
    const row = parsePlannerRow({ ...baseRow, audience_included: ["VIPs"] })!;
    expect(row.audience_planned_included).toEqual([{ id: "", name: "VIPs", type: "segment" }]);
  });

  it("is IDEMPOTENT — re-reading never re-routes an already-split row", () => {
    const once = parsePlannerRow({ ...baseRow, audience_included: [AUD] })!;
    const twice = parsePlannerRow(JSON.parse(JSON.stringify(once)))!;
    expect(twice.audience_planned_included).toEqual([AUD]);
    expect(twice.audience_actual_included).toBeUndefined();
  });

  it("never overwrites an explicit brief when a campaign is linked later", () => {
    const briefed = parsePlannerRow({ ...baseRow, audience_included: [AUD] })!;
    const linked = parsePlannerRow({ ...briefed, klaviyo_campaign_id: "01ABC" })!;
    expect(linked.audience_planned_included).toEqual([AUD]);
  });

  it("keeps the legacy pair readable during the one-release overlap", () => {
    const row = parsePlannerRow({ ...baseRow, audience_included: [AUD], audience_excluded: [EXC] })!;
    expect(row.audience_included).toEqual([AUD]);
    expect(row.audience_excluded).toEqual([EXC]);
  });

  it("drops no rows: a row with no audience fields at all still parses", () => {
    const row = parsePlannerRow(baseRow)!;
    expect(row).not.toBeNull();
    expect(row.audience_planned_included).toEqual([]);
    expect(row.audience_actual_included).toBeUndefined();
  });

  it("accepts a planned note and a null actual sync time", () => {
    const row = parsePlannerRow({
      ...baseRow, audience_planned_included: [AUD], audience_planned_note: "cap at 3/week",
      audience_actual_synced_at: null,
    })!;
    expect(row.audience_planned_note).toBe("cap at 3/week");
    expect(row.audience_actual_synced_at).toBeNull();
  });

  it("REPAIRS a malformed audience array to empty rather than destroying the row", () => {
    // The same choice migrateAudience has always made for the legacy pair, and the
    // right one: a planner row carries synced metrics and a copy link, so dropping
    // the whole record over a bad audience list loses far more than it protects.
    const row = parsePlannerRow({ ...baseRow, audience_planned_included: "not-an-array" })!;
    expect(row).not.toBeNull();
    expect(row.audience_planned_included).toEqual([]);
  });

  it("still drops a row that is genuinely malformed — the shape gate is intact", () => {
    // A required field of the wrong type is a different thing from a repairable
    // audience list, and must not slip through.
    expect(parsePlannerRow({ ...baseRow, planned_send_at: 12345 })).toBeNull();
    expect(parsePlannerRow({ ...baseRow, channel: "carrier-pigeon" })).toBeNull();
  });

  it("parsePlannerRows migrates a whole list, routing each row by its link state", () => {
    const rows = parsePlannerRows([
      { ...baseRow, id: "a", audience_included: [AUD] },
      { ...baseRow, id: "b", channel: "smoke-signal", audience_included: [AUD] },
      { ...baseRow, id: "c", klaviyo_campaign_id: "01X", audience_included: [AUD] },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a", "c"]);   // the bad row dropped
    expect(rows[0].audience_planned_included).toEqual([AUD]);
    expect(rows[0].audience_actual_included).toBeUndefined();
    expect(rows[1].audience_actual_included).toEqual([AUD]);
    expect(rows[1].audience_planned_included).toEqual([]);
  });
});
