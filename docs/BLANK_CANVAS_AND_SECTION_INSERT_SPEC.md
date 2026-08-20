# Blank Canvas + Section Insertion — Spec

**Status:** BUILT 2026-08-20 (branch `copy-voice-rebuild`). Both features and the
§4 sync fix shipped; see "Build record" below for where everything lives, what
deviated, and the one pre-existing bug this work uncovered.
**Surfaces:** `/copy-builder` (email channel only).
**Read against:** `src/app/copy-builder/page.tsx` (1846 lines),
`src/components/CampaignCanvas.tsx`, `src/components/SectionBlock.tsx`,
`src/components/SectionBuilder.tsx`, `src/lib/schemas.ts`.

Two features that share the same plumbing:

- **A. Start from scratch** — open the Copy Builder and write a campaign by hand
  on an empty canvas, adding modules yourself, with no generation step required.
- **B. Fix the add-module interaction** — the current insert affordance is
  invisible until hovered, only inserts *after* a section, and forces a scroll to
  the bottom of the page to append.

They ship together because A is unusable without B (a blank canvas is *nothing
but* add-module actions), and because both depend on the same fix to
`sectionStructure` described in §4, which is a live bug today.

---

## 1. Current behaviour

### 1.1 There is no way into the canvas without generating

`stage` is `"form" | "canvas"` (`src/app/copy-builder/helpers.ts`). At
`stage === "form"` the right pane renders an `EmptyState` — *"Start a campaign.
Fill in the brief on the left and hit Generate Brief. Or pick up something you've
already written"* — plus a **Pick up where you left off** grid of recent drafts,
library entries and SMS records (`page.tsx:1636-1682`).

Every path to `stage === "canvas"` goes through either a generation
(`page.tsx:438`) or loading an existing record (`:159`, `:997`, `:1108`). There is
no third path. The canvas cannot be reached empty.

### 1.2 The insert affordance

`src/components/SectionBlock.tsx:580-613`, one instance rendered at the **bottom
of every section**.

```css
.insert-divider { opacity: 0; transition: opacity .15s; }
.insert-divider:hover, .insert-divider:focus-within { opacity: 1; }
```
(`src/app/globals.css:293-300`)

Concretely, today:

| Problem | Detail |
|---|---|
| Invisible until hovered | `opacity: 0` on a `py-1` strip — roughly a 10px tall target the user has to already know exists |
| Cannot insert at the top | The divider renders only *after* a section (`onInsertAfter`, `CampaignCanvas.tsx:108`). There is no way to add a section above the first one |
| Appending requires a scroll | The only "add at the end" target is the divider under the last section, so you scroll to the bottom and hunt for an invisible strip — the reported complaint, exactly |
| The picker is a bare list | `INSERTABLE_TYPES.map(t => t.replace(/_/g, " "))` (`:598-607`) — raw type names, no description, no icons, no grouping, no search, no keyboard navigation |
| Two section types are unreachable | `INSERTABLE_TYPES` (`:18-20`) omits `product_grid` and `bundle`. `SECTION_TYPES` in `SectionBuilder.tsx:15-17` omits `bundle` too — so **`bundle` cannot be created anywhere in the app**, despite being a fully built feature (schema `:19`, 4 layout templates, prompt allocation, complete config UI) |
| Reordering is arrow-only | Up/down buttons inside the hover-revealed controls; no drag, though `@hello-pangea/dnd` is already a dependency and already used in the planner |

---

## 2. Feature A — Start from scratch

### 2.1 Entry point

On the `stage === "form"` empty state (`page.tsx:1636`), add a primary action
next to the existing "Browse all" button:

> **Start blank canvas** — Write it yourself. Add modules as you go.

Clicking it goes straight to `stage === "canvas"` with an empty campaign. No
brief form, no generation, no LLM call.

Also expose it from the sticky top bar's **New** control (`page.tsx:1527-1536`)
as a two-option choice: *New from brief* / *New blank canvas*.

### 2.2 What a blank canvas is

```ts
const blank: GeneratedCampaign = {
  meta: { subject_lines: ["", "", ""], preview_texts: ["", "", ""] },
  sections: [],
};
```

- `canvasSource` gains a new value: `"scratch"` (currently
  `"new" | "draft" | "library"`, `page.tsx:74`). It behaves like `"draft"` for
  autosave purposes until first save.
