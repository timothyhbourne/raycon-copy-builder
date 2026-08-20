# Reviews Module — Configurable Count, Per-Slot Sources, and Provenance

**Status:** BUILT 2026-08-20 (branch `copy-voice-rebuild`). All three features
shipped; see "Build record" below, including two pre-existing bugs this uncovered
and the one criterion that could not be verified live.
**Surfaces:** Section Structure builder, Copy Builder canvas, `/api/reviews`.
**Read against:** `src/lib/reviews/fetch.ts`, `src/app/api/reviews/route.ts`,
`src/components/SectionBuilder.tsx`, `src/components/CampaignCanvas.tsx`,
`src/lib/schemas.ts`, `src/lib/prompts/regenerate-section.ts`,
`src/lib/hard-rules-check.ts`.

Three things:

- **A.** Choose how many reviews a reviews section holds, in the Section
  Structure builder, the way USP count already works.
- **B.** Per-review source control, including a URL to fetch a real review from.
- **C.** Stop the module inventing reviews. There is a specific root cause; §2.2
  names it.

---

## 1. What already works

Worth knowing before building, because more of this exists than it appears:

- `src/lib/reviews/fetch.ts` fetches **real** reviews by scraping Judge.me markup
  off `rayconglobal.com/products/<handle>`, pages deeper through Judge.me's
  public widget endpoint when page 1 is thin, filters for substantive / 4–5★ /
  English / this-product-only / no-negative-signal, then runs an LLM positivity
  screen. It already accepts a `limit` of **1–10** (`fetch.ts:255`).
- `/api/reviews?product=E25&limit=3&refresh=1` already exposes limit and refresh.
- `REPEATABLE_ELEMENTS.reviews = [{ family: "Review", min: 1, max: 6 }]`
  (`schemas.ts:476`) — the **canvas** already supports adding and removing Review
  slots between 1 and 6.
- Element-level regeneration already refuses to touch a Review and routes to
  `/api/reviews` cycling instead (`api/regenerate-element/route.ts:44-49`).

So the fetching layer is sound. The gaps are in configuration, in one unprotected
regeneration path, and in the absence of provenance.

---

## 2. What's broken

### 2.1 The count is invisible and inconsistent

- `SECTION_CATALOGUE.reviews = ["Subheader", "Review 1", "Review 2", "Review 3"]`
  (`schemas.ts:413`) — hardcoded at 3.
- `SectionBuilder.tsx` has a full per-slot planner for `usps` (2–5 slots, each
  with source and product) and **nothing at all** for `reviews`. The builder just
  says "reviews", which is the reported complaint.
- `CampaignCanvas.tsx:200` hardcodes `REVIEW_KEYS = ["Review 1", "Review 2",
  "Review 3"]` and fetches with `limit=3` (`:217`). So if you *do* add Review 4,
  5 or 6 on the canvas, **the auto-fill will never fill them.** They stay empty
  permanently. The canvas and the fetch layer disagree about how many reviews
  exist.

### 2.2 Why it invents reviews — root cause

Two unprotected paths, and nothing downstream catches the result.

**Path 1 — generation.** The generate prompt's review rule is scoped to one
section type: *"Review (product_card_review only): a REAL customer review
supplied to you below… If no review was supplied for the card's product, leave
the Review element empty"* (`src/lib/prompts/generate.ts:34`). Server-side, real
reviews are fetched **only** for `product_card_review` slugs
(`api/generate/route.ts:52-72`).

A standalone `reviews` section is neither covered by that instruction nor
supplied with data. The model is handed three elements named "Review 1/2/3", no
source material, and no prohibition. It writes them. That is not a model failure
— nothing told it not to.

Worse, the canvas auto-fill only populates **empty** slots (`emptySlot`,
`CampaignCanvas.tsx:204-207`), explicitly so it never clobbers a user's edits. So
once the model has invented three reviews, the real-review fetch silently declines
to overwrite them. **The fabrication wins.**

