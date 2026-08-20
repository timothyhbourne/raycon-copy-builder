# Recursive Learning Framework — Spec

**Status:** BUILT 2026-08-19 (branch `copy-voice-rebuild`). Phases 0-4 implemented;
see "Build record" below for what shipped, what deviated, and what is still open.
**Supersedes:** `docs/LEARNING_LOOP_SPEC.md` (which specified the performance half only).
**Related:** `docs/CONSTRUCTION_INDEX_PROMPT.md`, `docs/COPY_PERFORMANCE_SPEC.md`,
`src/lib/performance-memory.ts` (now wired, see §6).

---

## 0. What this is

Two things that turn out to be the same thing.

**The goal.** The app should learn from every piece of copy that was actually
approved and shipped, keep relearning as new sends land, and never repeat itself
while doing so.

**The problem it also fixes.** Headlines currently read dull, repetitive and
by-the-book. That is not a coincidence and not a model limitation — it is a
direct consequence of the same missing machinery, plus one default setting that
is doing more damage than anything else in the pipeline. Part 1 covers that
diagnosis because it is cheap to fix and it is the proof case for the framework.

The framework's core claim: **learning and non-repetition are two opposing forces
and you have to build both, deliberately, or you get one failure mode or the
other.** Build only the "learn what works" half and copy converges on a single
winning formula and goes stale — which is roughly where the tool is now. Build
only the "never repeat" half and you get novelty for its own sake. The design
below holds them apart on purpose: **attraction operates on effect, repulsion
operates on form.**

---

# Part 1 — Why the headlines are dull

Findings from reading the generation path end to end. Ordered by size of effect.

## 1.1 The tone dial defaults to 1, and dial 1 is labelled "By the book"

`src/components/InputForm.tsx:75` — `tone_dial: 1`.
`src/components/InputForm.tsx:85` — `TONE_LABELS[1] = "By the book"`.

Dial 1's instruction (`src/lib/prompts/generate.ts:59-60`) is:

> "Trace the closest reference closely and adapt it to the new offer. **Use no
> phrasing that is absent from the references.** This is the safest, most
> on-brand setting."

That is a literal instruction not to invent anything. Every campaign that ships
without someone deliberately dragging the slider is a traced variation of the
same 11 canonical reference headlines. The slider renders "Safe" on the left and
"Bold" on the right and starts pinned to Safe.

The phrase used to describe the problem — "dull, by the book" — is the app's own
label for the setting it defaults to. This is the single highest-leverage fix in
this document and it is a one-line change.

**Fix:** default `tone_dial` to **4**. Dial 4 is labelled "Creative": *"Personality
on. Playful headlines built from the four headline patterns… Every hard ban stays
intact."* Nothing about the safety envelope changes — the ban lists, cliché list,
length caps and honesty rules do not unlock at any dial
(`data/copy-system.md:52`). The only thing dial 1 buys is tracing, and tracing is
the thing being complained about.

Change in three places so a brief cannot silently fall back to 1:

| File | Line | Now | Change to |
|---|---|---|---|
| `src/components/InputForm.tsx` | 75, 338 | `1` | `4` |
| `src/app/api/generate/route.ts` | 40 | `?? 1` | `?? 4` |
| `src/lib/planner-copy-link.ts` | 102 | `tone_dial: 1` | `4` |

## 1.2 The dial fallback is inconsistent across routes

- `/api/generate:40` → `?? 1`
- `/api/regenerate-section:28` → `?? 1`
- `/api/regenerate-element:57` → `?? 3`
- `/api/section-variations:52` → `?? 3`

So a campaign generates at dial 1 and then, if the client omits the dial,
regenerating a single element silently jumps to 3. Same brief, two voices, no
signal to the user. Pick one constant, export it from
`src/lib/prompts/generate.ts`, and use it in all four routes.

## 1.3 The headline is the highest-stakes element with the weakest divergence machinery

Compare what the prompt asks for, element by element
(`src/lib/prompts/generate.ts:27-31`):

- **Subheader** — "an array of EXACTLY 3 distinct options… each a genuinely
  different angle (one benefit-led, one product/feature-led, one
  occasion/emotion-led)… ordered strongest-first." Three candidates, *emitted*,
  visible, selectable, and `subheader_selected` is recorded.
