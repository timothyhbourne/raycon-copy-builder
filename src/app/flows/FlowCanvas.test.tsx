import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";
import FlowCanvas, { EmptyCanvasPrompt } from "./FlowCanvas";
import type { FlowGraph } from "@/lib/flow-graph";
import { insertSplit } from "@/lib/flow-graph";

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
  <FlowCanvas graph={graph} flowType="welcome" flowId="f1" selectedNodeId={selected} generatingNodeId={null} {...actions} />,
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
