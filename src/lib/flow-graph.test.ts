import { describe, it, expect } from "vitest";
import {
  type FlowGraph,
  connect, deleteNode, deletionImpact, deriveLegacy, descendants, emailNodesInOrder,
  ensureGraph, hasCycle, insertAfter, insertSplit, linearizePath, migrateLinearFlowToGraph,
  nodeById, orphanNodes, pathContext, pathSiblings, positionOf, reachable, reconnect,
  updateEmailNode, updateSplitFields, validateGraph, withGraph, wouldCycle,
} from "./flow-graph";
import type { Flow, FlowEmail, FlowNode } from "./schemas";

// Deterministic ids so every assertion below can name the node it means.
function ids(prefix = "n") {
  let i = 0;
  return () => `${prefix}${++i}`;
}

const emailNode = (id: string, job: string, patch: Partial<FlowNode["email"]> = {}): FlowNode => ({
  id, kind: "email", x: 0, y: 0,
  email: { id, job, section_structure: [], status: "empty", ...patch },
});

/** trigger → e1 → split(opened?) → yes: e2 / no: e3 → (e3 → e4) */
function branched(): FlowGraph {
  return {
    nodes: [
      { id: "t", kind: "trigger", x: 0, y: 0, trigger: { label: "Someone subscribes" } },
      emailNode("e1", "Welcome them"),
      { id: "s", kind: "split", x: 0, y: 0, split: { label: "Opened Email 1?", yes_label: "engaged", no_label: "quiet" } },
      emailNode("e2", "Build on the open"),
      emailNode("e3", "Try a different angle"),
      emailNode("e4", "Last nudge"),
    ],
    edges: [
      { id: "x1", from: "t", to: "e1" },
      { id: "x2", from: "e1", to: "s" },
      { id: "x3", from: "s", to: "e2", branch: "yes" },
      { id: "x4", from: "s", to: "e3", branch: "no" },
      { id: "x5", from: "e3", to: "e4" },
    ],
  };
}

describe("reading the graph", () => {
  it("walks yes before no, so email order is deterministic", () => {
    expect(emailNodesInOrder(branched()).map((n) => n.id)).toEqual(["e1", "e2", "e3", "e4"]);
  });

  it("gives an email its position from the traversal, not a stored integer", () => {
    const g = branched();
    expect(positionOf(g, "e1")).toBe(1);
    expect(positionOf(g, "e3")).toBe(3);
    expect(positionOf(g, "nope")).toBe(0);
  });

  it("linearizes the path actually taken to a node on the No branch", () => {
    expect(linearizePath(branched(), "e4").map((n) => n.id)).toEqual(["t", "e1", "s", "e3", "e4"]);
  });

  it("returns no path for an unreachable node", () => {
    const g = branched();
    g.nodes.push(emailNode("orphan", "Detached"));
    expect(linearizePath(g, "orphan")).toEqual([]);
  });

  it("collects descendants without looping forever on a cycle", () => {
    const g = branched();
    g.edges.push({ id: "loop", from: "e4", to: "e1" });
    // Terminates, and excludes the start node itself even though the cycle leads
    // back to it — "downstream of" never includes the node you asked about.
    expect(descendants(g, "s").sort()).toEqual(["e1", "e2", "e3", "e4"]);
  });

  it("reports orphans instead of pretending they aren't there", () => {
    const g = branched();
    g.nodes.push(emailNode("orphan", "Detached"));
    expect(orphanNodes(g).map((n) => n.id)).toEqual(["orphan"]);
    expect(reachable(g).has("orphan")).toBe(false);
  });

  it("still counts an orphaned email in the order, at the end", () => {
    const g = branched();
    g.nodes.push(emailNode("orphan", "Detached"));
    expect(emailNodesInOrder(g).map((n) => n.id)).toEqual(["e1", "e2", "e3", "e4", "orphan"]);
  });
});

