# Copy Quality + Review Injection — Diagnostic Spec

Status: investigation complete, fixes proposed (not yet applied)
Date: 2026-07-22
Triggering campaign: "Last Call" flash sale (3-product combo: Pro Earbuds E95, Essential Headphones H10, Everyday Headphones H20), code COMBO30, 30% off, urgency send.

This document diagnoses two problems reported on the copy builder output and traces each to the exact place in the backend prompt or code that causes it. It is a review/spec, not a patch — every recommended change is called out so it can be applied deliberately.

Files in scope:
- `src/app/api/generate/route.ts` — the generation endpoint (compiles brief, fetches reviews, streams copy).
- `src/lib/prompts/generate.ts` — the role instruction + user prompt (element craft rules, caps).
- `data/copy-system.md` — the single source of truth for VOICE, RULES (hard gate), SELFCHECK.
- `src/lib/reviews/fetch.ts` — the live review fetcher/parser.
- `src/lib/products.ts` — SKU → name → Shopify handle map.
- `data/reviews/*.json` — curated review cache (currently only `H10.json`).

---

## Part 1 — Review injection: only one of three cards got a review

### Observed
In the generated email, the Review element was populated only for **Essential Headphones** (Rosa D.). **Pro Earbuds** and **Everyday Headphones** came back with empty Review fields.

### How the pipeline works (as built)
`generate/route.ts` (lines 46–60) collects every `product_card_review` section's `product_slug`, then calls `fetchProductReviews(slug)` for each. Whatever comes back is passed to the prompt as `reviewsBySlug`. In `generate.ts` (lines 89–96) each card either gets "use this REAL review verbatim" (if a review exists for that slug) or "leave Review as an empty string" (if not). The model never invents one — that is by design (hard rule: never fabricate a review).

So an empty card is always caused by `fetchProductReviews` returning `[]`. There are three distinct reasons that happened here, one per product:

### Root cause A — Essential Headphones (H10) worked *only because it is curated*
`data/reviews/H10.json` exists (Rosa D., 5★, 2026-05-27). `fetchProductReviews` checks the curated cache first (`fetch.ts` lines 221–223) and returns it immediately. H10 never touched the live path. **It is the only product with a curated file.** This is why it is the only card that filled.

### Root cause B — Everyday Headphones (H20) can *never* fetch a review (data gap)
In `products.ts`, H20 is defined with **no `handle`**:

```
{ id: "H20", name: "Everyday Headphones" },   // <- no handle
```

`fetchProductReviews` returns `[]` the moment `getProductHandle` is null (`fetch.ts` lines 226–227). No handle → no page → no reviews, permanently. There is also no `H20.json` cache to fall back on.

Worse, the obvious guess for the handle is wrong. The live storefront handle is **`the-everyday-h20-headphones`**, not `everyday-headphones` (confirmed 2026-07-22: `/products/everyday-headphones` does not resolve; the site nav links to `/products/the-everyday-h20-headphones`). So anyone "fixing" this by adding `everyday-headphones` would produce a soft-404 that the fetcher correctly rejects (`fetch.ts` line 232), and the card would still be empty.

### Root cause C — Pro Earbuds (E95) has a valid handle but the parser finds nothing
E95's handle `pro-earbuds` is correct and the page is live with **422 reviews** (confirmed 2026-07-22). Yet the live fetch yields zero placeable reviews, for two compounding reasons:

1. **Parser mismatch.** `parseJudgeMeReviews` (`fetch.ts` lines 142–160) splits on the Judge.me class `class='jdgm-rev `. The Pro Earbuds review section does not expose review text in that markup on a plain server fetch (the reviews render through a different/JS-driven widget — the visible reviewer rows and the star-histogram layout do not match the Judge.me block structure the parser expects). No `jdgm-rev` blocks → the parser returns an empty array even though 422 reviews exist on-site. The comment at the top of `fetch.ts` asserts "every product page server-renders Judge.me reviews"; that assumption does not hold for E95.

2. **Filter strictness would empty it anyway.** Even if the blocks parsed, E95's recent reviews are mixed. The confirmed live sample includes "They hurt the ears after a few minutes," "Devices would not stay in my ears," and a "die within two to 3 hours … previous ones" comparison. Those trip the negative-signal prefilter (`hasNegativeSignal`, e.g. `/\bhurt|\bpain/`, `/\bdie[ds]?\b/`, `/\bprevious ones?\b/`) and the LLM positivity screen. With no positive substantive survivors, the result is `[]`.

