import type { GeneratedCampaign, ProductInGrid, SectionSpec } from "./schemas";

// Clipboard export for written copy (spec: FLOW_BUILDER_FIXES_SPEC.md Part 2).
//
// This was `handleCopyCampaign`, inline in the 1,800-line copy-builder page. The
// Flow Builder needs the same thing — a finished flow email that can't be pasted
// into a doc, a ticket or Slack exists only inside its own canvas — and copying
// the function across would have guaranteed the two drift. So it lives here,
// PURE: no clipboard, no DOM, no React. `writeToClipboard` is the only impure
// part, and it does nothing but hand these two strings to the browser.
//
// The HTML flavour is shaped for GOOGLE DOCS specifically: bold field labels,
// `<hr>` between sections, and product grids as real `<table>`s so a grid pastes
// as a grid instead of a list.

export interface CopyExport {
  html: string;
  text: string;
}

/**
 * The line under the title. Three parts rather than one string so the emphasis
 * survives into the HTML flavour: `label: **value** — note`. The Copy Builder
 * passes the conceit (`Conceit: <name> — <description>`); a flow email passes its
 * place in the sequence (`Email 2 of 4: Welcome — 1 day later`), because a flow
 * email pasted into a doc is useless without saying WHICH flow and WHERE in it.
 */
export interface ExportSubtitle {
  label: string;
  value: string;
  note?: string;
}

export interface CopyExportOpts {
  /** Heading for the block, upper-cased in both flavours. Omitted when empty. */
  title?: string;
  subtitle?: ExportSubtitle;
}

/** One copy document's worth of export, before the HTML document wrapper. */
interface Fragment {
  html: string;
  text: string;
}

export interface CopyExportItem {
  campaign: GeneratedCampaign;
  sectionStructure: SectionSpec[];
  opts?: CopyExportOpts;
}

const HR = "─────────────────────────────────────";
const TD_STYLE = "border:1px solid #e0e0e0;padding:10px;vertical-align:top;";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isProductList(v: unknown): v is ProductInGrid[] {
  return Array.isArray(v);
}