- The canvas renders with zero sections and a centred **Add your first section**
  call to action inside `.rc-canvas-sheet`, using the §3 picker.
- `MetaBlock` renders as normal with empty subject/preview fields, editable by
  hand.
- The **Brief bar** at `CampaignCanvas.tsx:243-257` currently shows the conceit or
  "Compiling…". On a scratch canvas it must not sit on "Compiling…" forever —
  render it as an editable one-line campaign intent field instead (see §2.3).

### 2.3 The brief problem — read this before building

**A naive blank canvas ships with every AI assist button dead.** This is the
single thing most likely to be got wrong.

`CampaignCanvas.tsx:165` returns `null` from `regenerateElement` when
`!expandedBrief || !chosenConceit`. `onRegenerateElement` is only passed down at
all when both exist (`:309-313`). `handleRegenerateMeta` bails at `:121`.
`VariationsModal.onFetch` returns `[]` at `:346`. So with no brief: no element
regeneration, no section variations, no meta regeneration, no tone control. The
user gets an empty text editor with a Raycon logo on it.

**Solution — compile a minimal brief for scratch canvases.** There is already a
precedent: library campaigns loaded from an older schema re-derive their brief
through `compileBrief()` so regeneration keeps working (`page.tsx:1101-1103`).
Do the same here.

- The scratch canvas collects a **minimum viable brief**: campaign name, offer,
  and (optional) hero product. Surface these as three inline fields in the brief
  bar, not as a blocking modal — the user can start typing sections immediately
  and fill them in later.
- Run `compileBrief()` on whatever exists, debounced, to produce an
  `ExpandedBrief` + synthesized `Conceit`. It is deterministic and has no LLM
  step (`src/lib/brief/compile.ts:189-279`), so this is cheap and can re-run on
  every edit.
- Until name and offer are both non-empty, AI assists stay disabled and each
  shows a tooltip: *"Add a campaign name and offer to enable rewrites."* Disabled
  with a stated reason, never a dead button.
- `tone_dial` on a scratch canvas defaults to the same constant as everywhere
  else. (See `docs/RECURSIVE_LEARNING_FRAMEWORK_SPEC.md` §1.1 — this should be 4,
  not the current 1.)

### 2.4 Saving

Scratch canvases use the existing draft path unchanged: `POST /api/campaigns`
with id `YYYY-MM-DD-slug-nanoid6` (`page.tsx:709-759`), then `POST /api/finalize`
on Save Final. The `structured` snapshot must include the hand-built
`section_structure` so the campaign reloads correctly — which requires §4.

Hand-written copy is **still subject to the hard-rules check**. Run
`runHardRulesCheck` on save for scratch canvases, the same as generated ones
(`page.tsx:528-546`). The rules are about brand safety, not about who typed the
words.

---

## 3. Feature B — Section insertion UX

### 3.1 Three affordances, not one

**1. Persistent "Add section" button in the sticky top bar.**
Alongside Copy / Save / New (`page.tsx:1511-1537`), visible whenever
`stage === "canvas"`. Opens the picker; the chosen section **appends to the end**
and the canvas scrolls it into view. This is the always-available path and it is
what removes the "scroll to the bottom and hunt" problem — the target no longer
moves.

Bind **⌘⇧A** to it, consistent with the existing ⌘S and ⌘↵ bindings
(`page.tsx:185-197`).

**2. Inline dividers that are visible at rest.**
Change `.insert-divider` from `opacity: 0` to a quiet resting state:

```css
.insert-divider { opacity: .35; transition: opacity .15s var(--ease-out-soft); }
.insert-divider:hover,
.insert-divider:focus-within { opacity: 1; }
```

Render the divider as a hairline with a small centred `⊕` and no text label at
rest; reveal the "Insert section" label on hover. Discoverable without hunting,
quiet enough not to compete with the copy.

**3. A divider above the first section.**
`CampaignCanvas` currently renders dividers only from inside `SectionBlock`
(after each section). Lift insertion up to the canvas so it can render `n + 1`
dividers for `n` sections. Add `insertAt(index, type)` alongside the existing
`insertAfter`, and have `insertAfter` delegate to it.

### 3.2 The picker

Replace the dropdown (`SectionBlock.tsx:592-610`) with a small centred modal,
built on the existing `Modal` primitive (`src/components/ui/Modal.tsx`).