describe("path context for generation", () => {
  it("names the branch condition and which way it went", () => {
    const ctx = pathContext(branched(), "e4");
    expect(ctx).toContain("Trigger: Someone subscribes.");
    expect(ctx).toContain("Welcome them");
    expect(ctx).toContain('Branch — "Opened Email 1?" → NO (quiet)');
    // e3 is the 2nd email THIS reader received, even though it is 3rd flow-wide.
    // Numbering is path-relative throughout, never mixed with the flow-wide index.
    expect(ctx).toContain("Then they received email 2 on this path");
    expect(ctx).toContain("Try a different angle");
    expect(ctx).not.toContain("email 4");
  });

  it("says which branch the email sits on, even several steps down it", () => {
    // e2 hangs directly off the split; e4 is two steps down the No branch. Both
    // are on a branch — reading only the inbound edge called e4 "the main path".
    expect(pathContext(branched(), "e2")).toContain('"Opened Email 1?" → YES branch');
    expect(pathContext(branched(), "e4")).toContain('"Opened Email 1?" → NO branch');
    expect(pathContext(branched(), "e1")).toContain("main path");
    expect(pathContext(branched(), "e4")).not.toContain("main path");
  });

  it("numbers this email by its own place on the path", () => {
    expect(pathContext(branched(), "e1")).toContain("This is email 1 on this path");
    expect(pathContext(branched(), "e2")).toContain("This is email 2 on this path");
    expect(pathContext(branched(), "e4")).toContain("This is email 3 on this path");
  });

  it("does not double up sentence-enders on a job that already has one", () => {
    const g = updateEmailNode(branched(), "e1", { job: "Welcome them warmly." });
    const ctx = pathContext(g, "e2");
    expect(ctx).toContain("whose job was: Welcome them warmly.");
    expect(ctx).not.toContain("warmly..");
  });

  it("reports the email's own delay", () => {
    const g = updateEmailNode(branched(), "e4", { delay: "3 days later" });
    expect(pathContext(g, "e4")).toContain("This email fires 3 days later.");
  });

  it("describes a standalone delay node on the path", () => {
    const { graph } = insertAfter(branched(), "e1", "delay", ids("d"), { node: { delay: { label: "Wait 2 days" } } });
    expect(pathContext(graph, "e2")).toContain("Then a wait: Wait 2 days.");
  });

  it("siblings come only from the email's OWN path — never the other branch", () => {
    const yes = pathSiblings(branched(), "e2").map((s) => s.node.id);
    const no = pathSiblings(branched(), "e4").map((s) => s.node.id);
    expect(yes).toEqual(["e1"]);          // NOT e3/e4
    expect(no).toEqual(["e1", "e3"]);     // NOT e2
  });

  it("is honest about an unconnected email rather than inventing a path", () => {
    const g = branched();
    g.nodes.push(emailNode("orphan", "Detached"));
    expect(pathContext(g, "orphan")).toContain("not connected");
  });
});

describe("invariants", () => {
  it("a well-formed branched graph has no problems", () => {
    expect(validateGraph(branched())).toEqual([]);
  });

  it("catches a missing trigger and a second one", () => {
    const g = branched();
    expect(validateGraph({ ...g, nodes: g.nodes.filter((n) => n.kind !== "trigger") })
      .some((p) => p.message.includes("no trigger"))).toBe(true);
    expect(validateGraph({ ...g, nodes: [...g.nodes, { id: "t2", kind: "trigger", x: 0, y: 0 }] })
      .some((p) => p.message.includes("2 triggers"))).toBe(true);
  });

  it("catches anything leading INTO the trigger", () => {
    const g = branched();
    g.edges.push({ id: "bad", from: "e4", to: "t" });
    expect(validateGraph(g).some((p) => p.message.includes("cannot have anything leading into it"))).toBe(true);
  });

  it("catches a split that isn't exactly one Yes and one No", () => {
    const g = branched();
    const oneSided = { ...g, edges: g.edges.filter((e) => e.id !== "x4") };
    expect(validateGraph(oneSided).some((p) => p.nodeId === "s" && p.message.includes("exactly one Yes"))).toBe(true);
  });

  it("catches a non-split with two outbound edges", () => {
    const g = branched();
    g.edges.push({ id: "extra", from: "e1", to: "e2" });
    expect(validateGraph(g).some((p) => p.nodeId === "e1" && p.message.includes("Only a split"))).toBe(true);
  });

  it("catches a cycle", () => {
    const g = branched();
    g.edges.push({ id: "loop", from: "e4", to: "e1" });
    expect(hasCycle(g)).toBe(true);
    expect(validateGraph(g).some((p) => p.message.includes("loops back"))).toBe(true);
  });

  it("hasCycle is false on a diamond — two paths in, no loop", () => {
    const g = branched();
    g.edges.push({ id: "join", from: "e2", to: "e4" });
    expect(hasCycle(g)).toBe(false);
  });

  it("wouldCycle rejects a self-loop and a back-edge, and allows a forward one", () => {
    const g = branched();
    expect(wouldCycle(g, "e1", "e1")).toBe(true);
    expect(wouldCycle(g, "e4", "e1")).toBe(true);
    expect(wouldCycle(g, "e2", "e4")).toBe(false);
  });
});

