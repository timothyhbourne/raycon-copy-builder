# USP System — Product USP Bank, Company USP Bank & Modular USPs Section

**Status:** Ready to implement
**Area:** Product data (`data/products.md`, `src/lib/products.ts`), the USPs section (`src/lib/schemas.ts`, `src/components/SectionBuilder.tsx`, `src/lib/prompts/generate.ts`, `src/lib/prompts/regenerate-section.ts`)
**Goal:** Stop the USPs section producing generic, wrong-product, or invented benefits. Give every product a verified USP bank, give the brand its own company USP bank, and make the USPs section modular — variable USP count, per-USP choice of product vs. company source, and a removable Subheader.

---

## 1. Root cause (why USPs come out irrelevant today)

This is a **data + binding** problem, not a prompt-tuning problem. Four concrete defects:

1. **The USPs section has no product binding.** `SectionSpec` supports `product_slug` for `product_card` / `product_card_review` only (`isProductCardType`). A `usps` section has *no* idea which product it is about, so the model guesses — often pulling features from whichever product it saw last in the catalogue.

2. **The entire catalogue is injected as one prompt blob.** `data/products.md` is loaded wholesale by `getProducts()` into `buildSystemBlocks()`. Every product's features are in context at once, with nothing scoping them to this section — which is precisely how features from the wrong product leak in.

3. **There is no USP data to draw on — only terse spec strings.** Each product carries a single comma-joined `- **Key features:**` line (~4–6 items) written as specs ("IPX5 Water Resistant, 40 Hour Total Battery"), not as benefits. There is no bank of 10 benefit-phrased USPs per product, so the model pads with generic filler.

4. **There is no company/brand USP source at all.** `src/lib/prompts/regenerate-section.ts` literally instructs the model to *avoid* claiming free shipping, free returns, or a warranty "the data does not state" — because that data doesn't exist anywhere. So brand-level USPs are either omitted or invented.

Plus two flexibility gaps the user hit:
5. **`Subheader` is mandatory** — `SECTION_CATALOGUE.usps = ["Subheader", "USP 1", "USP 2", "USP 3", "CTA"]`, and `OPTIONAL_ELEMENTS` can only *add* elements, never remove required ones.
6. **The USP count is hard-coded to 3.**

---

## 2. Ground rules

1. **Next.js 16**; TypeScript `strict`; no `any`. Read `node_modules/next/dist/docs/` before routing/config changes.
2. **Truth over persuasion.** Every USP must be verifiable on the live product page or an authoritative internal source. **Never invent** shipping terms, warranty length, return windows, or certifications. If a claim can't be verified, it does not go in the bank.
3. **Backward compatibility.** Existing saved campaigns and library entries use `usps` with 3 USPs + Subheader + CTA. They must keep loading and rendering unchanged (see §7).
4. **Don't bloat the system prompt.** The new USP banks must **not** be appended wholesale to the global system blocks — that would worsen defect #2. They are injected **per section, scoped to the bound product** (§5.3).
5. Reuse existing patterns: the `product_slug` + "Auto (assign in order)" pattern from product cards, the `optional_elements` chip UI, and the boundary-validation approach in `src/lib/validation/`.

---

## 3. Part A — The product USP bank

### 3.1 Where it lives
Create **`data/product-usps.md`** — a dedicated, human-editable document, one block per product, parsed into structured data at load time.

**Why a separate file rather than extending `products.md`:** `products.md` is injected wholesale into every prompt. Adding ~150 USP lines there would put every product's USPs in context on every generation — making the cross-contamination bug worse. A separate file lets the app parse it and inject **only** the relevant product's USPs.

### 3.2 Format
Keyed by SKU so it joins cleanly to `PRODUCT_CATEGORIES` in `src/lib/products.ts`:

```md
## O25 — Fitness Open Earbuds
**Source:** https://rayconglobal.com/products/fitness-open-earbuds
**Verified:** 2026-08-06

- **Secure fit:** Multi-angular hook adjusts to your ear so they stay put through
  sprints, burpees, and everything else. `[fit]`
- **40-hour total battery:** 8 hours per charge plus the case — a full week of
  workouts between plug-ins. `[battery]`
- **IPX5 waterproof:** Rinses off sweat and shrugs off rain. `[durability]`
...
```