**Path 2 — section rewrite.** `regenerate-section.ts:72` applies its
`reviewFixedNote` — *"REVIEW IS FIXED… Preserve it EXACTLY… Never reword,
replace, shorten, or invent it"* — only when
`sectionToRegenerate.type === "product_card_review"`. A standalone `reviews`
section gets no such note. Hit "rewrite this section" on a reviews section and
the model rewrites the real reviews. `/api/section-variations` uses the same
prompt builder (`route.ts:52`), so all five register variations fabricate.

**Nothing catches it.** `hard-rules-check.ts:279` skips `kind === "review"`
entirely — *"Reviews are real customer text, not our copy — exempt from every
scan."* True of real reviews; catastrophic for fake ones. The repetition checker
excludes Review too (`repetition-client.ts:74-75`). A fabricated review passes
every gate in the app, silently, and this is a brand claim about a real customer
in a marketing email.

### 2.3 Cache staleness

`fetch.ts:266-269` returns the curated `data/reviews/<id>.json` cache whenever it
is non-empty and `refresh` is not set. There is no TTL and no age display, so
curated files win forever. Only 7 of 17 SKUs have one; products with no live
storefront page (E26, H90) return `[]` because `getProductHandle` is null.

---

## 3. Feature A — configurable review count

Mirror the USP slot plan, which already solves this exact problem.

In `SectionBuilder.tsx`, when a section's type is `reviews`, render a slot
planner: a count stepper of **1–6** (matching `REPEATABLE_ELEMENTS.reviews`) and
one row per slot. Adding a slot appends `Review N`; removing renumbers, which
`element-families.ts` already handles including flag migration
(`onRenameFlags`).

`sectionElementNames()` (`schemas.ts:522-538`) must derive review slots from the
spec rather than the static catalogue, exactly as it does for `usp_slots`. This is
the single source of truth the prompt, the JSONL skeleton, regeneration and the
canvas all read, so getting it here fixes every surface at once.

`CampaignCanvas.tsx:200-217` must stop hardcoding three: derive the key list from
the section's actual elements and pass the real count as `limit`.

## 4. Feature B — per-slot source

```ts
export type ReviewSource = "product" | "url" | "manual";

export interface ReviewSlot {
  source: ReviewSource;
  /** source: "product" — which SKU's reviews to pull from. Defaults to the
   *  section's/campaign's hero product. */
  product_slug?: string;
  /** source: "url" — the page to fetch a review from. */
  source_url?: string;
  /** source: "manual" — text pasted by the writer. Always wins, never fetched. */
  manual_text?: string;
  manual_author?: string;
}
```

Stored on `SectionSpec` as `review_slots?: ReviewSlot[]`, directly alongside
`usp_slots` (`schemas.ts:67-69`). Absent = legacy shape (3 product-sourced slots),
same migration convention `usp_slots` already uses.

### 4.1 URL sources — be deliberate about scope

The existing parser is **Judge.me-specific**. "Fetch reviews from any URL" is a
much larger problem than it sounds, so build it in tiers and let the UI say which
tier a URL falls into:

| Tier | Example | Approach | Effort |
|---|---|---|---|
| **1. Own storefront** | `rayconglobal.com/products/the-everyday-earbuds` | Resolve handle from the URL, reuse `fetchProductReviews` unchanged | Trivial |
| **2. Any Judge.me shop** | another Shopify store using Judge.me | Existing `parseJudgeMeReviews` works as-is; detect the widget in the HTML | Small |
| **3. Generic page** | a blog roundup, a press review | Fetch HTML, strip to text, run an LLM extraction pass returning candidate quotes + attribution, then send those through the **existing** eligibility and positivity screens | Medium |
| **4. Walled gardens** | Amazon, Best Buy | **Do not build.** Scraping these breaches their terms, they actively block server-side fetches, and reviews carry licensing constraints. Route these to `manual` | — |

Tier 3 must never let the LLM *write* a review — it extracts spans from fetched
text and returns them with a character offset, and the server verifies each
returned quote appears verbatim in the source before accepting it. An extraction
that fails verification is dropped, not repaired.

