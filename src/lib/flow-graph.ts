import type {
  Flow, FlowEdge, FlowEmail, FlowNode, FlowNodeKind, FlowSplit,
} from "./schemas";

// The flow GRAPH: every structural rule about a flow, as pure functions
// (docs/FLOW_CANVAS_REBUILD_SPEC.md §3). No React, no network, no fs — the same
// discipline as campaign-sections.ts, and for the same reason: the canvas has to
// be able to reject an illegal edit BEFORE it renders it, and that judgement has
// to be unit-testable without a browser.
//
// Every mutator is pure: it takes a graph and returns a new one, or returns a
// typed failure. Nothing here mutates its input.
//
// New ids are supplied by the caller (`mkId`), never generated here, so a test
// can pin them and a caller can use the app's nanoid.

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** Canvas spacing used when a node is auto-placed (the user can drag afterwards,
 * and Tidy up re-lays the whole graph out with dagre — see lib/flow-layout.ts). */
export const NODE_STEP_Y = 140;
export const NODE_STEP_X = 260;

export type MkId = () => string;

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export function nodeById(g: FlowGraph, id: string | null | undefined): FlowNode | undefined {
  return id ? g.nodes.find((n) => n.id === id) : undefined;
}

export function outEdges(g: FlowGraph, nodeId: string): FlowEdge[] {
  return g.edges.filter((e) => e.from === nodeId);
}

export function inEdges(g: FlowGraph, nodeId: string): FlowEdge[] {
  return g.edges.filter((e) => e.to === nodeId);
}

export function triggerNode(g: FlowGraph): FlowNode | undefined {
  return g.nodes.find((n) => n.kind === "trigger");
}

/** The node one step on from here. `branch` picks a side when leaving a split. */
export function nextNode(g: FlowGraph, nodeId: string, branch?: "yes" | "no"): FlowNode | undefined {
  const edges = outEdges(g, nodeId);
  const edge = branch ? edges.find((e) => e.branch === branch) : edges[0];
  return edge ? nodeById(g, edge.to) : undefined;
}

/** Yes-edge first, then no, then unlabelled — so a traversal is deterministic. */
function orderedOut(g: FlowGraph, nodeId: string): FlowEdge[] {
  const rank = (e: FlowEdge) => (e.branch === "yes" ? 0 : e.branch === "no" ? 1 : 2);
  return outEdges(g, nodeId).sort((a, b) => rank(a) - rank(b));
}

/** Every node downstream of `nodeId`, excluding it. Cycle-safe. */
export function descendants(g: FlowGraph, nodeId: string): string[] {
  const seen = new Set<string>();
  const stack = outEdges(g, nodeId).map((e) => e.to);
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of outEdges(g, id)) stack.push(e.to);
  }
  seen.delete(nodeId);
  return [...seen];
}

/** Every node reachable from the trigger. */
export function reachable(g: FlowGraph): Set<string> {
  const trigger = triggerNode(g);
  if (!trigger) return new Set();
  return new Set([trigger.id, ...descendants(g, trigger.id)]);
}

/**
 * Nodes with no path from the trigger. Surfaced visually rather than deleted: an
 * orphan is almost always work in progress (spec §3), and silently removing
 * someone's half-built branch is the worst possible reading of it.
 */
export function orphanNodes(g: FlowGraph): FlowNode[] {
  const live = reachable(g);
  return g.nodes.filter((n) => !live.has(n.id));
}

/**
 * Email nodes in traversal order — depth-first from the trigger, `yes` before
 * `no`. This is what gives an email its 1-based "position" now that there is no
 * position field. Orphaned email nodes come last, in array order, so a derived
 * `emails` array never loses one.
 */
export function emailNodesInOrder(g: FlowGraph): FlowNode[] {
  const out: FlowNode[] = [];
  const seen = new Set<string>();
  const trigger = triggerNode(g);

  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = nodeById(g, id);
    if (node?.kind === "email") out.push(node);
    for (const e of orderedOut(g, id)) walk(e.to);
  };
  if (trigger) walk(trigger.id);

  for (const n of g.nodes) {
    if (n.kind === "email" && !seen.has(n.id)) out.push(n);
  }
  return out;
}

