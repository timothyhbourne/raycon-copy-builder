import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";
import FlowCanvas, {
  EmptyCanvasPrompt, nodeData, nodePropsEqual, sameData, structureSignature, type NodeData,
} from "./FlowCanvas";
import type { FlowGraph } from "@/lib/flow-graph";
import { insertSplit } from "@/lib/flow-graph";
import type { FlowNode } from "@/lib/schemas";

// A server-render smoke test. React Flow only renders node bodies once it can
// MEASURE them, which needs a browser, so this cannot assert on node content —
// what it does catch is the class of failure that takes the whole page down: a
// broken import, an unregistered node type, or a crash in the first render pass.
// Everything about what the canvas may DO is tested in lib/flow-graph.test.ts.

function ids(prefix = "n") { let i = 0; return () => `${prefix}${++i}`; }

const noop = () => {};
const actions = {
  onSelectNode: noop, onMoveNode: noop, onInsert: noop, onDelete: noop,
  onConnect: noop, onReconnect: noop, onEditTrigger: noop, onEditSplit: noop,
  onEditDelay: noop, onEditExit: noop, onTidy: noop,
};

const linear: FlowGraph = {
  nodes: [
    { id: "t", kind: "trigger", x: 0, y: 0, trigger: { label: "Someone subscribes" } },
    { id: "e1", kind: "email", x: 0, y: 140, email: { id: "e1", job: "Welcome them", section_structure: [], status: "draft" } },
  ],
  edges: [{ id: "x1", from: "t", to: "e1" }],
};

const render = (graph: FlowGraph, selected: string | null = "e1") => renderToString(
  <FlowCanvas graph={graph} flowType="welcome" flowId="f1" selectedNodeId={selected} generatingNodeId={null} actions={actions} />,
);

describe("FlowCanvas renders", () => {
  it("mounts React Flow with the toolbar", () => {
    const html = render(linear);
    expect(html).toContain("react-flow");
    expect(html).toContain("Tidy up");
    expect(html).toContain("Add step");
  });

  it("renders a branched graph, a delay and an exit without throwing", () => {
    const { graph } = insertSplit(linear, "e1", ids("s"));
    const withMore: FlowGraph = {
      nodes: [
        ...graph.nodes,
        { id: "d", kind: "delay", x: 0, y: 500, delay: { label: "Wait 2 days" } },
        { id: "x", kind: "exit", x: 0, y: 640, exit: { label: "Done" } },
      ],
      edges: graph.edges,
    };
    expect(() => render(withMore)).not.toThrow();
  });

  it("surfaces a broken graph in the canvas rather than rendering it silently", () => {
    // A split with no branches — the state insertSplit can never produce, but a
    // hand-edited or half-reconnected graph can.
    const broken: FlowGraph = {
      nodes: [...linear.nodes, { id: "s", kind: "split", x: 0, y: 280, split: { label: "Opened?" } }],
      edges: [...linear.edges, { id: "x2", from: "e1", to: "s" }],
    };
    expect(render(broken)).toContain("A split needs exactly one Yes and one No branch");
  });

  it("renders with nothing selected", () => {
    expect(() => render(linear, null)).not.toThrow();
  });

  it("renders an empty graph", () => {
    expect(() => render({ nodes: [], edges: [] }, null)).not.toThrow();
  });

  it("the empty-canvas prompt offers the first email", () => {
    const html = renderToString(<EmptyCanvasPrompt flowType="welcome" onAdd={noop} />);
    expect(html).toContain("Add your first email");
    // React splits adjacent text nodes with an empty comment in SSR output, so
    // assert on the interpolated label rather than the rendered phrase.
    expect(html).toContain("Welcome<!-- --> flow");
  });
});

// ---------------------------------------------------------------------------
// The performance fix (docs/FLOW_CANVAS_PERFORMANCE_SPEC.md). The acceptance
// criteria are frame rates and render counts, which need a browser and a
// profiler. What IS testable here is the MECHANISM each of them rests on, and
// these are the assertions that break if someone undoes the fix:
//
//   "traversals don't run during a drag"        -> structureSignature is
//                                                  position-independent
//   "dragging one node re-renders that node"    -> nodePropsEqual ignores
//                                                  position, catches content
//   "memo can work at all"                      -> nodeData is primitives only

const emailNode = (id: string, patch: Record<string, unknown> = {}): FlowNode => ({
  id, kind: "email", x: 0, y: 0,
  email: { id, job: `Job ${id}`, section_structure: [], status: "empty", ...patch },
});