- **Subject / preview** — three each, with assigned slots (direct / playful /
  curiosity). Emitted and visible.
- **Headline** — "Draft one candidate per headline pattern… (4 minimum), pick the
  strongest." Four candidates, **internal only**. One string is emitted. Nobody
  ever sees the other three, nobody can pick, and nothing records what was
  considered.

An instruction to "internally draft four and pick the strongest" is unverifiable
and weakly followed. The elements that produce visible slates produce noticeably
more variety than the one that does not — and the headline is the element that
carries the whole hook.

**Fix:** make `Headline` emit a slate of **4, one per named pattern**, the same
shape as `Subheader`. Label each with its pattern so the writer is choosing
between genuinely different constructions rather than four rewordings:

```
"Headline": [
  {"pattern": "idiom_remix",   "text": "Summer Just Got Louder"},
  {"pattern": "product_truth", "text": "Motion Never Stops"},
  {"pattern": "rhyme",         "text": "Fit That Won't Quit"},
  {"pattern": "bold_claim",    "text": "Best Part of Working Out"}
]
```

Add `headline_selected` alongside the existing `subheader_selected`
(`src/lib/schemas.ts:169`). The collapse logic already exists —
`extractSubheaderVariants` in `src/lib/normalize-section.ts:13-34` — and
generalises to any element with a variant array.

This also has to work as a pair: the Tagline pays off the Headline
(`copy-system.md:47`), so the tagline regenerates when the selected headline
changes, or the slate carries headline+tagline pairs rather than headlines alone.
Pairs are the better answer and match the brand rule.

## 1.4 The anti-obviousness instruction skips the headline

`data/copy-system.md:50`:

> "**Reaching past the first instinct (Subheaders and Taglines).** The first
> phrasing that comes to mind for a heading is almost always the statistically
> most common, most obviously AI option. Generate at least 5 candidates
> internally, **discard the 2 to 3 most predictable**, and choose from the
> less-obvious remainder…"

This is the single best instruction in the whole prompt system and it is scoped to
Subheaders and Taglines. The Headline gets "draft one per pattern, pick the
strongest" — which selects for *strongest*, not for *least predictable*. Those are
different objectives, and "strongest" under a tight ban list resolves to "safest."

**Fix:** extend the discard-the-predictable clause to Headlines explicitly.

## 1.5 The reference set is 11 examples and is described as the ceiling

`data/copy-system.md:54` calls the 11-row table the "CANONICAL register anchor"
and instructs: *"Match this, not your own idea of playful."* Dial 5 goes further:
*"The shipped reference set IS the register: match its wit level, no further."*

Eleven examples, four patterns derived from those eleven, and an instruction to
not exceed them. The model correctly regresses to the mean of a very small set.
Every headline reads like one of eleven headlines because it is being told to.

**Fix:** this is the point where Part 1 becomes Part 2. The reference set should
not be 11 hand-picked rows frozen in a markdown file. It should be a **rotating
sample drawn from the approved corpus**, selected for relevance to the current
brief and deliberately varied across sends. The framework builds exactly that.

## 1.6 The repetition checker cannot see the thing that makes headlines feel repetitive

`src/lib/constructions.ts:482-524` — similarity is the max of character-trigram
Jaccard and token-set containment, threshold 0.65.

That catches **"Summer Just Got Louder"** vs **"Fall Just Got Louder"**.
It does not catch **"Motion Never Stops"** vs **"Sound Never Quits"** vs
**"Fit That Won't Quit"** — near-zero lexical overlap, identical construction:
`[noun] [negated-verb] [verb]`, three words, product-truth declaration.

A reader does not experience repetition lexically. They experience it as *"these
all sound the same."* The checker measures the wrong thing, which is why headlines
pass it and still feel repetitive. §2.3 defines the fix.

## 1.7 Temperature is unset

`/api/generate` (`route.ts:105-109`) sets `model` and `max_tokens` and no
`temperature`, so it takes the API default of 1.0. `/api/section-variations:89`
sets it explicitly to 1. Not a bug today, but it should be explicit and named, so
that it is a decision rather than an accident — and so per-element tuning is
possible later.

## 1.8 Order of operations for Part 1

