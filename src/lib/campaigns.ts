import fs from "fs";
import path from "path";
import matter from "gray-matter";
import type { SavedCampaign } from "./schemas";

const GENERATED_DIR = path.join(process.cwd(), "generated");

// Guards file operations against path traversal: ids come from network input
// and are interpolated into filenames, so reject anything but slug characters.
function isSafeId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_-]+$/.test(id);
}

// Best-effort: on a read-only filesystem (Vercel serverless — everything outside
// /tmp is read-only) mkdir throws. Swallow it so reads degrade to "empty" rather
// than 500ing the route; writes are separately guarded and simply don't persist.
function ensureDir() {
  try {
    if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });
  } catch { /* read-only FS: nothing to list, nothing to persist */ }
}

function campaignToMarkdown(c: SavedCampaign): string {
  // gray-matter / js-yaml throws "unacceptable kind of an object to dump" on
  // any `undefined` value, so coerce every frontmatter field to a serialisable
  // one (undefined -> null). promo_code is the common offender (optional field).
  const rawFm: Record<string, unknown> = {
    id: c.id,
    campaign_name: c.campaign_name,
    campaign_type: c.campaign_type,
    offer: c.offer,
    promo_code: c.promo_code ?? null,
    audience: c.audience,
    hero_angle: c.hero_angle,
    products_featured: c.products_featured ?? [],
    status: c.status,
    planner_row_id: c.planner_row_id ?? null,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
  const fm = Object.fromEntries(
    Object.entries(rawFm).map(([k, v]) => [k, v === undefined ? null : v])
  );
  const body = JSON.stringify({ expanded_brief: c.expanded_brief, chosen_conceit: c.chosen_conceit, section_structure: c.section_structure, campaign: c.campaign }, null, 2);
  return matter.stringify(`\n\`\`\`json\n${body}\n\`\`\`\n`, fm);
}

function markdownToCampaign(raw: string): SavedCampaign | null {
  try {
    const { data, content } = matter(raw);
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[1]);
    return {
      id: data.id,
      campaign_name: data.campaign_name,
      campaign_type: data.campaign_type,
      offer: data.offer,
      promo_code: data.promo_code,
      audience: data.audience,
      hero_angle: data.hero_angle,
      products_featured: data.products_featured ?? [],
      status: data.status ?? "draft",
      planner_row_id: data.planner_row_id ?? undefined,
      created_at: data.created_at,
      updated_at: data.updated_at,
      expanded_brief: parsed.expanded_brief,
      chosen_conceit: parsed.chosen_conceit,
      section_structure: parsed.section_structure ?? [],
      campaign: parsed.campaign,
    };
  } catch {
    return null;
  }
}

export function listCampaigns(): Omit<SavedCampaign, "campaign" | "expanded_brief" | "section_structure">[] {
  ensureDir();
  let files: string[];
  try {
    files = fs.readdirSync(GENERATED_DIR).filter((f) => f.endsWith(".md"));
  } catch {
    return []; // dir absent / read-only FS → no drafts
  }
  const result = [];
  for (const file of files) {
    const raw = fs.readFileSync(path.join(GENERATED_DIR, file), "utf8");
    const c = markdownToCampaign(raw);
    if (c) {
      const { campaign: _c, expanded_brief: _e, section_structure: _s, ...meta } = c;
      result.push(meta);
    }
  }
  return result.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function saveCampaign(c: SavedCampaign): void {
  if (!isSafeId(c.id)) throw new Error("Invalid campaign id");
  ensureDir();
  try {
    fs.writeFileSync(path.join(GENERATED_DIR, `${c.id}.md`), campaignToMarkdown(c), "utf8");
  } catch (e) {
    // Read-only FS (Vercel): a draft save can't persist — log, don't crash the
    // request. Drafts are transient WIP; the durable copy is the Library (Redis).
    console.warn(`[campaigns] draft write failed (read-only FS?): ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function loadCampaign(id: string): SavedCampaign | null {
  if (!isSafeId(id)) return null;
  ensureDir();
  const filepath = path.join(GENERATED_DIR, `${id}.md`);
  if (!fs.existsSync(filepath)) return null;
  return markdownToCampaign(fs.readFileSync(filepath, "utf8"));
}

// Attach/detach a planner row back-reference on a saved draft. Load→mutate→save
// is lossless (markdownToCampaign reconstructs the whole campaign). Returns false
// when the id doesn't resolve to a draft (caller then tries the library).
export function setCampaignPlannerRow(id: string, plannerRowId: string | null): boolean {
  const c = loadCampaign(id);
  if (!c) return false;
  c.planner_row_id = plannerRowId ?? undefined;
  c.updated_at = new Date().toISOString();
  saveCampaign(c);
  return true;
}

export function deleteCampaign(id: string): boolean {
  if (!isSafeId(id)) return false;
  ensureDir();
  const filepath = path.join(GENERATED_DIR, `${id}.md`);
  if (!fs.existsSync(filepath)) return false;
  fs.unlinkSync(filepath);
  return true;
}