describe("connecting", () => {
  it("rejects an edge that would cycle, with a reason", () => {
    const res = connect(branched(), "e4", "e1", ids());
    expect(res).toEqual({ ok: false, reason: "cycle" });
  });

  it("refuses to point anything at the trigger", () => {
    expect(connect(branched(), "e4", "t", ids())).toEqual({ ok: false, reason: "missing" });
  });

  it("a split edge must say which branch it is", () => {
    expect(connect(branched(), "s", "e4", ids())).toEqual({ ok: false, reason: "split_needs_branch" });
  });

  it("repoints rather than duplicating when the slot is taken", () => {
    const res = connect(branched(), "s", "e4", ids(), "no");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const noEdges = res.graph.edges.filter((e) => e.from === "s" && e.branch === "no");
    expect(noEdges).toHaveLength(1);
    expect(noEdges[0].to).toBe("e4");
    expect(validateGraph(res.graph)).toEqual([]);
  });

  it("reconnect doesn't false-positive on the edge it is moving", () => {
    // x5 (e3 → e4) repointed at e4 again must be allowed, not read as a cycle.
    const res = reconnect(branched(), "x5", "e4");
    expect(res.ok).toBe(true);
  });

  it("reconnect still rejects a genuine cycle", () => {
    expect(reconnect(branched(), "x5", "e1")).toEqual({ ok: false, reason: "cycle" });
  });
});

describe("inserting", () => {
  it("splices a node in front of what the parent already pointed at", () => {
    const { graph, nodeId } = insertAfter(branched(), "e1", "email", ids("new"), { node: { email: { id: "x", job: "New", section_structure: [], status: "empty" } } });
    // e1 → new → s, and the old e1 → s edge is gone.
    expect(graph.edges.find((e) => e.from === "e1")!.to).toBe(nodeId);
    expect(graph.edges.find((e) => e.from === nodeId)!.to).toBe("s");
    expect(validateGraph(graph)).toEqual([]);
    expect(emailNodesInOrder(graph).map((n) => n.id)).toEqual(["e1", nodeId, "e2", "e3", "e4"]);
  });

  it("appends when the parent is a leaf", () => {
    const { graph, nodeId } = insertAfter(branched(), "e4", "exit", ids("new"), { node: { exit: { label: "Done" } } });
    expect(graph.edges.filter((e) => e.from === "e4").map((e) => e.to)).toEqual([nodeId]);
    expect(validateGraph(graph)).toEqual([]);
  });

  it("inserting onto a split branch keeps that branch labelled", () => {
    const { graph, nodeId } = insertAfter(branched(), "s", "delay", ids("new"), { branch: "no", node: { delay: { label: "Wait 2 days" } } });
    const edge = graph.edges.find((e) => e.from === "s" && e.to === nodeId);
    expect(edge?.branch).toBe("no");
    expect(graph.edges.find((e) => e.from === nodeId)?.to).toBe("e3");
    expect(validateGraph(graph)).toEqual([]);
  });

  it("a new split arrives VALID — never one-sided", () => {
    const linear: FlowGraph = {
      nodes: [
        { id: "t", kind: "trigger", x: 0, y: 0, trigger: { label: "fires" } },
        emailNode("e1", "Hello"),
      ],
      edges: [{ id: "x1", from: "t", to: "e1" }],
    };
    const { graph, nodeId } = insertSplit(linear, "e1", ids("new"), { label: "Purchased?" });
    expect(validateGraph(graph)).toEqual([]);
    const out = graph.edges.filter((e) => e.from === nodeId);
    expect(out.map((e) => e.branch).sort()).toEqual(["no", "yes"]);
    // Both branches land on exit nodes, ready to be replaced.
    expect(out.every((e) => nodeById(graph, e.to)!.kind === "exit")).toBe(true);
  });

  it("a split inserted mid-chain keeps the existing downstream on YES", () => {
    const { graph, nodeId } = insertSplit(branched(), "e1", ids("new"), { label: "Clicked?" });
    const yes = graph.edges.find((e) => e.from === nodeId && e.branch === "yes");
    expect(yes?.to).toBe("s");     // the old e1 → s downstream
    expect(validateGraph(graph)).toEqual([]);
  });
});

