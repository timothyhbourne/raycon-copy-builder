# Planner ↔ Copy Embed — show and attach campaign copy inside the planner editor

You are connecting the Campaign Planner and the Copy Builder in `raycon-copy-builder` (Next 16, React 19, Tailwind v4). Read `AGENTS.md` first — this is NOT the Next.js you know. Use the UI primitives in `src/components/ui/` (Button, Chip, Drawer, Skeleton, Toast); match the app's token styling.

## What exists already (reuse, don't rebuild)

- Planner rows carry `copy_campaign_id` + `copy_status` ("draft" | "final"), stamped by `src/app/api/planner/link/route.ts` when copy is saved from a planner handoff. The table view renders this as a chip + "Open copy" link (see `CopyLink` in `src/app/planner/page.tsx`).
- SavedCampaign drafts live in the campaigns store (`src/lib/campaigns.ts`, `/api/campaigns` — GET list, GET ?id= one). Finalized copy lives in the library (`src/lib/library.ts`, `/api/library` — GET list, GET ?id= one, entries may have `structured.campaign`).
- The planner page already loads the set of saved copy ids to heal stale links (`copyIds` state).
- The planner row editor is the `Drawer` in `src/app/planner/page.tsx`. NOTE: `PLANNER_EDITOR_REDESIGN_PROMPT.md` may or may not have been executed yet — detect the current drawer structure and integrate accordingly; if the redesign landed, the Copy section goes between Audiences and Notes; if not, place it after the Klaviyo link field.

## What's missing (the task)

1. The copy CONTENT is not visible from the planner — only a link out.
2. Copy created independently (not via planner handoff) and library entries cannot be attached to a planner row at all.

---

## Step 1 — Copy summary endpoint

Create `src/app/api/planner/copy/route.ts` — GET `?id=<copy_campaign_id>`:

- Look up the id in the campaigns store first, then the library (same fallthrough as `handleLoadSaved` in `src/app/copy-builder/page.tsx`).
- Return a normalized preview payload:
  ```json
  {
    "id": "...", "source": "draft" | "library",
    "campaign_name": "...", "updated_at": "...",
    "subject_lines": ["...", "...", "..."],
    "preview_texts": ["..."],
    "sections": [ { "type": "header", "fields": { "Headline": "...", "Tagline": "..." } } ]
  }
  ```
- For structured content (SavedCampaign.campaign or library `structured.campaign`): map each section's elements; where a Subheader is a 3-variant array, return only the selected/first variant. For product grids, flatten each product to "Name — one-liner — CTA" strings. For legacy flat library bodies, split on `# ` headings (same best-effort logic the copy-builder uses).
- 404 with `{ error: "not_found" }` when the id exists in neither store (the client heals the link).
- Same auth posture as the other planner routes.

## Step 2 — Copy section in the planner drawer

Add a **Copy** section to the row editor (email rows only; SMS rows show nothing until SMS copy exists):

**Linked state** (`row.copy_campaign_id` set and resolvable):
- Header line: mono micro-label "COPY", a status Chip (draft = amber, final = emerald), and right-aligned actions: "Open in Copy Builder" (link to `/copy-builder?campaign=<id>`) and "Unlink" (ghost, with ConfirmModal).
- Below: a compact read-only preview from the Step 1 endpoint — first subject line + preview text, then each section as a collapsed row (mono section type + first field's text, truncated to 2 lines) inside a `max-h-64 overflow-y-auto` area. Quiet styling: no boxes-in-boxes, hairline separators between sections, `text-sm` body, muted metadata. Skeleton lines while loading.
- If the endpoint 404s: toast nothing; render the unlinked state and clear the stale link via the existing healing path.

**Unlinked state:**
- Two affordances side by side:
  - "Write copy" — the existing planner-handoff link (`/copy-builder?planner=<rowId>`), primary.
  - "Attach existing copy" — opens the Step 3 picker, secondary.

**Unlink behavior:** clears `copy_campaign_id`/`copy_status` on the row via the planner upsert AND clears `planner_row_id` on the copy record (Step 4 route). Toast confirmation.

## Step 3 — Attach-existing-copy picker

A lightweight picker (Modal, or inline expanding panel in the drawer — pick whichever reads cleaner with the current drawer; do not add a dependency):

- Tabs or a segmented toggle: "Drafts" (from `/api/campaigns`) and "Library" (from `/api/library`), plus a text filter on name.
- Each entry: name, date, campaign type, status chip. Entries already linked to ANOTHER planner row show a muted "linked to <row name>" tag — selectable, but selecting one warns via ConfirmModal ("This copy is linked to <other row>. Move it here?") and unlinks the other row on confirm (a copy belongs to at most one planner row).
- Selecting an entry calls the Step 4 link route with `{ row_id, copy_campaign_id, copy_status }` (draft for saved drafts, final for library), then refreshes the drawer to the linked state.

## Step 4 — Make the link bidirectional and safe

Extend `src/app/api/planner/link/route.ts` (or add a sibling handler) to support the manual attach/detach flows:

- POST `{ row_id, copy_campaign_id, copy_status }` — existing stamp behavior, PLUS: write `planner_row_id` onto the copy record (SavedCampaign field exists; the library entry format has `planner_row_id` too), and if that copy was previously linked to a different row, clear that other row's `copy_campaign_id`/`copy_status` (single-owner rule).
- DELETE (or POST with `unlink: true`) `{ row_id }` — clears the row's copy fields and the copy record's `planner_row_id`.
- All writes go through the existing store modules (`lib/planner.ts`, `lib/campaigns.ts`, `lib/library.ts`) — no direct fs in the route.
- Keep the existing write-back-from-copy-builder call path working unchanged (it uses the same POST shape).

## Step 5 — Surface the connection on the calendar too

Calendar pills for rows with linked copy get a small document glyph (inline SVG, 12px, muted) after the name — so "has copy" is visible at a glance alongside the status color. Table view keeps the existing CopyLink chip (restyle to `Chip` if it isn't already).

## Step 6 — Verify

1. Planner-handoff flow unchanged: create row → Write copy → save draft in builder → reopen planner drawer → Copy section shows the preview with a draft chip.
2. Attach flow: create a fresh planner row → Attach existing copy → pick a library entry → preview renders, table chip says final, calendar pill shows the glyph.
3. Move flow: attach the same copy to a different row → confirm dialog → old row reverts to unlinked.
4. Unlink flow: unlink → row shows Write copy / Attach again; the copy record's `planner_row_id` is cleared (check the JSON).
5. Stale link: delete a linked draft from the copy-builder sidebar → reopen the planner drawer → unlinked state, no crash.
6. `npm run build` passes.

Commit order: (1) copy summary endpoint, (2) drawer Copy section, (3) picker + bidirectional link route, (4) calendar glyph + polish. Note any deviations explicitly in your summary.