describe("structureSignature — keeps the graph traversals off the interaction path", () => {
  const base: FlowGraph = {
    nodes: [
      { id: "t", kind: "trigger", x: 0, y: 0, trigger: { label: "fires" } },
      emailNode("e1"),
    ],
    edges: [{ id: "x1", from: "t", to: "e1" }],
  };

  it("is unchanged when a node MOVES — the whole point", () => {
    const moved: FlowGraph = { ...base, nodes: base.nodes.map((n) => ({ ...n, x: n.x + 137, y: n.y + 42 })) };
    expect(structureSignature(moved)).toBe(structureSignature(base));
  });

  it("is unchanged when a LABEL or a job is edited", () => {
    const edited: FlowGraph = {
      ...base,
      nodes: [
        { ...base.nodes[0], trigger: { label: "someone subscribes" } },
        emailNode("e1", { job: "Something else entirely", highlights: "warranty" }),
      ],
    };
    expect(structureSignature(edited)).toBe(structureSignature(base));
  });

  it("is unchanged when copy is generated into an email", () => {
    const written: FlowGraph = {
      ...base,
      nodes: [base.nodes[0], emailNode("e1", {
        status: "draft",
        campaign: { meta: { subject_lines: ["Hi"], preview_texts: [] }, sections: [] },
      })],
    };
    expect(structureSignature(written)).toBe(structureSignature(base));
  });

  it("CHANGES when a node is added, removed, or its kind changes", () => {
    expect(structureSignature({ ...base, nodes: [...base.nodes, emailNode("e2")] })).not.toBe(structureSignature(base));
    expect(structureSignature({ ...base, nodes: [base.nodes[0]] })).not.toBe(structureSignature(base));
    expect(structureSignature({ ...base, nodes: [base.nodes[0], { ...base.nodes[1], kind: "exit" }] })).not.toBe(structureSignature(base));
  });

  it("CHANGES when an edge is added, repointed, or rebranched", () => {
    expect(structureSignature({ ...base, edges: [] })).not.toBe(structureSignature(base));
    expect(structureSignature({ ...base, edges: [{ id: "x1", from: "t", to: "nowhere" }] })).not.toBe(structureSignature(base));
    expect(structureSignature({ ...base, edges: [{ id: "x1", from: "t", to: "e1", branch: "no" }] })).not.toBe(structureSignature(base));
  });
});

describe("nodeData — primitives only, which is what makes the comparator valid", () => {
  it("carries no functions and no nested objects", () => {
    const data = nodeData(emailNode("e1", { delay: "1 day later", status: "draft" }), {
      position: 2, orphan: false, generating: false, flowType: "welcome",
    });
    for (const [k, v] of Object.entries(data)) {
      expect(["string", "number", "boolean"], `${k} is ${typeof v}`).toContain(typeof v);
    }
  });

  it("flattens each kind's own label into the same field", () => {
    const trigger = nodeData({ id: "t", kind: "trigger", x: 0, y: 0, trigger: { label: "fires" } }, opts());
    const split = nodeData({ id: "s", kind: "split", x: 0, y: 0, split: { label: "Opened?", yes_label: "y", no_label: "n" } }, opts());
    const delay = nodeData({ id: "d", kind: "delay", x: 0, y: 0, delay: { label: "Wait 2 days" } }, opts());
    const exit = nodeData({ id: "x", kind: "exit", x: 0, y: 0, exit: { label: "Done" } }, opts());
    expect([trigger.label, split.label, delay.label, exit.label]).toEqual(["fires", "Opened?", "Wait 2 days", "Done"]);
    expect([split.yesLabel, split.noLabel]).toEqual(["y", "n"]);
  });

  it("defaults every field, so a key never appears or disappears between renders", () => {
    // A changing key COUNT would make the shallow comparison unsound.
    const a = nodeData(emailNode("e1"), opts());
    const b = nodeData({ id: "x", kind: "exit", x: 0, y: 0, exit: { label: "Done" } }, opts());
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  });

  function opts() { return { position: 0, orphan: false, generating: false, flowType: "welcome" as const }; }
});

describe("nodePropsEqual — what makes a drag re-render one node", () => {
  const data = (patch: Partial<NodeData> = {}): NodeData => ({
    kind: "email", label: "", yesLabel: "", noLabel: "", job: "Welcome them",
    delay: "Immediately", status: "draft", position: 1, orphan: false,
    generating: false, flowType: "welcome", ...patch,
  });
  const props = (over: Record<string, unknown> = {}) =>
    ({ id: "e1", selected: false, dragging: false, data: data(), ...over }) as never;

  it("treats a FRESH data object with identical values as equal", () => {
    // This is the case the default memo comparison gets wrong: React Flow hands a
    // new `data` object every time the node list is rebuilt.
    expect(nodePropsEqual(props(), props({ data: data() }))).toBe(true);
  });

  it("ignores position entirely — position is not in data", () => {
    expect(nodePropsEqual(props(), props())).toBe(true);
  });

  it("catches every field the node actually shows", () => {
    for (const patch of [
      { job: "A different job" },
      { delay: "3 days later" },
      { status: "final" as const },
      { position: 2 },
      { orphan: true },
      { generating: true },
      { label: "Opened?" },
      { yesLabel: "y" },
      { noLabel: "n" },
    ]) {
      expect(nodePropsEqual(props(), props({ data: data(patch) })), JSON.stringify(patch)).toBe(false);
    }
  });

  it("catches selection and drag state", () => {
    expect(nodePropsEqual(props(), props({ selected: true }))).toBe(false);
    expect(nodePropsEqual(props(), props({ dragging: true }))).toBe(false);
    expect(nodePropsEqual(props(), props({ id: "e2" }))).toBe(false);
  });

  it("sameData notices a missing key rather than passing on a shorter object", () => {
    const full = data();
    const { generating: _dropped, ...partial } = full;
    expect(sameData(full, partial as NodeData)).toBe(false);
  });
});
