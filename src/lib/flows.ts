import path from "path";
import { getAdapter } from "./storage";
import { parseFlows, stampAll } from "./validation";
import type { Flow } from "./schemas";

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
export type FlowMeta = Omit<Flow, "emails" | "splits"> & {
  emails: FlowEmailMeta[];
  email_count: number;
  written_count: number;
};

function toMeta(f: Flow): FlowMeta {
  const { emails, splits: _splits, ...rest } = f;
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
  const entries = await readAll();
  const idx = entries.findIndex((e) => e.id === f.id);
  const next = idx === -1 ? [...entries, f] : entries.map((e) => (e.id === f.id ? f : e));
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
