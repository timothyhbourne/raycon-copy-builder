import path from "path";
import { getAdapter } from "./storage";
import { parseSmsCampaigns, stampAll } from "./validation";
import type { SmsCampaign } from "./schemas";

// Store for SMS campaigns: a single JSON array behind the shared storage adapter
// (lib/storage.ts), mirroring lib/library.ts and lib/planner.ts. File-backed
// locally when no KV is configured; Upstash Redis when it is.
//
// This store used to write one JSON file per campaign into data/sms/. That
// silently lost every save in production: Vercel's filesystem is read-only, the
// write threw, and the catch turned it into a console.warn — so POST /api/sms
// still answered `{ ok: true }` and the UI toasted "SMS draft saved" for a
// campaign that was never persisted. The seam makes the write durable, and a
// genuine backend failure now propagates so the route can 500 instead of lying.
//
// The legacy per-campaign files in data/sms/*.json are the seed source for a
// one-time migration; once seeded, runtime reads/writes only this blob.
const DATA_ROOT = path.join(process.cwd(), "data");
const STORE_KEY = "sms.json";
const store = getAdapter(DATA_ROOT, "sms");

// ids come from network input — reject anything but slug characters to keep
// store keys clean and predictable.
function isSafeId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_-]+$/.test(id);
}

async function readAll(): Promise<SmsCampaign[]> {
  const raw = await store.read(STORE_KEY);
  if (raw == null) return []; // absent store → no SMS campaigns
  try {
    // Validate at the boundary — a malformed campaign is logged and skipped
    // rather than surfacing as a wrongly-typed record.
    return parseSmsCampaigns(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function writeAll(entries: SmsCampaign[]): Promise<void> {
  await store.write(STORE_KEY, JSON.stringify(stampAll(entries), null, 2));
}

// Meta view for the sidebar list — omits the variant bodies.
export type SmsMeta = Omit<SmsCampaign, "variants" | "brief"> & {
  brief: Pick<SmsCampaign["brief"], "offer">;
};

export async function listSmsCampaigns(): Promise<SmsMeta[]> {
  const entries = await readAll();
  return entries
    .map((c) => {
      const { variants: _v, brief, ...rest } = c;
      return { ...rest, brief: { offer: brief?.offer ?? "" } };
    })
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function saveSmsCampaign(c: SmsCampaign): Promise<void> {
  if (!isSafeId(c.id)) throw new Error("Invalid SMS campaign id");
  const entries = await readAll();
  const idx = entries.findIndex((e) => e.id === c.id);
  const next = idx === -1 ? [...entries, c] : entries.map((e) => (e.id === c.id ? c : e));
  await writeAll(next);
}

export async function loadSmsCampaign(id: string): Promise<SmsCampaign | null> {
  if (!isSafeId(id)) return null;
  return (await readAll()).find((c) => c.id === id) ?? null;
}

// Attach/detach a planner row back-reference. Load→mutate→save, matching
// setCampaignPlannerRow. Returns false when the id doesn't resolve.
export async function setSmsPlannerRow(id: string, plannerRowId: string | null): Promise<boolean> {
  const c = await loadSmsCampaign(id);
  if (!c) return false;
  c.planner_row_id = plannerRowId ?? undefined;
  c.updated_at = new Date().toISOString();
  await saveSmsCampaign(c);
  return true;
}

export async function deleteSmsCampaign(id: string): Promise<boolean> {
  if (!isSafeId(id)) return false;
  const entries = await readAll();
  const next = entries.filter((c) => c.id !== id);
  if (next.length === entries.length) return false;
  await writeAll(next);
  return true;
}
