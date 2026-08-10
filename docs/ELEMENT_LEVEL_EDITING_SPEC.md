# Element-Level Editing — Remove "Design this" + Per-Element Regenerate / Add / Delete

**Status:** Ready to implement
**Area:** Copy Builder canvas (`src/components/CampaignCanvas.tsx`, `src/components/SectionBlock.tsx`), regeneration routes/prompts, `src/lib/schemas.ts`
**Goal:** Two changes. (A) Remove the "Design this" image-generation feature — the Copy Builder is a copy tool, not a design tool. (B) Make **every element** inside a section independently regenerable, deletable, and (where it's a repeatable family) addable — so a `reviews` section can have its Subheader regenerated alone, Review 2 swapped alone, a Review 4 added, or its One-Liner deleted.

---

## Part A — Remove the "Design this" feature

### A.1 What it is today
`SectionBlock` renders a "Design this" / "Regenerate design" button whenever an `onDesign` prop is passed. `CampaignCanvas` wires it for `header` sections only (`section.type === "header" ? () => handleDesign(section.id) : undefined`), which POSTs to `/api/design-section` and stores a base64 PNG on `GeneratedSection.design_image`, shown in `DesignModal`.

### A.2 Delete
- `src/components/DesignModal.tsx`
- `src/app/api/design-section/route.ts`
- `src/lib/prompts/design-section.ts`
- `src/lib/design.ts` — **verify first** it has no other importer (currently only the design-section route imports `getDesignSpec` / `resolveProductImage`).
- `designSectionBody` in `src/lib/validation/requests.ts`
- In `SectionBlock.tsx`: the `onDesign` prop, its destructure, and the button block (~lines 38, 59, 296–303).
- In `CampaignCanvas.tsx`: the `DesignModal` import, `designModal` / `designingSection` state, `handleDesign`, the `onDesign={...}` prop pass, and the `<DesignModal />` render.

### A.3 `design_image` on the schema
Remove `design_image?: string` from `GeneratedSection` (`src/lib/schemas.ts` ~line 171), **but keep reads tolerant**: saved library entries and drafts may already carry it. The validation layer must **ignore unknown/legacy fields rather than reject** them (confirm `looseObj` behavior in `src/lib/validation/`), so existing campaigns still load. Do not write a migration to strip it — dead data in old snapshots is harmless.

### A.4 Optional cleanup (flag, don't assume)
These are offline/dev-only and unrelated to the runtime feature — remove only if confirmed unused:
- `scripts/ingest-designs.ts`, `scripts/extract-design-spec.ts` and their prompts (`src/lib/prompts/ingest-designs.ts`, `src/lib/prompts/design-spec.ts`), plus the `ingest:designs` / `ingest:design-spec` entries in `package.json`.
- `data/design-specs/`, `data/design-assets/`.
- **`puppeteer` and `html2canvas` in `package.json`** — a grep of `src/` and `scripts/` shows **no usage**. If that holds, dropping them removes a very heavy dependency. Verify, then remove.
- Leave alone: any `LibraryCampaign` whose `source` is `"design"` — those are ingested copy examples, not this feature.

### A.5 Acceptance
- No "Design this" / "Regenerate design" control anywhere in the canvas; no `/api/design-section` route.
- Existing saved campaigns that contain `design_image` still load and render without error.
- `build`, `typecheck`, `lint`, `test` pass; no dead imports.

---

## Part B — Per-element regenerate, delete, and add

### B.1 Current state
- Regeneration is **section-wide only**: `/api/regenerate-section` rewrites every element in a section (`RegenerateModal` → steering + tone). There is no way to touch one element.
- Two element-level affordances already exist and are the right precedent: the **Subheader variant picker** (3 options, pick one) and **"another review"** (`cycleReview`, which fetches *real* reviews and never fabricates).
- Element *removal* exists but only **pre-generation**: `SectionSpec.removed_elements` + `REMOVABLE_ELEMENTS` + `elementsForSpec()` decide what gets generated. There is no post-generation removal in the canvas.
- `SectionBlock` renders `[...presentKeys, ...missingCatalogue]` — it **re-appends any catalogue element missing from `elements`**, so simply deleting a key from `elements` would make it reappear on the next render. This is the main gotcha.

### B.2 Where canvas-level removals are stored — architectural decision

Add **`removed_elements?: string[]` to `GeneratedSection`** (the generated content), *not* to the section spec.

Rationale:
- `CampaignCanvas` receives `sectionStructure` as a read-only prop with no structure-change callback; routing canvas edits into the spec would mean new plumbing through the copy-builder page.
- `GeneratedSection` is what gets persisted (draft frontmatter + the library `structured` snapshot), so canvas removals survive save/reload for free.
- Clean separation of concerns: **spec-level** `removed_elements` = "don't generate this"; **section-level** `removed_elements` = "this was removed on the canvas".

Then in `SectionBlock`: `elementKeys = [...presentKeys, ...missingCatalogue].filter(k => !removed.has(k))`, and deleting an element both removes it from `elements` **and** adds it to `section.removed_elements`.

### B.3 Deleting an element
- Every element gets a delete control (hover-revealed, matching the existing quiet-controls style).
- **Guard:** a section must keep at least one element. When the last element is deleted, prompt to delete the whole section instead (reuse the existing section delete).
- Deleting `Subheader` must also clear `subheader_variants` / `subheader_selected` for that section.
- Deleting a member of a repeatable family (e.g. `Review 2`) **renumbers** the remaining members so there is never a gap (`Review 1, Review 3` → `Review 1, Review 2`). Renumber in `elements`, in `removed_elements`, and in any flag keys.

### B.4 Adding an element
An "+ add element" affordance per section (in the section's hover controls) offering:
1. **Re-add** any element previously removed (from `section.removed_elements`) or any catalogue element currently absent.
2. **Optional elements** for that type (`OPTIONAL_ELEMENTS`, e.g. header's `Sub-Tagline`).
3. **Next member of a repeatable family** — see B.5.

Added elements start empty and are immediately editable (`EditableField` already handles empty values). **Ordering matters:** insert a new family member directly after the last existing member of that family (so `Review 4` lands after `Review 3`, not after `CTA`); insert a re-added catalogue element at its catalogue position.

### B.5 Repeatable element families
Add to `src/lib/schemas.ts`:

```ts
/** Element families that can repeat within a section, with bounds. */
export const REPEATABLE_ELEMENTS: Partial<Record<SectionType, { family: string; min: number; max: number }[]>> = {
  reviews:  [{ family: "Review", min: 1, max: 6 }],
  usps:     [{ family: "USP",    min: 2, max: 5 }],
};
```
- Members are named `"<family> <n>"` (`Review 1`, `USP 3`) — matching the existing catalogue convention, so the stream parser, canvas, and library format need no changes.
- **USPs already have a richer model** (`usp_slots`, each with a product/company source — see `USP_SYSTEM_SPEC.md`). Canvas-adding a USP must also append a slot defaulting to `{ source: "product" }` (Auto product) so regeneration knows where to draw from. If the spec isn't reachable from the canvas, default the slot at regenerate time.
- `product_card_review` has a single `Review` (not a family) — leave it single.

### B.6 Regenerating one element — the route
Create **`src/app/api/regenerate-element/route.ts`** (POST), modeled on `/api/regenerate-section`:

Request: `{ element_key, section (current GeneratedSection), section_spec, full_campaign, expanded_brief, chosen_conceit, steering?, tone_dial?, retrieved_examples }` — validated via `parseBody` + a new zod shape in `src/lib/validation/requests.ts`.

Response: `{ value: string }`, or `{ variants: string[] }` for `Subheader`.

Create **`src/lib/prompts/regenerate-element.ts`** with a role instruction + user prompt that:
- Rewrites **only** the named element; returns just that element's content (JSON), never the whole section.
- Receives the section's other elements **and** the full campaign as context, with an explicit instruction to stay consistent with them and **not restate** what neighbouring elements already say (this is what the section-wide regenerate gets for free and a naive per-element call would lose).
- Carries the element's craft rules: CTA = 2–4 word action phrase, no promo code, no product name; Headline/Tagline caps; One-Liner scoped to the bound product; USP rules per its slot source (product bank vs company bank + live offer); `Subheader` returns **exactly 3 distinct options**.
- Reuses `buildAvoidBlock()` (product-scoped when the section is a product card, matching the existing route) and `toneDirective()`.
- Uses `MODEL` for copy-bearing elements; a single element is a small call, so keep `max_tokens` low.

### B.7 Elements that must NOT be LLM-regenerated

**`Review` elements are real customer reviews.** The existing `cycleReview` fetches from `/api/reviews` and the code explicitly notes it "Never fabricates", and `buildSectionList` instructs the model to leave `Review` empty rather than invent one. Therefore:

- For any `Review` / `Review N` element, the regenerate control **must map to "fetch another real review"**, not to the LLM. Generalize the existing `cycleReview` to accept an element key so it can target `Review 2` specifically, and so adding `Review 4` pulls a 4th distinct real review.
- Ensure the reviews section doesn't assign the **same** review to two slots — track used review indices per section.
- If no review is available for the product, keep the element empty and say so in the UI. Never generate one.

`Products` (grid array) elements: regenerate at the **item field** level (name / one-liner / cta) rather than the whole array, reusing the same route with a compound key (e.g. `Products[2].one_liner`). Alternatively defer grid-item regeneration to Phase 2 — but the per-item one-liner is the highest-value one, so prefer including it.

### B.8 UI
In `SectionBlock`, each element's label row (which already hosts the variant hint, "another review", and `RepetitionChip`) gains hover-revealed controls:

```
BODY COPY                                    ↻   ⋯   ✕
```
- **↻** — regenerate immediately, no modal (fast path). Inline spinner on that element only; the rest of the section stays interactive.
- **⋯** — opens a small popover with optional **steering** + **tone** (reuse `RegenerateModal`'s pattern, scoped to one element).
- **✕** — delete the element (B.3).
- For `Review` elements, ↻ = "another review" (B.7) — keep the existing wording so the behavior is obvious.
- Keep controls quiet/hover-revealed to match the current canvas aesthetic; don't clutter the writing surface.

**Undo (recommended, cheap):** hold the previous value in local state and offer a one-click "revert" on the element for a few seconds after a regenerate. Per-element regeneration invites experimentation; without undo a good line is easily lost.

### B.9 Post-regenerate hooks
After an element regenerates, reuse the existing client helpers so quality gates still apply:
- `scrubElements` / `autoFixMechanical` (`src/lib/hard-rules-client.ts`) on the new value.
- Re-run the repetition check for that element (`collectCheckElements` / `repetition-client`) and refresh its `RepetitionChip`.
- Fire the existing `onRegenerated` callback so the parent re-checks the campaign.

### B.10 Ripples to handle
- **Autosave / persistence:** `removed_elements` on `GeneratedSection` must round-trip through the draft store (`src/lib/campaigns.ts` markdown JSON body) and the library `structured` snapshot (`src/lib/library.ts`), and be accepted by `src/lib/validation/`.
- **`campaignToLibraryBody`** (`library.ts`) iterates `section.elements` — it will naturally reflect deletions/additions; verify a `Review 4` renders sensibly in the exported body.
- **`sectionPreview`** in `CampaignCanvas` reads a fixed key list — extend it to pick up `Review N` / `USP N` families so the variations picker preview isn't blank.
- **Section-wide regenerate** must respect canvas-level removals: a regenerated section should not resurrect deleted elements. Pass `removed_elements` into `/api/regenerate-section` and filter the returned elements accordingly.
- **`regenerate-section.ts`'s `uspsNote` / `hasSubheader`** logic must tolerate a missing Subheader and a variable USP count (already partly handled by the USP spec — verify).

### B.11 Acceptance criteria
- In a `reviews` section: the Subheader can be regenerated alone (returning 3 fresh options), Review 2 can be swapped for a different **real** review without touching Review 1 or 3, a Review 4 can be added (pulling a 4th real review), and any element can be deleted.
- In a `product_card_review` section: `Product Name` or `One-Liner` can be deleted, and the remaining elements are unaffected.
- Regenerating one element never rewrites its neighbours, and the new text doesn't restate them.
- A deleted element stays deleted across re-render, autosave, save-to-library, and reload.
- Deleting `Review 2` of three renumbers to `Review 1, Review 2` with no gap.
- A section-wide regenerate does not bring back canvas-deleted elements.
- `Review` elements are never LLM-generated; with no reviews available the element stays empty with a clear note.
- A section cannot be reduced to zero elements; the UI offers to delete the section instead.
- Hard-rules scrub and repetition flags re-run for a regenerated element.
- Deleting the last USP beyond the minimum is blocked per `REPEATABLE_ELEMENTS.usps.min`.
- `build`, `typecheck`, `lint`, `test` pass; new unit tests cover family renumbering, add/remove ordering, and `elementsForSpec` + canvas-removal interaction.

---

## Ground rules
1. **Next.js 16**; TypeScript `strict`; no `any`.
2. Element **naming** stays `"<Family> <n>"` so the stream parser, canvas, and library body format are unchanged.
3. Never fabricate a customer review (B.7). This is a hard brand/legal line, already encoded in the existing prompts.
4. Preserve backward compatibility: sections without `removed_elements` behave exactly as today.
5. Keep the canvas calm — hover-revealed controls, no new persistent chrome.

## Out of scope
- Element-level editing in the SMS or Flows canvases (email canvas first; both reuse `CampaignCanvas` patterns and can follow).
- Reordering elements within a section (separate change; the current order logic is deliberate — generated order first, then missing catalogue keys).
- Reinstating any design/image generation in another form.
