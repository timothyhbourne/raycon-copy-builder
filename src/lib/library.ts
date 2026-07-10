import fs from "fs";
import path from "path";
import matter from "gray-matter";
import type { LibraryCampaign, GeneratedCampaign, BriefInput, Conceit, SectionSpec } from "./schemas";

const LIBRARY_DIR = path.join(process.cwd(), "data", "library");

// Guards file operations against path traversal: ids come from network input
// and are interpolated into filenames, so reject anything but slug characters.
function isSafeId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_-]+$/.test(id);
}

export function getLibraryCampaigns(): LibraryCampaign[] {
  if (!fs.existsSync(LIBRARY_DIR)) return [];
  const files = fs.readdirSync(LIBRARY_DIR).filter((f) => f.endsWith(".md"));
  const campaigns: LibraryCampaign[] = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(LIBRARY_DIR, file), "utf8");
      const { data, content } = matter(raw);
      let structured: LibraryCampaign["structured"];
      if (typeof data.structured === "string" && data.structured.trim()) {
        try { structured = JSON.parse(data.structured); } catch { /* ignore malformed */ }
      }
      campaigns.push({
        id: data.id ?? file.replace(".md", ""),
        title: data.title ?? "",
        date: data.date instanceof Date ? data.date.toISOString().split("T")[0] : (data.date ? String(data.date) : ""),
        campaign_type: data.campaign_type ?? "promo",
        offer: data.offer ?? "",
        promo_code: data.promo_code,
        hero_angle: data.hero_angle ?? "",
        audience: data.audience ?? "all",
        products_featured: data.products_featured ?? [],
        conceit: data.conceit ?? "",
        source: data.source ?? "doc",
        body: content.trim(),
        planner_row_id: data.planner_row_id ?? undefined,
        structured,
      });
    } catch {
      // skip malformed files
    }
  }
  return campaigns.sort((a, b) => b.date.localeCompare(a.date));
}

export function getLibraryCampaignById(id: string): LibraryCampaign | null {
  const campaigns = getLibraryCampaigns();
  return campaigns.find((c) => c.id === id) ?? null;
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
// the body + structured snapshot. (saveToLibrary would need the full briefInput,
// which a manual attach doesn't have.) Returns false when the id doesn't resolve.
export function setLibraryPlannerRow(id: string, plannerRowId: string | null): boolean {
  if (!isSafeId(id)) return false;
  const filePath = path.join(LIBRARY_DIR, `${id}.md`);
  if (!fs.existsSync(filePath)) return false;
  try {
    const { data, content } = matter(fs.readFileSync(filePath, "utf8"));
    data.planner_row_id = plannerRowId ?? null;
    fs.writeFileSync(filePath, matter.stringify(content, data), "utf8");
    return true;
  } catch {
    return false;
  }
}

export function deleteFromLibrary(id: string): boolean {
  if (!isSafeId(id)) return false;
  const filePath = path.join(LIBRARY_DIR, `${id}.md`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

export function saveToLibrary(
  id: string,
  briefInput: BriefInput,
  conceit: Conceit | null,
  campaign: GeneratedCampaign,
  sectionStructure: SectionSpec[] = []
): void {
  if (!isSafeId(id)) throw new Error("Invalid campaign id");
  if (!fs.existsSync(LIBRARY_DIR)) fs.mkdirSync(LIBRARY_DIR, { recursive: true });
  const fm = {
    id,
    title: briefInput.campaign_name,
    date: new Date().toISOString().split("T")[0],
    campaign_type: briefInput.campaign_type,
    offer: briefInput.offer,
    promo_code: briefInput.promo_code || null,
    hero_angle: briefInput.hero_angle,
    audience: briefInput.audience,
    products_featured: briefInput.products_featured,
    conceit: conceit?.name ?? "[FILL ME IN]",
    source: "generated",
    // Back-reference so a re-opened finalized copy still knows its planner row
    // (js-yaml throws on undefined, so coerce to null like promo_code above).
    planner_row_id: briefInput.planner_row_id ?? null,
    // Lossless snapshot for faithful canvas reload (model reference still uses `body`).
    structured: JSON.stringify({ campaign, section_structure: sectionStructure }),
  };
  const body = campaignToLibraryBody(campaign);
  const content = matter.stringify("\n" + body, fm);
  fs.writeFileSync(path.join(LIBRARY_DIR, `${id}.md`), content, "utf8");
}
