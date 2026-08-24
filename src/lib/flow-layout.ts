import dagre from "@dagrejs/dagre";
import type { FlowNode } from "./schemas";
import type { FlowGraph } from "./flow-graph";

// Auto-layout for the flow canvas — the "Tidy up" button (spec §4.2). Kept apart
// from flow-graph.ts so that module stays dependency-free: it runs at the storage
// read boundary (migration) and in unit tests, and has no business pulling a
// layout engine in with it.
//
// Deterministic: same graph in, same coordinates out. Orphans are laid out too —
// they are work in progress, not rubbish (spec §4.4) — in their own column to the
// right of the connected graph rather than piled on the origin.

/** Rendered node footprint, in canvas units. Dagre needs real sizes or the
 * spacing comes out wrong; these match the widths in FlowCanvas's node CSS. */
const SIZE: Record<FlowNode["kind"], { width: number; height: number }> = {
  trigger: { width: 210, height: 64 },
  email: { width: 220, height: 96 },
  split: { width: 220, height: 76 },
  delay: { width: 150, height: 44 },
  exit: { width: 180, height: 52 },
};

export interface LayoutOptions {
  /** Vertical gap between ranks. */
  rankSep?: number;
  /** Horizontal gap between siblings. */
  nodeSep?: number;
}

function runDagre(
  nodes: FlowNode[],
  edges: { from: string; to: string }[],
  opts: LayoutOptions,
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", ranksep: opts.rankSep ?? 70, nodesep: opts.nodeSep ?? 60, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    const size = SIZE[n.kind] ?? SIZE.email;
    g.setNode(n.id, { width: size.width, height: size.height });
  }
  const present = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (present.has(e.from) && present.has(e.to)) g.setEdge(e.from, e.to);
  }

  dagre.layout(g);

  const out = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const laid = g.node(n.id);
    if (!laid) continue;
    // Dagre positions by CENTRE; React Flow positions by TOP-LEFT.
    const size = SIZE[n.kind] ?? SIZE.email;
    out.set(n.id, { x: Math.round(laid.x - size.width / 2), y: Math.round(laid.y - size.height / 2) });
  }
  return out;
}

/**
 * Re-lay the whole graph out top-down. Returns a NEW graph; the input is untouched.
 * This is both the escape hatch for a canvas the user has tangled and the layout
 * engine for any flow that has never been arranged.
 */
export function tidyLayout(graph: FlowGraph, opts: LayoutOptions = {}): FlowGraph {
  if (!graph.nodes.length) return graph;

  // Connected component containing the trigger vs. everything else. Laying them
  // out together lets dagre stack unrelated fragments into the same column, which
  // reads as a structure the user never built.
  const connected = new Set<string>();
  const trigger = graph.nodes.find((n) => n.kind === "trigger");
  if (trigger) {
    // Undirected reachability, so a half-built branch hanging off a real node
    // still counts as connected.
    const adjacency = new Map<string, string[]>();
    for (const e of graph.edges) {
      adjacency.set(e.from, [...(adjacency.get(e.from) ?? []), e.to]);
      adjacency.set(e.to, [...(adjacency.get(e.to) ?? []), e.from]);
    }
    const stack = [trigger.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (connected.has(id)) continue;
      connected.add(id);
      for (const next of adjacency.get(id) ?? []) stack.push(next);
    }
  }

  const main = graph.nodes.filter((n) => connected.has(n.id));
  const rest = graph.nodes.filter((n) => !connected.has(n.id));

  const mainPos = runDagre(main, graph.edges, opts);
  const mainRight = main.reduce((max, n) => {
    const p = mainPos.get(n.id);
    const w = (SIZE[n.kind] ?? SIZE.email).width;
    return p ? Math.max(max, p.x + w) : max;
  }, 0);

  // Orphans: their own dagre pass, shifted clear of the main graph.
  const restPos = rest.length ? runDagre(rest, graph.edges, opts) : new Map();
  const offsetX = rest.length ? mainRight + 120 : 0;

  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      const p = mainPos.get(n.id);
      if (p) return { ...n, x: p.x, y: p.y };
      const r = restPos.get(n.id);
      return r ? { ...n, x: r.x + offsetX, y: r.y } : n;
    }),
  };
}

/** True when nothing has ever been arranged — every node still sits on the
 * origin. Used to auto-tidy a graph the first time it is opened. */
export function needsLayout(graph: FlowGraph): boolean {
  if (graph.nodes.length < 2) return false;
  return graph.nodes.every((n) => n.x === 0 && n.y === 0);
}