function buildFragment(
  campaign: GeneratedCampaign,
  sectionStructure: SectionSpec[],
  opts: CopyExportOpts = {},
): Fragment {
  const { title, subtitle } = opts;

  // ── Plain text ────────────────────────────────────────────────────────────
  const plainParts: string[] = [];
  if (title) plainParts.push(title.toUpperCase());
  if (subtitle) {
    plainParts.push(`${subtitle.label}: ${subtitle.value}${subtitle.note ? ` — ${subtitle.note}` : ""}`);
  }
  plainParts.push("");

  campaign.meta.subject_lines.forEach((s, i) => plainParts.push(`SUBJECT LINE ${i + 1}: ${s}`));
  campaign.meta.preview_texts.forEach((p, i) => plainParts.push(`PREVIEW TEXT ${i + 1}: ${p}`));

  campaign.sections.forEach((sec) => {
    plainParts.push(HR);
    Object.entries(sec.elements).forEach(([k, v]) => {
      if (isProductList(v)) {
        v.forEach((prod, pi) => {
          plainParts.push(`[${pi + 1}] ${prod.name}`);
          plainParts.push(`    ${prod.one_liner}`);
          plainParts.push(`    ${prod.cta}`);
          plainParts.push("");
        });
      } else {
        plainParts.push(`${k.toUpperCase()}: ${v}`);
      }
    });
  });

  // ── HTML (Google Docs renders bold labels + <hr> as divider lines) ────────
  const htmlParts: string[] = [];
  if (title) htmlParts.push(`<p><strong>${esc(title.toUpperCase())}</strong></p>`);
  if (subtitle) {
    htmlParts.push(
      `<p>${esc(subtitle.label)}: <strong>${esc(subtitle.value)}</strong>${subtitle.note ? ` — ${esc(subtitle.note)}` : ""}</p>`,
    );
  }

  // Subject lines and preview texts grouped into one paragraph each (no inter-line dividers)
  const metaLines: string[] = [];
  campaign.meta.subject_lines.forEach((s, i) => metaLines.push(`<strong>SUBJECT LINE ${i + 1}:</strong> ${esc(s)}`));
  campaign.meta.preview_texts.forEach((p, i) => metaLines.push(`<strong>PREVIEW TEXT ${i + 1}:</strong> ${esc(p)}`));
  if (metaLines.length) htmlParts.push(`<p>${metaLines.join("<br>")}</p>`);

  // Each section = one <hr> divider.
  // product_grid → HTML table with grid_cols columns.
  // Everything else → one <p> with fields joined by <br><br>.
  campaign.sections.forEach((sec, i) => {
    htmlParts.push("<hr>");

    if (sec.type === "product_grid") {
      // Look up grid_cols from the section structure spec (by position, then type)
      const spec = sectionStructure[i] ?? sectionStructure.find((s) => s.type === "product_grid");
      const cols = spec?.grid_cols ?? 2;

      // Separate subheader-type fields from the products array
      const headerFields: string[] = [];
      let products: ProductInGrid[] = [];
      Object.entries(sec.elements).forEach(([k, v]) => {
        if (isProductList(v)) {
          products = v;
        } else {
          headerFields.push(`<strong>${esc(k.toUpperCase())}:</strong> ${esc(v as string)}`);
        }
      });
      if (headerFields.length) htmlParts.push(`<p>${headerFields.join("<br><br>")}</p>`);

      // Build table: slice products into rows of `cols` cells
      const rows: string[] = [];
      for (let r = 0; r < products.length; r += cols) {
        const slice = products.slice(r, r + cols);
        const cells = slice.map((prod) =>
          `<td style="${TD_STYLE}"><strong>${esc(prod.name)}</strong><br><br>${esc(prod.one_liner)}<br><br><em>${esc(prod.cta)}</em></td>`
        );
        // Pad incomplete last row so table stays square
        while (cells.length < cols) cells.push(`<td style="${TD_STYLE}"></td>`);
        rows.push(`<tr>${cells.join("")}</tr>`);
      }
      htmlParts.push(`<table style="border-collapse:collapse;width:100%">${rows.join("")}</table>`);
    } else {
      const fieldLines: string[] = [];
      Object.entries(sec.elements).forEach(([k, v]) => {
        if (isProductList(v)) {
          v.forEach((prod) => {
            fieldLines.push(`<strong>PRODUCT:</strong> ${esc(prod.name)}`);
            fieldLines.push(`<strong>ONE-LINER:</strong> ${esc(prod.one_liner)}`);
            fieldLines.push(`<strong>CTA:</strong> ${esc(prod.cta)}`);
          });
        } else {
          fieldLines.push(`<strong>${esc(k.toUpperCase())}:</strong> ${esc(v as string)}`);
        }
      });
      htmlParts.push(`<p>${fieldLines.join("<br><br>")}</p>`);
    }
  });

  return { html: htmlParts.join(""), text: plainParts.join("\n") };
}

/** One copy document (a campaign, or one flow email) as HTML + plain text. */
export function buildCopyExport(
  campaign: GeneratedCampaign,
  sectionStructure: SectionSpec[],
  opts?: CopyExportOpts,
): CopyExport {
  const frag = buildFragment(campaign, sectionStructure, opts);
  return { html: `<html><body>${frag.html}</body></html>`, text: frag.text };
}

/**
 * Several documents in one export — a whole flow, each email under its own
 * heading, in sequence. This is the one that actually gets pasted into a brief or
 * a review doc, so it is worth having: it makes a flow legible to someone who
 * isn't in the app. Callers skip unwritten emails; an empty list yields an empty
 * export rather than a document of headings with nothing under them.
 */
export function buildMultiCopyExport(items: CopyExportItem[]): CopyExport {
  const frags = items.map((it) => buildFragment(it.campaign, it.sectionStructure, it.opts));
  return {
    html: `<html><body>${frags.map((f) => f.html).join("<hr>")}</body></html>`,
    // A blank line either side of the boundary, so two emails never read as one.
    text: frags.map((f) => f.text).join("\n\n\n"),
  };
}

/**
 * Put an export on the clipboard in BOTH flavours, so a paste into Google Docs
 * keeps its formatting and a paste into Slack or a terminal gets clean text.
 * Falls back to plain text where `ClipboardItem` is unavailable or refused.
 * Returns which flavour actually landed; throws only if even the fallback fails.
 */
export async function writeToClipboard(exported: CopyExport): Promise<"rich" | "plain"> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([exported.html], { type: "text/html" }),
        "text/plain": new Blob([exported.text], { type: "text/plain" }),
      }),
    ]);
    return "rich";
  } catch {
    await navigator.clipboard.writeText(exported.text);
    return "plain";
  }
}
