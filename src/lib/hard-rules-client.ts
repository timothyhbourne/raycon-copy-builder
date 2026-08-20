// Client-side companion to src/lib/hard-rules-check.ts. Browser-safe: the
// checker is pure string math (no fs/next), so it bundles cleanly. Two jobs:
//   1. scrub* — apply the deterministic punctuation autofix (em/en dashes,
//      ellipses, stacked "!") to copy as it streams, so the banned characters
//      never reach the canvas. This runs with zero network round-trips.
//   2. collectHardRuleElements / summarizeReport — build the payload for
//      /api/hard-rules-check (the flagging pass for the non-fixable rules:
//      banned words, the retired "Classic", length caps) and render a short
//      human summary.
import type { GeneratedCampaign, GeneratedSection, CampaignMeta, ProductInGrid } from "./schemas";
import { autoFixMechanical, type HardRuleElement, type HardRuleReport, type CheckKind } from "./hard-rules-check";
import { isReviewElement } from "./element-families";

export { autoFixMechanical };
export type { HardRuleReport };

// Map a campaign element key to the checker's element kind (drives length caps).
function kindForKey(key: string): CheckKind {
  switch (key) {
    case "Headline": return "headline";
    case "Tagline": return "tagline";
    case "Subheader": return "subheader";
    case "Body Copy":
    case "Body": return "body";
    case "One-Liner": return "one_liner";
    case "Closing Line": return "closing";
    case "CTA": return "cta";
    case "Product Name": return "product_name"; // must equal a catalogue name
    default:
      // A reviews section's slots are "Review 1".."Review 6". Matching only the
      // literal "Review" classified every one of them as `generic`, so a real
      // customer quote was run through the length caps, the ban list and the
      // cliché list as if it were our copy — and the provenance rule, which is
      // scoped to the `review` kind, never saw them at all.
      if (isReviewElement(key)) return "review";
      return "generic";
  }
}

/** Apply the punctuation autofix to every string in a section's element map. */
export function scrubElements(elements: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(elements)) {
    // Reviews are real customer text — kept verbatim, never punctuation-scrubbed.
    // isReviewElement, not `k === "Review"`: a reviews section's slots are named
    // "Review 1".."Review 6", and scrubbing those mangled the em dash in their
    // "… — Jordan M." attribution, which both rewrote a customer's words and broke
    // the verbatim match that provenance depends on.
    if (isReviewElement(k)) { out[k] = v; continue; }
    if (typeof v === "string") {
      out[k] = autoFixMechanical(v);
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        typeof item === "string"
          ? autoFixMechanical(item)
          : item && typeof item === "object"
            ? scrubElements(item as Record<string, unknown>)
            : item
      );
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function scrubMeta(meta: CampaignMeta): CampaignMeta {
  return {
    ...meta,
    subject_lines: (meta.subject_lines ?? []).map(autoFixMechanical),
    preview_texts: (meta.preview_texts ?? []).map(autoFixMechanical),
  };
}

/** Flatten a campaign into elements the hard-rules checker understands. */
export function collectHardRuleElements(campaign: GeneratedCampaign): HardRuleElement[] {
  const out: HardRuleElement[] = [];
  (campaign.meta.subject_lines ?? []).forEach((t, i) => { if (t?.trim()) out.push({ id: `subject:${i}`, kind: "subject", text: t }); });
  (campaign.meta.preview_texts ?? []).forEach((t, i) => { if (t?.trim()) out.push({ id: `preview:${i}`, kind: "preview", text: t }); });

  campaign.sections.forEach((section: GeneratedSection) => {
    // Slate candidates the writer has NOT selected. elements.<key> mirrors only the
    // selected one, so without this a length cap or a banned word in candidate 3
    // goes unreported until the moment someone picks it.
    const selectedSubheader = section.subheader_selected ?? 0;
    (section.subheader_variants ?? []).forEach((text, i) => {
      if (i !== selectedSubheader && text?.trim()) {
        out.push({ id: `${section.id}::Subheader:variant:${i}`, kind: "subheader", text });
      }
    });
    const selectedHeadline = section.headline_selected ?? 0;
    (section.headline_variants ?? []).forEach((variant, i) => {
      if (i === selectedHeadline) return;
      if (variant.text?.trim()) out.push({ id: `${section.id}::Headline:variant:${i}`, kind: "headline", text: variant.text });
      if (variant.tagline?.trim()) out.push({ id: `${section.id}::Tagline:variant:${i}`, kind: "tagline", text: variant.tagline });
    });

    for (const [k, v] of Object.entries(section.elements as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) {
        const kind = kindForKey(k);
        out.push({
          id: `${section.id}::${k}`,
          kind,
          text: v,
          // A review is judged on WHERE IT CAME FROM, not on how it reads, so the
          // provenance record has to travel with it to the checker.
          ...(kind === "review" ? { provenance: section.review_provenance?.[k] } : {}),
        });
      } else if (Array.isArray(v)) {
        v.forEach((item, i) => {
          if (typeof item === "string") {
            if (item.trim()) out.push({ id: `${section.id}::${k}:${i}`, kind: kindForKey(k), text: item });
          } else if (item && typeof item === "object") {
            const p = item as ProductInGrid;
            if (typeof p.one_liner === "string" && p.one_liner.trim()) out.push({ id: `${section.id}::Products:${i}:one_liner`, kind: "one_liner", text: p.one_liner });
            if (typeof p.name === "string" && p.name.trim()) out.push({ id: `${section.id}::Products:${i}:name`, kind: "generic", text: p.name });
          }
        });
      }
    }
  });
  return out;
}

/** One-line human summary of the non-fixable violations, for a toast/notice. */
export function summarizeReport(report: HardRuleReport): string {
  const bits: string[] = [];
  for (const el of report.elements) {
    for (const v of el.violations) bits.push(v.detail);
  }
  for (const v of report.emailLevel) bits.push(v.detail);
  const unique = Array.from(new Set(bits));
  if (!unique.length) return "";
  const shown = unique.slice(0, 4).join("  •  ");
  return unique.length > 4 ? `${shown}  (+${unique.length - 4} more)` : shown;
}
