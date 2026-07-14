import fs from "fs";
import path from "path";
import type { SmsCampaign } from "./schemas";

// File store for SMS campaigns — mirrors lib/campaigns.ts, but one JSON file per
// campaign (the record is small and fully structured, so no markdown+frontmatter
// split is needed).
const SMS_DIR = path.join(process.cwd(), "data", "sms");

// ids come from network input and are interpolated into filenames — reject
// anything but slug characters to guard against path traversal.
function isSafeId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_-]+$/.test(id);
}

// Best-effort: on a read-only filesystem (Vercel serverless) mkdir throws.
// Swallow it so reads degrade to "empty" rather than 500ing; writes are
// separately guarded and simply don't persist there.
function ensureDir() {
  try {
    if (!fs.existsSync(SMS_DIR)) fs.mkdirSync(SMS_DIR, { recursive: true });
  } catch { /* read-only FS: nothing to list, nothing to persist */ }
}

// Meta view for the sidebar list — omits the variant bodies.
export type SmsMeta = Omit<SmsCampaign, "variants" | "brief"> & {
  brief: Pick<SmsCampaign["brief"], "offer">;
};

function parse(raw: string): SmsCampaign | null {
  try {
    const c = JSON.parse(raw) as SmsCampaign;
    if (!c || !Array.isArray(c.variants)) return null;
    return c;
  } catch {
    return null;
  }
}

export function listSmsCampaigns(): SmsMeta[] {
  ensureDir();
  let files: string[];
  try {
    files = fs.readdirSync(SMS_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return []; // dir absent / read-only FS → no SMS campaigns
  }
  const result: SmsMeta[] = [];
  for (const file of files) {
    const c = parse(fs.readFileSync(path.join(SMS_DIR, file), "utf8"));
    if (c) {
      const { variants: _v, brief, ...rest } = c;
      result.push({ ...rest, brief: { offer: brief?.offer ?? "" } });
    }
  }
  return result.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function saveSmsCampaign(c: SmsCampaign): void {
  if (!isSafeId(c.id)) throw new Error("Invalid SMS campaign id");
  ensureDir();
  try {
    fs.writeFileSync(path.join(SMS_DIR, `${c.id}.json`), JSON.stringify(c, null, 2), "utf8");
  } catch (e) {
    console.warn(`[sms] write failed (read-only FS?): ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function loadSmsCampaign(id: string): SmsCampaign | null {
  if (!isSafeId(id)) return null;
  ensureDir();
  const filepath = path.join(SMS_DIR, `${id}.json`);
  if (!fs.existsSync(filepath)) return null;
  return parse(fs.readFileSync(filepath, "utf8"));
}

// Attach/detach a planner row back-reference. Load→mutate→save, matching
// setCampaignPlannerRow. Returns false when the id doesn't resolve.
export function setSmsPlannerRow(id: string, plannerRowId: string | null): boolean {
  const c = loadSmsCampaign(id);
  if (!c) return false;
  c.planner_row_id = plannerRowId ?? undefined;
  c.updated_at = new Date().toISOString();
  saveSmsCampaign(c);
  return true;
}

export function deleteSmsCampaign(id: string): boolean {
  if (!isSafeId(id)) return false;
  ensureDir();
  const filepath = path.join(SMS_DIR, `${id}.json`);
  if (!fs.existsSync(filepath)) return false;
  fs.unlinkSync(filepath);
  return true;
}