1. Default dial to 4; unify the fallback constant across the four routes. *(one afternoon, largest effect)*
2. Extend the discard-the-predictable clause to Headlines. *(prompt edit)*
3. Headline+Tagline emitted as a 4-pair slate with `headline_selected`. *(medium)*
4. Make temperature explicit. *(trivial)*

Items 5 (rotating references) and 6 (form-level repetition) are Part 2.

---

# Part 2 — The framework

## 2.1 The two forces

| | Attraction | Repulsion |
|---|---|---|
| Question | "What worked?" | "What have we already said?" |
| Operates on | **Effect** — revenue per recipient, click behaviour | **Form** — construction, pattern, rhythm, opening move |
| Source | Tier A corpus + planner metrics | Tiers A, B and C corpus |
| Injected as | `PERFORMANCE` block | `AVOID` block (exists) + `FORM BUDGET` block (new) |
| Failure if built alone | Converges on one formula, goes stale | Novelty with no direction |

The separation is the whole design. **Never let attraction operate on form.** The
moment the system learns "idiom-remix headlines earn more" and starts preferring
idiom remixes, it has begun manufacturing the exact staleness Part 1 diagnoses. It
may learn that a *register* works. It may not learn that a *construction* works
and then reuse that construction — the construction goes on the repulsion side,
always, no matter how well it performed.

Stated as a rule the implementation must honour:

> Performance guidance may name angles, stages, structural choices and offer
> framing. It may never name or quote a specific headline, tagline, subject line
> or phrasing as a thing to emulate.

## 2.2 The corpus and its authority tiers

**The approval signal already exists in the data model.** A `PlannerRow` with
`status: "scheduled"` means a human took that copy and put it into the sending
platform — `statusLabel()` renders it as "Scheduled in Klaviyo" or "Scheduled in
Postscript" depending on `channel` (`src/lib/planner-types.ts:30-33`). The copy
itself is reachable through `copy_campaign_id`. No platform API integration is
required, and Postscript — which has no usable public campaign API — is covered by
exactly the same mechanism as Klaviyo.

That gives three tiers:

| Tier | Definition | Counts for attraction | Counts for repulsion |
|---|---|---|---|
| **A — Shipped & measured** | `status: "scheduled"` AND `isEffectivelySent()` (send date in the past, `planner-types.ts:134-136`) AND metrics synced | **Yes** — this is the only tier with performance | Yes |
| **B — Approved, in flight** | `status: "scheduled"`, send date in the future | No (no outcome yet) | **Yes — critically** |
| **C — Drafted only** | In the library, never reached `scheduled` | No | Yes, at reduced weight |

Three consequences worth stating plainly, because each is a live defect today:

**The system currently learns from the wrong set.** `constructions.ts` is indexed
on `finalize` (`src/app/api/finalize/route.ts:27-28`) — i.e. on "someone clicked
Save Final." That is not approval. Copy that was drafted, rejected and abandoned
sits in the avoid-block and the reference retrieval with exactly the same weight
as copy that shipped to 400,000 people. Tier C is the *weakest* signal in the
corpus and it is presently the *only* signal.

**Tier B is invisible and it is the most dangerous gap.** Copy scheduled for
Thursday is not in the constructions index in any distinguished way, so nothing
stops today's generation producing a near-identical headline to one that goes out
in three days. Approved-but-unsent is the single most important thing to repel
from, and it is currently unmodelled.

**Tier A is where "learn from what's approved" actually lives.** It is a filter
over data the app already holds, not an integration.

### Postscript / SMS

Same rule, no special case: an SMS planner row at `status: "scheduled"` links to
an `SmsCampaign` and enters the corpus as Tier B, then Tier A once the send date
passes. The only asymmetry is that SMS platform metrics are hand-entered
(`metrics_source: "manual"`), so a Tier-A SMS record carries performance **only
if** someone typed the numbers in. Records without metrics stay in the repulsion
set and are excluded from attraction. No estimation, no imputation.

## 2.3 Form signatures — repetition the way a reader experiences it

The unit of repulsion is not a string. It is a **form signature**: a compact
structural fingerprint computed deterministically from a line.

For a headline:

| Field | Example: "Fit That Won't Quit" | Example: "Motion Never Stops" |
|---|---|---|
| `pattern` | `rhyme` | `product_truth` |
| `template` | `NOUN + REL-CLAUSE + NEG-VERB` | `NOUN + ADV-NEG + VERB` |
| `word_count` | 4 | 3 |
| `head_noun` | fit | motion |
| `verb_lemma` | quit | stop |
| `devices` | `["rhyme", "negation"]` | `["negation", "declarative"]` |
| `opening_pos` | NOUN | NOUN |