- **Searchable** — text input focused on open, filtering by type name and
  description.
- **Keyboard first** — ↑/↓ to move, ↵ to insert, Esc to close.
- **Cards, not a list** — each type shows its display name, a one-line
  description, and the elements it contains, read from
  `sectionElementNames()` / `SECTION_CATALOGUE` (`schemas.ts:522-538`) so the
  preview can never drift from the real catalogue.
- **Grouped** into: *Copy* (header, body, free_form, cta_bridge, footer_cta),
  *Product* (product_card, product_card_review, product_grid, bundle),
  *Proof* (usps, reviews).

Display names and descriptions live in one exported map so the picker, the
`SectionBuilder` and any future surface share them:

```ts
// src/lib/section-catalogue-meta.ts
export const SECTION_META: Record<SectionType, {
  label: string;
  description: string;
  group: "copy" | "product" | "proof";
  needsConfig?: boolean;   // product_grid, bundle — see §3.3
}> = { /* … */ };
```

### 3.3 product_grid and bundle become insertable

Both are currently excluded because they need configuration that only the
pre-generation `SectionBuilder` collects — grid dimensions, bundle mode and
template, product bindings.

Fix by letting the picker collect that configuration inline: when a
`needsConfig` type is chosen, the modal advances to a second step reusing the
same controls `SectionBuilder.tsx:377-465` already implements for bundles and
grid dimensions, then inserts a fully configured section.

Also add `"bundle"` to `SECTION_TYPES` in `SectionBuilder.tsx:15-17`. It is
missing there as well, which is why the bundle feature has never been reachable
from anywhere in the app.

### 3.4 Drag to reorder

`@hello-pangea/dnd` is already a dependency and already drives the planner
calendar. Wrap the section list in `CampaignCanvas.tsx:272-319` in a
`DragDropContext` / `Droppable`, with a drag handle in the existing hover
controls. Keep the up/down arrow buttons — they are the keyboard-accessible path
and removing them would be a regression.

Reordering must move the matching `SectionSpec` in lockstep (§4).

---

## 4. `sectionStructure` must stay in sync — required for both features

**This is a live bug and it blocks everything above.**

`insertAfter` (`CampaignCanvas.tsx:108-118`) pushes a new section into
`campaign.sections` and **never touches `sectionStructure`**. But the canvas
resolves each section's spec by array index, falling back to a type match:

```ts
const spec = sectionStructure[i] ?? sectionStructure.find(s => s.type === section.type);
```
(`CampaignCanvas.tsx:275`, and again at `:166-168` and `:336-338`)

So the moment a section is inserted anywhere except the end, every index after it
is off by one. The consequences are silent and wrong: `catalogueElements`
resolves from another section's spec, so a `usps` section can render 3 slots when
it should show 5, or resurrect a Subheader the user removed (`:285-289`); grid
columns come from the wrong spec (`:276`); `product_card_review` fetches reviews
for the wrong SKU (`:280-282`); and `regenerate-element` posts a mismatched
`section_spec` (`:166-168`).

A blank canvas is *entirely* inserted sections, so this goes from an edge case to
the default case.

**Required change — make the spec a property of the section, not of its position.**

1. Every mutation that changes the section list — insert, delete, reorder, drag —
   updates `campaign.sections` and `sectionStructure` in the same operation.
2. Give `SectionSpec.id` the same value as the `GeneratedSection.id` it describes
   (both already exist; `nanoid()` is already used for both). Then resolve by id:
   ```ts
   const spec = sectionStructure.find(s => s.id === section.id);
   ```
   and delete the index-and-type fallback entirely.
3. Add a one-time migration at load for existing records whose ids don't line up:
   pair by index, stamp matching ids, and persist on next save. Records where the
   lengths disagree fall back to the current behaviour and log — never crash, per
   the app's read-boundary convention.
4. `insertAt(index, type)` creates **both** the `GeneratedSection` (elements from
   `SECTION_CATALOGUE[type]`) and its `SectionSpec` (with `needsConfig` values
   from §3.3), sharing one id.

Add unit tests for insert / delete / reorder keeping the two arrays aligned. This
is deterministic logic in the same spirit as `calendar-grid.test.ts`.

---

## 5. Data model changes