/** 1-based position of an email node among the flow's emails; 0 when unknown. */
export function positionOf(g: FlowGraph, nodeId: string): number {
  return emailNodesInOrder(g).findIndex((n) => n.id === nodeId) + 1;
}

/**
 * The ordered nodes from the trigger to `nodeId`, following whichever branches
 * were actually taken. Empty when the node is unreachable (an orphan) — callers
 * treat that as "no path context yet", which is the truth.
 */
export function linearizePath(g: FlowGraph, nodeId: string): FlowNode[] {
  const trigger = triggerNode(g);
  if (!trigger) return [];
  const path: FlowNode[] = [];
  const seen = new Set<string>();

  const walk = (id: string): boolean => {
    if (seen.has(id)) return false;   // cycle guard
    seen.add(id);
    const node = nodeById(g, id);
    if (!node) return false;
    path.push(node);
    if (id === nodeId) return true;
    for (const e of orderedOut(g, id)) {
      if (walk(e.to)) return true;
    }
    path.pop();
    return false;
  };

  return walk(trigger.id) ? path : [];
}

/**
 * The LAST split on the path to this node, and which way the path went out of it.
 * A node is on the No branch whether it hangs directly off the split or three
 * emails further down it, so reading only the inbound edge is not enough — that
 * reported "on the main path" for every node past the first on a branch.
 */
function branchOfPath(g: FlowGraph, path: FlowNode[], nodeId: string):
  { branch: "yes" | "no"; split: FlowNode } | null {
  const stop = path.findIndex((n) => n.id === nodeId);
  const upto = stop === -1 ? path : path.slice(0, stop + 1);
  let found: { branch: "yes" | "no"; split: FlowNode } | null = null;
  for (let i = 0; i < upto.length - 1; i++) {
    const node = upto[i];
    if (node.kind !== "split") continue;
    const taken = inEdges(g, upto[i + 1].id).find((e) => e.from === node.id)?.branch;
    if (taken) found = { branch: taken, split: node };
  }
  return found;
}

/**
 * A human-readable description of the path to this email, INCLUDING the branch
 * conditions that lead here. This is the copy-quality half of the graph work: an
 * email on the "did not open" branch must not be written as though the reader
 * read the last one, and until now the flow brain had no way to know the
 * difference.
 *
 * Emails are numbered ALONG THE PATH, not flow-wide. On a branched graph the
 * flow-wide index is meaningless to the reader's experience — someone on the No
 * branch has received two emails, not "email 4" — and mixing the two numbering
 * schemes in one paragraph is worse than either.
 */
/** Trim a trailing sentence-ender so we don't emit "…was: Welcome them warmly..". */
function unpunctuated(s: string): string {
  return s.replace(/[.!?]+$/, "");
}

export function pathContext(g: FlowGraph, nodeId: string): string {
  const path = linearizePath(g, nodeId);
  if (!path.length) {
    return "This email is not connected to the flow yet, so it has no path — write it as a standalone message.";
  }
  const lines: string[] = [];
  let received = 0;      // emails BEFORE this one, along this path
  let selfIndex = 0;     // this email's own 1-based index along the path

  for (let i = 0; i < path.length; i++) {
    const node = path[i];
    const next = path[i + 1];
    if (node.kind === "trigger") {
      lines.push(`Trigger: ${node.trigger?.label?.trim() || "the flow fires"}.`);
    } else if (node.kind === "email") {
      if (node.id === nodeId) { selfIndex = received + 1; break; }
      received++;
      const job = unpunctuated(node.email?.job?.trim() ?? "");
      lines.push(`Then they received email ${received} on this path${job ? `, whose job was: ${job}` : ""}.`);
    } else if (node.kind === "delay") {
      lines.push(`Then a wait: ${node.delay?.label?.trim() || "a pause"}.`);
    } else if (node.kind === "split") {
      // Which way the path went out of this split is on the edge into the NEXT
      // node along it.
      const taken = next ? inEdges(g, next.id).find((e) => e.from === node.id)?.branch : undefined;
      const condition = node.split?.label?.trim() || "a condition";
      const label = taken === "yes" ? node.split?.yes_label?.trim() : node.split?.no_label?.trim();
      if (taken) {
        lines.push(`Branch — "${condition}" → ${taken.toUpperCase()}${label ? ` (${label})` : ""}.`);
      } else {
        lines.push(`Branch — "${condition}".`);
      }
    }
  }

  const self = nodeById(g, nodeId);
  if (self?.email?.delay?.trim()) lines.push(`This email fires ${unpunctuated(self.email.delay.trim())}.`);

  const branch = branchOfPath(g, path, nodeId);
  lines.push(branch
    ? `This is email ${selfIndex} on this path, and it sits on the "${branch.split.split?.label?.trim() || "branch"}" → ${branch.branch.toUpperCase()} branch.`
    : `This is email ${selfIndex} on this path, which is the main path — no branch has been taken.`);
  return lines.join("\n");
}

