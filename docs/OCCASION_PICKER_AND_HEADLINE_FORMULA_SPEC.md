# Occasion Picker Cleanup + The Real Headline/Tagline Formula — v3 Spec

Status: ready to implement (nothing applied yet)
Date: 2026-07-23
Predecessors: `COPY_QUALITY_AND_REVIEW_INJECTION_SPEC.md` (diagnostics), `FLASH_SALE_DATES_AND_VOICE_V2_SPEC.md` (v2 — flash sale inputs + dial 4–5). **This spec amends v2 where noted; where they conflict, v3 wins.**

The centerpiece of this spec is Part 2: eleven real, shipped Raycon campaigns (transcribed from screenshots Tim provided) that define what a "catchy" headline actually is for this brand. Until now every iteration tried to describe the register in abstract rules; this one anchors it to shipped work. The reference set goes into `copy-system.md` verbatim.

---

## Part 1 — Occasion picker: stop showing the whole calendar

### Problem
`InputForm.tsx` fetches `/api/promotions` with **no year/month filter**, so the occasion dropdown renders the entire consolidated Promotional Calendar: 2023–2024 history ("Impact Earbuds Launch · 2023-06-20", "Global-E · 2024-05-30"), dozens of dated one-offs, and a block of undated planner-style rows ("E61 - Pro Sleep", "Cheetos Limited Edition O15", "UFC Limited Edition B43?"). An occasion picker should offer occasions you can currently write for, not the archive.

### Changes (`src/components/InputForm.tsx`; optionally `/api/promotions`)

**1a. Filter.** Show a promotion only if it is current or upcoming: `endDate >= today`, or (no endDate) `startDate >= today - 7d`. Drop undated rows entirely — a promotion with no dates can't drive stage/urgency/deadline language, which is the whole point of picking one.

**1b. Sort + cap.** Sort ascending by `startDate` (soonest first). Cap the list at ~15; the archive is never needed mid-brief.

**1c. Structure.** Final picker shape:
```
Custom / evergreen (no calendar promotion)
⚡ Flash Sale (ad hoc)                      ← pinned, from v2 Part A
── Current & upcoming ──
<filtered, date-sorted promotions, "Sale Name · start date">
```

**1d. Server-side option (preferred).** Add `?active=1` to `/api/promotions` that applies the date filter server-side, so every consumer gets the clean list and the client stays dumb.

### Acceptance
- No 2023/2024 entries, no undated entries, list sorted soonest-first, ≤15 rows + the two pinned options.

---

## Part 2 — The reference set: 11 shipped campaigns (CANONICAL — inject into copy-system.md VOICE)

Transcribed from real sent campaigns. **These replace the v2 Part D4 invented examples as the primary register anchor.** (The v2 anti-examples list stays.)

| # | HEADLINE | TAGLINE / support | Notes |
|---|---|---|---|
| 1 | Summer Just Got Louder | 20% OFF SITEWIDE · USE CODE: SUNNY | Idiom remix: "just got better" (banned cliché) → product word "Louder" makes it brand voice |
| 2 | Sound Worth Celebrating | 25% off our most popular open audio gear | Occasion tie; category descriptor for multi-product |
| 3 | Best Part of Working Out | Fitness Earbuds are 30% off. Right now. | Bold claim headline; tagline = plain offer + clipped punch |
| 4 | Ready for the Road | Up to 20% off the lineup made for moving | Occasion idiom; "the lineup made for moving" = characterful category descriptor |
| 5 | Tonight's Your Night | The Sleep Earbuds. | Product-truth pun (sleep); tagline can be JUST the product name |
| 6 | Sound as good as it looks | Three styles we're sure your mom would approve of | Tagline with a light wink, still concrete |
| 7 | Great Moms Deserve Great Sound | Up to 50% off sitewide | Parallel structure (Great…Great) |
| 8 | Say Yes To: (body layout) | subheads: "A build that shrugs off sweat and rain" / "A battery that keeps you going" + one-line spec support | The body-subheader pattern: benefit fragment, spec proof below |
| 9 | Motion Never Stops | The Fitness Earbuds, 20% off | Product truth as declaration |
| 10 | Open All Summer | Fitness Open Earbuds, 25% off. | Double meaning: open audio + "open all summer" |
| 11 | Fit That Won't Quit | 30% off Fitness Open Earbuds | Rhyme + product truth (secure fit) |

### What the set proves (the formula)

**Headlines are the hook. Taglines are the payoff.** In every shipped example the playfulness lives in the HEADLINE (idiom remix, pun, rhyme, bold claim) and the TAGLINE states the offer plainly, with at most a light wink. **This inverts v2 Part D's "tagline may be a personality line" — that clause is revoked.** Playfulness concentrates in the headline; the tagline answers it with the deal.

