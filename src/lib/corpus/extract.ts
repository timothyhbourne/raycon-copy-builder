// L2 EXTRACT — turn a piece of copy into corpus elements with form signatures.
// Spec: docs/RECURSIVE_LEARNING_FRAMEWORK_SPEC.md §2.4 (L2), §2.3.
//
// PURE: no fs, no network, no store. Given a generated campaign (or a legacy flat
// library body) it returns the per-element records the corpus stores.
//
// This closes a gap the constructions index has: that index folds Subheader into
// "headlines" and Closing Line into "taglines", so the ELEMENT KIND is lost, and
// taglines / subheaders / CTAs / closing lines are written into it but never
// checked against it (src/lib/repetition-client.ts collects only Headline, body
// opener and one-liners). The corpus keeps every kind distinct, and the repetition
// check reads all of them.

import type {
  GeneratedCampaign, GeneratedSection, SectionSpec, ProductInGrid, LibraryCampaign,
} from "../schemas";
import { isProductCardType } from "../schemas";
import { getProductSlugByName } from "../products";
import { formSignature } from "./signature";
import type { CorpusElement, ElementKind } from "./types";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function firstSentence(text: string): string {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  const m = t.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : t).trim();
}

function el(
  kind: ElementKind,
  text: string,
  extra: { product_slug?: string; was_selected?: boolean; pattern?: string } = {},
): CorpusElement | null {
  const t = (text || "").trim();
  if (!t) return null;
  return {
    kind,
    text: t,
    signature: formSignature(t, extra.pattern),
    ...(extra.product_slug ? { product_slug: extra.product_slug } : {}),
    ...(extra.was_selected === undefined ? {} : { was_selected: extra.was_selected }),
  };
}

/** Elements of one generated section, with slate candidates expanded and the
 * shipped one marked. `spec` supplies the product binding when the section has
 * one. */
export function elementsFromSection(section: GeneratedSection, spec?: SectionSpec): CorpusElement[] {
  const out: (CorpusElement | null)[] = [];
  const e = section.elements ?? {};

  // --- Headline (+ its paired tagline), slate-aware -------------------------
  const hVariants = section.headline_variants ?? [];
  if (hVariants.length) {
    const chosen = section.headline_selected ?? 0;
    hVariants.forEach((v, i) => {
      out.push(el("headline", v.text, { was_selected: i === chosen, pattern: v.pattern }));
      if (v.tagline) out.push(el("tagline", v.tagline, { was_selected: i === chosen }));
    });
    // The canvas may have edited the mirrored strings after the pick; record them
    // too when they diverged, since THEY are what ships.
    const live = str(e["Headline"]);
    if (live && live !== hVariants[chosen]?.text) out.push(el("headline", live, { was_selected: true }));
    const liveTag = str(e["Tagline"]);
    if (liveTag && liveTag !== hVariants[chosen]?.tagline) out.push(el("tagline", liveTag, { was_selected: true }));
  } else {
    out.push(el("headline", str(e["Headline"])));
    out.push(el("tagline", str(e["Tagline"])));
  }

  // --- Subheader slate ------------------------------------------------------
  const sVariants = section.subheader_variants ?? [];
  if (sVariants.length) {
    const chosen = section.subheader_selected ?? 0;
    sVariants.forEach((v, i) => out.push(el("subheader", v, { was_selected: i === chosen })));
  } else {
    out.push(el("subheader", str(e["Subheader"])));
  }

  // --- The kinds that were written into the old index but never checked -----
  out.push(el("closing", str(e["Closing Line"])));
  out.push(el("cta", str(e["CTA"])));

  const body = str(e["Body Copy"]) || str(e["Body"]);
  if (body) out.push(el("opener", firstSentence(body)));

  // --- Product one-liners, product-scoped ----------------------------------
  if (isProductCardType(section.type)) {
    const slug = spec?.product_slug
      || getProductSlugByName(str(e["Product Name"]))
      || str(e["Product Name"]).toLowerCase();
    out.push(el("one_liner", str(e["One-Liner"]), slug ? { product_slug: slug } : {}));
  }
  const products = e["Products"];
  if (Array.isArray(products)) {
    for (const p of products as ProductInGrid[]) {
      if (!p?.one_liner) continue;
      const slug = getProductSlugByName(p.name || "") || (p.name || "").toLowerCase();
      out.push(el("one_liner", p.one_liner, slug ? { product_slug: slug } : {}));
      out.push(el("cta", p.cta || ""));
    }
  }
  // NOTE: the Review element is deliberately absent. It is real customer text,
  // exempt from every repetition check (same rule as repetition-client.ts).
  return out.filter((x): x is CorpusElement => x !== null);
}

