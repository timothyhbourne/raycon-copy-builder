import { NextRequest, NextResponse } from "next/server";
import { loadCampaign } from "@/lib/campaigns";
import { getLibraryCampaignById } from "@/lib/library";
import { loadSmsCampaign } from "@/lib/sms";
import { loadFlowEmail, parseFlowEmailId } from "@/lib/flows";
import { FLOW_TYPE_META, SMS_VARIANT_LABELS } from "@/lib/schemas";
import type { GeneratedCampaign, GeneratedSection, SectionSpec, ProductInGrid } from "@/lib/schemas";

// Normalized copy payloads for the planner. Resolves the id against every copy
// store: flow emails (composite ids) first, then the drafts store, the library,
// and SMS (the same fallthrough as the copy builder's load path).
//  - default: a COMPACT preview (drawer one-line summary).
//  - ?full=1: the COMPLETE document, every section in order with all elements
//    untruncated, for the full-copy viewer modal.
// No caching: the modal fetches fresh on every open so copy-builder edits show
// up next time ("projection" semantics). Auth: app-wide proxy gate.

interface CopyBase {
  id: string;
  /** "flow" is one email of a Flow, addressed by the composite id
   * "<flowId>::<emailId>" (see lib/flows.ts). It comes back in the same shape as
   * everything else, so CopyDocModal renders it with no changes. */
  source: "draft" | "library" | "flow";
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

/**
 * Resolve the Headline (and the Tagline it is paired with) to the SELECTED slate
 * candidate. elements.Headline already mirrors the selection, but preferring the
 * explicit slate metadata means the design handoff can never show one of the three
 * candidates that were not chosen.
 */
function resolveHeadlinePair(s: GeneratedSection): { Headline?: string; Tagline?: string } {
  if (!s.headline_variants?.length) return {};
  const pick = s.headline_variants[s.headline_selected ?? 0] ?? s.headline_variants[0];
  return { Headline: pick.text, ...(pick.tagline ? { Tagline: pick.tagline } : {}) };
}

/**
 * The chosen subject line / preview text FIRST, the alternatives after it. The
 * design handoff needs to know which one to build for; the others are still worth
 * seeing, so they are ordered behind it rather than dropped.
 */
function selectedFirst(lines: string[] | undefined, selected: number | undefined): string[] {
  if (!lines?.length) return [];
  const idx = selected != null && lines[selected] ? selected : 0;
  return [lines[idx], ...lines.filter((_, i) => i !== idx)];
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
  const pair = resolveHeadlinePair(s);
  if (pair.Headline) fields["Headline"] = pair.Headline;
  // Only overwrite a Tagline the section actually has.
  if (pair.Tagline && fields["Tagline"] !== undefined) fields["Tagline"] = pair.Tagline;
  return fields;
}

function fromStructured(campaign: GeneratedCampaign, base: CopyBase): CopyPreview {
  return {
    ...base,
    subject_lines: selectedFirst(campaign.meta?.subject_lines, campaign.meta?.subject_selected),
    preview_texts: selectedFirst(campaign.meta?.preview_texts, campaign.meta?.preview_selected),
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
    if (key === "Headline" || key === "Tagline") {
      const resolved = resolveHeadlinePair(s)[key] ?? String(value);
      if (resolved.length) elements.push({ label: key, value: resolved });
      continue;
    }
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
    subject_lines: selectedFirst(campaign.meta?.subject_lines, campaign.meta?.subject_selected),
    preview_texts: selectedFirst(campaign.meta?.preview_texts, campaign.meta?.preview_selected),
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

  // Flow emails first: a composite id can't resolve anywhere else, so the check
  // is both cheap and unambiguous.
  if (parseFlowEmailId(id)) {
    const resolved = await loadFlowEmail(id);
    if (!resolved) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const { flow, email } = resolved;
    const label = FLOW_TYPE_META[flow.type]?.label ?? flow.type;
    const base: CopyBase = {
      id,
      source: "flow",
      // A flow email pasted anywhere is meaningless without its flow and its
      // position, so the name carries both.
      campaign_name: `${flow.name} — Email ${email.position} of ${flow.emails.length}`,
      updated_at: flow.updated_at,
    };
    // The "conceit" slot is where the viewer shows a one-line what-is-this; for a
    // flow email that is its place in the arc plus when it fires.
    const context = [`${label} flow`, email.delay?.trim()].filter(Boolean).join(" · ");
    // An email linked before it was written (or rewritten back to empty) is an
    // empty document, not an error — the viewer says "nothing here yet" instead
    // of failing to open.
    const campaign = email.campaign ?? { meta: { subject_lines: [], preview_texts: [] }, sections: [] };
    return NextResponse.json(
      full
        ? fromStructuredFull(campaign, email.section_structure, context, base)
        : fromStructured(campaign, base)
    );
  }

  const draft = await loadCampaign(id);
  if (draft) {
    const base: CopyBase = { id, source: "draft", campaign_name: draft.campaign_name, updated_at: draft.updated_at };
    return NextResponse.json(
      full
        ? fromStructuredFull(draft.campaign, draft.section_structure, draft.chosen_conceit?.name, base)
        : fromStructured(draft.campaign, base)
    );
  }

  const lib = await getLibraryCampaignById(id);
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
  const sms = await loadSmsCampaign(id);
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