"Fit That Won't Quit" and "Motion Never Stops" share `devices: negation`,
`opening_pos: NOUN` and a declarative three-to-four-word shape. Trigram
similarity between them is ~0. Signature similarity is high. **That is the
repetition the reader feels and the current checker cannot see.**

Implementation notes:

- Deterministic and pure, in the spirit of `hard-rules-check.ts` — no LLM in the
  scoring path. A small POS tagger or a rule-based shape extractor is sufficient
  for 3–8 word lines; do not reach for a model here.
- Signature distance = weighted field agreement, not string distance. Weight
  `pattern` and `devices` highest.
- Applies to Headline, Tagline, Subject, Preview, Subheader and body openers. Note
  that taglines, subheaders, CTAs and closing lines are currently written *into*
  the constructions index and never *checked* against it
  (`src/lib/repetition-client.ts:55-86` collects only Headline, body opener and
  one-liners). Close that gap in the same pass.
- Keep the existing lexical check. It catches near-verbatim reuse, which the
  signature check will miss. Run both; either can flag.

### The form budget

Signatures make a new and better instruction possible. Instead of "don't reuse
these lines," the prompt can carry a quota:

> FORM BUDGET — the last 8 approved sends used: idiom_remix ×4, bold_claim ×3,
> product_truth ×1, rhyme ×0. Do not use idiom_remix or bold_claim for the
> headline in this send.

This is the mechanism that actually delivers "never repetitive." It is a
constraint on construction, applied before generation, rather than a similarity
check applied after — and it forces rotation through the pattern space instead of
letting the model settle into whichever pattern the reference table over-weights.

## 2.4 The five loops

```
  L1 INGEST        nightly + on status change
   Planner rows at status:"scheduled" → resolve copy via copy_campaign_id
   → tier A/B/C → normalize → corpus store
        │
  L2 EXTRACT       on ingest
   Per element: form signature, pattern class, opening move, offer framing,
   structural signature. Deterministic. → corpus record
        │
  L3 ATTRIBUTE     on metrics sync
   Tier A only. Join planner revenue/recipients. Recipient-weighted pooled RPR.
   MIN_N guard. → performance aggregates
        │
  L4 INJECT        at generation
   AVOID block (lexical, exists) + FORM BUDGET (new, tiers A+B+C)
   + PERFORMANCE block (new, tier A only, effect-level only)
   + rotating REFERENCE sample (tier A, replaces the frozen 11)
        │
  L5 EVALUATE      weekly, after L3
   Did last period's guidance hold? Re-weight or retire signals that didn't.
   → guidance ledger
        └──────────────────► feeds back into L4
```

L5 is what makes it recursive rather than merely incremental. Without it the
system accumulates guidance and never retires any, which is how a learning loop
turns into a superstition engine. L5 asks, each week: of the associations the
`PERFORMANCE` block asserted, which survived contact with the next batch of
sends? Signals that stop replicating get down-weighted and eventually dropped, and
the drop is logged so a human can see what the system stopped believing and when.

## 2.5 Data model

New store on the existing seam (`src/lib/storage.ts`), namespace `corpus`:

```ts
interface CorpusRecord {
  id: string;                       // copy_campaign_id
  tier: "shipped" | "approved" | "drafted";
  channel: "email" | "sms";
  platform: "klaviyo" | "postscript" | null;
  planner_row_id: string | null;
  approved_at: string | null;       // when the row first hit status:"scheduled"
  sent_at: string | null;
  elements: CorpusElement[];
  performance: {                    // tier "shipped" only, null until synced
    recipients: number | null;
    revenue: number | null;
    rpr: number | null;
    basis: "platform" | "northbeam";
  } | null;
  schema_version: number;
}

interface CorpusElement {
  kind: "headline" | "tagline" | "subject" | "preview" | "subheader"
      | "one_liner" | "opener" | "cta" | "closing";
  text: string;
  signature: FormSignature;
  product_slug?: string;
  was_selected?: boolean;           // for slate elements — see §2.7
}
```

