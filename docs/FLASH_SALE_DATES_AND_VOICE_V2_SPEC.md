# Flash Sale Inputs, Date-Aware Urgency, and Voice v2 — Implementation Spec

Status: ready to implement (nothing applied yet)
Date: 2026-07-23
Predecessor: `COPY_QUALITY_AND_REVIEW_INJECTION_SPEC.md` (diagnostics; Parts 1–3 fixes partially applied)
Decisions locked with Tim: tone dial runs at 4–5 and output is still flat → this is a **voice-system revision**, not a bug fix. Tagline direction: **playful/editorial** at high dials. Stage/date mismatch: **auto-adjust language** (keep last-call framing, compute honest deadline phrasing, step urgency down).

This spec is written to be implemented in ONE pass. Every change lists the exact file, the exact rule text or code shape, and the acceptance test that proves it. The dial 4–5 example lines in Part D are the approved taste anchor: implementers copy them into the prompt verbatim; the model is steered by them, not by its own idea of "playful."

---

## Part A — Brief panel: evergreen Flash Sale occasion + dates

### Problem
Flash sales are ad hoc (sometimes two in a week) and never live on the Promotional Calendar. Today the occasion picker only offers calendar promotions, so a flash sale has no occasion → the compiler falls back to the type label → conceit degenerates to "Sale — Sale: the deal is the reason to open." The model gets no real angle and no real window.

### Changes

**A1. Schema (`src/lib/schemas.ts`, `BriefInput`).** Add:

```ts
/** "flash_sale" = evergreen ad-hoc occasion, decoupled from the promo calendar. */
occasion_kind?: "promo_calendar" | "flash_sale";
/** Flash sale window (ISO yyyy-mm-dd). Required when occasion_kind === "flash_sale". */
flash_sale_start?: string;
flash_sale_end?: string;
/** Planned send date (ISO). Defaults to today at compile time. Drives deadline language. */
send_date?: string;
```

**A2. Occasion picker (`src/components/InputForm.tsx`).**
- Pin a permanent first option "⚡ Flash Sale (ad hoc)" above the calendar promotions. Selecting it sets `occasion_kind: "flash_sale"`, `occasion: "Flash Sale"`, `promotion_id: undefined`.
- When selected, reveal three date inputs: **Flash sale start**, **Flash sale end** (required), **Send date** (defaults to today). Validate `start ≤ end` and `send_date ≤ end`; block generate on violation with an inline message, not a silent clamp.
- The existing derived Stage/Urgency chips must recompute live from these dates (same `deriveSendStage` path as calendar promotions — see A3).

**A3. Compiler (`src/lib/brief/compile.ts`).** When `occasion_kind === "flash_sale"`, build a synthetic promotion internally:

```ts
const promo = input.occasion_kind === "flash_sale"
  ? { sale: "Flash Sale", promotion: offer, startDate: input.flash_sale_start, endDate: input.flash_sale_end }
  : promotion;
```

…and run the existing `deriveSendStage`/slot logic against it unchanged. This gives `{dates}`, `{deadline}`, stage, and urgency for free, and the conceit becomes "Flash Sale · …" with a real thesis instead of "Sale — Sale".

### Acceptance (Part A)
- Creating a flash-sale brief with end date = today yields conceit name "Flash Sale", stage `last_call`, urgency 3.
- No promo calendar entry is required or consulted.
- Missing end date blocks generation with a visible message.

---

## Part B — Date-aware deadline language + urgency (the synergy rule)

