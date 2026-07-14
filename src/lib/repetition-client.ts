// Client-side companion to src/lib/constructions.ts: collects the checkable
// elements of a generated campaign and defines the stable element-key scheme
// that both the check loop and the chip renderers agree on. Pure/browser-safe
// (no fs) — CheckElement is imported as a type only, so nothing server-side is
// pulled into the bundle.
import type { GeneratedCampaign, GeneratedSection, SectionSpec, CampaignMeta, ProductInGrid } from "./schemas";
import type { CheckElement } from "./constructions";
import { getProductSlugByName } from "./products";

export interface RepetitionFlag {
  match_text: string;
  match_campaign_title: string;
  match_date: string;
  score: number;
}

export function firstSentence(text: string): string {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  const m = t.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : t).trim();
}

// Element-key helpers — these strings identify an element in BOTH the check
// payload and the flag map, so the chip can be rendered next to its element.
export const metaKey = (field: "subject" | "preview", i: number) => `${field}:${i}`;
export const elementKey = (sectionId: string, key: string) => `${sectionId}::${key}`;
export const gridProductKey = (sectionId: string, i: number) => `${sectionId}::Products:${i}`;

// Position-first spec match (mirrors CampaignCanvas), so multiple product_card
// sections each resolve to their own product_slug.
export function specForSection(
  sectionStructure: SectionSpec[],
  index: number,
  type: string
): SectionSpec | undefined {
  return sectionStructure[index]?.type === type
    ? sectionStructure[index]
    : sectionStructure.find((s) => s.type === type);
}

function slugForCard(section: GeneratedSection, spec: SectionSpec | undefined): string {
  const name = typeof section.elements["Product Name"] === "string" ? section.elements["Product Name"] : "";
  return spec?.product_slug || getProductSlugByName(name) || name.toLowerCase();
}

export function collectMetaElements(meta: CampaignMeta): CheckElement[] {
  const out: CheckElement[] = [];
  meta.subject_lines?.forEach((t, i) => { if (t?.trim()) out.push({ id: metaKey("subject", i), kind: "subject", text: t }); });
  meta.preview_texts?.forEach((t, i) => { if (t?.trim()) out.push({ id: metaKey("preview", i), kind: "preview", text: t }); });
  return out;
}

export function collectSectionElements(
  section: GeneratedSection,
  spec: SectionSpec | undefined
): CheckElement[] {
  const out: CheckElement[] = [];
  const el = section.elements;
  const str = (k: string) => (typeof el[k] === "string" ? (el[k] as string) : "");

  if (str("Headline").trim()) out.push({ id: elementKey(section.id, "Headline"), kind: "headline", text: str("Headline") });

  const body = str("Body Copy") || str("Body");
  if (body.trim()) {
    const bodyKey = el["Body Copy"] !== undefined ? "Body Copy" : "Body";
    out.push({ id: elementKey(section.id, bodyKey), kind: "opener", text: firstSentence(body) });
  }

  if (section.type === "product_card" && str("One-Liner").trim()) {
    out.push({ id: elementKey(section.id, "One-Liner"), kind: "one_liner", text: str("One-Liner"), product: slugForCard(section, spec) });
  }

  const products = el["Products"];
  if (Array.isArray(products)) {
    (products as ProductInGrid[]).forEach((p, i) => {
      if (p?.one_liner?.trim()) {
        const slug = getProductSlugByName(p.name || "") || (p.name || "").toLowerCase();
        out.push({ id: gridProductKey(section.id, i), kind: "one_liner", text: p.one_liner, product: slug });
      }
    });
  }
  return out;
}

export function collectCheckElements(
  campaign: GeneratedCampaign,
  sectionStructure: SectionSpec[]
): CheckElement[] {
  const out: CheckElement[] = collectMetaElements(campaign.meta);
  campaign.sections.forEach((section, i) => {
    const spec = specForSection(sectionStructure, i, section.type);
    out.push(...collectSectionElements(section, spec));
  });
  return out;
}

// The target a match belongs to for a single targeted regeneration: "meta" for
// subject/preview lines, otherwise the owning section id.
export function targetForKey(id: string): { kind: "meta" } | { kind: "section"; sectionId: string } {
  if (id.startsWith("subject:") || id.startsWith("preview:")) return { kind: "meta" };
  return { kind: "section", sectionId: id.split("::")[0] };
}
