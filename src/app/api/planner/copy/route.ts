import { NextRequest, NextResponse } from "next/server";
import { loadCampaign } from "@/lib/campaigns";
import { getLibraryCampaignById } from "@/lib/library";
import type { GeneratedCampaign, GeneratedSection } from "@/lib/schemas";

// Normalized copy preview for the planner drawer's Copy section. Looks up the id
// in the drafts store first, then the library (same fallthrough as the copy
// builder's load path), and returns a compact, render-ready shape. Auth: relies
// on the app-wide proxy gate, same posture as the other /api/planner routes.

interface CopyPreview {
  id: string;
  source: "draft" | "library";
  campaign_name: string;
  updated_at: string;
  subject_lines: string[];
  preview_texts: string[];
  sections: { type: string; fields: Record<string, string> }[];
}

// Map one structured section's elements to flat display strings: product grids
// flatten to "Name — one-liner — CTA" lines; a Subheader variant array collapses
// to the selected/first option; everything else stringifies.
function sectionToFields(s: GeneratedSection): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(s.elements)) {
    if (Array.isArray(value)) {
      if (value.length && typeof value[0] === "object") {
        fields[key] = value
          .map((p) => [p.name, p.one_liner, p.cta].filter(Boolean).join(" — "))
          .join("\n");
      } else {
        // Variant array (e.g. a raw Subheader) → first option.
        fields[key] = value.length ? String(value[0]) : "";
      }
    } else if (value) {
      fields[key] = String(value);
    }
  }
  // If this section carries Subheader variants, show the selected one.
  if (s.subheader_variants?.length) {
    const idx = s.subheader_selected ?? 0;
    fields["Subheader"] = s.subheader_variants[idx] ?? s.subheader_variants[0];
  }
  return fields;
}

function fromStructured(
  campaign: GeneratedCampaign,
  base: Pick<CopyPreview, "id" | "source" | "campaign_name" | "updated_at">
): CopyPreview {
  return {
    ...base,
    subject_lines: campaign.meta?.subject_lines ?? [],
    preview_texts: campaign.meta?.preview_texts ?? [],
    sections: (campaign.sections ?? []).map((s) => ({ type: s.type, fields: sectionToFields(s) })),
  };
}

// Legacy / doc-sourced library entries have only a flattened markdown body: blocks
// of `# Heading` + text. Same best-effort split the copy builder uses.
function fromLegacyBody(body: string, base: Pick<CopyPreview, "id" | "source" | "campaign_name" | "updated_at">): CopyPreview {
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

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 });

  // Drafts store first.
  const draft = loadCampaign(id);
  if (draft) {
    return NextResponse.json(fromStructured(draft.campaign, {
      id, source: "draft", campaign_name: draft.campaign_name, updated_at: draft.updated_at,
    }));
  }

  // Then the library.
  const lib = getLibraryCampaignById(id);
  if (lib) {
    const base = { id, source: "library" as const, campaign_name: lib.title, updated_at: lib.date };
    return NextResponse.json(
      lib.structured?.campaign ? fromStructured(lib.structured.campaign, base) : fromLegacyBody(lib.body, base)
    );
  }

  // Neither store — the client heals the stale link.
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