### Net
The review feature is only *reliable* when a curated JSON file exists (`H10.json`). The live path is best-effort and silently fails when (a) a handle is missing/wrong, (b) the page isn't Judge.me-server-rendered, or (c) the strict filters remove everything. Two of the three cards hit those failure modes, and the UI gives no signal distinguishing "no eligible review found" from "system chose to leave it blank."

### Recommended fixes (in priority order)
1. **Curate cache files for the products you feature.** Add `data/reviews/E95.json` and `data/reviews/H20.json` (same shape as `H10.json`) with real, verified 4–5★ reviews. This is the fastest, most reliable fix and matches the existing pattern. Curated files win over the live path.
2. **Add H20's real handle** to `products.ts`: `handle: "the-everyday-h20-headphones"`. This makes the live path *possible* for H20 (still subject to parser/filter caveats), and is correct data regardless.
3. **Surface a review-gap flag to the UI.** In `generate/route.ts`, when a `product_card_review` slug returns no review, emit that slug in the streamed payload so the builder can show "no eligible review found — add one manually or curate a cache file" instead of a silently empty field. This directly answers the "I don't know why that's happening" problem.
4. **Broaden the parser** (larger effort): detect the actual review widget on non-Judge.me pages, or add a JSON/GraphQL review source, so the live path works beyond Judge.me pages like E95. Until then, rely on curated caches for featured products.
5. **Optional:** loosen the E95-style problem by ranking positive reviews rather than hard-dropping the whole set — but keep the never-fabricate rule absolute.

---

## Part 2 — Copy quality: thin headline, bloated tagline, flat subheader

### Observed (header)
```
HEADLINE: Last Call
TAGLINE:  Pro Earbuds, Essential Headphones, Everyday Headphones. 30% off with code COMBO30.
```
The headline is two words; the tagline is a 12-word product roll-call that also carries the offer and the code. Headline and tagline do not read as a cohesive unit.

### Root cause D — the tagline rule is being violated, and there is no rule against a product roll-call in it
The hard-rule cap (`copy-system.md`, Length caps table) is:
> Tagline: 1 line, 10 words max, states the offer OR the promise, **not both**.

The shipped tagline breaks this three ways: it is **two sentences** (period after "Everyday Headphones"), it is **12 words** (over the 10-word cap), and it layers a **product list + offer + code** together rather than offer *or* promise. Contributing factors:

1. **Conflicting caps between the two prompt sources.** `generate.ts` line 22 says "Tagline: one sentence, max 12 words," while `copy-system.md` says "10 words max." Same for the headline: `generate.ts` says "2–4 words," `copy-system.md` says "2 to 5 words." The role instruction and the hard gate disagree, so the model has slack. These should be reconciled to one number each (recommend the stricter `copy-system.md` values as canonical, and make `generate.ts` reference them rather than restate them).

2. **No ban on enumerating product names in the tagline.** Voice craft rule 4 ("Do not list every product by name; the modules already show them") and self-check #6 ("no product roll-call") are framed around *body openings and one-liners*, not the tagline. The tagline slipped through the gate because nothing explicitly forbids a roll-call there. Recommend extending the roll-call ban to the Tagline and Headline explicitly, in both the RULES table and self-check #6.

3. **The multi-product combo fights the "single-product-led above the fold" hierarchy.** `generate.ts` lines 13–18 tell the model to lead the hero with ONE product. But the brief features three, so the model resolved the tension by cramming all three into the tagline. There is no guidance for how the hero should behave in a *genuine* multi-product combo/bundle sale. Recommend adding a rule: in a multi-product sale, the hero names the *offer/occasion* (e.g. "30% off, tonight only"), not a list of SKUs; individual products get their own cards below. This also fixes cohesion — a "Last Call" headline pairs naturally with an offer/urgency tagline, not a catalogue line.

### Root cause E — the headline/tagline are not written as a pair
Nothing in the prompt asks the model to make the headline and tagline cohere. They are specified as independent elements with independent caps. "Last Call" + a product list reads disjointed because the two were optimized separately. Recommend an explicit instruction: "Write the Headline and Tagline as one unit — the tagline completes or pays off the headline; they should read as a single thought." (This is a voice/craft addition, not a hard rule.)

### Observed (body)
```
SUBHEADER: 30% off. Closes tonight.
```
Reported as "very lame / not editorial." (The user also recalled a "Three pairs, one window" line; that phrasing appears in the subject/preview slots, e.g. SUBJECT 2 "Last call. Three pairs, one code." and PREVIEW 1 "…Tonight's your last window." — same flatness, different slot.)

