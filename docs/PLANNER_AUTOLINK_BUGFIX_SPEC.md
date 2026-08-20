# Bug: copy auto-links to the wrong planner row on save

**Status:** FIXED 2026-08-20 (branch `copy-voice-rebuild`). All five holes closed and
verified against the reproduction in §4. The §6 data cleanup found real damage in
the live planner store — see "Build record" for what to review by hand.
**Severity:** high — it silently corrupts links on *two* records per occurrence.
**Regression of:** the "every copy links to the evergreen row" bug, previously
patched at `src/app/copy-builder/page.tsx:407-411`. The patch is still there and
still correct; it is being bypassed. §2 explains how.

---

## 1. Symptom

Finishing any copy stamps it onto a planner row the writer never chose. The row
is usually one they were working with at some earlier point. The toast reports
*"Linked to planner ✓"* as if it were intended.

Second-order damage, which is the worse half: `/api/planner/link` is
**single-owner**. Stamping row R with copy B, when R already owned copy A, also
clears copy A's back-reference (`api/planner/link/route.ts:61-64`). So one bad
save both mislinks the new copy *and* silently unlinks a correct one.

---

## 2. Root cause

The link target is resolved from ambient state at save time
(`copy-builder/page.tsx:349`):

```ts
const rowId = plannerLink?.rowId ?? currentBriefInput?.planner_row_id;
```

Both sources survive across unrelated campaigns, in two different localStorage
keys. The chain:

1. The writer opens `/copy-builder?planner=<rowA>` once. The seed applies and
   sets `form.planner_row_id = rowA`.
2. `InputForm.tsx:170-172` persists **the entire form** to
   `localStorage["raycon_brief_draft"]` on every change — `planner_row_id`
   included, since it is part of `BriefInput` (`schemas.ts:397`).
3. Days later the writer opens the Copy Builder normally, with no `?planner=`
   param. Hydration at `InputForm.tsx:139-153` sees no seed and restores the
   saved form wholesale via `setForm(parsed)`. **`planner_row_id` is still
   `rowA`.** Note that this same block already sanitises `products_featured`
   against the current catalogue (`:147-149`) — the pattern exists, it just
   doesn't cover this field.
4. The writer writes a completely unrelated campaign and hits Generate. The
   existing guard —
   ```ts
   if (!input.planner_row_id) setPlannerLink(null);   // page.tsx:411
   ```
   — **does not fire**, because `input.planner_row_id` is `rowA`. The guard is
   sound; the value it is testing is contaminated upstream.
5. Save Final → `writeBackToPlanner` resolves `rowA` → `POST /api/planner/link`.
6. The API links rowA to the new copy, unlinks rowA's previous copy, and clears
   that copy's back-reference.

### Contributing holes

| # | Hole | Location |
|---|---|---|
| a | The persisted brief form carries `planner_row_id` and is restored unsanitised | `InputForm.tsx:139-153`, `:170-172` |
| b | The canvas draft persists and restores `plannerLink` with no validation | `page.tsx:166-173`, `:149`, `:157` |
| c | `softResetToForm()` clears `currentBriefInput`, `campaign`, `sectionStructure` and more — but **not `plannerLink`** | `page.tsx:205-217` |
| d | The guard runs only inside `handleBriefSubmit`. Loading a saved draft, loading a library campaign, or restoring the canvas from localStorage all reach Save without it running | `page.tsx:411` |
| e | Nothing validates the row before stamping — not that it still exists, not that it isn't already owned by a different copy | `page.tsx:348-364` |
| f | The link is invisible until after it happens, and there is no unlink control in the Copy Builder | `page.tsx:358` |

`resetAll()` does clear `plannerLink` (`:376`) — that path is fine. It is every
*other* path that leaks.

---

## 3. Fix

The governing principle: **a planner link is an explicit act, not an inherited
default.** Today it is derived from ambient state that outlives the campaign that
created it. Reverse that.

### 3.1 Stop persisting the link (fixes a, b — the direct cause)

A planner handoff is a session-scoped intent carried by a deep link. It should
not be durable state.

- Strip `planner_row_id` when restoring the brief form
  (`InputForm.tsx:139-153`), alongside the existing `products_featured`
  sanitisation. A restored draft is a *content* draft; its planner association
  died with the session.
- Drop `plannerLink` from the canvas-draft payload written at `page.tsx:168-171`,
  and stop reading it at `:157`.
