import path from "path";
import { getAdapter } from "./storage";
import { parseFlows, stampAll } from "./validation";
import type { Flow, FlowEmail } from "./schemas";
import { parseFlowEmailId } from "./flow-email-id";
import { deriveLegacy, nodeById, positionOf, withGraph } from "./flow-graph";

// Store for FLOWS: a single JSON array behind the shared storage adapter
// (lib/storage.ts), a near-copy of lib/sms.ts. File-backed locally when no KV is
// configured; Upstash Redis when it is — durable in production the same way the
// SMS / library / planner stores are. Runtime reads/writes only this blob.
const DATA_ROOT = path.join(process.cwd(), "data");
const STORE_KEY = "flows.json";
const store = getAdapter(DATA_ROOT, "flows");

// ids come from network input — reject anything but slug characters to keep
// store keys clean and predictable (matches the SMS/library guards).
function isSafeId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_-]+$/.test(id);
}

async function readAll(): Promise<Flow[]> {
  const raw = await store.read(STORE_KEY);
  if (raw == null) return []; // absent store → no flows
  try {
    // Validate at the boundary — a malformed flow is logged and skipped rather
    // than surfacing as a wrongly-typed record.
    return parseFlows(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function writeAll(entries: Flow[]): Promise<void> {
  await store.write(STORE_KEY, JSON.stringify(stampAll(entries), null, 2));
}

// Meta view for the sidebar list — omits the (potentially large) per-email
// generated bodies, keeping just enough to render a rich card.
export type FlowEmailMeta = { id: string; position: number; job: string; status: "empty" | "draft" | "final" };
export type FlowMeta = Omit<Flow, "emails" | "splits" | "nodes" | "edges"> & {
  emails: FlowEmailMeta[];
  email_count: number;
  written_count: number;
};

function toMeta(f: Flow): FlowMeta {
  // `nodes` is dropped as deliberately as `emails`: an email NODE carries the
  // whole generated body, so leaving the graph in would put every written email
  // of every flow into the sidebar's list payload.
  const { emails, splits: _splits, nodes: _nodes, edges: _edges, ...rest } = f;
  return {
    ...rest,
    emails: emails.map((e) => ({ id: e.id, position: e.position, job: e.job, status: e.status })),
    email_count: emails.length,
    written_count: emails.filter((e) => e.status !== "empty").length,
  };
}

export async function listFlows(): Promise<FlowMeta[]> {
  const entries = await readAll();
  return entries
    .map(toMeta)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function loadFlow(id: string): Promise<Flow | null> {
  if (!isSafeId(id)) return null;
  return (await readAll()).find((f) => f.id === id) ?? null;
}

export async function saveFlow(f: Flow): Promise<void> {
  if (!isSafeId(f.id)) throw new Error("Invalid flow id");
  // The graph is the source of truth; `emails`/`splits` are the derived rollback
  // copy (spec §6). Re-deriving on every write means a client that posts a stale
  // pair — or none at all — can never leave the two out of step.
  const record = f.nodes?.length ? withGraph(f, { nodes: f.nodes, edges: f.edges ?? [] }) : f;
  const entries = await readAll();
  const idx = entries.findIndex((e) => e.id === record.id);
  const next = idx === -1 ? [...entries, record] : entries.map((e) => (e.id === record.id ? record : e));
  await writeAll(next);
}

export async function deleteFlow(id: string): Promise<boolean> {
  if (!isSafeId(id)) return false;
  const entries = await readAll();
  const next = entries.filter((f) => f.id !== id);
  if (next.length === entries.length) return false;
  await writeAll(next);
  return true;
}

// ---- flow emails addressed from OUTSIDE the flows store --------------------
// A flow email is nested inside a Flow, so the planner addresses it by the
// composite id "<flowId>::<emailId>". The id format itself (and its parse) lives
// in lib/flow-email-id.ts, which is PURE so the planner page can import it too;
// re-exported here so the planner routes get store + ids from one place.
export { flowEmailId, parseFlowEmailId, isFlowEmailId } from "./flow-email-id";

/**
 * Resolve a composite id to its flow AND its email. Null when the id isn't
 * composite, the flow is gone, or the email was deleted out of the flow.
 *
 * Reads the GRAPH (an email node) and falls back to the legacy `emails` array,
 * because the graph is where an edit lands and the legacy copy is derived. The
 * returned `email` carries a `position` taken from the graph traversal, so
 * callers that print "Email 2 of 4" keep working.
 */
export async function loadFlowEmail(id: string): Promise<{ flow: Flow; email: FlowEmail } | null> {
  const parsed = parseFlowEmailId(id);
  if (!parsed) return null;
  const flow = await loadFlow(parsed.flowId);
  if (!flow) return null;

  if (flow.nodes?.length) {
    const g = { nodes: flow.nodes, edges: flow.edges ?? [] };
    const node = nodeById(g, parsed.emailId);
    if (node?.kind === "email" && node.email) {
      return { flow, email: { ...node.email, position: positionOf(g, node.id) } };
    }
    return null;
  }
  const email = flow.emails.find((e) => e.id === parsed.emailId);
  return email ? { flow, email } : null;
}

/**
 * Attach/detach a planner row back-reference on one flow email. Mirrors
 * setSmsPlannerRow (sms.ts) — load → mutate → save, false when the id doesn't
 * resolve — so the four copy stores stay symmetrical for the planner.
 *
 * Writes to the graph NODE. Writing only the derived `emails` array would look
 * like it worked and then vanish: the next save re-derives that array from the
 * graph, which would not have the back-reference.
 */
export async function setFlowEmailPlannerRow(id: string, plannerRowId: string | null): Promise<boolean> {
  const parsed = parseFlowEmailId(id);
  if (!parsed) return false;
  const flow = await loadFlow(parsed.flowId);
  if (!flow) return false;
  const now = new Date().toISOString();

  if (flow.nodes?.length) {
    const node = flow.nodes.find((n) => n.id === parsed.emailId && n.kind === "email");
    if (!node?.email) return false;
    const nodes = flow.nodes.map((n) =>
      n.id === node.id ? { ...n, email: { ...n.email!, planner_row_id: plannerRowId ?? undefined } } : n);
    const graph = { nodes, edges: flow.edges ?? [] };
    const { emails, splits } = deriveLegacy(graph);
    await saveFlow({ ...flow, nodes, edges: graph.edges, emails, splits, updated_at: now });
    return true;
  }

  if (!flow.emails.some((e) => e.id === parsed.emailId)) return false;
  await saveFlow({
    ...flow,
    emails: flow.emails.map((e) =>
      e.id === parsed.emailId ? { ...e, planner_row_id: plannerRowId ?? undefined } : e),
    updated_at: now,
  });
  return true;
}