/** Every element of a generated campaign, meta lines included. */
export function elementsFromCampaign(
  campaign: GeneratedCampaign,
  sectionStructure: SectionSpec[] = [],
): CorpusElement[] {
  const out: (CorpusElement | null)[] = [];
  const meta = campaign.meta ?? { subject_lines: [], preview_texts: [] };
  const subjectPick = meta.subject_selected ?? 0;
  const previewPick = meta.preview_selected ?? 0;
  (meta.subject_lines ?? []).forEach((s, i) => out.push(el("subject", s, { was_selected: i === subjectPick })));
  (meta.preview_texts ?? []).forEach((p, i) => out.push(el("preview", p, { was_selected: i === previewPick })));

  const specById = new Map(sectionStructure.map((s) => [s.id, s]));
  for (const section of campaign.sections ?? []) {
    out.push(...elementsFromSection(section, specById.get(section.id)));
  }
  return out.filter((x): x is CorpusElement => x !== null);
}

// ---------------------------------------------------------------------------
// Legacy flat bodies. Library entries ingested from docs/designs have no
// structured snapshot — only the "# Heading" block form written by
// campaignToLibraryBody. Best-effort, same parse the constructions index uses.
// ---------------------------------------------------------------------------
const HEADING_KINDS: [string, ElementKind][] = [
  ["Headline", "headline"],
  ["Tagline", "tagline"],
  ["Subheader", "subheader"],
  ["Subject Line", "subject"],
  ["Preview Text", "preview"],
  ["Closing Line", "closing"],
  ["CTA", "cta"],
];

export function elementsFromBody(body: string): CorpusElement[] {
  if (!body?.trim()) return [];
  const blocks = body.split(/\n(?=# )/).filter(Boolean);
  const linesOf = (heading: string): string[] => {
    const b = blocks.find((bl) => bl.match(/^# (.+)/)?.[1]?.trim() === heading);
    if (!b) return [];
    return b.replace(/^# .+\n?/, "").split("\n").map((l) => l.trim()).filter(Boolean);
  };
  const out: (CorpusElement | null)[] = [];
  for (const [heading, kind] of HEADING_KINDS) {
    for (const line of linesOf(heading)) out.push(el(kind, line));
  }
  const bodyLines = linesOf("Body Copy").length ? linesOf("Body Copy") : linesOf("Body");
  if (bodyLines.length) out.push(el("opener", firstSentence(bodyLines.join(" "))));
  for (const heading of ["Products", "One-Liner"]) {
    for (const line of linesOf(heading)) {
      const idx = line.indexOf(":");
      if (idx <= 0) continue;
      const name = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      const slug = getProductSlugByName(name) || name.toLowerCase();
      out.push(el("one_liner", value, slug ? { product_slug: slug } : {}));
    }
  }
  return out.filter((x): x is CorpusElement => x !== null);
}

/** Elements of a library entry: the structured snapshot when it has one, else the
 * flat body. */
export function elementsFromLibraryCampaign(entry: LibraryCampaign): CorpusElement[] {
  const structured = entry.structured?.campaign;
  if (structured) {
    const els = elementsFromCampaign(structured, entry.structured?.section_structure ?? []);
    if (els.length) return els;
  }
  return elementsFromBody(entry.body || "");
}