- Re-establish the link on load **from the saved record**, not from localStorage.
  `handleLoadSaved` already does exactly this correctly at `page.tsx:993`:
  ```ts
  setPlannerLink(c.planner_row_id ? { rowId: c.planner_row_id, … } : null);
  ```
  That is the right pattern — the copy record is the source of truth for its own
  link. Make every load path use it.

### 3.2 Clear the link on every reset (fixes c)

Add `setPlannerLink(null)` to `softResetToForm()`. Better: extract one
`clearPlannerHandoff()` helper — `plannerLink`, `formSeed`, `formSeedLabel`,
`seedAiFailed` — and call it from `resetAll`, `softResetToForm` and
`handleClearSeed`, so a future reset path can't forget one field. Three call
sites currently duplicate this cleanup by hand, which is how (c) happened.

### 3.3 Validate before stamping (fixes d, e)

Move the decision out of ambient state and into an explicit check inside
`writeBackToPlanner`:

```
if (!rowId) → no link. done.
fetch the row.
  row missing            → no link. clear plannerLink. toast: "That planner row no longer exists."
  row.copy_campaign_id is empty
      or === this copy id → link. (the normal case)
  row.copy_campaign_id is a DIFFERENT copy
                         → DO NOT link. Ask.
```

The last branch is the one that currently causes collateral damage. Silently
stealing a row from another campaign is never the right default. Prompt:

> **This planner row is already linked to "<other campaign>".**
> Move the link to this campaign, or leave it as it is?
> [ Move it here ]  [ Leave it ]

### 3.4 Make it visible and reversible (fixes f)

- When a planner link is pending, show it in the canvas header *before* saving:
  `Linked to: <row name>` with an **×** to detach. The writer should never be
  told about a link only after it has been written.
- `DELETE /api/planner/link?row_id=…` already exists (`route.ts:88-91`) — wire
  the × to it.

### 3.5 Defend at the API (defence in depth)

`api/planner/link/route.ts:61-64` clears another copy's back-reference with no
signal. Require intent: add `reassign?: boolean` to the request body, and when
the target row already points at a *different* copy, return **409** with the
current owner's id and name unless `reassign: true`. The client's §3.3 prompt
sends `reassign: true` only after the writer confirms.

This makes the destructive path impossible to reach by accident even if a future
client regresses again — which, given this is the second occurrence, is worth the
twenty lines.

---

## 4. Reproduction

1. Open `/copy-builder?planner=<rowA>`. Let the seed apply. Do not save.
2. Navigate away. Open `/copy-builder` with no query string.
3. Confirm the brief form has rehydrated from localStorage. Inspect
   `localStorage["raycon_brief_draft"]` — `planner_row_id` is still `rowA`.
4. Change the campaign name and offer to something unrelated. Generate. Save Final.
5. **Observed:** toast "Linked to planner ✓"; rowA now points at the new copy;
   rowA's previous copy has lost its `planner_row_id`.
   **Expected:** no link written.

---

## 5. Acceptance criteria

- A campaign written with no planner deep link and no explicit link action saves
  with `planner_row_id` unset and writes nothing to the planner.
- Restoring a brief draft from localStorage never restores a planner association.
- Restoring a canvas draft never restores a planner association; the association
  comes only from the saved copy record.
- `softResetToForm()` leaves no planner handoff behind. *(Fails today.)*
- Saving a copy onto a row already owned by a different copy prompts, and
  cancelling writes nothing to either record. *(Fails today — it silently
  reassigns.)*
- A pending link is visible in the canvas header before save and can be detached
  there.
- `POST /api/planner/link` returns 409 when reassignment is implied but not
  requested.
- Regression test: seed from a planner row, soft-reset, write an unrelated
  campaign, save. No link is written. This is the exact path that regressed, so
  it should be the test that guards it.

---

## 6. Build record (2026-08-20)

### The decision now exists, and it is testable

`src/lib/planner-link-decision.ts` — `decideLink()` returns
`none | missing | link | confirm`. The bug was never a bad rule; it was that no rule
existed anywhere. The row id was read out of ambient state at save time and written
immediately. Now the row is fetched and judged, in a pure function with its own
tests, so a future caller can't skip the judgement.

### The five holes

