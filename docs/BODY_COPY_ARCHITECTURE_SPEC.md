# Body Copy — Angle Adherence and Structural Variety

**Status:** diagnosed, fix proposed.
**Surface:** `src/lib/prompts/generate.ts`, `regenerate-element.ts`,
`regenerate-section.ts`, `src/lib/brief/compile.ts`, `src/lib/brief/blocks.ts`,
`data/copy-system.md`.
**Related:** `docs/RECURSIVE_LEARNING_FRAMEWORK_SPEC.md` — §2.3 form signatures.
This is the same idea applied one level up, to paragraphs.

---

## 1. The evidence

Three regenerations of the same Body Copy module, reported from use:

> **1.** The Fitness Earbuds earn their keep on the days that stack up fastest. A
> 56-hour battery means you charge once and forget about it for most of the week.
> The stabilizing gel fin and IPX7 waterproofing mean whatever the day throws at
> you, your earbuds are already ready for it. **30% off through Monday, Aug 31.**
>
> **2.** Pick up the Fitness Earbuds and you're set for the week. Fifty-six hours
> of total battery means one charge covers a lot of ground, and the stabilizing
> gel fin means they stay put whether you're running, commuting, or just moving
> fast. IPX7 waterproof, so rain and sweat are already handled. **Thirty percent
> off through Monday, Aug 31.**
>
> **3.** Some earbuds survive a workout. These survive the whole week. The
> stabilizing gel fin holds through your run, your commute, and the long stretch
> of everything after, and IPX7 waterproofing means sweat and rain are already
> accounted for. **Thirty percent off through Monday, Aug 31.**

Strip the wording and all three are the same paragraph:

| Slot | Every time |
|---|---|
| 1 | Hook asserting the product's role in the reader's week |
| 2 | Spec + benefit — battery |
| 3 | Spec + benefit — gel fin |
| 4 | Spec + benefit — IPX7 |
| 5 | Offer, last, near-verbatim |

Same three specs, same order, same closer. **The wording varies; the argument
never does.** And note what that means for our quality gates: these three are
lexically distinct enough to pass the repetition checker
(`constructions.ts`, char-trigram Jaccard at 0.65) while a reader sees the same
email three times. The checker measures the wrong thing — the same conclusion
`RECURSIVE_LEARNING_FRAMEWORK_SPEC.md` §1.6 reached for headlines.

The campaign was set to **offer-led**. In all three the offer is the last
sentence, which is the opposite of offer-led.

---

## 2. Four causes

### 2.1 An element craft rule hardcodes "offer last", for every angle ★

`generate.ts:38` and `regenerate-element.ts:89`, identical text:

> "2 to 4 short sentences in the voice. **May restate the offer or code at the
> end.** Advance the argument, do not re-say the header."

That instruction is angle-blind. It ships on every campaign. Meanwhile
`ANGLE_DIRECTIVE.offer_led` (`blocks.ts:22`) says:

> "The deal is the through-line. **State the offer plainly and early**, and let
> every section reinforce it."

The two directly contradict each other, and the craft rule wins — it is
specific, imperative, and attached to the element being written. The angle
directive is general and attached to the campaign.

### 2.2 The angle reaches the model buried inside a JSON dump

`regenerate-element.ts:186` opens the prompt with:

```
Campaign brief:
${JSON.stringify(expandedBrief, null, 2)}
```

The angle directive is in there — `compile.ts:179` folds `ANGLE_DIRECTIVE[angle]`
into `structural_notes`. But it arrives as one sentence nested inside a
pretty-printed JSON blob, several hundred tokens before a crisp craft rule that
says the opposite. It is present, not prominent.

### 2.3 No division of labour between modules ★

This is the "holistic" gap.

`regenerate-element.ts` gives the model the full campaign as `campaignContext`
("do NOT rewrite any of it") and the section's siblings ("must NOT restate
them"). Both are **anti-repetition** instructions. Neither tells the body what its
**job** is relative to the other modules.

So when a `usps` section below is already selling battery, gel fin and IPX7 — and
in this campaign it certainly is, because `uspSectionNote` (`generate.ts:108`)
binds each USP slot to that product's bank — the body has nothing telling it to do
something *else*. It reaches for the same three specs and produces a prose version
of the module underneath it.

`SectionSpec.focus` is the only per-section steering that exists, it is free text,
and it is usually empty. An empty job description gets filled by the default.

### 2.4 The brand system names exactly one body shape

`data/copy-system.md:37`:

> "**The default shape (the stacked case).** Open with a short hook or fact that
> promises specifics are coming. Stack three to five short, concrete truths, each
> landing on its own… Close with one earned line."

That is a precise description of all three examples above. The doc adds "this is a
philosophy, not a module count" — but no alternative shape is named anywhere, so
in practice it reads as *the* template. The model is following the brand system
correctly. The brand system only has one gear.

---

## 3. The fix

### 3.1 Make the body craft rule derive from the angle

Replace the hardcoded sentence in both `generate.ts:38` and
`regenerate-element.ts:89` with a per-architecture rule keyed on
`conceit.architecture` (already set from the angle at `compile.ts:275`):

| Architecture | Body craft rule |
|---|---|
| `offer_led` | **Open on the deal.** First sentence states the offer and what it covers. Everything after earns it. Never close on the offer — it has already been said. |
| `product_led` | Open on one product truth and stay with it. **One** spec, developed, not three listed. The offer appears once, in passing, never as the closer. |
| `story_led` | Hold the offer entirely. No discount figure, no deadline, no code in this module. |
| `occasion_led` | Open on the moment. The product arrives as the answer to it. Dates may close. |

Note two of the four now **forbid** the offer-last pattern outright rather than
merely not encouraging it. A permission ("may restate the offer at the end") is
read as a suggestion; the model takes it every time.