**The four headline patterns (add to VOICE as the generation recipe):**
1. **Idiom remix** — take a familiar phrase and swap one word for a sound/product word: "Summer Just Got *Louder*", "*Open* All Summer", "Ready for the Road". The banned-cliché list is the raw material: the cliché verbatim is banned, the product-word remix is the voice (e.g. "just got better" banned → "Just Got Louder" shipped).
2. **Product-truth pun** — the product's core benefit doubles as the occasion: "Tonight's Your Night" (Sleep Earbuds), "Motion Never Stops" (Fitness).
3. **Rhyme / parallel** — "Fit That Won't Quit", "Great Moms Deserve Great Sound". One echo, never a three-item run (anaphora ban stands).
4. **Bold plain claim** — "Best Part of Working Out", "Sound Worth Celebrating". Confident superlative, no hedge.

All are 3–5 words. None contain a discount number, a code, or an urgency tag — the offer lives in the tagline, the code in its own callout. Headline generation instruction: draft one candidate per pattern (4 minimum), pick the strongest.

---

## Part 3 — Tagline rules (rewrite; supersedes v2 Part D2 tagline row)

New tagline rule block for `copy-system.md`:

> **Tagline.** One line, 8 words max (the shipped range is 2–8). The tagline is the plain payoff of the headline's hook: it states the offer and what it covers. A light wink is welcome ("the lineup made for moving", "styles we're sure your mom would approve of") but the offer stays legible at a glance.
>
> **Product naming by count (featured products):**
> - 1 product → name it: "The Sleep Earbuds." / "Fitness Earbuds are 30% off. Right now."
> - 2 products → name BOTH by exact catalogue name: "Essential Headphones and Everyday Headphones, 30% off." Never substitute a generic bucket ("headphones", "earbuds") for products that can be named in the space available.
> - 3+ products → a characterful category descriptor ("our most popular open audio gear", "the lineup made for moving") or, when truly sitewide, "sitewide". Never a roll-call of 3+ names, never a bare generic noun with no character.
> - Scope must be TRUE (v2 Part C2 stands): never name a product that isn't featured, never imply one product is the whole deal.
>
> **Never in a tagline:** the promo code (codes get their own callout, per every shipped example), an urgency tag, or a counting construction (below).

**New hard rule — counting constructions (`copy-system.md` RULES → Banned structures):**
> - No counting constructions: "one code", "one deal", "one deadline", "one window", "N products/styles/picks, one X". There is only ever one code and one deadline; counting them is filler. (This generalizes the existing "pairs" ban — "Three pairs, one code" fails twice.)

This kills this iteration's tagline ("Pro Earbuds, Headphones, and one code") three ways: wrong scope (Pro Earbuds not featured), generic bucket instead of the two real names, and "one code".

---

## Part 4 — Subheader cap: back to 7 (amends v2 Part D2)

v2 raised the subheader cap to 10 words; in practice the longer subheaders read padded. Tim's call: **7 words max, aim 3–6.** The shipped pattern (reference #8) is the target: a benefit fragment ("A battery that keeps you going"), with the spec proof in the supporting line below it, not inside the subheader. Update the caps table, SELFCHECK #3, and the `generate.ts` reference accordingly. Keep the 3-option array shape and the strongest-first ordering.

Body-section subheaders specifically follow reference #8: benefit-fragment register, never offer mechanics ("30% off. Closes tonight." as a subheader was iteration-1's miss; mechanics live in tagline/body/CTA).

---

## Part 5 — Prompt integration (where each piece lands)

| Piece | File | Placement |
|---|---|---|
| Reference set table (Part 2) | `data/copy-system.md` VOICE | New subsection "How shipped campaigns sound", replacing v2 D4's invented headline/tagline examples (keep v2's subject/preview/body examples + anti-examples) |
| 4-pattern headline recipe | `data/copy-system.md` VOICE | Directly under the reference set; `generate.ts` headline bullet says "draft one candidate per pattern, pick the strongest" |
| Tagline rule block (Part 3) | `data/copy-system.md` RULES (caps table + structures) | Replaces current tagline row |
| Counting-construction ban | `data/copy-system.md` RULES → Banned structures + SELFCHECK | New numbered self-check item |
| Subheader cap 7 | `data/copy-system.md` caps table + SELFCHECK #3 | — |
| Occasion filter | `InputForm.tsx` (+ `/api/promotions?active=1`) | — |

Reminder from v2 (still binding): `generate.ts` references the gate's caps instead of restating numbers, so the 10-vs-7 change happens in ONE file.

---

## Acceptance tests

1. **Picker:** open occasion dropdown → pinned Custom + Flash Sale, then only current/upcoming dated promotions, soonest first. Zero 2023/2024, zero undated.
2. **Headline:** regenerate the H10+H20 flash sale at dial 2 and dial 4 → headline is 3–5 words, matches one of the four patterns, contains no discount/code/urgency tag. Dial 2 vs 4 differ in wit, not in formula.
3. **Tagline:** for the 2-product sale → both products named exactly ("Essential Headphones and Everyday Headphones, 30% off." shape). Zero generic buckets, zero codes, zero "one code/one deal", ≤8 words.
4. **Subheader:** every subheader ≤7 words; body-section subheaders are benefit fragments, zero offer mechanics.
5. **Regression:** all v2 acceptance tests still pass (deadline language honesty, subject scope, review fill).

## Out of scope
- Any change to the four dial 1–3 definitions, the banned/cliché lists, or review handling.
- Redesigning the code callout element (codes already render separately; this spec only keeps them out of taglines).
