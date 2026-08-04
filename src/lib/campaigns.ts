import path from "path";
import matter from "gray-matter";
import { getAdapter } from "./storage";
import { parseSavedCampaign, SCHEMA_VERSION } from "./validation";
import type { SavedCampaign } from "./schemas";

// Store for Copy Builder drafts: one markdown file per draft (id.md, gray-matter
// frontmatter + a JSON body block) behind the single canonical storage seam
// (lib/storage.ts). File-backed locally (generated/<id>.md) and Upstash Redis
// when configured — durable across Vercel's ephemeral, read-only-except-/tmp
// serverless FS, where these writes previously silently no-op'd. Drafts are
// transient WIP; the durable finalized copy is the Library (also Redis-backed).
// The CRUD surface is async because the KV backend is a network call.
const GENERATED_DIR = path.join(process.cwd(), "generated");
const store = getAdapter(GENERATED_DIR, "campaigns");

const draftKey = (id: string) => `${id}.md`;

// Guards store keys against path traversal: ids come from network input and are
// interpolated into keys, so reject anything but slug characters.
function isSafeId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_-]+$/.test(id);
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
    hero_angle: c.hero_angle ?? null, // legacy; no longer collected
    // Selection-driven brief fields, persisted so a reload rebuilds the brief.
    angle: c.angle ?? null,
    promotion_id: c.promotion_id ?? null,
    occasion: c.occasion ?? null,
    hero_product_slug: c.hero_product_slug ?? null,
    send_stage: c.send_stage ?? null,
    urgency: c.urgency ?? null,
    products_featured: c.products_featured ?? [],
    status: c.status,
    planner_row_id: c.planner_row_id ?? null,
    created_at: c.created_at,
    updated_at: c.updated_at,
    schema_version: SCHEMA_VERSION,
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
    const candidate = {
      id: data.id,
      campaign_name: data.campaign_name,
      campaign_type: data.campaign_type,
      offer: data.offer,
      promo_code: data.promo_code,
      audience: data.audience,
      hero_angle: data.hero_angle ?? undefined,
      angle: data.angle ?? undefined,
      promotion_id: data.promotion_id ?? undefined,
      occasion: data.occasion ?? undefined,
      hero_product_slug: data.hero_product_slug ?? undefined,
      send_stage: data.send_stage ?? undefined,
      urgency: data.urgency ?? undefined,
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
    // Validate at the boundary — a malformed draft is logged and treated as
    // absent (null) rather than returned as a wrongly-typed campaign.
    return parseSavedCampaign(candidate);
  } catch {
    return null;
  }
}

export async function listCampaigns(): Promise<Omit<SavedCampaign, "campaign" | "expanded_brief" | "section_structure">[]> {
  const files = (await store.list("")).filter((f) => f.endsWith(".md"));
  const raws = await Promise.all(files.map((f) => store.read(f)));
  const result = [];
  for (const raw of raws) {
    if (raw == null) continue;
    const c = markdownToCampaign(raw);
    if (c) {
      const { campaign: _c, expanded_brief: _e, section_structure: _s, ...meta } = c;
      result.push(meta);
    }
  }
  return result.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function saveCampaign(c: SavedCampaign): Promise<void> {
  if (!isSafeId(c.id)) throw new Error("Invalid campaign id");
  // File backend absorbs read-only-FS failures (logs, no-op) so a draft save
  // never crashes the request; Redis makes it durable across invocations.
  await store.write(draftKey(c.id), campaignToMarkdown(c));
}

export async function loadCampaign(id: string): Promise<SavedCampaign | null> {
  if (!isSafeId(id)) return null;
  const raw = await store.read(draftKey(id));
  return raw == null ? null : markdownToCampaign(raw);
}

// Attach/detach a planner row back-reference on a saved draft. Load→mutate→save
// is lossless (markdownToCampaign reconstructs the whole campaign). Returns false
// when the id doesn't resolve to a draft (caller then tries the library).
export async function setCampaignPlannerRow(id: string, plannerRowId: string | null): Promise<boolean> {
  const c = await loadCampaign(id);
  if (!c) return false;
  c.planner_row_id = plannerRowId ?? undefined;
  c.updated_at = new Date().toISOString();
  await saveCampaign(c);
  return true;
}

export async function deleteCampaign(id: string): Promise<boolean> {
  if (!isSafeId(id)) return false;
  if ((await store.read(draftKey(id))) == null) return false;
  await store.remove(draftKey(id));
  return true;
}
