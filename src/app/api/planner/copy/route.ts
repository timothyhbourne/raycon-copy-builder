import { NextRequest, NextResponse } from "next/server";
import { loadCampaign } from "@/lib/campaigns";
import { getLibraryCampaignById } from "@/lib/library";
import { loadSmsCampaign } from "@/lib/sms";
import { SMS_VARIANT_LABELS } from "@/lib/schemas";
import type { GeneratedCampaign, GeneratedSection, SectionSpec, ProductInGrid } from "@/lib/schemas";

// Normalized copy payloads for the planner. Looks up the id in the drafts store
// first, then the library (same fallthrough as the copy builder's load path).
//  - default: a COMPACT preview (drawer one-line summary).
//  - ?full=1: the COMPLETE document, every section in order with all elements
//    untruncated, for the full-copy viewer modal.
// No caching: the modal fetches fresh on every open so copy-builder edits show
// up next time ("projection" semantics). Auth: app-wide proxy gate.

interface CopyBase {
  id: string;
  source: "draft" | "library";
  campaign_name: string;
  updated_at: string;
}

// ---- compact preview (drawer summary) ----
interface CopyPreview extends CopyBase {
  subject_lines: string[];
  preview_texts: string[];
  sections: { type: string; fields: Record<string, string> }[];
}

// ---- full document (viewer modal) ----
interface FullElement { label: string; value: string }
interface FullProduct { name: string; one_liner: string; cta: string }
interface FullSection {
  type: string;
  elements: FullElement[];      // ordered scalar elements (Subheader resolved to selected)
  products?: FullProduct[];     // present for product grids
  grid_cols?: number;
  grid_rows?: number;
}
interface CopyFull extends CopyBase {
  conceit_name?: string;
  subject_lines: string[];
  preview_texts: string[];
  sections: FullSection[];
}

// Resolve a section's Subheader to the SELECTED variant only (fall back to
// variant 0). elements.Subheader already mirrors the selection, but prefer the
// explicit variant metadata when present so we never leak the other two.
function resolveSubheader(s: GeneratedSection, raw: string): string {
  if (s.subheader_variants?.length) {
    const idx = s.subheader_selected ?? 0;
    return s.subheader_variants[idx] ?? s.subheader_variants[0];
  }
  return raw;
}

function sectionToFields(s: GeneratedSection): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(s.elements)) {
    if (Array.isArray(value)) {
      if (value.length && typeof value[0] === "object") {
        fields[key] = (value as ProductInGrid[]).map((p) => [p.name, p.one_liner, p.cta].filter(Boolean).join(" — ")).join("\n");
      } else {
        fields[key] = value.length ? String(value[0]) : "";
      }
    } else if (value) {
      fields[key] = String(value);
    }
  }
  if (s.subheader_variants?.length) {
    fields["Subheader"] = s.subheader_variants[s.subheader_selected ?? 0] ?? s.subheader_variants[0];
  }
  return fields;
}

function fromStructured(campaign: GeneratedCampaign, base: CopyBase): CopyPreview {
  return {
    ...base,
    subject_lines: campaign.meta?.subject_lines ?? [],
    preview_texts: campaign.meta?.preview_texts ?? [],
    sections: (campaign.sections ?? []).map((s) => ({ type: s.type, fields: sectionToFields(s) })),
  };
}