| Change | File | Note |
|---|---|---|
| `CanvasSource` gains `"scratch"` | `src/app/copy-builder/helpers.ts` | Behaves like `draft` for autosave |
| `SectionSpec.id` === `GeneratedSection.id` | `src/lib/schemas.ts:57-58` | No schema change; a new invariant, plus migration |
| `SECTION_META` map | new `src/lib/section-catalogue-meta.ts` | Labels, descriptions, grouping, `needsConfig` |
| `"bundle"` added to `SECTION_TYPES` | `src/components/SectionBuilder.tsx:15-17` | Unblocks an already-built feature |
| `INSERTABLE_TYPES` deleted | `src/components/SectionBlock.tsx:18-20` | Superseded by `SECTION_META` + the picker |

No storage schema version bump is required — `structured.section_structure` is
already persisted (`src/lib/library.ts:108-138`); the ids inside it simply become
meaningful.

---

## 6. Acceptance criteria

**Blank canvas**
- From the Copy Builder empty state, one click reaches an empty editable canvas
  with no LLM call fired.
- Adding a section, typing copy, saving as draft, reloading, and finding the copy
  intact — with the correct elements per section — works end to end.
- With a campaign name and offer filled in, element regeneration, section
  variations and meta regeneration all work on a scratch canvas.
- Before name and offer are filled, those controls are visibly disabled and state
  why.
- Save Final on a scratch canvas runs the hard-rules check and writes to the
  library, the same as a generated campaign.

**Insertion**
- The insert affordance is visible without hovering.
- A section can be added above the first section.
- A section can be appended without scrolling to the bottom of the canvas.
- The picker is searchable and fully keyboard operable.
- `product_grid` and `bundle` can both be inserted from the canvas, configured
  inline, and render correctly.
- `bundle` is selectable in the pre-generation Section Structure builder.

**Sync (regression guard)**
- Insert a `usps` section with 5 slots above an existing `usps` section with 3.
  Both render their correct slot counts. *(Fails today.)*
- Insert a section above a `product_card_review`. It still fetches reviews for
  its own SKU. *(Fails today.)*
- Reorder sections by drag. Every section keeps its own spec.
- Delete a section. No other section changes shape.

---

## 7. Build record (2026-08-20)

### §4 first — the sync bug

`src/lib/campaign-sections.ts` (pure, 32 unit tests) owns insert / delete / move /
reorder / patch, and `SectionSpec.id === GeneratedSection.id` is now the
invariant. `specForSection()` resolves by id **with no fallback at all** — a
section with no spec renders from its type catalogue, which is a correct default,
whereas the old index-then-type fallback silently produced *another section's*
shape.

Ids are aligned at every entry point:

| Path | How the id gets set |
|---|---|
| Generation | a streamed section adopts the id of the spec it was generated from (they arrive in structure order) |
| Insertion | `newSection()` mints one id for the section and its spec together |
| Saved draft / library / localStorage restore | `alignSpecIds()` at load |

`useCampaignSections` (`src/app/copy-builder/useCampaignSections.ts`) binds the
pure helpers to the page's two setters and hands the canvas callbacks. That is the
structural fix behind the bug: `CampaignCanvas` implemented insert/delete/move
itself while only ever receiving `sectionStructure` read-only, so it *could not*
have kept the two in step.

**Deviation from §4.3.** The spec says records whose lengths disagree should "fall
back to the current behaviour". Neither the current behaviour (index pairing,
which is what caused the bug) nor discarding every spec was right: a real library
record in this account has **6 specs for 5 sections** — a section deleted on the
canvas whose spec was left behind — and discarding would have thrown away that
campaign's whole slot plan and product bindings. `alignSpecIds()` instead walks
both lists in order and pairs on TYPE, so it re-keys what it can, never forces a
spec onto a section of a different type, and logs what it could not pair.

### §2 — blank canvas

Two ways in: **Start blank canvas** on the empty state, and **New → New blank
canvas** in the toolbar (guarded by the same "unsaved work" confirm as New from
brief). `CanvasSource` gained `"scratch"`; it persists and autosaves exactly like
a draft and becomes one on first save.

The brief problem in §2.3 is handled as the spec prescribes: the brief bar becomes
three inline fields (name, offer, optional hero product), `compileBrief()` runs
debounced at 400ms over whatever exists, and until name and offer are both filled
every AI assist renders **disabled with its reason** — element rewrite, steering,
section variations, and meta regeneration all carry
*"Add a campaign name and offer to enable rewrites."* rather than disappearing.
Save Final on a scratch canvas runs the hard-rules check.