### Root cause F — the 6-word subheader cap + the "no editorial" mandate produce clipped fragments
The subheader is capped at **6 words** (`copy-system.md`) and must be one of three angles (benefit / feature / occasion), clear of every cliché on the banned-headings list. Under that cap, the model produces terse fragments. In this case it also picked the **offer-mechanics** angle ("30% off. Closes tonight.") rather than a benefit or occasion angle, which is the least evocative of the three.

There is a **genuine design tension** here worth naming: the user wants "editorial/elegant," but the voice system deliberately bans literary/editorial flourish at *every* tone dial (dial 5 is explicitly "NOT license for literary devices, tension or paradox constructs"). So "editorial" subheaders are out of scope by current design. Two honest options:

- **If the plain-retail voice is intended:** the fix is not "make it editorial" but "make it a *better plain* line" — steer the subheader picker toward the benefit/occasion angle over the raw offer-mechanics angle, and enforce the "reach past the first instinct / discard the 2–3 most predictable candidates" rule that already exists in VOICE but clearly isn't biting here.
- **If you actually want more elegance:** that is a **voice-level change**, not a per-campaign one. It means raising the subheader cap (e.g. to ~8–10 words / allowing one richer clause) and softening the "no editorial" stance in `copy-system.md`. This is a deliberate brand decision and should be made in the VOICE section, not patched around in the campaign.

Recommend deciding which of the two you want before changing anything, because they pull in opposite directions.

### Root cause G — Subheader shape vs. what shipped
The prompt requires Subheader to be a **3-option array** (strongest-first). The shipped copy shows a single subheader string. That is expected — the builder/display layer selects one of the three. But note: if the *offer-mechanics* option is being auto-selected as "strongest," the ordering heuristic (or the display default) is surfacing the weakest-for-brand choice. Worth checking that the "strongest-first" ordering the model is told to produce is actually the one the UI shows by default.

---

## Summary of recommended changes

Review injection
- Curate `data/reviews/E95.json` and `data/reviews/H20.json` (fastest, reliable). [Part 1, fix 1]
- Add H20 handle `the-everyday-h20-headphones` to `products.ts`. [fix 2]
- Emit a "no review found" flag from `generate/route.ts` so empty cards are explained, not silent. [fix 3]
- Longer term: make the parser handle non-Judge.me review widgets (E95). [fix 4]

Copy quality
- Reconcile the tagline/headline caps between `generate.ts` and `copy-system.md` to one canonical value each. [Root cause D.1]
- Extend the product-roll-call ban to the Tagline and Headline explicitly, in RULES + self-check. [D.2]
- Add multi-product-sale hero guidance: hero leads with offer/occasion, not a SKU list. [D.3]
- Add a "write headline + tagline as one cohesive unit" craft instruction. [E]
- Decide the subheader direction: enforce the existing "reach past the first instinct" rule and bias away from the offer-mechanics angle (plain-but-better), OR make a deliberate VOICE-level change to allow more elegant/longer subheaders. Don't do both. [F]
- Verify the UI surfaces the model's "strongest-first" subheader, not the offer-mechanics one. [G]

---

## Part 3 — Iteration-3 audit: the REAL root cause of the recurring headline

Three iterations of voice-rule tweaking have not moved the headline off "Last Call." That is because the defect is **not in the generation/voice layer at all** — it is in the deterministic brief compiler's *input*. The model is being handed the answer.

### The smoking gun
The output's Conceit line is:
> Conceit: FS - 30% OFF E95 + H20 + H10 - Last Call — FS - 30% OFF E95 + H20 + H10 - Last Call: the deal is the reason to open. 30% off.

That is the **internal campaign filename** ("FS - 30% OFF E95 + H20 + H10 - LAST CALL") being used as the creative angle — twice (conceit name *and* description). Trace:

1. `compile.ts` L148: `const subject = occasion || input.campaign_name || "This send";`
   This flash sale has **no `occasion`**, so `subject` = the raw campaign name `FS - 30% OFF E95 + H20 + H10 - LAST CALL`.
2. `blocks.ts` L51 (`promo` template): `headline_thesis: "{subject}: the deal is the reason to open. {offer}."`
   → interpolates to `"FS - 30% OFF E95 + H20 + H10 - Last Call: the deal is the reason to open. 30% off."`