function fromLegacyBody(body: string, base: CopyBase): CopyPreview {
  const subject_lines: string[] = [];
  const preview_texts: string[] = [];
  const sections: { type: string; fields: Record<string, string> }[] = [];
  for (const block of body.split(/\n(?=# )/).filter(Boolean)) {
    const heading = block.match(/^# (.+)/)?.[1]?.trim() ?? "Section";
    const content = block.replace(/^# .+\n?/, "").trim();
    if (heading === "Subject Line") subject_lines.push(...content.split("\n").map((l) => l.trim()).filter(Boolean));
    else if (heading === "Preview Text") preview_texts.push(...content.split("\n").map((l) => l.trim()).filter(Boolean));
    else sections.push({ type: "body", fields: { [heading]: content } });
  }
  return { ...base, subject_lines, preview_texts, sections };
}

// ---- full builders ----
function fullSection(s: GeneratedSection, spec: SectionSpec | undefined): FullSection {
  const elements: FullElement[] = [];
  let products: FullProduct[] | undefined;
  for (const [key, value] of Object.entries(s.elements)) {
    if (Array.isArray(value)) {
      if (value.length && typeof value[0] === "object") {
        products = (value as ProductInGrid[]).map((p) => ({ name: p.name, one_liner: p.one_liner, cta: p.cta }));
      } else if (key === "Subheader") {
        elements.push({ label: key, value: resolveSubheader(s, value.length ? String(value[0]) : "") });
      } else {
        elements.push({ label: key, value: (value as unknown[]).map(String).join("\n") });
      }
      continue;
    }
    if (key === "Subheader") { elements.push({ label: key, value: resolveSubheader(s, String(value)) }); continue; }
    if (value != null && String(value).length) elements.push({ label: key, value: String(value) });
  }
  const out: FullSection = { type: s.type, elements };
  if (products) {
    out.products = products;
    out.grid_cols = spec?.grid_cols ?? (Math.min(products.length, 2) || 1);
    out.grid_rows = spec?.grid_rows ?? Math.ceil(products.length / (out.grid_cols || 1));
  }
  return out;
}

function fromStructuredFull(
  campaign: GeneratedCampaign,
  sectionStructure: SectionSpec[] | undefined,
  conceitName: string | undefined,
  base: CopyBase
): CopyFull {
  const specs = sectionStructure ?? [];
  return {
    ...base,
    conceit_name: conceitName || undefined,
    subject_lines: campaign.meta?.subject_lines ?? [],
    preview_texts: campaign.meta?.preview_texts ?? [],
    // campaign.sections and section_structure are generated in the same order;
    // zip by index to recover product-grid dimensions.
    sections: (campaign.sections ?? []).map((s, i) => fullSection(s, specs[i])),
  };
}

function fromLegacyBodyFull(body: string, conceitName: string | undefined, base: CopyBase): CopyFull {
  const subject_lines: string[] = [];
  const preview_texts: string[] = [];
  const sections: FullSection[] = [];
  for (const block of body.split(/\n(?=# )/).filter(Boolean)) {
    const heading = block.match(/^# (.+)/)?.[1]?.trim() ?? "Section";
    const content = block.replace(/^# .+\n?/, "").trim();
    if (heading === "Subject Line") subject_lines.push(...content.split("\n").map((l) => l.trim()).filter(Boolean));
    else if (heading === "Preview Text") preview_texts.push(...content.split("\n").map((l) => l.trim()).filter(Boolean));
    else sections.push({ type: "body", elements: [{ label: heading, value: content }] });
  }
  return { ...base, conceit_name: conceitName || undefined, subject_lines, preview_texts, sections };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const full = searchParams.get("full") === "1";
  if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 });

  const draft = loadCampaign(id);
  if (draft) {
    const base: CopyBase = { id, source: "draft", campaign_name: draft.campaign_name, updated_at: draft.updated_at };
    return NextResponse.json(
      full
        ? fromStructuredFull(draft.campaign, draft.section_structure, draft.chosen_conceit?.name, base)
        : fromStructured(draft.campaign, base)
    );
  }

  const lib = getLibraryCampaignById(id);
  if (lib) {
    const base: CopyBase = { id, source: "library", campaign_name: lib.title, updated_at: lib.date };
    if (full) {
      return NextResponse.json(
        lib.structured?.campaign
          ? fromStructuredFull(lib.structured.campaign, lib.structured.section_structure, lib.conceit, base)
          : fromLegacyBodyFull(lib.body, lib.conceit, base)
      );
    }
    return NextResponse.json(
      lib.structured?.campaign ? fromStructured(lib.structured.campaign, base) : fromLegacyBody(lib.body, base)
    );
  }

  // SMS campaigns live in their own store. Return an SMS-shaped payload the
  // viewer renders as three variants; the compact form summarizes the selected one.
  const sms = loadSmsCampaign(id);
  if (sms) {
    const selectedText = sms.variants[sms.selected_variant]?.text ?? sms.variants[0]?.text ?? "";
    const base = { id, source: "sms" as const, campaign_name: sms.name, updated_at: sms.updated_at };
    if (full) {
      return NextResponse.json({
        ...base,
        kind: "sms",
        subject_lines: [],
        preview_texts: [],
        sections: [],
        variants: sms.variants,
        selected_variant: sms.selected_variant,
      });
    }
    return NextResponse.json({
      ...base,
      kind: "sms",
      subject_lines: selectedText ? [selectedText] : [],
      preview_texts: [],
      sections: sms.variants.map((v, i) => ({
        type: "sms",
        fields: { [SMS_VARIANT_LABELS[i] ?? `Variant ${i + 1}`]: v.text },
      })),
    });
  }

  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