Per USP: a **short bold label**, a **one-sentence benefit** (benefit-led, not a bare spec), and an optional **`[tag]`** for filtering (`fit`, `battery`, `sound`, `durability`, `comfort`, `controls`, `connectivity`, `awareness`, `design`, `value`).

Rules for authoring:
- **8–12 USPs per product**, ordered strongest-first.
- Benefit-phrased: state the spec *and* what it does for the reader.
- Product-specific — nothing that could be said of any earbud.
- Numerals per the existing brand rules; no em dashes; no invented claims.

### 3.3 Population + verification (the research pass)
For **every** product in `PRODUCT_CATEGORIES` (O15, O25, O55, B42, E25, E26, E45, E60, E75, E95, H10, H20, H41, NOTETAKER, and the Fast Charging accessories):

1. Open the live product page (URLs already in `products.md`; `getProductHandle()` resolves the rest).
2. Extract genuine, page-supported features and rewrite each as a benefit.
3. Record `**Source:**` URL and `**Verified:**` date per product.
4. Reconcile against the existing `- **Key features:**` line in `products.md`; where they disagree, **the live page wins** and `products.md` gets corrected in the same pass.
5. Flag anything unverifiable with `[unverified]` — the loader must **exclude** `[unverified]` USPs from prompts (§3.4).

Note the known data gaps to resolve during this pass: E26's URL is marked *"not in canonical product list"*, and some accessories have no handle.

### 3.4 Loading
Create **`src/lib/usps.ts`**:
- `parseProductUsps(md: string): Record<string, ProductUsp[]>` — pure, unit-tested parser.
- `ProductUsp = { label: string; benefit: string; tags: string[]; unverified?: boolean }`
- `getProductUsps(sku: string): ProductUsp[]` — reads via `src/lib/data.ts` (bundled static content, read-only — exempt from the storage seam, consistent with §3.3 of `ARCHITECTURE_REMEDIATION_SPEC.md`), filtering out `unverified` entries.
- Validate the parse result with a zod schema in `src/lib/validation/`; log and skip malformed blocks rather than throwing.
- Add `scripts/verify-usps.ts`: asserts every SKU in `PRODUCT_CATEGORIES` has a bank of ≥N USPs and reports missing/unverified ones. Wire as `npm run verify:usps`.

---

## 4. Part B — The company USP bank

### 4.1 Where it lives
Create **`data/company-usps.md`** — brand-level selling points, same bullet format, grouped by theme:

- **Shipping & delivery** (only what is actually true — verified thresholds/timing)
- **Returns & guarantee** (real window and terms)
- **Warranty & support**
- **Brand proof** (scale/credibility claims that are substantiated — e.g. verified review volume)
- **Value positioning** (premium sound at a fair price, etc.)

Every entry needs a `**Verified:**` date and, where applicable, a source. **This file is the single source of truth that ends the "never invent free shipping" problem** — once populated, the model can state these because they're verified; anything absent remains forbidden.

### 4.2 The live offer is separate
The current promotion is **not** stored here — it comes from the brief at generation time and already exists: `offer`, `promo_code`, `occasion`, plus `deadline_language` computed by `compileBrief()` (`src/lib/brief/compile.ts`). A company-sourced USP slot receives **both** the company bank *and* the live offer context, so it can render the offer as a benefit.

This preserves the existing hard rule: offer mechanics get **woven into** a benefit, never tacked onto a product spec (see the `uspsNote` in `regenerate-section.ts`).

### 4.3 Loading
Extend `src/lib/usps.ts` with `getCompanyUsps(): CompanyUsp[]` (same parse/validate/filter approach).

---

## 5. Part C — The modular USPs section

### 5.1 Schema (`src/lib/schemas.ts`)

```ts
export type UspSource = "product" | "company";

export interface UspSlot {
  source: UspSource;
  /** Product-sourced slots only. Undefined = Auto (hero product, else first featured). */
  product_slug?: string;
  /** Optional steering for this single USP, e.g. "lead on battery". */
  focus?: string;
}
```

Add to `SectionSpec` (all optional, so existing saved sections stay valid):
- `usp_slots?: UspSlot[]` — the per-USP configuration. Length defines the USP count.
- `removed_elements?: string[]` — **new general mechanism** for dropping otherwise-required elements.