describe("deleting", () => {
  it("reconnects around a deleted email so the chain survives", () => {
    const impact = deletionImpact(branched(), "e3");
    expect(impact.reconnects).toBe(true);
    const { graph, removed } = deleteNode(branched(), "e3");
    expect(removed).toEqual(["e3"]);
    expect(graph.edges.find((e) => e.from === "s" && e.branch === "no")?.to).toBe("e4");
    expect(validateGraph(graph)).toEqual([]);
  });

  it("a split takes its whole subtree, and says how many emails that is FIRST", () => {
    const impact = deletionImpact(branched(), "s");
    expect(impact.emailCount).toBe(3);                      // e2, e3, e4
    expect(impact.removed.sort()).toEqual(["e2", "e3", "e4", "s"]);
    const { graph } = deleteNode(branched(), "s");
    expect(graph.nodes.map((n) => n.id)).toEqual(["t", "e1"]);
    expect(graph.edges.map((e) => e.id)).toEqual(["x1"]);   // e1 → s is gone with it
  });

  it("refuses to delete the trigger", () => {
    const { graph, removed } = deleteNode(branched(), "t");
    expect(removed).toEqual([]);
    expect(graph.nodes).toHaveLength(6);
  });

  it("deleting a leaf leaves no dangling edge", () => {
    const { graph } = deleteNode(branched(), "e4");
    expect(graph.edges.some((e) => e.to === "e4")).toBe(false);
    expect(validateGraph(graph)).toEqual([]);
  });
});

describe("updating", () => {
  it("patches an email node without touching the rest", () => {
    const g = updateEmailNode(branched(), "e1", { job: "Say hello properly", highlights: "warranty" });
    expect(nodeById(g, "e1")!.email!.job).toBe("Say hello properly");
    expect(nodeById(g, "e1")!.email!.highlights).toBe("warranty");
    expect(nodeById(g, "e2")!.email!.job).toBe("Build on the open");
  });

  it("ignores an email patch aimed at a non-email node", () => {
    expect(updateEmailNode(branched(), "s", { job: "nope" })).toEqual(branched());
  });

  it("patches split fields", () => {
    const g = updateSplitFields(branched(), "s", { no_label: "didn't open" });
    expect(nodeById(g, "s")!.split).toEqual({ label: "Opened Email 1?", yes_label: "engaged", no_label: "didn't open" });
  });
});

// ---------------------------------------------------------------------------

const legacyEmail = (id: string, position: number, patch: Partial<FlowEmail> = {}): FlowEmail => ({
  id, position, job: `Job ${position}`, delay: position === 1 ? "Immediately" : `${position} days later`,
  section_structure: [{ id: `s${position}`, type: "header" }],
  status: "empty", ...patch,
});

const legacyFlow = (patch: Partial<Flow> = {}): Flow => ({
  id: "2026-08-01-welcome-abc123",
  name: "Welcome flow", type: "welcome", channel: "email",
  trigger: "Someone subscribes",
  emails: [legacyEmail("a", 1), legacyEmail("b", 2), legacyEmail("c", 3)],
  splits: [],
  created_at: "x", updated_at: "y",
  ...patch,
});