Validated at the read boundary through `src/lib/validation/`, `schema_version`
stamped on write, bad records logged and skipped — same contract as every other
store in the app (`ARCHITECTURE.md`, Validation).

The existing `constructions-index.json` becomes a derived view over this store
rather than a parallel source of truth. Do not run both indefinitely.

## 2.6 Injection at generation

Four blocks, in this order, each independently able to be empty:

1. **REFERENCE sample** — 4–6 Tier-A campaigns, scored for relevance to the brief
   (type, audience, product, occasion) *and* deliberately diversified by form
   signature so the sample is not four instances of one pattern. Replaces the
   frozen 11-row table in `data/copy-system.md:56-70`. Keep the table as the
   fallback when the corpus is thin.
2. **FORM BUDGET** — pattern quotas from the last N approved sends (§2.3).
3. **AVOID** — the existing lexical block (`buildAvoidBlock()`), now sourced from
   the corpus and tier-weighted, with Tier B included and marked as *in flight*.
4. **PERFORMANCE** — `buildPerformanceBlock()` from `src/lib/performance-memory.ts`,
   which already exists on `main` and is imported by nothing. Wire it — but not
   before §2.7.

## 2.7 Guards — the things that make this honest rather than plausible

**Fix the estimator before wiring the performance block.**
`src/lib/copy-performance.ts:215` takes an **unweighted mean** of per-campaign
RPRs, so a 2,000-recipient test send counts the same as a 400,000-recipient blast.
`total_revenue` and `total_recipients` are already accumulated at `:209-210`;
compute the pooled recipient-weighted RPR and rank on that. It is also univariate
across eight dimensions with no significance test and no multiple-comparison
correction, so "angle=urgency wins" is confounded with promo windows and audience
size. At minimum, require a between-group spread wider than the within-group
dispersion before a signal is eligible to be injected. Feeding the current
estimator into the prompt would train the copy on noise, and it would do so
invisibly.

**Capture what actually shipped.** Nothing currently records which of the three
subject lines was sent — `subheader_selected` exists, `selected_variant` exists
for SMS, and email subject/preview have no selection field at all. Without it,
every slate element enters the corpus as three equally-weighted candidates when
only one was ever seen by a customer. Add `was_selected` and set it at the point
the writer picks, at the same time as `headline_selected` from §1.3.

**Fail open, always.** Every block returns `""` when there is not enough signal.
Generation must never block or degrade because the corpus is thin, a sync failed,
or a store is empty. This matches how `performance-memory.ts` is already written
(`MIN_ATTRIBUTED_SENDS = 5`, returns `""`).

**No dollar figures in the prompt.** State associations and sample sizes, never
causes and never revenue. Already the stated contract of `performance-memory.ts`;
keep it.

**Log what the system believes.** The guidance ledger from L5 should be readable
in the app — what the framework currently asserts, on what n, and what it has
retired. A learning system that cannot be inspected cannot be trusted or debugged,
and the first time a writer disagrees with the copy they will want to see why the
machine thinks what it thinks.

**Corpus floor.** Below ~15 Tier-A records the performance block stays off
entirely and only the repulsion side runs. Repulsion is useful from record one;
attraction is not.

---

## 3. Build phases

**Phase 0 — headline fixes (Part 1, items 1, 2, 4).** Independent of everything
else. Ship this week. It is the change most likely to be felt immediately.

**Phase 1 — the corpus.** L1 + L2. Tier the existing library by planner status,
build form signatures, stand up the corpus store, make `constructions-index` a
derived view. Delivers the FORM BUDGET and Tier-B repulsion — the "never
repetitive" half — with no dependency on any performance work.

**Phase 2 — headline slate.** Part 1 item 3 plus `was_selected` capture. Depends
on Phase 1 for the pattern labels to mean anything.

**Phase 3 — attraction.** Fix the RPR estimator, then wire
`performance-memory.ts` into `/api/generate`, `/api/sms-generate` and
`/api/flows/generate`. In that order.

**Phase 4 — recursion.** L5, the guidance ledger, and the in-app view of it.

Phases 1 and 3 are separable and Phase 1 is worth more. If only one gets built,
build Phase 1: it addresses the complaint that prompted this document, and it
carries no statistical risk.

---

## 4. Acceptance criteria