Every URL fetch is bounded the way the current one is: 8s timeout, size cap,
`https` only, no redirects to private ranges.

### 4.2 Manual source

The always-works escape hatch, and the honest answer for anything in tier 4. The
writer pastes review text and an optional first name. It is stored with
`origin: "manual"` and shown as manually entered — trusted, but visibly not
machine-verified.

---

## 5. Feature C — provenance, and the gate that's missing

This is the actual fix for "it's making up reviews." The rule stops being *"the
model shouldn't invent reviews"* (an instruction, unenforceable) and becomes
*"a review element without provenance cannot ship"* (a check).

### 5.1 Every review carries where it came from

```ts
export interface ReviewProvenance {
  origin: "fetched" | "manual" | "curated" | "unverified";
  source_url?: string;
  fetched_at?: string;   // ISO
  author?: string;
  rating?: number;
}
```

Stored per review element on the section, keyed by element name. Populated by
the fetch path, the manual path, and the curated cache. **Anything the model
produced in a Review slot is `"unverified"` by definition** — it has no
provenance record because no fetch created one.

### 5.2 Three enforcement points

**1. The model never writes reviews, for any section type.** Extend the generate
prompt's review rule from `product_card_review only` to all Review elements, and
have `api/generate/route.ts` fetch reviews for standalone `reviews` sections the
same way it already does for `product_card_review` slugs (`:52-72`) — including
returning them in the existing `review_gaps` stream event so an unfillable slot
surfaces as a visible gap rather than a blank.

**2. Server-side strip, not just an instruction.** After generation and after
every section rewrite, any Review element whose text has no matching provenance
record is **discarded server-side** and the slot returned empty. An instruction
the model can ignore is not a control; deleting the field is.

Add the missing `reviewFixedNote` for standalone `reviews` sections in
`regenerate-section.ts:72` as well — belt and braces, since the strip runs
regardless.

**3. Replace the hard-rules blanket exemption with a provenance check.**
`hard-rules-check.ts:279` currently `continue`s past every `review` element.
Keep the exemption from *stylistic* rules — real customer text legitimately breaks
voice rules — but add one review-specific rule:

> `review-provenance` — a non-empty Review element with `origin: "unverified"`
> or no provenance record is a violation. **Not auto-fixable.**

Unlike the rest of the hard-rules report, which is advisory
(`copy-builder/page.tsx:527`, "never blocks the user"), this one **blocks Save
Final**. Everything else in that report is a matter of craft. This one is a
factual claim about a customer who may not exist, and it is the one case where
shipping is worse than being interrupted.

### 5.3 Surface it on the canvas

Each Review element shows a small provenance line: author, star rating, fetch
date, and the source as a link. An unverified review renders with a warning
treatment and a one-click **Fetch a real one** action. A writer should never have
to wonder whether a review on screen is real — the answer should be visible
without clicking anything.

Add cache age to the same line, and surface `?refresh=1` as a per-slot refresh
control (`api/reviews/route.ts:21` already supports it). That addresses §2.3
without adding a TTL: staleness becomes visible rather than automatic.

---

## 6. Data model changes

| Change | File |
|---|---|
| `ReviewSlot`, `ReviewSource`, `ReviewProvenance` types | `src/lib/schemas.ts` |
| `SectionSpec.review_slots?: ReviewSlot[]` | `src/lib/schemas.ts:57` |
| `GeneratedSection.review_provenance?: Record<string, ReviewProvenance>` | `src/lib/schemas.ts:160-193` |
| `sectionElementNames()` derives Review slots from spec | `src/lib/schemas.ts:522-538` |
| Zod schemas + `schema_version` bump | `src/lib/validation/schemas.ts` |
| Reviews slot planner UI | `src/components/SectionBuilder.tsx` |
| Drop hardcoded `REVIEW_KEYS` / `limit=3` | `src/components/CampaignCanvas.tsx:200,217` |
| `review-provenance` rule; keep style exemption | `src/lib/hard-rules-check.ts:279` |
| URL resolution + tier detection | `src/lib/reviews/fetch.ts` |
| Fetch reviews for standalone `reviews` sections | `src/app/api/generate/route.ts:52-72` |
| `reviewFixedNote` for `reviews` type | `src/lib/prompts/regenerate-section.ts:72` |

