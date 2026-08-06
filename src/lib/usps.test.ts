import { describe, it, expect, vi } from "vitest";
import {
  parseProductUsps, parseProductUspBanks, parseCompanyUsps, formatUsp,
  getProductUsps, getCompanyUsps, getAllProductUspBanks,
} from "./usps";
import { PRODUCT_CATEGORIES } from "./products";

const DOC = `# Raycon Product USP Banks

Intro prose that must not be parsed as a bank.

\`\`\`
## SKU — Product Name
- **Not a real USP:** this lives inside a fence. \`[fit]\`
\`\`\`

---

## O25 — Fitness Open Earbuds
**Source:** https://rayconglobal.com/products/fitness-open-earbuds
**Verified:** 2026-08-06

- **Secure fit:** Multi-angular hook adjusts to your ear so they stay put through
  sprints and everything else. \`[fit]\`
- **40 hour total battery:** 8 hours per charge plus the case. \`[battery]\` \`[value]\`
- **IPX5 waterproof:** Rinses off sweat and shrugs off rain. \`[durability] [design]\`
- **Untested claim:** Something the page did not confirm. \`[fit] [unverified]\`
- **No tags at all:** A benefit with no tag group.

---

## E60 — Sleep Earbuds
**Source:** https://rayconglobal.com/products/sleep-earbuds
**Verified:** 2026-08-06

- **Ultra-slim profile:** Low enough to lie on. \`[design]\`
`;

const COMPANY_DOC = `# Raycon Company USP Bank

Preamble.

## Returns and guarantee
**Source:** https://rayconglobal.com/policies/refund-policy
**Verified:** 2026-08-06

- **30 day satisfaction guarantee:** A full 30 days from purchase to decide. \`[returns]\`
- **Free returns:** Contradicted by the published policy. \`[returns] [unverified]\`

## Brand proof
**Verified:** 2026-08-06

- **Over 57,000 five-star reviews:** More than 57,000 people left five stars. \`[proof]\`
`;

describe("parseProductUspBanks", () => {
  const banks = parseProductUspBanks(DOC);

  it("parses one bank per ## block, keyed by SKU", () => {
    expect(banks.map((b) => b.sku)).toEqual(["O25", "E60"]);
  });

  it("captures the product name, source and verified date", () => {
    expect(banks[0]).toMatchObject({
      sku: "O25",
      name: "Fitness Open Earbuds",
      source: "https://rayconglobal.com/products/fitness-open-earbuds",
      verified: "2026-08-06",
    });
  });

  it("ignores headings inside fenced code blocks", () => {
    // The format example in the doc header contains "## SKU — Product Name".
    expect(banks.some((b) => b.sku === "SKU")).toBe(false);
  });

  it("folds a hard-wrapped continuation line back onto its bullet", () => {
    expect(banks[0].usps[0].benefit).toBe(
      "Multi-angular hook adjusts to your ear so they stay put through sprints and everything else."
    );
  });
});

describe("tag handling", () => {
  const [o25] = parseProductUspBanks(DOC);

  it("reads tags split across separate backtick groups, in source order", () => {
    expect(o25.usps[1].tags).toEqual(["battery", "value"]);
  });

  it("reads multiple tags inside one backtick group", () => {
    expect(o25.usps[2].tags).toEqual(["durability", "design"]);
  });

  it("tolerates a bullet with no tag group", () => {
    const untagged = o25.usps.find((u) => u.label === "No tags at all");
    expect(untagged).toMatchObject({ tags: [], benefit: "A benefit with no tag group." });
  });

  it("lifts `unverified` out of tags onto its own flag", () => {
    const u = o25.usps.find((x) => x.label === "Untested claim");
    expect(u?.unverified).toBe(true);
    expect(u?.tags).toEqual(["fit"]);
  });
});