- A campaign generated with default settings does not use dial 1.
- Two headlines with the same construction and no shared words are flagged as
  repetitive. Specifically: "Motion Never Stops" and "Sound Never Quits" flag.
- Copy scheduled for a future date is repelled from as strongly as copy already
  sent.
- The reference sample shown to the model differs between two consecutive
  generations with the same brief.
- Pattern distribution across any 8 consecutive approved sends shows no single
  pattern above 50%.
- Turning the corpus store off degrades output quality but does not break
  generation.
- The performance block never appears below the corpus floor, and never contains a
  quoted line or a dollar figure.
- Every claim in the guidance ledger carries its n and its date range.

---

## 5. Build record (2026-08-19)

Where the code lives, and where it departed from this document.

### Phase 0 — headline fixes

| Item | Where |
|---|---|
| One tone-dial default, = 4 | `DEFAULT_TONE_DIAL` in `src/lib/schemas.ts`, re-exported from `src/lib/prompts/generate.ts`. Used by the form, the planner seed, the copy-builder page, all four routes, and both `defaultTone` component props. No `?? 1` or `?? 3` survives. |
| Discard-the-predictable extended to Headlines | `data/copy-system.md` ("Reaching past the first instinct (Headlines, Subheaders and Taglines)") + the Headline craft rule in `prompts/generate.ts`. |
| Explicit temperature | `CREATIVE_TEMPERATURE` in `src/lib/anthropic.ts`, passed at all six copy-writing call sites. Value 1 = what those routes already ran at, so naming it changed no output. |

**Deviation:** the constant is declared in `schemas.ts`, not `prompts/generate.ts` as
§1.2 says, and re-exported from there. `prompts/generate.ts` transitively reads
product/USP files from disk, so a client component importing it would drag `fs`
into the browser bundle; `schemas.ts` is pure and already imported by both sides.

### Phase 1 — the corpus

`src/lib/corpus/`: `signature.ts` (form signatures + distance, pure),
`extract.ts` (copy → elements, pure), `blocks.ts` (form budget, in-flight,
rotating references, pure), `repetition.ts` (form-level scan),
`types.ts`, `store.ts`, `ingest.ts`, `inject.ts`, `summary.ts`,
`ledger.ts` / `ledger-types.ts`.

- Tiering is derived from `PlannerRow.status`, exactly as §2.2 specifies. No
  platform API involved. Verified against the live stores: 46 records — 21 shipped,
  2 approved in flight, 23 drafted, 9 measured.
- Ingest is a **full rebuild**, not incremental: a record's tier changes with the
  clock (approved becomes shipped when the send time passes), so anything
  incremental would need a re-tiering pass anyway. Triggered on finalize
  (rate-limited to once a minute — the library autosave posts there on a debounce),
  on any write to a scheduled planner row, and cache-on-read with a 15-minute TTL
  on the generation path.
- Repetition now runs **two** scans (`/api/check-repetition`), lexical and form,
  either of which can flag. `RepetitionFlag.reason` distinguishes them in the UI and
  in the auto-retry steering note, because "reword it" fixes one and does nothing
  for the other.
- The previously-unchecked kinds (tagline, subheader, CTA, closing line) are now
  collected and checked.

**Deviation from §2.5:** `constructions-index.json` is NOT yet a derived view of the
corpus. It is still written on finalize and still owns the lexical avoid block, the
USP recency slice, the SMS avoid block and the conceit history. What §2.6.3 asked
for — tier-weighting — is done: `buildAvoidBlock({ tiers })` takes the corpus's tier
map, orders in-flight copy first, labels it, and gives drafts one line so the byte
cap trims them first. Collapsing the two stores is the remaining piece of §2.5 and
it should be done deliberately, not as a side effect of this build: four independent
call paths read that index.

**Extension:** `ElementKind` gained `"sms"`. The spec's kind list is email-shaped and
an SMS message is a whole send in one line; folding it into `"opener"` would have
corrupted that bucket. SMS is otherwise handled with no special case, as §2.2 asks.

### Phase 2 — headline slate

