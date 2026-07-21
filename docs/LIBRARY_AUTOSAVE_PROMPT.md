# Library Autosave — edits to finalized copy save themselves

You are adding autosave to the Copy Builder in `raycon-copy-builder` (Next 16, React 19). Read `AGENTS.md` first. Main file: `src/app/copy-builder/page.tsx`.

## Why

Finalized copy in the library is what the planner's copy viewer shows (it fetches fresh on open). Today, edits to a library-loaded campaign only persist when someone remembers to click "Save to Library" — so the planner can show stale copy. Requirement: when a library campaign is open in the canvas, every edit is saved automatically, so the planner viewer always reflects the latest state.

## Scope

Autosave applies ONLY when `canvasSource === "library"` (a finalized campaign loaded from the library). Draft behavior (localStorage persistence + manual "Save Draft") stays exactly as is. Do not autosave during initial generation (library canvases don't generate, but guard anyway).

## Implementation

### 1. Debounced autosave loop
- Watch the states that feed `handleUpdateLibrary` (campaign, sectionStructure, currentBriefInput incl. campaign_name, chosenConceit). When any change while `canvasSource === "library"` and `currentLibraryId` is set, schedule a save **1.5s after the last change** (debounce — "every letter is saved" means no edit is ever lost, not one HTTP call per keystroke).
- Reuse the exact payload/endpoint of `handleUpdateLibrary` (`POST /api/finalize` with the current library id). Extract the shared logic into one function both paths call.
- **Single-flight with trailing latest**: never run two saves concurrently. If changes arrive while a save is in flight, run ONE follow-up save with the latest state when it completes. A simple `savingRef` + `dirtyRef` pair is enough.
- Don't fire while a section/meta regenerate request is streaming in; mark dirty and save when it settles.

### 2. Flush on exit
- Flush a pending debounced save immediately on: navigating away from the canvas (New campaign, loading another item from the sidebar, planner deep-link), component unmount, and `beforeunload`/`pagehide` (use `navigator.sendBeacon` to the finalize endpoint for the unload case if the payload fits; otherwise a best-effort keepalive fetch).
- The existing "unsaved changes" confirm dialogs should no longer trigger for library canvases (there's nothing unsaved) — leave them for draft/new canvases.

### 3. UI
- When `canvasSource === "library"`, REPLACE the "Save to Library" button with a quiet autosave status in the same spot, mono micro text: "Saving…" (in flight) → "Saved" with a check (settled, fades to just the check after ~2s) → on failure: "Autosave failed — Retry" where Retry is a small ghost button re-triggering the save. Toast only on failure, never on success.
- Keep `savingStatus` state naming/behavior for the draft paths untouched.

### 4. Failure semantics
- On a failed save, keep the dirty flag so the next edit or the Retry re-attempts. Two consecutive failures → one toast (not one per retry). Never lose local state — the canvas content is the source of truth until a save lands.

## Verify
1. Load a library campaign, edit a headline, stop typing → "Saving…" then "Saved" within ~2s; `data/library/<id>.md` on disk shows the new headline; opening the campaign from the planner's copy viewer shows it.
2. Type continuously for 10s → requests are debounced (a few saves, not dozens).
3. Edit then immediately click a different sidebar item → the edit still persisted (flush-on-exit).
4. Kill the dev server mid-save → "Autosave failed — Retry" appears; restart server, hit Retry → saves.
5. Draft canvases: behavior unchanged (manual Save Draft / Save Final, localStorage restore).
6. `npm run build` passes.