### Problem
Last-call sends often go out 24–48h before the window closes, but the copy always says "tonight" (this iteration: subject 1, subject 2's sibling, subheader, body — all "tonight"). If the send is 48h early, "tonight" is factually false, which violates the honesty rules the system already claims to enforce. Urgency also shouldn't be pinned at 3 when there are two days left.

### Changes

**B1. New pure function (`src/lib/brief/compile.ts`).**

```ts
// daysToEnd = calendar days from send_date to endDate (0 = send day IS the last day)
export function deadlineLanguage(sendDate: string, endDate: string): { phrase: string; urgency: UrgencyTier } {
  // 0 → { phrase: "tonight", urgency: 3 }
  // 1 → { phrase: "tomorrow night", urgency: 3 }
  // 2 → { phrase: "in 48 hours" (or "Friday night" if the weekday is unambiguous), urgency: 2 }
  // 3+ → { phrase: "<Weekday>, <Month D>", urgency: 2 }  // and the UI suggests stage "reminder"
}
```

`send_date` defaults to today (`today` param already threaded through `compileBrief`). A manual `input.urgency` override still wins, matching current behavior.

**B2. Carry it to the model (`ExpandedBrief` + `generate.ts`).**
- Add `deadline_language?: string` to `ExpandedBrief`; compiler sets it whenever an end date is known.
- In `generateUserPrompt`, when present, inject a literal constraint line directly above the hard-rules gate:
  > DEADLINE LANGUAGE: the sale ends {deadline_language}. Use this exact time frame everywhere a deadline is named. "Tonight"/"today" are FORBIDDEN unless the supplied phrase is "tonight".

**B3. Hard rule (`data/copy-system.md`, RULES → Honesty and semantics).** Add:
> - Deadline words match the supplied deadline language exactly. Never write "tonight", "today", or "hours left" when the sale ends on a later date. If no deadline language is supplied, name no specific deadline at all.

And SELFCHECK: add "14. Every deadline mention uses the supplied deadline language; zero unsanctioned 'tonight'."

**B4. UI feedback (`InputForm.tsx`).** Next to the Stage/Urgency chips, show the computed phrase (e.g. `Deadline language: "tomorrow night"`). If the user forces `last_call` with 3+ days remaining, show a passive hint: "3 days to end date — consider Reminder." Never block; Tim decides.

### Acceptance (Part B)
- Same brief, three send dates (0 / 1 / 2 days before end) → copy says "tonight" / "tomorrow night" / "in 48 hours" respectively, everywhere a deadline is named, and urgency chips read 3 / 3 / 2.
- Grep of output for "tonight" on a 2-days-out send returns zero hits.

---

## Part C — Subject lines and preview text: scope + quality

### Problem
Subject 1 was "Pro Earbuds: 30% off ends tonight." for a THREE-product sale — the prompt's own DIRECT example ("Fitness Earbuds: 30% off ends tonight.") is a single-product template, so the model copies its shape regardless of scope.

### Changes

**C1. Replace the DIRECT slot instruction (`generate.ts` L32).**
> 1. DIRECT — the offer stated plainly, at the offer's TRUE scope. Single-product sale: "Fitness Earbuds: 30% off ends tonight." Multi-product sale: name the category or the count, never just one product ("30% off our top earbuds and headphones." / "Three of our best, all 30% off.").

**C2. Scope hard rule (`copy-system.md`, RULES → Honesty and semantics).** Add:
> - Subject lines, preview texts, taglines, and headlines reflect the offer's true scope. In a multi-product sale, never name a single product as if it is the whole deal. Name the category, the count ("three of our best"), or nothing.

**C3. Count-noun rule — "pairs" ban (verify applied; if not, add to RULES → Banned structures).**
> - Never count distinct products as "pairs" ("two pairs", "three pairs", "all three pairs"). One earbud/headphone set may be "a pair"; a multi-product lineup is "products", "styles", "picks", "favorites", or named individually.

**C4. Slot 2/3 playfulness is governed by Part D** — at dial ≥ 4, slots 2 and 3 must draw on the approved-example register below, not just soften slot 1.

### Acceptance (Part C)
- Multi-product brief → no subject/preview/tagline/headline names exactly one product; at least one names the category or count.
- Zero "pairs" as a product count anywhere.

---

## Part D — Voice v2: what dials 4–5 actually permit (APPROVED EXAMPLES INSIDE)

### Problem
Tim generates at dial 4–5 and output is still flat, because the current system *defines* dial 5 as "a very charming cheerful salesperson" and bans anything editorial at every dial. The ceiling is the spec, not the model. This part deliberately raises the ceiling at dials 4–5 while keeping every AI-cliché ban intact. Dials 1–3 are unchanged.

### D1. The boundary (add to `copy-system.md` VOICE, replacing the current tone-dial paragraph)

> **The tone dial (1 to 5).** Dials 1–3 are unchanged: 1 traces the closest reference, 3 is fresh copy in the plain retail voice. **Dials 4–5 unlock personality**: wordplay, light metaphor, one editorial turn of phrase per element, and taglines that pay off the headline instead of restating the offer. What NEVER unlocks, at any dial: the banned-word list, the AI heading clichés, em dashes, inversions ("It's not X, it's Y"), anaphora runs, defensive framing, full personification (objects or body parts taking actions or deadlines: "Your ears have until midnight" stays banned; a light attribute like "one very persuasive discount" is fine at 4–5), manufactured urgency, and product roll-calls. The line: playful is a *wink in passing*; clever-for-clever's-sake is copy that pauses to admire itself. If a line needs a second read to land, cut it.

### D2. Rule changes that make room (all in `copy-system.md`)

| Rule | Current | New |
|---|---|---|
| Tagline cap | 1 line, 10 words, offer OR promise | 1 line, **12 words**. Dials 1–3: offer or promise, plain. **Dials 4–5: may be a personality line that pays off the headline; offer mechanics then move to body/CTA.** Never a roll-call of 2+ product names (any dial). |
| Subheader cap | 6 words | **10 words** (aim 4–8). Same 3-option array shape. |
| Headline | 2 to 5 words | **3 to 6 words.** Never only an urgency tag ("Last Call", "Final Hours" alone banned); must also carry a benefit, product, or the offer. Never echoes the conceit or campaign name verbatim. |
| Roll-call ban | body openings only | Extend explicitly to Tagline, Headline, Subheader: never enumerate 2+ product names. |

Mirror the tagline/subheader/headline caps in `generate.ts` element-craft bullets — **by reference, not by restating numbers** ("caps per the HARD RULES gate"), so the two sources can never drift again (the drift caused iteration-2's 12-vs-10 slack).

### D3. `generate.ts` `toneDirective()` — replace dial 4 and 5 text

Dial 4:
> Personality on. Playful headlines, one pun or turn of phrase where it comes easily, taglines may wink instead of restate. Draw on the approved dial 4–5 examples in the voice for register. Every hard ban stays intact.

Dial 5:
> Maximum personality within the bans. Wordplay, light metaphor, an editorial turn per element. The approved examples ARE the register: match their wit level, no further. Clever that needs a second read is a fail, not a flex.

### D4. APPROVED EXAMPLE LINES (Tim-approved; inject into VOICE as "How dials 4–5 sound")

These go into `copy-system.md` verbatim as the register anchor, replacing guesswork. Context: 30%-off multi-product flash sale (ANC earbuds + two over-ear headphones), code PRIME.

**Headlines (3–6 words):**
- "The Good Kind of Loud"
- "30% Off the Quiet Life"
- "Full-Volume Savings End Tonight"
- "Big Sound, Smaller Price"

**Taglines (personality line, mechanics moved to body/CTA):**
- "Noise cancellation for everything except this deal."
- "Three of our loudest fan favorites, quietly discounted."
- "The upgrade you keep putting off, 30% lighter."
- "Serious sound at a not-so-serious price."

**Subject lines:**
- "Psst. The good ones are 30% off."
- "Earbuds, headphones, and one very persuasive discount."
- "We'll keep this short: 30% off ends tomorrow."
- "Your playlist deserves better speakers. 30% off says start now." *(dial 5 ceiling — this is as far as personification stretch goes)*

**Preview texts:**
- "Code PRIME at checkout. The quiet life has never been cheaper."
- "Three of our best, one code, and a deadline with your name on it."

**Subheaders (≤10 words):**
- "Serious sound at a not-so-serious price"
- "Big battery, bigger discount" *(the one allowed parallel pair)*
- "The rare deal that sounds as good as it looks"

**Body opener:**
- "Here's the deal, and it's a good one: 30% off our three most-loved listens through Friday night."

**ANTI-EXAMPLES (banned at every dial — include these in the VOICE block too, labeled):**
- "Silence never sounded so good" (heading cliché)
- "It's not a sale, it's a send-off" (inversion)
- "Real sound. Real savings. Real fast." (anaphora run)
- "Say goodbye to full price" (banned phrase family)
- "Your ears have until midnight" (full personification)
- "Last call. Three pairs, one deal." (urgency-only + pairs count)

### Acceptance (Part D)
- Regenerate the same flash-sale brief at dial 4: tagline is a personality line (not offer restatement, not roll-call), at least one subject line matches the approved register, zero anti-example patterns.
- Regenerate at dial 2: output unchanged in character from today (dials 1–3 untouched).

---

## Part E — Data housekeeping

**E1. Reorder `data/reviews/E95.json` — file order IS the ranking (fetcher takes index 0).**
1. T.F. ("Really feels comfortable. The sound quality is spectacular…") → first.
2. Rodney G. → second.
3. **Delete Marilyn O.** ("This is a gift for my other son. He doesn't have it yet…") — secondhand, no firsthand product experience; it fails the spirit of the review element.

**E2. Curation criteria (add as a README line in `data/reviews/` or a comment convention).** Rank by: firsthand use > specific sensory/benefit detail > generic praise. Exclude: gift/secondhand reviews, "haven't tried yet", price-only praise, any comparison to older Raycons.

**E3. Overused-builder-phrase rotation (`copy-system.md`, RULES).** Add:
> **Overused builder phrases (rotate away).** These have appeared in nearly every recent generation; treat as one-per-campaign maximum, prefer zero: "window" (as a sale period: "last window", "upgrade window", "the window closes"), "the price resets", "pick the pair/one that fits your life", "get it done", "you're done", "just so you know" (outside the reference line it comes from).

### Acceptance (Part E)
- E95 card shows the T.F. review.
- Two consecutive generations of the same brief share zero phrases from the rotation list.

---

## Implementation order (one pass)

1. Part E (data, 5 min — immediate quality lift, zero risk).
2. Part A schema + compiler (A1, A3), then A2 UI.
3. Part B (`deadlineLanguage`, prompt injection, hard rule, UI chip).
4. Parts C + D rule text in `copy-system.md` + `generate.ts` (single commit — they touch the same files).
5. Regression run: the acceptance tests above, plus the full original acceptance set (headline not urgency-only, no roll-call, reviews filled, scope-true subjects) on ONE regenerated campaign at dial 4 and one at dial 2.

## Out of scope (explicitly)
- Live review parser for non-Judge.me widgets (curated files are the supported path).
- Any change to dials 1–3, the banned-word/cliché lists, or the never-fabricate-reviews rule.
- Image direction removal — **already specced in the predecessor doc, Part 3**; implement from there if not yet applied.