`Headline` emits 4 pattern-labelled candidates, each carrying **its own tagline**
(§1.3's preferred answer, because the pair is one thought). `HeadlineVariant` +
`headline_selected` in `schemas.ts`; `normalizeSectionElements()` (the generalised
`extractSubheaderVariants`) collapses any slate; `SectionBlock` renders one picker
for both slates; `/api/regenerate-element` returns a slate for Headline.

`was_selected` capture is complete: `headline_selected`, `subheader_selected`, and
new `subject_selected` / `preview_selected` (a radio in `MetaBlock` — "mark the one
that ships"). `/api/planner/copy` resolves all of them, so the design handoff sees
the chosen line first, never one of the candidates that lost.

### Phase 3 — attraction

- **Estimator fixed first, as instructed.** `DimensionValueAgg.pooled_rpr` is the
  recipient-weighted figure and is now the ranking key; `mean_rpr` is retained as a
  secondary view. `DimensionAgg.spread` implements the eligibility bar from §2.7:
  between-group spread must exceed mean within-group dispersion, or nothing from
  that dimension may be injected. The Copy Performance page leads with the pooled
  number and states, per dimension, whether its ranking is worth acting on.
- `performance-memory.ts` rebuilt on the pooled estimator, wired into
  `/api/generate`, `/api/sms-generate` and `/api/flows/generate` via
  `corpus/inject.ts`, and gated by the corpus floor (15 measured Tier-A records).
  At the time of writing the account has 9, so **the performance block is
  correctly off** and only repulsion is running.
- The store I/O behind it is `src/lib/performance-records.ts`, shared with
  `/api/copy-performance` so the dashboard and the prompt can never disagree.

### Phase 4 — recursion

`corpus/ledger.ts` + `/api/learning` + the `/learning` page ("What It Learned").
Claims are re-checked against the current window; `insufficient_data` is explicitly
not a failure; one failure weakens (and immediately stops injection), two retire.
Every claim carries its n, its date range, its basis and its history. A weakened
claim that starts replicating again is revived — permanently blacklisting a
now-well-evidenced association would be its own kind of superstition.

### Acceptance criteria (§4)

| Criterion | State |
|---|---|
| Default settings do not use dial 1 | Met |
| "Motion Never Stops" / "Sound Never Quits" flag | Met (`signature.test.ts`, `repetition.test.ts`) |
| Future-dated copy repelled as hard as sent copy | Met (`repetition.test.ts`, `blocks.test.ts`) |
| Reference sample differs between consecutive generations | Met (persisted rotation cursor; `blocks.test.ts`) |
| No pattern above 50% across 8 approved sends | Mechanism in place (form budget bans anything above its fair share of the window); the outcome needs 8 sends written under it to confirm |
| Corpus off degrades but does not break generation | Met (every block returns `""`; `inject.ts` swallows all errors) |
| Performance block never below the floor, never quotes a line or a figure | Met |
| Every ledger claim carries n and date range | Met |

### Still open

1. §2.5's collapse of `constructions-index.json` into a view over the corpus.
2. The form-budget outcome check above, which needs 8 sends of real use.
3. L5 runs on demand (a button on `/learning`), not weekly. The Hobby plan is at its
   2-cron cap (`vercel.json`), which is why this is a button and not a schedule.
4. The tagger is a lexicon plus rules and mislabels words ("Clip In, Tune Up" reads
   as a fragment). It does not matter for distance — both sides go through the same
   tagger — but it does make `describeSignature()` output occasionally read oddly in
   the `/learning` table.

---

## 6. Out of scope

- **Any Klaviyo or Postscript API integration for copy ingestion.** The approval
  signal is `PlannerRow.status`, already in the app. Postscript has no usable
  public campaign API and this design does not need one.
- **Embeddings / vector retrieval.** Form signatures are deterministic,
  inspectable and debuggable; embeddings are none of those, and the failure mode
  here is semantic-but-not-lexical repetition, which signatures address directly.
  Parked as it was in `CONSTRUCTION_INDEX_PROMPT.md`.
- **Automatic A/B winner selection.** Requires holdout design the app does not
  have. `COPY_PERFORMANCE_SPEC` §11 parks this correctly.
- **Fine-tuning or training a model.** "Learning" here means retrieval, structured
  memory and prompt construction. No weights are touched.
- **Changing brand voice, hard rules or ban lists.** The framework changes what
  the model is *shown*, never what it is *forbidden*. Every hard ban survives every
  phase.
- **Flow-level attribution.** Blocked on flow-message-grain metrics, which the app
  does not pull today.
