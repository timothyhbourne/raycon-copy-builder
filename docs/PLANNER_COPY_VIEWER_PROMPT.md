# Planner Copy Viewer — full-copy document modal inside the planner

You are iterating on the planner↔copy feature just built from `PLANNER_COPY_EMBED_PROMPT.md` in `raycon-copy-builder` (Next 16, React 19, Tailwind v4). Read `AGENTS.md` first. Use the existing UI primitives (`src/components/ui/Modal.tsx` etc.) and design tokens.

## The problem with what was built

The drawer's Copy section shows a truncated preview and tells the user to "Open in Copy Builder" for the full copy. That breaks the designer's workflow: they live in the planner/calendar and shouldn't bounce to another page just to READ copy. 

## The fix

A **full-copy document modal**: from the planner drawer's Copy section, one click opens a large, centered, white, Google-Docs-like view of the COMPLETE copy — read-only — layered over the planner. Read it, close it, stay in the planner.

## Requirements

### 1. Data — full content, selected variants
- Extend the copy summary endpoint (`src/app/api/planner/copy/route.ts`) with `?full=1`: return every section IN ORDER with ALL elements untruncated, plus `campaign_name`, `source` (draft/library), `updated_at`, all subject lines and preview texts, the chosen conceit name if stored, and `section_structure` grid dimensions for product grids.
- **Subheader rule (important):** the copy builder stores subheaders as 3 variants with a selected one (`subheader_variants` / `subheader_selected` — see `extractSubheaderVariants` in `src/lib/normalize-section.ts` and how `SectionBlock.tsx` renders the radio selection). The viewer payload must resolve each Subheader to THE SELECTED VARIANT ONLY — a single string. Never show the other two variants. Fall back to variant 0 when no selection is stored.
- No caching beyond the request: the modal fetches fresh on every open, so edits made in the Copy Builder are reflected the next time the modal opens ("projection" semantics). 

### 2. The document modal
- New component `src/components/CopyDocModal.tsx`, rendered from the planner page (triggered from the drawer's Copy section — replace the truncated inline preview with a compact one-line summary + a prominent "View copy" button; keep "Open in Copy Builder" as a smaller secondary action for people who need to EDIT).
- Layout: centered overlay (`bg-black/40`), white sheet `max-w-3xl`, `max-h-[85vh]`, internal scroll, `rounded-lg` (radius token), `--shadow-pop`, generous document padding (`px-10 py-8` desktop). It should read like a clean document, not an app panel:
  - Title: campaign name, `text-2xl` DM Sans semibold, with the draft/final Chip and a muted "Updated <relative time>" line.
  - Meta block: "SUBJECT LINES" mono micro-label, then the 3 subject lines as plain numbered lines; same for preview texts.
  - Sections in order, separated by hairline dividers: each element as a mono micro-label (HEADLINE, TAGLINE, BODY COPY, CTA…) followed by the value in `text-[15px]` leading-relaxed ink. Product grids render as an actual CSS grid matching `grid_cols` (cells: product name semibold, one-liner, CTA italic — mirroring the clipboard-export layout in `handleCopyCampaign` in `src/app/copy-builder/page.tsx`).
- **Strictly read-only**: plain text nodes only — no inputs, no contenteditable, no hover-edit affordances. Text must remain selectable for copy-paste.
- Close via X button, ESC, and click-outside (reuse `Modal`'s behavior — build on the `Modal` primitive if it supports a large variant, otherwise extend it with a `size="document"` prop rather than duplicating focus-trap logic).
- Loading state: skeleton document (title bar + label/paragraph pairs). Error/stale link: small inline message + close, and trigger the existing link-healing path.
- The modal opens ON TOP of the open drawer (z-index above it); closing the modal returns to the drawer untouched.

### 3. Access from the calendar (small, worth it)
- The calendar pill's document glyph (added in the previous prompt) becomes clickable: clicking the glyph (stopPropagation — don't open the drawer) opens the CopyDocModal directly. Title bar of the modal gains a subtle "Edit in Copy Builder →" link on the right for the copywriter.

### 4. Don'ts
- Don't touch the copy builder's own editing UI or the SavedCampaign/library data shapes.
- Don't render unselected subheader variants, internal ids, planner metadata, or expanded-brief/conceit internals (conceit NAME as a one-line muted footer is fine if present).
- No new dependencies.

## Verify
1. Link a draft with a multi-variant subheader; select variant 2 in the copy builder, save → planner modal shows exactly variant 2's text, single line.
2. Edit a headline in the copy builder, save draft → reopen the modal from the planner → new headline shows (no stale cache).
3. Try to edit text in the modal → impossible; selection/copy works.
4. ESC and click-outside close the modal and leave the drawer open underneath.
5. Calendar glyph click opens the modal without opening the drawer.
6. `npm run build` passes.
