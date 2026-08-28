# Bug: campaigns can be saved with no name, and look unrenameable

**Status:** diagnosed, fix proposed. Small.
**Surface:** `src/app/copy-builder/page.tsx`, `src/components/LibraryBrowser.tsx`,
`src/lib/library.ts`, `src/lib/validation/requests.ts`.

---

## 1. What happens

Save a campaign from a blank canvas without typing a name and it lands in the
library as a blank row. Two of them now sit there, indistinguishable, and there
is no apparent way to name them.

## 2. Root cause — four small omissions in a row

**a. Nothing requires a name.** `validation/requests.ts` has no constraint on
`campaign_name`; an empty string saves cleanly.

**b. The library title is the raw name.** `library.ts:119` —
`title: briefInput.campaign_name` — with no fallback. Empty name, empty title.

**c. The library browser renders it raw.** `LibraryBrowser.tsx:141` prints
`{title}` directly, so the row shows nothing at all.

**d. The rename field is invisible.** `page.tsx:1604-1609` renders a real,
working `<input>` bound to `campaign_name` — but with **no `placeholder`**. At
`value=""` it is a blank 14rem underline in the header with nothing to see or aim
at. The pencil icon next to it only appears on hover (`:1610`,
`opacity-0 group-hover:opacity-100`).

**So the campaign is renameable today.** The control exists, it works, and the
rename persists through autosave. It just cannot be found, which for the person
using it is the same thing as being unable to.

Reloading from the library re-reads `campaign_name: lib.title` — empty again — so
the invisible field is invisible every time you come back to it.

**Not a problem:** the ids are safe. Both save paths already fall back when the
name slugs to empty — `"untitled"` plus a nanoid for drafts (`:934`), a bare
nanoid for finals (`:1006`). No collisions, no overwrites. The comment at
`:1003-1004` shows this was already thought through.

## 3. Fix

**a. Never create an unnamed campaign — auto-name it.** On Save Final with an
empty `campaign_name`, derive one from the copy that already exists: the
Headline, else the first subject line, else `Untitled — {date}`. Truncate to ~60
chars. This is the fix that matters; the rest is cleanup.

Do **not** do this on Save Draft — drafts should stay frictionless, and a draft
gains a name the moment it is finalised.

**b. Give the rename field a placeholder.**
`placeholder="Name this campaign"` on the input at `:1605`, and show the pencil
icon persistently (not hover-only) whenever the name is empty. An empty required
field should look like an empty field, not like nothing.

**c. Fall back in the library browser.** `LibraryBrowser.tsx:141` renders
`title || "Untitled campaign"` in muted italic. Two untitled entries must still
be distinguishable, so where the title is a fallback, put the date and the
campaign type into the row's meta line.

**d. Rename from the library browser.** A rename action on each row, so a badly
named campaign can be fixed without opening it. It writes `title` through the
same path Save Final uses and leaves the id alone — ids stay stable, titles are
display.

## 4. Acceptance criteria

- Finalising a campaign with no name produces a library entry with a sensible
  auto-derived name, never a blank one.
- The rename field shows a placeholder when the name is empty and is visibly
  clickable.
- Renaming a campaign persists through a reload and does not change its id.
- The library browser shows no blank rows, and two untitled entries are
  distinguishable by date and type.
- A campaign can be renamed from the library browser without opening it.
- The two existing unnamed entries can be named and saved.
- Save Draft still works with no name — no new friction on drafts.