### 3.2 Promote the angle to a first-class block

Every prompt that writes or rewrites copy — generate, regenerate-element,
regenerate-section, section-variations — gets the angle as its own labelled
block, above the craft rules, not inside a JSON dump:

```
=== ANGLE: OFFER-LED ===
The deal is the through-line. State the offer plainly and early…
This governs the SHAPE of every module. Where a craft rule below appears to
conflict with it, the angle wins.
```

Precedence must be stated, because §2.1 is precisely a precedence failure.

### 3.3 Give every section a job, computed from the whole campaign ★

Add a deterministic **section role map** to `brief/compile.ts` — no LLM, same
spirit as the rest of the compiler. It walks the section structure and assigns
each module a job *relative to the others*:

```ts
export interface SectionRole {
  sectionId: string;
  job: string;              // what this module is for
  covered_elsewhere: string[]; // topics other modules own — do not duplicate
}
```

Rules, in order:

1. If a `usps` section exists, it **owns the specs**. Every spec bound to its
   slots goes into `covered_elsewhere` for every other module.
2. If a `product_card` / `product_grid` exists, it owns the per-product
   one-liners. The body must not narrate the lineup.
3. If a `reviews` section exists, it owns social proof. The body must not
   paraphrase customer sentiment.
4. The header owns the hook. The body must not restate it (already enforced).
5. The body gets **what is left** — and the map states it positively, e.g.
   *"The USPs module below covers battery, fit and waterproofing. Your job is the
   reason to act now, not the feature list."*

Inject it per section in generate, and for the target section in every
regeneration path. This is the holistic view: not "don't repeat," but "here is
what you are for."

### 3.4 A menu of body architectures, not one default

Add to `data/copy-system.md` alongside the stacked case. Named, so they can be
requested, rotated and measured:

| Shape | Structure | Fits |
|---|---|---|
| **Stacked case** *(current default)* | hook → 3–5 concrete truths → earned close | product_led, launch |
| **Offer-first** | the deal → what it covers → one reason it is worth it | offer_led, last_call |
| **Single truth** | one product truth, developed across the whole paragraph, one spec only | product_led, evergreen |
| **Scene** | a moment the reader recognises → the product inside it → out | story_led, occasion_led |
| **Objection flip** | the doubt named plainly → the answer → the close | winback, considered purchase |
| **Contrast** | what most do → what these do → why that matters | launch, category education |

Selection: derive a default from `architecture` + `send_stage`, then **exclude
whatever the last two sends of this campaign type used** — from the corpus work
in `RECURSIVE_LEARNING_FRAMEWORK_SPEC.md`. Regeneration cycles to a *different*
shape rather than rewording the same one, which is the behaviour Tim expected and
did not get.

State the shape in the prompt by name and let the model execute it. "Write in the
Offer-first shape" is a far stronger constraint than a paragraph of guidance.

### 3.5 Extend form signatures to paragraphs

`RECURSIVE_LEARNING_FRAMEWORK_SPEC.md` §2.3 defines form signatures for
headlines. Extend to body copy:

```ts
interface BodySignature {
  shape: BodyShape;          // stacked_case | offer_first | …
  spec_count: number;        // how many specs cited
  offer_position: "open" | "middle" | "close" | "absent";
  opening_move: "claim" | "scene" | "question" | "contrast" | "offer";
  sentence_count: number;
}
```

Two bodies with the same signature are repetitive **even with zero shared
words**. All three examples above have the identical signature:
`{ stacked_case, 3, close, claim, 4 }`. That is the thing to catch.

Two uses: flag it in the repetition check, and — the important one — feed the
last N signatures into regeneration as an exclusion, so a rewrite is forced to
change shape rather than vocabulary.

---

## 4. Acceptance criteria

- A campaign set to **offer-led** produces a body whose **first** sentence
  carries the offer. Regenerating it five times keeps the offer in the opening.
  *(Fails today — all three examples close on it.)*
- A campaign set to **story-led** produces a body with no discount figure,
  deadline or code anywhere in it.
- Regenerating a body three times produces three **different shapes**, not three
  rewordings of one. *(Fails today.)*
- When a `usps` section is present, the body cites **at most one** spec, and not
  one the USPs module already covers. *(Fails today — all three examples list the
  same three specs the USP module owns.)*
- The three example paragraphs in §1 are flagged as repetitive by the body
  signature check. *(They pass today.)*
- The angle block appears above the craft rules in every generate and regenerate
  prompt.
- Where a craft rule and the angle conflict, the prompt states which wins.
- Unit tests on the section role map: usps present vs absent, product grid
  present vs absent, reviews present vs absent — asserting the body's
  `covered_elsewhere` is correct in each.

---

## 5. Notes

**This is not a model quality problem.** The model is following the instructions
it was given: the brand system names one body shape, the craft rule licenses
offer-last, and no module is told what it is for relative to the others. It
executes that faithfully every time. The variation Tim expected from regeneration
can only appear if the *instruction* varies — which is what §3.4 and §3.5 do.

**The offer-last pattern is one word away from fixed.** Changing "may restate the
offer or code at the end" to an angle-derived rule is the smallest change in this
document and probably the largest single improvement. It is worth shipping on its
own, before the rest.

---

## 6. Out of scope

- Changing the Raycon voice, the ban lists, or the hard rules. This changes the
  **shape** of an argument, never what may be said.
- The USP bank contents and per-slot binding — working as designed.
- SMS and flow copy. Same craft rule appears there; extend once this is proven on
  email.
- Measuring which body shape performs best. That needs the attraction half of the
  learning loop and an honest RPR estimator; it is the natural follow-on once
  shapes are named and recorded.