3. `compile.ts` L177–184: `label = occasion || input.campaign_name || ...` → `conceit.name` = the same filename; `conceit.description` = the polluted `headline_thesis`.
4. `generate.ts` L11 tells the model the conceit "is the campaign's angle … Let it shape the headline." The model reads a "conceit" that literally contains the words **"Last Call"** and dutifully makes that the headline.

So the headline is "Last Call" **by construction, every single time**, because the internal ops filename (which contains "LAST CALL") is being fed to the model as the campaign's creative idea. No voice rule downstream can override an input that hands the model the exact phrase to use. This is the miss across all three iterations: we kept editing the paint, the crack is in the foundation.

### Fixes (root-cause first)
1. **Stop feeding the raw `campaign_name` to the model.** The campaign name is an internal label (SKUs, percentages, "FS -", "LAST CALL"), not an angle. Either:
   - (best) require a clean `occasion`/angle for the conceit and **never** fall back to `campaign_name` for `{subject}` or `conceit.name`; fall back to a clean campaign-type label ("Flash Sale") instead; or
   - sanitize `campaign_name` before use — strip SKU codes (`E95/H20/H10`), `FS -`, `NN% OFF`, and urgency tags (`LAST CALL`, `FINAL HOURS`) — so an ops string can never become creative copy.
   This one change is what actually kills the recurring "Last Call" headline.

2. **Headline floor + anti-echo rule** (defense in depth, add to RULES + self-check):
   - A headline may not be *only* an urgency tag. "Last Call", "Final Hours", "Time's Up" alone are banned; the headline must also name a benefit, product, or the offer (e.g. "30% Off Ends Tonight", "Last Call on 30% Off").
   - The headline must not copy the conceit name or campaign name verbatim.
   - Consider raising the floor from 2 words to **3–5 words** so a bare two-word tag can't satisfy the cap.

### New rule requested — no "pairs" as a product count
There is currently **no rule** against calling the featured set "pairs." The model reaches for it (SUBJECT 2 "Three pairs, one deal"; body "Pick the pair that fits your life"). Add a hard rule:
> Never count distinct products as "pairs" ("two pairs", "three pairs", "all three pairs"). A single earbud/headphone set may be called "a pair"; a multi-product lineup is "products", "styles", "picks", or named individually. Applies to subject lines, taglines, subheaders, and body.

Add to RULES and self-check.

### Still-open items from Parts 1–2 (confirmed still broken this iteration)
- **Pro Earbuds (E95) review still empty.** `data/reviews/` now has `H10.json` and `H20.json` (that's why Essential + Everyday now fill), but **no `E95.json`**. E95's live page can't be parsed (non-Judge.me widget, Part 1-C), so until a curated `E95.json` is added it will stay empty. Fix: curate `data/reviews/E95.json`.
- **Tagline roll-call + code still shipping** ("Pro Earbuds, Essential Headphones, Everyday Headphones: 30% off with code COMBO30."). The Part-2 tagline fixes (roll-call ban, cap reconciliation) were documented but **not applied**.

### New request — remove Image Direction entirely (content only)
Drop the image-direction elements so the builder outputs copy only. Locations (`src/lib/schemas.ts` `SECTION_CATALOGUE`):
- L237 `header`: remove `"Hero Image Direction"`.
- L240 `product_card`: remove `"Image Direction"`.
- L241 `product_card_review`: remove `"Image Direction"`.
Also remove the "Hero Image Direction" craft bullet in `generate.ts` (L28) and check the render layer (`SectionBlock` / card components) and JSONL shape examples don't still expect the field. Removing from `SECTION_CATALOGUE` cascades to the prompt automatically since elements are built from it.

### Why this kept costing tokens
Iterations 1–3 all targeted the **voice/generation** layer (word caps, cliché bans, hierarchy). The two problems that actually recur live **upstream and sideways** of that layer: a contaminated conceit (deterministic compiler input) and a missing curated review file (data), neither of which a generation-prompt edit can reach. Fixing the compiler input + adding `E95.json` addresses the recurring failures at their source.

---

## Evidence log
- Code: `generate/route.ts` L46–60, L89–96; `fetch.ts` L142–160, L221–232; `products.ts` H20 entry; `copy-system.md` Length caps table, VOICE craft rule 4, SELFCHECK #6.
- Live (confirmed 2026-07-22): `pro-earbuds` resolves, 422 reviews, non-Judge.me widget, mixed recent reviews (negative/comparison content present); `everyday-headphones` does NOT resolve; real handle is `the-everyday-h20-headphones` per storefront nav.
- Cache: only `data/reviews/H10.json` exists.