Legacy records with no `review_slots` migrate to three product-sourced slots at
the read boundary — the same pattern `parsePlannerRow` and `usp_slots` already
use. Existing reviews with no provenance record migrate to `origin: "curated"`
rather than `"unverified"`, so the new gate doesn't retroactively block every
saved campaign.

---

## 7. Acceptance criteria

- The Section Structure builder shows a review count control (1–6) and it is
  respected end to end: prompt, canvas, and fetch limit all agree.
- Adding Review 4 on the canvas fetches and fills a fourth real review.
- A reviews section generated from scratch never contains model-written text. If
  no real review is available, the slot is empty and flagged as a gap.
- Rewriting a standalone `reviews` section preserves the real reviews verbatim.
  *(Fails today.)*
- Running all five section variations on a reviews section preserves them.
  *(Fails today.)*
- A slot set to a `rayconglobal.com` product URL returns the same reviews as
  selecting that SKU.
- A slot set to a generic URL returns only quotes verifiable verbatim in the
  fetched page, or returns nothing.
- A manual review saves, displays as manually entered, and is never overwritten.
- Save Final is blocked while any non-empty Review element is unverified, with
  the offending slot named.
- Every review on the canvas displays its origin, author, rating and age.

---

## 8. Build record (2026-08-20)

### A — configurable count

`SectionSpec.review_slots` mirrors `usp_slots`, and `sectionElementNames()` now
derives the review count from it (`reviewSlotsOf` → `reviewsElements`). That was the
lever the spec pointed at: one change, and the prompt, the JSONL skeleton,
regeneration, the canvas and the fetch limit all agree, because they all read that
function. The builder renders a 1–6 slot planner alongside the USP one.

`CampaignCanvas`'s auto-fill no longer hardcodes three: it derives the slot list from
the section's own elements and asks for exactly as many reviews as there are empty
slots. Adding Review 4 on the canvas now fills it, where before it stayed empty
forever.

### B — per-slot sources

`ReviewSlot.source` is `product | url | manual`, edited per slot in the builder.
URL support is tiered exactly as §4.1 lays out, in `src/lib/reviews/url.ts`:

| Tier | Behaviour | Verified live |
|---|---|---|
| storefront | resolves the handle → SKU, reuses `fetchProductReviews` unchanged | returns byte-identical reviews to picking the SKU |
| judgeme | detects the widget in the HTML, reuses `parseJudgeMeReviews` | — |
| generic | fetch → strip → LLM **extraction** → verbatim verification | a page with no reviews returns nothing |
| blocked | Amazon/Best Buy/Walmart/Reddit et al. refused, routed to manual | refused with the manual-entry answer |

The tier classifier is split into `url-tiers.ts` because the slot editor is a client
component and `url.ts` reaches `fetch.ts`, which imports `fs`.

**Tier 3 never lets the model write a review.** `verifyExtractedQuotes()` keeps a
quote only if it appears verbatim in the fetched page (modulo quote/dash/whitespace
style). A hallucination can't survive it, and a real quote the model "tidied" is
dropped too — the correct side to err on. That function is pure and separately
tested, so it needs no network or model to verify.

### C — provenance, and the gate

`ReviewProvenance` (`fetched | manual | curated | unverified`) is stored per review
element on the section. Three enforcement points, as specified:

1. **The prompt covers every Review element**, not just `product_card_review`'s, and
   `resolveSectionReviews()` resolves each slot server-side before generation, so a
   standalone `reviews` section arrives with its real reviews or with an explicit
   instruction to leave the slot empty. Unfillable slots come back in the existing
   `review_gaps` event with a per-slot reason.
2. **The strip.** `stripUnprovenancedReviews()` runs on the generation stream
   (`guardReviewLine`), on section rewrite, and on all five variations. Any Review
   whose text doesn't match a review the server actually resolved is emptied.