/**
 * The emails that precede this one ON ITS OWN PATH. Sibling context used to come
 * from `flow.emails` — every email in the flow — which on a branched graph feeds
 * an email on the Yes branch the context of the No branch, i.e. things the reader
 * demonstrably never received.
 */
export function pathSiblings(g: FlowGraph, nodeId: string): { position: number; node: FlowNode }[] {
  const path = linearizePath(g, nodeId);
  const out: { position: number; node: FlowNode }[] = [];
  let position = 0;
  for (const node of path) {
    if (node.kind !== "email") continue;
    position++;
    if (node.id === nodeId) break;
    out.push({ position, node });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validating
// ---------------------------------------------------------------------------

export interface GraphProblem {
  nodeId?: string;
  message: string;
}

/** The invariants from spec §3. Reported, not thrown: the canvas shows them. */
export function validateGraph(g: FlowGraph): GraphProblem[] {
  const problems: GraphProblem[] = [];
  const triggers = g.nodes.filter((n) => n.kind === "trigger");

  if (triggers.length === 0) problems.push({ message: "This flow has no trigger." });
  if (triggers.length > 1) problems.push({ message: `This flow has ${triggers.length} triggers; it must have exactly one.` });
  for (const t of triggers) {
    if (inEdges(g, t.id).length) problems.push({ nodeId: t.id, message: "The trigger cannot have anything leading into it." });
  }

  for (const n of g.nodes) {
    const out = outEdges(g, n.id);
    if (n.kind === "split") {
      const yes = out.filter((e) => e.branch === "yes").length;
      const no = out.filter((e) => e.branch === "no").length;
      if (yes !== 1 || no !== 1) {
        problems.push({ nodeId: n.id, message: `A split needs exactly one Yes and one No branch (has ${yes} Yes, ${no} No).` });
      }
    } else if (out.length > 1) {
      problems.push({ nodeId: n.id, message: "Only a split can lead to more than one next step." });
    }
  }

  for (const e of g.edges) {
    if (!nodeById(g, e.from) || !nodeById(g, e.to)) {
      problems.push({ message: "An edge points at a node that no longer exists." });
    }
  }

  if (hasCycle(g)) problems.push({ message: "This flow loops back on itself." });

  return problems;
}

/** True when the graph already contains a cycle. */
export function hasCycle(g: FlowGraph): boolean {
  const state = new Map<string, 0 | 1 | 2>();   // 0 unseen, 1 on stack, 2 done
  const visit = (id: string): boolean => {
    const s = state.get(id) ?? 0;
    if (s === 1) return true;
    if (s === 2) return false;
    state.set(id, 1);
    for (const e of outEdges(g, id)) {
      if (visit(e.to)) return true;
    }
    state.set(id, 2);
    return false;
  };
  return g.nodes.some((n) => visit(n.id));
}

/** Would connecting from → to create a cycle (including a self-loop)? */
export function wouldCycle(g: FlowGraph, from: string, to: string): boolean {
  if (from === to) return true;
  return descendants(g, to).includes(from) || to === from;
}

// ---------------------------------------------------------------------------
// Mutating — every one of these returns a NEW graph
// ---------------------------------------------------------------------------

export function updateNode(g: FlowGraph, id: string, patch: Partial<FlowNode>): FlowGraph {
  return { ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}

export function moveNode(g: FlowGraph, id: string, x: number, y: number): FlowGraph {
  return updateNode(g, id, { x, y });
}

export function updateSplitFields(
  g: FlowGraph,
  id: string,
  fields: Partial<{ label: string; yes_label: string; no_label: string }>,
): FlowGraph {
  const node = nodeById(g, id);
  if (!node || node.kind !== "split") return g;
  return updateNode(g, id, { split: { label: "", ...node.split, ...fields } });
}

export function updateEmailNode(g: FlowGraph, id: string, patch: Partial<FlowNode["email"]>): FlowGraph {
  const node = nodeById(g, id);
  if (!node || node.kind !== "email" || !node.email) return g;
  return updateNode(g, id, { email: { ...node.email, ...patch } });
}

export type ConnectFailure = "cycle" | "missing" | "occupied" | "split_needs_branch";

/**
 * Connect two nodes. Returns a discriminated result rather than throwing or
 * silently dropping the edge: a rejected connection has to be able to say WHY,
 * because the canvas turns that into a toast (spec §3, "rejected with a toast,
 * not silently dropped").
 */
export function connect(
  g: FlowGraph,
  from: string,
  to: string,
  mkId: MkId,
  branch?: "yes" | "no",
): { ok: true; graph: FlowGraph } | { ok: false; reason: ConnectFailure } {
  const src = nodeById(g, from);
  const dst = nodeById(g, to);
  if (!src || !dst || dst.kind === "trigger") return { ok: false, reason: "missing" };
  if (wouldCycle(g, from, to)) return { ok: false, reason: "cycle" };

  if (src.kind === "split") {
    if (!branch) return { ok: false, reason: "split_needs_branch" };
    const existing = outEdges(g, from).find((e) => e.branch === branch);
    const edges = existing
      ? g.edges.map((e) => (e.id === existing.id ? { ...e, to } : e))
      : [...g.edges, { id: mkId(), from, to, branch }];
    return { ok: true, graph: { ...g, edges } };
  }

  const existing = outEdges(g, from)[0];
  const edges = existing
    ? g.edges.map((e) => (e.id === existing.id ? { ...e, to } : e))
    : [...g.edges, { id: mkId(), from, to }];
  return { ok: true, graph: { ...g, edges } };
}

/** Repoint one existing edge at a new target. Same rejection contract. */
export function reconnect(
  g: FlowGraph,
  edgeId: string,
  to: string,
): { ok: true; graph: FlowGraph } | { ok: false; reason: ConnectFailure } {
  const edge = g.edges.find((e) => e.id === edgeId);
  const dst = nodeById(g, to);
  if (!edge || !dst || dst.kind === "trigger") return { ok: false, reason: "missing" };
  // Test the cycle against the graph WITHOUT this edge, so repointing an edge
  // that is itself part of the path can't false-positive.
  const without: FlowGraph = { ...g, edges: g.edges.filter((e) => e.id !== edgeId) };
  if (wouldCycle(without, edge.from, to)) return { ok: false, reason: "cycle" };
  return { ok: true, graph: { ...g, edges: g.edges.map((e) => (e.id === edgeId ? { ...e, to } : e)) } };
}

function placeBelow(parent: FlowNode | undefined, branch?: "yes" | "no"): { x: number; y: number } {
  const x = parent?.x ?? 0;
  const y = (parent?.y ?? 0) + NODE_STEP_Y;
  // A new node on the `no` branch is offset sideways so a split immediately reads
  // as two paths without the user arranging anything (spec §4.2).
  if (branch === "no") return { x: x + NODE_STEP_X, y };
  if (branch === "yes") return { x: x - NODE_STEP_X / 2, y };
  return { x, y };
}

/**
 * Insert a new node after `parentId`, splicing it in FRONT of whatever the parent
 * already pointed at. Splicing (rather than replacing) is what makes "+" on a
 * node an insert rather than a destructive overwrite.
 */
export function insertAfter(
  g: FlowGraph,
  parentId: string,
  kind: FlowNodeKind,
  mkId: MkId,
  opts: { branch?: "yes" | "no"; node?: Partial<FlowNode> } = {},
): { graph: FlowGraph; nodeId: string } {
  const parent = nodeById(g, parentId);
  const id = mkId();
  const { x, y } = placeBelow(parent, opts.branch);
  const node: FlowNode = { id, kind, x, y, ...opts.node };

  // What the parent pointed at on this branch, if anything — the new node takes
  // its place and then points at it.
  const existing = parent?.kind === "split"
    ? outEdges(g, parentId).find((e) => e.branch === opts.branch)
    : outEdges(g, parentId)[0];

  let edges = g.edges;
  if (existing) {
    edges = edges.map((e) => (e.id === existing.id ? { ...e, to: id } : e));
    edges = [...edges, { id: mkId(), from: id, to: existing.to }];
  } else if (parent) {
    edges = [...edges, { id: mkId(), from: parentId, to: id, ...(opts.branch ? { branch: opts.branch } : {}) }];
  }

  return { graph: { nodes: [...g.nodes, node], edges }, nodeId: id };
}

/**
 * A split arrives complete: the node plus an `exit` node on each branch, so it is
 * never left in an invalid one-outbound state (spec §4.4). Whatever the parent
 * pointed at stays on the YES branch, since that is the "condition held, carry
 * on" reading.
 */
export function insertSplit(
  g: FlowGraph,
  parentId: string,
  mkId: MkId,
  split: { label: string; yes_label?: string; no_label?: string } = { label: "" },
  parentBranch?: "yes" | "no",
): { graph: FlowGraph; nodeId: string } {
  const parent = nodeById(g, parentId);
  const splitId = mkId();
  const { x, y } = placeBelow(parent, parentBranch);
  const splitNode: FlowNode = { id: splitId, kind: "split", x, y, split };

  const existing = parent?.kind === "split"
    ? outEdges(g, parentId).find((e) => e.branch === parentBranch)
    : outEdges(g, parentId)[0];

  let edges = g.edges;
  if (existing) edges = edges.map((e) => (e.id === existing.id ? { ...e, to: splitId } : e));
  else if (parent) edges = [...edges, { id: mkId(), from: parentId, to: splitId, ...(parentBranch ? { branch: parentBranch } : {}) }];

  const nodes = [...g.nodes, splitNode];

  // YES keeps the downstream the parent already had; NO gets a fresh exit.
  if (existing) {
    edges = [...edges, { id: mkId(), from: splitId, to: existing.to, branch: "yes" as const }];
  } else {
    const yesExit: FlowNode = { id: mkId(), kind: "exit", ...placeBelow(splitNode, "yes"), exit: { label: split.yes_label?.trim() || "Yes — ends here" } };
    nodes.push(yesExit);
    edges = [...edges, { id: mkId(), from: splitId, to: yesExit.id, branch: "yes" as const }];
  }
  const noExit: FlowNode = { id: mkId(), kind: "exit", ...placeBelow(splitNode, "no"), exit: { label: split.no_label?.trim() || "No — ends here" } };
  nodes.push(noExit);
  edges = [...edges, { id: mkId(), from: splitId, to: noExit.id, branch: "no" as const }];

  return { graph: { nodes, edges }, nodeId: splitId };
}

/**
 * What deleting a node would take with it. The canvas asks this BEFORE it acts,
 * so a confirm can name how many emails are about to go (spec §4.4 / §7).
 */
export function deletionImpact(g: FlowGraph, id: string): { removed: string[]; emailCount: number; reconnects: boolean } {
  const node = nodeById(g, id);
  if (!node) return { removed: [], emailCount: 0, reconnects: false };
  // A split takes its whole downstream subtree; anything else takes only itself,
  // and its inbound edge is reconnected to its outbound target when that is
  // unambiguous (exactly one of each).
  const removed = node.kind === "split" ? [id, ...descendants(g, id)] : [id];
  const emailCount = removed.filter((r) => nodeById(g, r)?.kind === "email").length;
  const reconnects = node.kind !== "split" && inEdges(g, id).length === 1 && outEdges(g, id).length === 1;
  return { removed, emailCount, reconnects };
}

/** Delete a node (and, for a split, its downstream subtree). Never deletes the
 * trigger — a flow without one is not a flow. */
export function deleteNode(g: FlowGraph, id: string): { graph: FlowGraph; removed: string[] } {
  const node = nodeById(g, id);
  if (!node || node.kind === "trigger") return { graph: g, removed: [] };

  const { removed, reconnects } = deletionImpact(g, id);
  const gone = new Set(removed);

  let edges = g.edges;
  if (reconnects) {
    const inbound = inEdges(g, id)[0];
    const outbound = outEdges(g, id)[0];
    edges = edges.map((e) => (e.id === inbound.id ? { ...e, to: outbound.to } : e));
  }
  edges = edges.filter((e) => !gone.has(e.from) && !gone.has(e.to));

  return { graph: { nodes: g.nodes.filter((n) => !gone.has(n.id)), edges }, removed };
}

// ---------------------------------------------------------------------------
// Migration (spec §6) and the derived legacy shape
// ---------------------------------------------------------------------------

/**
 * Deterministic top-down coordinates for a freshly migrated graph. Real layout is
 * dagre's job (lib/flow-layout.ts, behind "Tidy up"), but that pulls a dependency
 * the storage read boundary has no business importing — and a migrated flow is
 * linear plus exits, which lays out fine by hand.
 */
function layoutMigrated(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  const g: FlowGraph = { nodes, edges };
  const depth = new Map<string, number>();
  const lane = new Map<string, number>();
  const trigger = triggerNode(g);
  if (!trigger) return nodes;

  const walk = (id: string, d: number, l: number) => {
    // Keep the DEEPEST placement so a node with two parents sits below both.
    if ((depth.get(id) ?? -1) >= d) return;
    depth.set(id, d);
    lane.set(id, l);
    for (const e of orderedOut(g, id)) {
      walk(e.to, d + 1, e.branch === "no" ? l + 1 : e.branch === "yes" ? l : l);
    }
  };
  walk(trigger.id, 0, 0);

  let orphanRow = 0;
  return nodes.map((n) => {
    const d = depth.get(n.id);
    if (d == null) {
      // Orphans park in a column to the right rather than piling on the origin.
      return { ...n, x: NODE_STEP_X * 3, y: NODE_STEP_Y * orphanRow++ };
    }
    return { ...n, x: (lane.get(n.id) ?? 0) * NODE_STEP_X, y: d * NODE_STEP_Y };
  });
}

/**
 * Turn a pre-rebuild linear flow into a graph. Deterministic and lossless:
 *
 *  - one trigger node from `flow.trigger` (or the caller's playbook default),
 *  - one email node per FlowEmail in `position` order, chained,
 *  - each FlowSplit becomes a split node after the email at
 *    `after_email_position`, with an `exit` node on each branch carrying
 *    `yes_label` / `no_label` as its text.
 *
 * That last translation is the honest one: the old labels DESCRIBED an outcome
 * ("they bought — stop emailing"), they never pointed at anything. An exit node
 * says exactly that, and the user can replace either side with real emails.
 *
 * Email node ids are the FlowEmail ids, unchanged — the planner addresses a flow
 * email as "<flowId>::<emailId>" (lib/flow-email-id.ts), so a migration that
 * minted new ids would break every existing planner link.
 */
export function migrateLinearFlowToGraph(
  flow: Pick<Flow, "trigger" | "emails" | "splits">,
  mkId: MkId,
  fallbackTrigger = "The flow fires",
): FlowGraph {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  const trigger: FlowNode = {
    id: mkId(), kind: "trigger", x: 0, y: 0,
    trigger: { label: flow.trigger?.trim() || fallbackTrigger },
  };
  nodes.push(trigger);

  const emails = [...(flow.emails ?? [])].sort((a, b) => a.position - b.position);
  // Where each email's node ended up, keyed by its old integer position, so
  // splits can be anchored after the right one.
  const nodeAtPosition = new Map<number, string>();
  let tail = trigger.id;

  for (const email of emails) {
    const { position: _position, ...emailNode } = email;
    const node: FlowNode = { id: email.id, kind: "email", x: 0, y: 0, email: emailNode };
    nodes.push(node);
    edges.push({ id: mkId(), from: tail, to: node.id });
    nodeAtPosition.set(email.position, node.id);
    tail = node.id;
  }

  // Splits, deepest-anchored last so two splits after the same email chain rather
  // than both claiming the same parent.
  const splits = [...(flow.splits ?? [])]
    .filter((s) => s.label?.trim())
    .sort((a, b) => a.after_email_position - b.after_email_position);

  for (const split of splits) {
    // after_email_position 0 means "right after the trigger".
    const parentId = split.after_email_position === 0
      ? trigger.id
      : nodeAtPosition.get(split.after_email_position);
    if (!parentId) continue;   // anchored to an email that no longer exists

    const splitNode: FlowNode = {
      id: mkId(), kind: "split", x: 0, y: 0,
      split: { label: split.label, yes_label: split.yes_label, no_label: split.no_label },
    };
    nodes.push(splitNode);

    // Splice: whatever followed the parent now follows the split's YES branch.
    const following = edges.find((e) => e.from === parentId && !e.branch);
    if (following) {
      edges.push({ id: mkId(), from: splitNode.id, to: following.to, branch: "yes" });
      following.to = splitNode.id;
    } else {
      edges.push({ id: mkId(), from: parentId, to: splitNode.id });
      const yesExit: FlowNode = {
        id: mkId(), kind: "exit", x: 0, y: 0,
        exit: { label: split.yes_label?.trim() || "Yes" },
      };
      nodes.push(yesExit);
      edges.push({ id: mkId(), from: splitNode.id, to: yesExit.id, branch: "yes" });
    }

    const noExit: FlowNode = {
      id: mkId(), kind: "exit", x: 0, y: 0,
      exit: { label: split.no_label?.trim() || "No" },
    };
    nodes.push(noExit);
    edges.push({ id: mkId(), from: splitNode.id, to: noExit.id, branch: "no" });
  }

  return { nodes: layoutMigrated(nodes, edges), edges };
}

/** The flow's graph, migrating a legacy record on the way if it has none. Safe to
 * call repeatedly — an existing graph is returned untouched. */
export function ensureGraph(flow: Flow, mkId: MkId, fallbackTrigger?: string): FlowGraph {
  if (flow.nodes?.length) return { nodes: flow.nodes, edges: flow.edges ?? [] };
  return migrateLinearFlowToGraph(flow, mkId, fallbackTrigger);
}

/**
 * The legacy `emails` / `splits` arrays, DERIVED from the graph. Written alongside
 * the graph for one release as a rollback path (spec §6), and read by the handful
 * of consumers that predate the rebuild:
 *
 *  - `/api/flows` list meta (email_count / written_count) — lib/flows.ts
 *  - `loadFlowEmail` / `setFlowEmailPlannerRow`, which now prefer the graph and
 *    fall back to these
 *
 * A split's `after_email_position` is the position of the nearest email ABOVE it
 * on its own path, which is the only reading of a graph an integer anchor has.
 */
export function deriveLegacy(g: FlowGraph): { emails: FlowEmail[]; splits: FlowSplit[] } {
  const ordered = emailNodesInOrder(g);
  const positionByNode = new Map(ordered.map((n, i) => [n.id, i + 1]));

  const emails: FlowEmail[] = ordered.map((n, i) => ({
    ...(n.email as Omit<FlowEmail, "position">),
    id: n.id,
    position: i + 1,
  }));

  const splits: FlowSplit[] = g.nodes
    .filter((n) => n.kind === "split")
    .map((n) => {
      // Walk up the path to this split and take the last email on it.
      const path = linearizePath(g, n.id);
      let after = 0;
      for (const p of path) {
        if (p.kind === "email") after = positionByNode.get(p.id) ?? after;
      }
      return {
        id: n.id,
        after_email_position: after,
        label: n.split?.label ?? "",
        ...(n.split?.yes_label ? { yes_label: n.split.yes_label } : {}),
        ...(n.split?.no_label ? { no_label: n.split.no_label } : {}),
      };
    });

  return { emails, splits };
}

/** A flow with its graph AND the derived legacy arrays in step — the shape every
 * write should persist, so the rollback path never goes stale. */
export function withGraph(flow: Flow, g: FlowGraph): Flow {
  const { emails, splits } = deriveLegacy(g);
  return { ...flow, nodes: g.nodes, edges: g.edges, emails, splits };
}
