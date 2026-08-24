import { describe, it, expect } from "vitest";
import { tidyLayout, needsLayout } from "./flow-layout";
import { insertSplit, migrateLinearFlowToGraph, type FlowGraph } from "./flow-graph";
import type { Flow, FlowNode } from "./schemas";

function ids(prefix = "n") { let i = 0; return () => `${prefix}${++i}`; }

const emailNode = (id: string): FlowNode => ({
  id, kind: "email", x: 0, y: 0, email: { id, job: `Job ${id}`, section_structure: [], status: "empty" },
});

const linear = (): FlowGraph => ({
  nodes: [
    { id: "t", kind: "trigger", x: 0, y: 0, trigger: { label: "fires" } },
    emailNode("e1"), emailNode("e2"), emailNode("e3"),
  ],
  edges: [
    { id: "x1", from: "t", to: "e1" },
    { id: "x2", from: "e1", to: "e2" },
    { id: "x3", from: "e2", to: "e3" },
  ],
});

const legacyFlow = (): Flow => ({
  id: "f", name: "F", type: "welcome", channel: "email", trigger: "fires",
  emails: [
    { id: "a", position: 1, job: "1", section_structure: [], status: "empty" },
    { id: "b", position: 2, job: "2", section_structure: [], status: "empty" },
  ],
  splits: [{ id: "sp", after_email_position: 1, label: "Opened?", yes_label: "y", no_label: "n" }],
  created_at: "x", updated_at: "y",
});

describe("tidyLayout", () => {
  it("lays a chain out strictly top-down", () => {
    const g = tidyLayout(linear());
    const y = (id: string) => g.nodes.find((n) => n.id === id)!.y;
    expect(y("t")).toBeLessThan(y("e1"));
    expect(y("e1")).toBeLessThan(y("e2"));
    expect(y("e2")).toBeLessThan(y("e3"));
  });

  it("puts a split's two branches side by side, at the same depth", () => {
    const { graph } = insertSplit(linear(), "e1", ids("s"));
    const g = tidyLayout(graph);
    const split = g.nodes.find((n) => n.kind === "split")!;
    const branchTargets = g.edges.filter((e) => e.from === split.id).map((e) => g.nodes.find((n) => n.id === e.to)!);
    expect(branchTargets).toHaveLength(2);
    // Different columns, and both below the split.
    expect(branchTargets[0].x).not.toBe(branchTargets[1].x);
    for (const t of branchTargets) expect(t.y).toBeGreaterThan(split.y);
  });

  it("is deterministic — the same graph lays out identically twice", () => {
    expect(tidyLayout(linear()).nodes).toEqual(tidyLayout(linear()).nodes);
  });

  it("does not mutate the graph it was given", () => {
    const g = linear();
    const before = JSON.stringify(g);
    tidyLayout(g);
    expect(JSON.stringify(g)).toBe(before);
  });

  it("keeps every node and edge — layout never drops structure", () => {
    const g = tidyLayout(linear());
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["e1", "e2", "e3", "t"]);
    expect(g.edges).toHaveLength(3);
  });

  it("parks a disconnected node clear of the connected graph, not on top of it", () => {
    const g = linear();
    g.nodes.push(emailNode("orphan"));
    const laid = tidyLayout(g);
    const orphan = laid.nodes.find((n) => n.id === "orphan")!;
    const mainRight = Math.max(...laid.nodes.filter((n) => n.id !== "orphan").map((n) => n.x));
    expect(orphan.x).toBeGreaterThan(mainRight);
  });

  it("handles a graph with no trigger without throwing", () => {
    const g: FlowGraph = { nodes: [emailNode("e1"), emailNode("e2")], edges: [{ id: "x", from: "e1", to: "e2" }] };
    expect(() => tidyLayout(g)).not.toThrow();
    expect(tidyLayout(g).nodes).toHaveLength(2);
  });

  it("handles an empty graph", () => {
    expect(tidyLayout({ nodes: [], edges: [] })).toEqual({ nodes: [], edges: [] });
  });

  it("reads a 3-deep branch without collapsing the levels", () => {
    // trigger → e1 → split → no → e2 → split2 → no → e3
    let g = linear();
    const { graph: g1, nodeId: s1 } = insertSplit(g, "e1", ids("a"));
    g = g1;
    const { graph: g2 } = insertSplit(g, g.edges.find((e) => e.from === s1 && e.branch === "no")!.to, ids("b"));
    const laid = tidyLayout(g2);
    const depths = new Set(laid.nodes.map((n) => n.y));
    expect(depths.size).toBeGreaterThanOrEqual(4);
  });
});

describe("needsLayout", () => {
  it("is true for a graph where nothing has been placed", () => {
    expect(needsLayout({
      nodes: [emailNode("a"), emailNode("b")],
      edges: [],
    })).toBe(true);
  });

  it("is false once anything has a position", () => {
    expect(needsLayout(tidyLayout(linear()))).toBe(false);
  });

  it("is false for a graph too small to arrange", () => {
    expect(needsLayout({ nodes: [emailNode("a")], edges: [] })).toBe(false);
    expect(needsLayout({ nodes: [], edges: [] })).toBe(false);
  });

  it("is false for a freshly migrated flow — migration already places nodes", () => {
    expect(needsLayout(migrateLinearFlowToGraph(legacyFlow(), ids("m")))).toBe(false);
  });
});
