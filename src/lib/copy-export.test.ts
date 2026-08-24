import { describe, it, expect } from "vitest";
import { buildCopyExport, buildMultiCopyExport } from "./copy-export";
import type { Conceit, GeneratedCampaign, SectionSpec } from "./schemas";

// The Copy Builder's export must be BYTE-IDENTICAL after the extraction — that is
// the acceptance criterion for Part 2, and the only way to prove it is to keep the
// pre-extraction implementation here as a reference oracle. `legacyCopyCampaign` is
// a verbatim transcription of the old inline `handleCopyCampaign` body (minus the
// clipboard call). If the two ever diverge, this test says so.
function legacyCopyCampaign(
  campaign: GeneratedCampaign,
  sectionStructure: SectionSpec[],
  name: string,
  chosenConceit: Conceit | null,
): { html: string; plain: string } {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const hr = "─────────────────────────────────────";

  const plainParts: string[] = [];
  plainParts.push(name.toUpperCase());
  if (chosenConceit) plainParts.push(`Conceit: ${chosenConceit.name} — ${chosenConceit.description}`);
  plainParts.push("");

  campaign.meta.subject_lines.forEach((s, i) => plainParts.push(`SUBJECT LINE ${i + 1}: ${s}`));
  campaign.meta.preview_texts.forEach((p, i) => plainParts.push(`PREVIEW TEXT ${i + 1}: ${p}`));

  campaign.sections.forEach((sec) => {
    plainParts.push(hr);
    Object.entries(sec.elements).forEach(([k, v]) => {
      if (Array.isArray(v)) {
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

  const plain = plainParts.join("\n");

  const htmlParts: string[] = [];
  htmlParts.push(`<p><strong>${esc(name.toUpperCase())}</strong></p>`);
  if (chosenConceit) {
    htmlParts.push(`<p>Conceit: <strong>${esc(chosenConceit.name)}</strong> — ${esc(chosenConceit.description)}</p>`);
  }

  const metaLines: string[] = [];
  campaign.meta.subject_lines.forEach((s, i) => metaLines.push(`<strong>SUBJECT LINE ${i + 1}:</strong> ${esc(s)}`));
  campaign.meta.preview_texts.forEach((p, i) => metaLines.push(`<strong>PREVIEW TEXT ${i + 1}:</strong> ${esc(p)}`));
  if (metaLines.length) htmlParts.push(`<p>${metaLines.join("<br>")}</p>`);

  const tdStyle = "border:1px solid #e0e0e0;padding:10px;vertical-align:top;";

  campaign.sections.forEach((sec, i) => {
    htmlParts.push("<hr>");

    if (sec.type === "product_grid") {
      const spec = sectionStructure[i] ?? sectionStructure.find((s) => s.type === "product_grid");
      const cols = spec?.grid_cols ?? 2;

      const headerFields: string[] = [];
      let products: { name: string; one_liner: string; cta: string }[] = [];
      Object.entries(sec.elements).forEach(([k, v]) => {
        if (Array.isArray(v)) {
          products = v as { name: string; one_liner: string; cta: string }[];
        } else {
          headerFields.push(`<strong>${esc(k.toUpperCase())}:</strong> ${esc(v as string)}`);
        }
      });
      if (headerFields.length) htmlParts.push(`<p>${headerFields.join("<br><br>")}</p>`);

      const rows: string[] = [];
      for (let r = 0; r < products.length; r += cols) {
        const slice = products.slice(r, r + cols);
        const cells = slice.map((prod) =>
          `<td style="${tdStyle}"><strong>${esc(prod.name)}</strong><br><br>${esc(prod.one_liner)}<br><br><em>${esc(prod.cta)}</em></td>`
        );
        while (cells.length < cols) cells.push(`<td style="${tdStyle}"></td>`);
        rows.push(`<tr>${cells.join("")}</tr>`);
      }
      htmlParts.push(`<table style="border-collapse:collapse;width:100%">${rows.join("")}</table>`);
    } else {
      const fieldLines: string[] = [];
      Object.entries(sec.elements).forEach(([k, v]) => {
        if (Array.isArray(v)) {
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

  return { html: `<html><body>${htmlParts.join("")}</body></html>`, plain };
}

const conceit: Conceit = { id: "c1", name: "Sound & Savings", description: "The deal is the story <here>" };

const structure: SectionSpec[] = [
  { id: "s1", type: "header" },
  { id: "s2", type: "product_grid", grid_cols: 3, grid_rows: 1 },
  { id: "s3", type: "product_card", product_slug: "everyday-earbuds" },
];

const campaign: GeneratedCampaign = {
  meta: {
    subject_lines: ["20% off & then some", "Hear <this>"],
    preview_texts: ["Ends Sunday"],
  },
  sections: [
    { id: "s1", type: "header", elements: { Headline: "Big & bold", Tagline: "Sound you keep" } },
    {
      id: "s2",
      type: "product_grid",
      elements: {
        Subheader: "Pick your pair",
        Products: [
          { name: "Everyday Earbuds", image_direction: "hero", one_liner: "All-day comfort & sound", cta: "Shop now" },
          { name: "Fitness Earbuds", image_direction: "hero", one_liner: "Sweatproof", cta: "Shop" },
          { name: "Performer", image_direction: "hero", one_liner: "Loud", cta: "Buy" },
          { name: "Magic", image_direction: "hero", one_liner: "Tiny", cta: "Get it" },
        ],
      },
    },
    {
      id: "s3",
      type: "product_card",
      elements: {
        "Product Name": "Everyday Earbuds",
        "One-Liner": "The pair you forget you're wearing",
        Products: [{ name: "Everyday Earbuds", image_direction: "hero", one_liner: "Comfort", cta: "Shop" }],
      },
    },
  ],
};

describe("buildCopyExport — Copy Builder parity", () => {
  it("is byte-identical to the pre-extraction implementation", () => {
    const legacy = legacyCopyCampaign(campaign, structure, "August Flash Sale", conceit);
    const next = buildCopyExport(campaign, structure, {
      title: "August Flash Sale",
      subtitle: { label: "Conceit", value: conceit.name, note: conceit.description },
    });
    expect(next.text).toBe(legacy.plain);
    expect(next.html).toBe(legacy.html);
  });

  it("is byte-identical with no conceit", () => {
    const legacy = legacyCopyCampaign(campaign, structure, "Campaign", null);
    const next = buildCopyExport(campaign, structure, { title: "Campaign" });
    expect(next.text).toBe(legacy.plain);
    expect(next.html).toBe(legacy.html);
  });

  it("renders a product grid as a padded table with grid_cols columns", () => {
    const { html } = buildCopyExport(campaign, structure, { title: "T" });
    // 4 products across 3 columns → 2 rows, the second padded to 3 cells.
    const rows = html.match(/<tr>/g) ?? [];
    expect(rows).toHaveLength(2);
    expect(html).toContain("<td style=\"border:1px solid #e0e0e0;padding:10px;vertical-align:top;\"></td>");
  });

  it("escapes HTML in copy but leaves the plain text alone", () => {
    const { html, text } = buildCopyExport(campaign, structure, { title: "T" });
    expect(html).toContain("Hear &lt;this&gt;");
    expect(text).toContain("Hear <this>");
  });
});

describe("buildMultiCopyExport", () => {
  const items = [
    { campaign, sectionStructure: structure, opts: { title: "Welcome flow", subtitle: { label: "Email 1 of 2", value: "Welcome", note: "Immediately" } } },
    { campaign, sectionStructure: structure, opts: { title: "Welcome flow", subtitle: { label: "Email 2 of 2", value: "Welcome", note: "1 day later" } } },
  ];

  it("emits each document in order, each under its own heading", () => {
    const { text, html } = buildMultiCopyExport(items);
    expect(text.indexOf("Email 1 of 2")).toBeLessThan(text.indexOf("Email 2 of 2"));
    expect(text).toContain("Email 1 of 2: Welcome — Immediately");
    expect(text).toContain("Email 2 of 2: Welcome — 1 day later");
    expect(html.match(/<p><strong>WELCOME FLOW<\/strong><\/p>/g)).toHaveLength(2);
  });

  it("wraps the HTML document exactly once", () => {
    const { html } = buildMultiCopyExport(items);
    expect(html.match(/<html>/g)).toHaveLength(1);
    expect(html.startsWith("<html><body>")).toBe(true);
    expect(html.endsWith("</body></html>")).toBe(true);
  });

  it("an empty list is an empty document, not a heading with nothing under it", () => {
    expect(buildMultiCopyExport([])).toEqual({ html: "<html><body></body></html>", text: "" });
  });
});