3. **The hard-rules exemption is now conditional.** Real reviews stay exempt from
   every style rule; a review with no provenance is a `review-provenance` violation,
   marked `blocking`, and it stops Save Final with the offending slot named.

The canvas shows each review's origin, author, rating and fetch age, with a `source`
link, a per-slot `refresh` (which is how §2.3's staleness becomes visible instead of
silently cached), and a one-click **Fetch a real one** on anything unverified.

### Two pre-existing bugs this uncovered

Both were in the same overlooked place — code that matched the literal key `"Review"`
and therefore missed every `"Review 1".."Review 6"` slot:

- **`kindForKey()`** classified numbered review slots as `generic`, so real customer
  quotes were being run through the length caps, the ban list and the cliché list as
  if they were our copy — and the new provenance rule, scoped to the `review` kind,
  would never have seen them.
- **`scrubElements()`** punctuation-scrubbed them, rewriting the em dash in
  "… — Jordan M.". That edited what a customer said, and it broke the verbatim match
  provenance depends on: it was why the five variations initially came back with the
  reviews *stripped* instead of *preserved*.

Both are fixed via `isReviewElement()`, with regression tests in
`hard-rules-client.test.ts`.

### Verification

500 unit tests pass (48 new across `provenance`, `url-tiers` and `verify`), `tsc`
clean, `next build` clean. Against the running app:

- SKU fetch returns provenance; a `rayconglobal.com` product URL returns **byte-identical**
  reviews to selecting that SKU; Amazon is refused; a generic page with no reviews
  returns nothing; `127.0.0.1` and `http://` are refused by the SSRF guard.
- The builder's slot planner adds a 4th slot, switches a slot to Paste, and warns on
  a walled-garden URL as it is typed.
- A 4-slot section renders 4 slots; a verified review shows origin/author/rating/age;
  an unverified one warns and offers the fix; **Save Final is blocked** naming
  `reviews → Review 2`, and proceeds once fixed.
- **Section rewrite preserves both reviews verbatim** and rewrites only the
  Subheader. With provenance removed from the request, the same rewrite comes back
  with both slots emptied and logged — proving the strip works independently of the
  prompt.
- **All five register variations preserve both reviews verbatim** with provenance
  intact, each with a different Subheader. *(Both of these were the spec's "Fails
  today" criteria.)*

### Not verified live

The **generation** path's strip. The Anthropic account's credit balance ran out
mid-verification (`400 … credit balance is too low`), so I could not complete a live
generation containing a reviews section. What did run before that: the pre-generation
half — slot resolution, the manual slot, the blocked-URL refusal, and the
`review_gaps` reasons — all behaved correctly. The strip itself is covered by
`guardReviewLine`'s wire-level tests, which is why it was extracted from the route in
the first place. Worth one live generation once the account is topped up.

### Still open

1. **Flows.** Out of scope per §8, but flow emails share `buildSectionList`, so a
   reviews section in a flow now gets the "leave it empty" instruction rather than an
   invitation to invent. Their generate route has no strip and no slot configuration.
2. **The `usps`-style per-slot focus** has no review equivalent (a review isn't
   steerable — it's a quote).
3. **Judge.me's official API** still unused, as §8 parks it.

---

## 9. Out of scope

- **Amazon, Best Buy, and other walled-garden review scraping.** Terms-of-service
  and licensing problem before it is an engineering one. Manual entry covers it.
- **Review sentiment analytics or a review browser.** This is about getting real
  reviews into copy, not about analysing them.
- **Writing back to Judge.me.** Read-only, as today.
- **SMS and Flows review handling.** Flows already fetch per-card reviews
  (`api/flows/generate/route.ts:62-80`); extending slot configuration there is a
  follow-on.
- **Replacing the Judge.me parser with an official API.** Judge.me has one, and
  it would be more robust than markup scraping, but it needs an account key and
  the current scraper is verified working. Worth revisiting if the markup breaks.