| Hole | Fix |
|---|---|
| a — the persisted brief form restored `planner_row_id` | `stripPlannerLinkFromRestoredForm()` on hydration, next to the existing `products_featured` sanitisation. `planner_notes` deliberately survives: it is text the writer was using and it stamps nothing. |
| b — the canvas draft persisted and restored `plannerLink` | Dropped from the payload and no longer read. The association now comes only from the saved copy record, which is what `handleLoadSaved` already did correctly. |
| c — `softResetToForm()` forgot `plannerLink` | One `clearPlannerHandoff()` helper (`plannerLink`, `formSeed`, `formSeedLabel`, `seedAiFailed`, `seedingProducts`), called from `resetAll`, `softResetToForm` and `handleClearSeed`. Three hand-rolled copies of this cleanup is how (c) happened. |
| d — the guard ran only inside `handleBriefSubmit` | The check moved into `writeBackToPlanner`, which every save path goes through. |
| e — nothing validated the row before stamping | `decideLink()` + a live row fetch: a missing row clears the handoff and links nothing; a row owned by another copy prompts. |
| f — the link was invisible until after it was written | A `Linked to: <row name>` chip in the workspace toolbar while the link is still pending, with an `×` that detaches (and releases the row server-side when it has already been stamped). |

### Defence in depth (§3.5)

`POST /api/planner/link` now answers **409** when the target row points at a
different copy and `reassign: true` was not sent, returning the current owner's id
and resolved name. The client sends `reassign` only after the writer answers the
prompt. This is what makes the destructive path unreachable by accident even if a
future client regresses — which, this being the second occurrence, is the point.

One consequence worth stating: the client no longer needs to detect the conflict
itself. It posts without `reassign`, and the 409 raises the prompt with the owner's
real NAME rather than an id. One code path, better message.

### Verification

Driven against the running app (no LLM needed — a blank canvas saves directly, which
is how the reproduction was exercised end to end):

- A brief draft restored from localStorage carries no planner association, and keeps
  its content and notes.
- Writing an unrelated campaign on top of a contaminated draft and saving writes
  **nothing** to the planner; the row stays unowned. *(This is §4 step 5, the
  observed bug.)*
- Seeding from a planner deep link, resetting, writing something else and saving
  also writes nothing. *(Hole c, the spec's named regression test.)*
- A legitimate link still works; re-saving the same copy onto its own row is not a
  conflict; a different copy is refused with 409 and the row is left untouched;
  `reassign: true` goes through; DELETE unlinks.
- 11 unit tests over `decideLink` / `stripPlannerLinkFromRestoredForm`.

### The data cleanup (§6) — findings

`npm run audit:planner-links` (new, read-only) was run against the live planner
store. **47 rows, 25 linked, and four need a human:**

- **Three rows whose linked copy has a materially different name** — 0% word overlap,
  which is the fingerprint of an inherited link:
  - `ray-summer-sale-launch-all-geo-07-08-2026` "RAY | Summer Sale Launch | All Geo |
    07.08.2026" → copy *"E45 30% OFF Flash Sale - Last Call"*
  - `fs-o25-30-last-call` "FS - O25 30% - Last Call" → copy *"Sale - Back To School -
    Launch"*
  - `cross-sell-everyday-earbuds-fitness-earbuds` "Cross-sell - Everyday Earbuds ->
    Fitness Earbuds" → copy *"Back To School - Battery Anxiety, Solved"*
- **One one-sided link:** `evergreen-h10` points at "Evergreen - H10 Highlight" and
  that copy points back at nothing. The names MATCH, so this is a correct link whose
  back-reference was wiped — precisely the second-order damage §1 describes.

Nothing was changed automatically. The audit writes nothing by design: which of
these is the wrong record is a judgement about intent, not something a name-overlap
heuristic should decide.

### Still open

1. The four rows above, pending review.
2. `plannerLink` is still resolved as `plannerLink?.rowId ?? currentBriefInput?.planner_row_id`
   at save time. That fallback is now safe (the contaminated source is sanitised on
   every restore path), but the tidier end state is a single explicit field.

---

## 7. Notes

- **Data cleanup.** Existing mislinks won't self-heal — the planner's stale-link
  reconciliation (`planner/page.tsx:96-128`) only clears links whose *copy* no
  longer exists, not links pointing at the wrong copy. Worth a one-off pass over
  `campaign-planner.json` to find rows whose linked copy has a materially
  different `campaign_name`, and reviewing those by hand before shipping the fix.
- **Not verified against live data.** This is a code-path diagnosis read against
  the working tree; I haven't inspected the actual planner store, so the
  E26 flash-sale row isn't used as evidence here. The mechanism above reproduces
  from a clean state regardless.
- **Related.** `docs/PLANNER_COPY_LINK_PROMPT.md` specified this feature. The
  single-owner rule it describes is correct — the defect is in how the row id is
  *sourced*, not in how the link is written.
