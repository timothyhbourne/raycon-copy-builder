import path from "path";
import { getAdapter } from "./storage";
import type { LibraryCampaign, GeneratedCampaign, BriefInput, Conceit, SectionSpec } from "./schemas";

// Store for the Copy Builder Library: a single JSON array behind the shared
// storage adapter (lib/storage.ts), mirroring lib/planner.ts. File-backed
// locally when no KV is configured; Upstash Redis when it is (durable across
// Vercel's ephemeral/read-only serverless FS — the reason for this migration).
// The CRUD surface is async because the KV backend is a network call.
//
// The legacy on-disk format was one markdown file per campaign in data/library/;
// those files are the seed source for `npm run seed:library`, which parses them
// into this JSON array. Once seeded, runtime reads/writes only this blob.
const DATA_ROOT = path.join(process.cwd(), "data");
const STORE_KEY = "library.json";
const store = getAdapter(DATA_ROOT, "library");

// Guards store keys: ids come from network input, so reject anything but slug
// characters to keep them clean and predictable.
function isSafeId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_-]+$/.test(id);
}

async function readAll(): Promise<LibraryCampaign[]> {
  const raw = await store.read(STORE_KEY);
  if (raw == null) return []; // absent store → empty library
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAll(entries: LibraryCampaign[]): Promise<void> {
  // On the file backend the adapter absorbs read-only-FS failures (logs, no-op);
  // the Redis backend makes the write durable across serverless invocations.
  await store.write(STORE_KEY, JSON.stringify(entries, null, 2));
}

export async function getLibraryCampaigns(): Promise<LibraryCampaign[]> {
  return (await readAll()).sort((a, b) => b.date.localeCompare(a.date));
}

export async function getLibraryCampaignById(id: string): Promise<LibraryCampaign | null> {
  if (!isSafeId(id)) return null;
  return (await readAll()).find((c) => c.id === id) ?? null;
}

function campaignToLibraryBody(campaign: GeneratedCampaign): string {
  const lines: string[] = [];
  // Subject lines
  if (campaign.meta.subject_lines?.length) {
    lines.push("# Subject Line");
    campaign.meta.subject_lines.forEach((s) => lines.push(s));
    lines.push("");
  }
  // Preview texts
  if (campaign.meta.preview_texts?.length) {
    lines.push("# Preview Text");
    campaign.meta.preview_texts.forEach((p) => lines.push(p));
    lines.push("");
  }
  // Sections
  for (const section of campaign.sections) {
    for (const [key, value] of Object.entries(section.elements)) {
      if (!value) continue;
      lines.push(`# ${key}`);
      if (Array.isArray(value)) {
        value.forEach((item) => {
          if (typeof item === "object") {
            lines.push(`${item.name}: ${item.one_liner}`);
          }
        });
      } else {
        lines.push(String(value));
      }
      lines.push("");
    }
  }
  return lines.join("\n").trim();
}

// Update just the planner_row_id back-reference on a library entry, preserving
// the body + structured snapshot. Returns false when the id doesn't resolve.
export async function setLibraryPlannerRow(id: string, plannerRowId: string | null): Promise<boolean> {
  if (!isSafeId(id)) return false;
  const entries = await readAll();
  const idx = entries.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  entries[idx] = { ...entries[idx], planner_row_id: plannerRowId ?? undefined };
  await writeAll(entries);
  return true;
}

export async function deleteFromLibrary(id: string): Promise<boolean> {
  if (!isSafeId(id)) return false;
  const entries = await readAll();
  const next = entries.filter((c) => c.id !== id);
  if (next.length === entries.length) return false;
  await writeAll(next);
  return true;
}

export async function saveToLibrary(
  id: string,
  briefInput: BriefInput,
  conceit: Conceit | null,
  campaign: GeneratedCampaign,
  sectionStructure: SectionSpec[] = []
): Promise<void> {
  if (!isSafeId(id)) throw new Error("Invalid campaign id");
  const entries = await readAll();
  const entry: LibraryCampaign = {
    id,
    title: briefInput.campaign_name,
    date: new Date().toISOString().split("T")[0],
    campaign_type: briefInput.campaign_type,
    offer: briefInput.offer,
    promo_code: briefInput.promo_code || undefined,
    hero_angle: briefInput.hero_angle,
    audience: briefInput.audience,
    products_featured: briefInput.products_featured,
    conceit: conceit?.name ?? "[FILL ME IN]",
    source: "generated",
    body: campaignToLibraryBody(campaign),
    // Back-reference so a re-opened finalized copy still knows its planner row.
    planner_row_id: briefInput.planner_row_id ?? undefined,
    // Lossless snapshot for faithful canvas reload (model reference uses `body`).
    structured: { campaign, section_structure: sectionStructure },
  };
  const idx = entries.findIndex((c) => c.id === id);
  const next = idx === -1 ? [...entries, entry] : entries.map((c) => (c.id === id ? entry : c));
  await writeAll(next);
}