### §3 — insertion

Three affordances, as specified: a persistent **Add section** in the toolbar bound
to **⌘⇧A**, inline dividers now visible at rest (`opacity: .35`, label on hover),
and a divider at **every** boundary including above the first section — the canvas
renders `n + 1` of them because insertion moved up there from `SectionBlock`.

The picker (`SectionPicker.tsx`) is a searchable, keyboard-first modal with grouped
cards whose element previews come from `sectionElementNames()`. `SECTION_META`
(`src/lib/section-catalogue-meta.ts`) is the single source of labels, descriptions,
grouping and `needsConfig`, and both the picker and the pre-generation
`SectionBuilder` read it — which is how **`bundle` became reachable for the first
time**, in both surfaces. `product_grid` and `bundle` collect their configuration
in a second step built on `SectionConfigFields.tsx`, extracted from SectionBuilder
so the two cannot drift; Insert stays disabled until a bundle has two products.
Drag-to-reorder uses `@hello-pangea/dnd` with a handle in the existing hover
controls, and the arrow buttons stay as the keyboard path (dnd's own keyboard drag
— space, arrows, space — works too, which is why that control row now reveals on
`focus-within`).

**Extra, not in the spec:** `newSection()` seeds elements from the section's SPEC
rather than the raw type catalogue. Without that an inserted `unified` bundle came
out as Bundle Name / Subheader / CTA with its per-product USPs appended *after* the
CTA, and an inserted grid rendered a text box where its product cells belong
(`Products` must be an array for the grid editor to appear). Both were caught by
driving the real UI, not by the unit tests.

### A pre-existing bug this uncovered

`markdownToCampaign()` read `promo_code: data.promo_code` while every other
optional field used `?? undefined`. The writer coerces undefined to `null`
(js-yaml refuses to dump undefined) and `savedCampaignSchema` types the field as
`string | undefined` — so **every draft saved without a promo code failed
validation on read and vanished from the drafts list**, after the POST had
returned 200. It is fixed in `src/lib/campaigns.ts` with a regression test in
`campaigns.test.ts`. Unrelated to this spec, but it sits squarely on the
"save a blank canvas as a draft, reload, find the copy intact" criterion, so it
had to go.

### Verification

Beyond `tsc`, lint and 433 unit tests, the acceptance criteria were driven through
a real browser (puppeteer against `next dev`): 24 checks for the blank canvas and
the picker, 17 for the sync regressions and the save→reload round trip, 5 against a
real library record, and 8 against a live generation. All pass, no console errors.
The sync guards from §6 were run exactly as written — a 5-slot `usps` above a
3-slot one, an insert above a `product_card_review`, a drag reorder (mouse *and*
keyboard), and a delete — each confirmed on screen, not just in the pure layer.

### Still open

1. `page.tsx` is still ~1,900 lines. §7 said extract the canvas-mutation logic and
   not to attempt the full decomposition; that is what happened.
2. SMS and flow canvases keep their own limitations, per §7 — though flow emails
   now share the id-synced mutation helpers, so their specs stay attached too.
3. The section picker does not collect `usps` slot counts, so a usps section
   inserted on the canvas starts at the default 3 (editable only in the
   pre-generation builder). `needsConfig` covers only the two types the spec named.

---

## 8. Out of scope

- **SMS and Flows canvases.** Same limitation exists there; deliberately not in
  this pass. `docs/ELEMENT_LEVEL_EDITING_SPEC.md` drew the same boundary.
- **Rich text / WYSIWYG.** The canvas stays a structured element editor. Elements
  are plain strings and the export path depends on that.
- **Image or layout handling.** `image_direction` remains a text hint. No asset
  library, no preview rendering.
- **Templates / saved section presets.** Worth doing later — "start from the
  standard promo skeleton" is the obvious follow-on once blank canvases exist —
  but it needs its own design and shouldn't hold this up.
- **Splitting `page.tsx`.** It is 1846 lines against the ~500 target in
  `docs/ARCHITECTURE_REMEDIATION_SPEC.md` §7. Extract the canvas-mutation logic
  touched here into a hook (`useCampaignSections`) as part of this work, but do
  not attempt the full decomposition in the same PR.
