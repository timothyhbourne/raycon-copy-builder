# Construction Index — anti-repetition system for copy generation

You are building an anti-repetition system in `raycon-copy-builder` (Next 16, React 19). Read `AGENTS.md` first. Design law for this task: **no bloat** — no new dependencies, no vector DB, no embeddings (phase 2, out of scope), bounded prompt additions, one small JSON index file.

## Concept

Generation keeps repeating headlines, subject constructions, and product one-liners because it can't see what was already written. Fix in three parts:

1. A **precomputed construction index** — a compact JSON file of every reusable construction in the library, updated incrementally on finalize. Generation never reads full past campaigns.
2. **Three bounded slices** of that index injected into generation prompts as "recently used — build differently" data.
3. A **post-generation similarity checker** (pure JS, lexical) that catches near-duplicates anyway, auto-retries the offending element once, and flags it in the UI if still too close. Prompts request novelty; the checker enforces it.

## Compatibility note (check first)

If `STRUCTURAL_VARIABILITY_PROMPT.md` was already executed (look for a `recentConstructions` helper in `src/lib/library.ts` and a "RECENTLY SENT" block in `src/lib/prompts/generate.ts`), this system REPLACES that step-2 mechanism: swap its call sites to the new index-based block and delete the old helper. If it wasn't executed, just build what's below.

---

## Step 1 — The index

`src/lib/constructions.ts` + data file `data/constructions-index.json`.

**Shape** (one entry per library campaign):
```json
{
  "version": 1,
  "campaigns": {
    "<library-id>": {
      "date": "2026-07-10", "campaign_type": "promo", "title": "...",
      "conceit": "...",
      "subject_lines": ["..."], "preview_texts": ["..."],
      "headlines": ["..."], "taglines": ["..."],
      "body_openers": ["first sentence of each body-like element"],
      "one_liners": { "<product-slug-or-name>": ["..."] }
    }
  }
}
```

**Extraction** (`extractConstructions(entry: LibraryCampaign)`): prefer `structured.campaign`; walk sections pulling Headline, Tagline, selected Subheader variant, first sentence of Body Copy, closing lines, and product one-liners. Key one-liners by `product_slug` when the section structure provides it (product_card `product_slug`); for grid products resolve the product name to a slug via `src/lib/products.ts`, falling back to the lowercased product name as key. Legacy flat-body entries: best-effort via the same `# `-heading split used elsewhere; skip silently on failure.

**API:** `readIndex()`, `updateCampaign(entry)` (extract + upsert + write), `removeCampaign(id)`, `buildAvoidBlock(opts)` (Step 2). Defensive parsing per the repo's store idiom; a corrupt index file is treated as empty, then rebuilt.

**Hooks:**
- `/api/finalize` (`src/app/api/finalize/route.ts`): after a successful library write, call `updateCampaign`. This covers manual saves AND the library autosave path (which posts to finalize).
- Library delete route: call `removeCampaign`.
- **Backfill script** `scripts/index-constructions.ts` (+ npm script `index:constructions`): rebuild the whole index from `data/library/`. Idempotent. Print a count summary.

## Step 2 — Bounded prompt slices

`buildAvoidBlock({ productsFeatured, campaignType, excludeId })` returns a single string with three sections, HARD-CAPPED at ~80 lines / 6KB total (truncate oldest-first when over):

1. **Recency** — the 8 most recent campaigns (by date, excluding `excludeId`): title, date, headlines, subject lines, first body opener each.
2. **Product-scoped** — for each featured product: EVERY one-liner ever recorded for that product (cap 20 per product, newest kept). This is the axis where verbatim repeats hurt most.
3. **Type-scoped** — subject lines from the 5 most recent campaigns of the same `campaign_type`.

Framing text (exact): "RECENTLY USED CONSTRUCTIONS — lines below were already sent. Do not reuse their headline shapes, subject constructions, opening moves, or product one-liner phrasings. Same voice, different build:"

**Inject into:** `generateUserPrompt` (products + type from the brief), `conceits.ts` (recency section only, plus past conceit names — conceits should also stop repeating), `regenerate-meta.ts` (recency + type subjects), `regenerate-section.ts` (product-scoped when regenerating a product section, recency otherwise). Empty library → omit entirely.

## Step 3 — Similarity checker + enforcement loop

**3a. Similarity function** (in `src/lib/constructions.ts`): `similarity(a, b): number` — normalize (lowercase, strip punctuation, collapse whitespace), then character-trigram Jaccard. Also compute token-set containment for short strings (≤6 tokens) and take the max of the two scores. Unit-sanity in a comment: "all-day comfort" vs "comfort all day long" should score high; "30% off ends tonight" vs "the classic still got it" should score low.

**3b. Check endpoint** `src/app/api/check-repetition/route.ts`: POST `{ elements: [{ id, kind: "headline"|"subject"|"preview"|"one_liner"|"opener", text, product? }], exclude_id? }` → for each element, scan the relevant index fields (one_liners scoped to the product when given, otherwise all) and return matches above threshold **0.65**: `{ id, match_text, match_campaign_title, match_date, score }`. Whole scan is in-memory string math — keep it synchronous and fast.

**3c. Client loop** (`src/app/copy-builder/page.tsx`): after generation streaming completes (and after a regenerate settles), collect the checkable elements and POST to the check endpoint.
- For each offender, auto-trigger ONE targeted regeneration through the EXISTING regenerate-section / regenerate-meta APIs, passing an instruction: `Your previous version of this element ("<text>") duplicates a past campaign ("<match_text>", <title>, <date>). Write a structurally different construction.` Re-check the replacement.
- Still ≥0.65 after the retry → no more retries; render a small amber Chip on that element: "similar to past send" with `title` tooltip naming the campaign/date, dismissible. Never block saving.
- Guard rails: max 4 auto-retries per generation total (avoid retry storms), skip the loop entirely while offline/on endpoint failure (fail open, console.warn).

## Step 4 — Verify

1. Run `npm run index:constructions` → index file lists every library campaign; spot-check one entry's headlines/one-liners against its markdown.
2. Finalize a campaign → index updates without running the script (check file mtime/content).
3. Feed the checker a headline copied verbatim from an old campaign (temporary test or curl) → score ~1.0, match returned; an unrelated line → < 0.3.
4. Generate a campaign for a product with existing library history → prompt (debug/log) contains the three-slice block, capped; if any generated element trips the checker, observe one auto-retry then a chip.
5. `npm run build` passes. Confirm the old `recentConstructions` mechanism (if it existed) has no remaining call sites.

Commit order: (1) index module + backfill + finalize/delete hooks, (2) prompt slices, (3) checker endpoint + client loop + chip, (4) verification notes. State deviations explicitly in your summary.