describe("parseProductUsps", () => {
  it("returns a SKU-keyed record", () => {
    const map = parseProductUsps(DOC);
    expect(Object.keys(map)).toEqual(["O25", "E60"]);
    expect(map.E60[0].label).toBe("Ultra-slim profile");
  });
});

describe("malformed input", () => {
  it("skips a block with no USP bullets rather than emitting an empty bank", () => {
    const banks = parseProductUspBanks(`## X99 — Ghost Product\n**Verified:** 2026-08-06\n\nNo bullets here.\n`);
    expect(banks).toEqual([]);
  });

  it("skips a bullet with an empty benefit and logs, keeping its siblings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const banks = parseProductUspBanks(
      `## O25 — Fitness Open Earbuds\n\n- **Empty one:**\n- **Good one:** A real benefit. \`[fit]\`\n`
    );
    expect(banks[0].usps.map((u) => u.label)).toEqual(["Good one"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("ignores prose bullets that are not USPs", () => {
    const banks = parseProductUspBanks(
      `## O25 — Fitness Open Earbuds\n\n- just a note, not a USP\n- **Good one:** A real benefit. \`[fit]\`\n`
    );
    expect(banks[0].usps).toHaveLength(1);
  });

  it("returns nothing for an empty document", () => {
    expect(parseProductUspBanks("")).toEqual([]);
    expect(parseCompanyUsps("")).toEqual([]);
  });
});

describe("parseCompanyUsps", () => {
  const usps = parseCompanyUsps(COMPANY_DOC);

  it("tags each entry with its theme heading", () => {
    expect(usps.map((u) => u.theme)).toEqual([
      "Returns and guarantee", "Returns and guarantee", "Brand proof",
    ]);
  });

  it("keeps unverified entries in the raw parse (the accessor filters them)", () => {
    expect(usps.find((u) => u.label === "Free returns")?.unverified).toBe(true);
  });
});

describe("getProductUsps (live data)", () => {
  it("excludes unverified entries from what reaches a prompt", () => {
    // E26 has no live product page; every entry in its bank is [unverified].
    expect(getProductUsps("E26")).toEqual([]);
    const raw = getAllProductUspBanks().find((b) => b.sku === "E26");
    expect(raw && raw.usps.length).toBeGreaterThan(0);
  });

  it("is case-insensitive on the SKU", () => {
    expect(getProductUsps("o25").length).toBe(getProductUsps("O25").length);
  });

  it("returns an empty bank for an unknown product rather than throwing", () => {
    expect(getProductUsps("NOPE")).toEqual([]);
    expect(getProductUsps("")).toEqual([]);
  });

  it("gives every catalogue SKU a bank of at least 8 verified USPs", () => {
    const missing = PRODUCT_CATEGORIES
      .flatMap((c) => c.products)
      .filter((p) => getProductUsps(p.id).length < 8)
      .map((p) => `${p.id} (${getProductUsps(p.id).length})`);
    expect(missing).toEqual([]);
  });
});

describe("getCompanyUsps (live data)", () => {
  const usps = getCompanyUsps();

  it("has verified shipping, returns, warranty and proof entries", () => {
    const themes = new Set(usps.map((u) => u.theme));
    expect(themes).toContain("Shipping and delivery");
    expect(themes).toContain("Returns and guarantee");
    expect(themes).toContain("Warranty and support");
    expect(themes).toContain("Brand proof");
  });

  it("never surfaces the contradicted free-returns claim", () => {
    expect(usps.some((u) => u.label === "Free returns")).toBe(false);
  });
});

describe("formatUsp", () => {
  it("renders label, benefit and tags as one prompt bullet", () => {
    expect(formatUsp({ label: "IPX5 waterproof", benefit: "Shrugs off rain.", tags: ["durability"] }))
      .toBe("• IPX5 waterproof: Shrugs off rain. [durability]");
  });

  it("omits the bracket when a USP has no tags", () => {
    expect(formatUsp({ label: "A", benefit: "B.", tags: [] })).toBe("• A: B.");
  });
});