describe("migration from the linear model", () => {
  it("chains every email in position order, under one trigger", () => {
    const g = migrateLinearFlowToGraph(legacyFlow(), ids("m"));
    expect(validateGraph(g)).toEqual([]);
    expect(emailNodesInOrder(g).map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(g.nodes.filter((n) => n.kind === "trigger")).toHaveLength(1);
    expect(nodeById(g, "a")).toBeDefined();
  });

  it("keeps the FlowEmail ids, so existing planner links still resolve", () => {
    // "<flowId>::<emailId>" is how the planner addresses a flow email; minting new
    // ids here would break every link written before the rebuild.
    const g = migrateLinearFlowToGraph(legacyFlow(), ids("m"));
    expect(g.nodes.filter((n) => n.kind === "email").map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("carries the trigger text, falling back when there is none", () => {
    expect(nodeById(migrateLinearFlowToGraph(legacyFlow(), ids("m")), "m1")!.trigger!.label)
      .toBe("Someone subscribes");
    const g = migrateLinearFlowToGraph(legacyFlow({ trigger: undefined }), ids("m"), "Playbook trigger");
    expect(nodeById(g, "m1")!.trigger!.label).toBe("Playbook trigger");
  });

  it("keeps every email's job, delay, highlights and written body", () => {
    const flow = legacyFlow({
      emails: [legacyEmail("a", 1, {
        highlights: "lead with warranty",
        status: "draft",
        campaign: { meta: { subject_lines: ["Hi"], preview_texts: [] }, sections: [] },
      })],
    });
    const g = migrateLinearFlowToGraph(flow, ids("m"));
    const email = nodeById(g, "a")!.email!;
    expect(email.job).toBe("Job 1");
    expect(email.delay).toBe("Immediately");
    expect(email.highlights).toBe("lead with warranty");
    expect(email.status).toBe("draft");
    expect(email.campaign!.meta.subject_lines).toEqual(["Hi"]);
    expect(email.section_structure).toEqual([{ id: "s1", type: "header" }]);
  });

  it("turns a split's two label strings into two real branches ending in exits", () => {
    const flow = legacyFlow({
      splits: [{ id: "sp1", after_email_position: 2, label: "Purchased?", yes_label: "stop emailing", no_label: "keep nudging" }],
    });
    const g = migrateLinearFlowToGraph(flow, ids("m"));
    expect(validateGraph(g)).toEqual([]);
    const split = g.nodes.find((n) => n.kind === "split")!;
    expect(split.split!.label).toBe("Purchased?");
    const out = g.edges.filter((e) => e.from === split.id);
    expect(out.map((e) => e.branch).sort()).toEqual(["no", "yes"]);
    // YES inherits what followed email 2 (i.e. email 3); NO gets an exit carrying
    // the old no_label, because that label described an outcome, not a message.
    expect(out.find((e) => e.branch === "yes")!.to).toBe("c");
    const noTarget = nodeById(g, out.find((e) => e.branch === "no")!.to)!;
    expect(noTarget.kind).toBe("exit");
    expect(noTarget.exit!.label).toBe("keep nudging");
  });

  it("a split after the LAST email gets an exit on both branches", () => {
    const flow = legacyFlow({
      splits: [{ id: "sp1", after_email_position: 3, label: "Bought?", yes_label: "done", no_label: "retry" }],
    });
    const g = migrateLinearFlowToGraph(flow, ids("m"));
    expect(validateGraph(g)).toEqual([]);
    const split = g.nodes.find((n) => n.kind === "split")!;
    const targets = g.edges.filter((e) => e.from === split.id).map((e) => nodeById(g, e.to)!.kind);
    expect(targets).toEqual(["exit", "exit"]);
  });

  it("a split anchored after position 0 hangs off the trigger", () => {
    const flow = legacyFlow({ splits: [{ id: "sp1", after_email_position: 0, label: "New?" }] });
    const g = migrateLinearFlowToGraph(flow, ids("m"));
    expect(validateGraph(g)).toEqual([]);
    const split = g.nodes.find((n) => n.kind === "split")!;
    expect(g.edges.some((e) => e.from === "m1" && e.to === split.id)).toBe(true);
  });

  it("drops an unlabelled split (the add-then-cancel case) rather than emitting an invalid node", () => {
    const flow = legacyFlow({ splits: [{ id: "sp1", after_email_position: 1, label: "" }] });
    const g = migrateLinearFlowToGraph(flow, ids("m"));
    expect(g.nodes.some((n) => n.kind === "split")).toBe(false);
    expect(validateGraph(g)).toEqual([]);
  });

  it("ignores a split anchored to an email that no longer exists", () => {
    const flow = legacyFlow({ splits: [{ id: "sp1", after_email_position: 99, label: "Ghost?" }] });
    const g = migrateLinearFlowToGraph(flow, ids("m"));
    expect(g.nodes.some((n) => n.kind === "split")).toBe(false);
    expect(validateGraph(g)).toEqual([]);
  });

  it("two splits after the same email chain instead of both claiming the parent", () => {
    const flow = legacyFlow({
      splits: [
        { id: "sp1", after_email_position: 1, label: "Opened?" },
        { id: "sp2", after_email_position: 1, label: "Clicked?" },
      ],
    });
    const g = migrateLinearFlowToGraph(flow, ids("m"));
    expect(validateGraph(g)).toEqual([]);
    expect(g.nodes.filter((n) => n.kind === "split")).toHaveLength(2);
  });

  it("migrates a flow with no emails at all into a bare trigger", () => {
    const g = migrateLinearFlowToGraph(legacyFlow({ emails: [] }), ids("m"));
    expect(g.nodes).toHaveLength(1);
    expect(validateGraph(g)).toEqual([]);
  });

  it("assigns distinct coordinates — nothing piles up on the origin", () => {
    const flow = legacyFlow({
      splits: [{ id: "sp1", after_email_position: 2, label: "Purchased?", no_label: "nudge" }],
    });
    const g = migrateLinearFlowToGraph(flow, ids("m"));
    const seen = new Set(g.nodes.map((n) => `${n.x},${n.y}`));
    expect(seen.size).toBe(g.nodes.length);
  });

  it("ensureGraph migrates once and is then a no-op", () => {
    const flow = legacyFlow();
    const first = ensureGraph(flow, ids("m"));
    const again = ensureGraph({ ...flow, nodes: first.nodes, edges: first.edges }, ids("z"));
    expect(again).toEqual(first);
  });
});

describe("the derived legacy shape (the rollback path)", () => {
  it("renumbers emails 1..n by traversal order", () => {
    const { emails } = deriveLegacy(branched());
    expect(emails.map((e) => [e.id, e.position])).toEqual([["e1", 1], ["e2", 2], ["e3", 3], ["e4", 4]]);
  });

  it("anchors each split after the last email above it on its own path", () => {
    const { splits } = deriveLegacy(branched());
    expect(splits).toEqual([{ id: "s", after_email_position: 1, label: "Opened Email 1?", yes_label: "engaged", no_label: "quiet" }]);
  });

  it("round-trips a migrated flow: graph → legacy keeps every job and label", () => {
    const flow = legacyFlow({
      splits: [{ id: "sp1", after_email_position: 2, label: "Purchased?", yes_label: "y", no_label: "n" }],
    });
    const g = migrateLinearFlowToGraph(flow, ids("m"));
    const { emails, splits } = deriveLegacy(g);
    expect(emails.map((e) => e.job)).toEqual(["Job 1", "Job 2", "Job 3"]);
    expect(emails.map((e) => e.delay)).toEqual(["Immediately", "2 days later", "3 days later"]);
    expect(emails.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(splits[0].label).toBe("Purchased?");
  });

  it("does not lose an orphaned email", () => {
    const g = branched();
    g.nodes.push(emailNode("orphan", "Detached"));
    expect(deriveLegacy(g).emails.map((e) => e.id)).toContain("orphan");
  });

  it("withGraph keeps the graph and the derived arrays in step", () => {
    const flow = withGraph(legacyFlow(), branched());
    expect(flow.nodes).toHaveLength(6);
    expect(flow.emails.map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4"]);
    expect(flow.splits).toHaveLength(1);
  });

  it("a derived email carries no stale `position` from the node", () => {
    // The node's email payload is FlowEmail minus position; the derived array is
    // the only place a position exists, and it comes from the traversal.
    const g = branched();
    const { emails } = deriveLegacy(g);
    expect(new Set(emails.map((e) => e.position))).toEqual(new Set([1, 2, 3, 4]));
  });
});