Add alongside `OPTIONAL_ELEMENTS`:
```ts
/** Required elements that MAY be removed per section (mirror of OPTIONAL_ELEMENTS). */
export const REMOVABLE_ELEMENTS: Partial<Record<SectionType, string[]>> = {
  usps: ["Subheader", "CTA"],
  body: ["Subheader"],
  cta_bridge: ["Subheader"],
};
```
Keep a **minimum**: a `usps` section must retain at least 2 USP slots; removal must never empty a section.

**Element naming:** stays `USP 1 … USP N` so the canvas, stream parser, and library format need no changes. USP **count** becomes `usp_slots.length` (default 3 when absent).

### 5.2 UI (`src/components/SectionBuilder.tsx`)
When `s.type === "usps"`, render a compact slot list (mirroring the existing bundle/product-card control style):

```
USPs
  1  [Product ▾] [Fitness Open Earbuds ▾]   ✕
  2  [Product ▾] [Auto (hero product)  ▾]   ✕
  3  [Company ▾]                            ✕
  + Add USP                    (max 5, min 2)
```

- **Source dropdown** per slot: Product / Company. Choosing Company hides the product picker.
- **Product picker** offers the campaign's featured products plus **"Auto (hero product)"**, exactly like the product-card picker.
- Optional per-slot focus input (small, collapsed by default — don't clutter).
- **Removable-element chips** reusing the existing `optional_elements` chip pattern, inverted: active-by-default chips for `Subheader` / `CTA` that can be switched off. This is what lets a section run product card → USPs with no subheader.
- Show a hint when a product slot has no USP bank yet ("No USPs recorded for this product — add them in `data/product-usps.md`").

Because `SectionBuilder` already supports drag-reorder and add-anywhere, the USPs section becomes freely placeable with no extra work — that satisfies the "modular, add it anywhere" requirement.

### 5.3 Prompt injection (`src/lib/prompts/generate.ts` → `buildSectionList`)
This is the fix for the core bug. For a `usps` section, emit **per-slot** instructions and inject **only the relevant banks**:

```
- section 3 — type: usps
  elements required: USP 1, USP 2, USP 3        ← Subheader/CTA omitted when removed
  USP 1 — PRODUCT USP for Fitness Open Earbuds (SKU O25). Choose the single
    strongest unused benefit from this product's USP bank and write it in Raycon
    voice. This USP must be about this product only.
    Available USPs for O25:
      • Secure fit: Multi-angular hook … [fit]
      • 40-hour total battery: … [battery]
      … (that product's bank ONLY)
  USP 2 — PRODUCT USP for <Auto-resolved product> …
  USP 3 — COMPANY USP. Draw from the verified company bank below and/or express
    the live offer as a benefit. Never invent shipping, returns, or warranty terms
    not listed here.
    Company USP bank: • 30-day returns … • 1-year warranty …
    Live offer: 30% off sitewide, code GOALS, ends Thursday night
```

Rules to carry into the prompt text:
- Each USP must draw from a **different** entry in the bank — no two USPs restating the same benefit.
- Product USPs must not reference any product other than the bound one.
- Company USPs may weave in the offer; product USPs must **not** have offer mechanics appended (existing rule, now enforceable because sources are explicit).
- Do **not** inject any other product's bank into this section.

**Auto-resolution:** resolve `product_slug: undefined` at expansion time in `src/lib/expand-sections.ts` (alongside `expandProductCardSections`) to `hero_product_slug`, else the first entry of `products_featured`. Unit-test this.

### 5.4 Removed elements — the ripple to handle carefully
`removed_elements` must be honoured everywhere the element list is derived:
- `buildSectionList` and `buildSectionExampleLines` (`generate.ts`) — omit removed elements from both the required list and the JSONL skeleton.
- **The Subheader-variants rule.** The global output rule states *"The 'Subheader' element, wherever it appears, must be a JSON array of EXACTLY 3 distinct option strings."* When `Subheader` is removed for a section, that section's skeleton must omit it entirely, and `subheader_variants` / `subheader_selected` must not be expected for it. Verify `src/lib/normalize-section.ts` (`extractSubheaderVariants`) tolerates its absence.
- `src/lib/prompts/regenerate-section.ts` — its `uspsNote` and `hasSubheader` logic must respect slots and removals. **Rewrite `uspsNote`** to describe the slot plan rather than the current fixed "divide the labour across three USPs" guidance.
- Canvas/rendering (`src/components/CampaignCanvas.tsx`, `SectionBlock.tsx`) — render N USPs and tolerate a missing Subheader/CTA without layout breakage.
- Section variations (`/api/section-variations`) and the hard-rules/repetition collectors — must handle variable element sets.

---

## 6. Part D — Optional quality upgrade (recommended)

With a real USP bank in place, add **anti-repetition across sends** for USPs: record which USP bank entries were used in recent campaigns (the `src/lib/constructions.ts` recency index already does this for other constructions) and prefer unused entries. This stops the same three USPs appearing in every email — the deeper form of the "regurgitation" complaint. Keep it a soft preference, not a hard block.

---

## 7. Backward compatibility

- `usp_slots` absent → behave exactly as today: 3 product-sourced USPs, product Auto-resolved, Subheader + CTA present.
- `removed_elements` absent → all catalogue elements present.
- Existing library entries and `structured` snapshots must reload and render unchanged.
- Add a `schema_version`-aware migration note if the validation layer needs it (`src/lib/validation/`).

---

## 8. Files

**Create**
- `data/product-usps.md` — per-product USP banks (§3).
- `data/company-usps.md` — company/brand USP bank (§4).
- `src/lib/usps.ts` — parsers + accessors.
- `src/lib/usps.test.ts` — parser, tag handling, `unverified` exclusion, missing-product fallback.
- `scripts/verify-usps.ts` — coverage/verification report (`npm run verify:usps`).

**Edit**
- `data/products.md` — correct any features contradicted by the live pages; resolve the E26 URL gap.
- `src/lib/schemas.ts` — `UspSource`, `UspSlot`, `SectionSpec.usp_slots`, `SectionSpec.removed_elements`, `REMOVABLE_ELEMENTS`.
- `src/components/SectionBuilder.tsx` — slot editor + removable-element chips.
- `src/lib/prompts/generate.ts` — per-slot USP instructions, scoped bank injection, removed-element handling in both the element list and JSONL skeleton.
- `src/lib/prompts/regenerate-section.ts` — slot-aware `uspsNote`; respect removals.
- `src/lib/expand-sections.ts` — Auto product resolution for USP slots.
- `src/lib/normalize-section.ts` — tolerate absent Subheader.
- `src/components/CampaignCanvas.tsx`, `src/components/SectionBlock.tsx` — variable USP count, optional Subheader/CTA.
- `src/lib/validation/` — schemas for the new section fields + USP data.

**Do not touch**
- The brand voice module, the hard-rules gate, or the Klaviyo/analytics layer.

---

## 9. Acceptance criteria

- Every product in `PRODUCT_CATEGORIES` has 8–12 verified, benefit-phrased USPs in `data/product-usps.md`, each with a source URL and verified date; `npm run verify:usps` passes with no missing banks.
- `data/company-usps.md` exists with verified shipping/returns/warranty/proof entries; nothing unverifiable is present.
- A USPs section can be configured per slot as Product (specific SKU or Auto) or Company, with 2–5 slots.
- A product-sourced USP is drawn **only** from the bound product's bank; no other product's USPs appear in that section's prompt (verify by inspecting the generated prompt).
- A company-sourced USP draws only from the company bank and/or the live offer, and never invents shipping/returns/warranty terms.
- `Subheader` (and `CTA`) can be switched off on a USPs section; generation, streaming, canvas render, regeneration, and library reload all work with them absent — and no `subheader_variants` are expected for that section.
- A USPs section can be added anywhere in the structure and dragged to any position (including directly after a product card or body) with no subheader.
- Saved campaigns created before this change load and render identically.
- No two USPs in one section restate the same bank entry.
- Unit tests cover the parser, Auto resolution, and removed-element handling; `build`, `typecheck`, `lint`, `test` all pass.

---

## 10. Out of scope
- Automatic scraping/syncing of product pages (the verification pass is manual and deliberate — claims must be human-checked).
- Applying the slot model to bundle sections' per-product USPs (already handled by `bundleElements`).
- SMS/Flows USP handling (campaign email only for now).
- Rewriting `products.md` into structured data — it stays the narrative catalogue.
