# UI/UX Redesign — Raycon Copy Builder

You are refining the UI/UX of `raycon-copy-builder`, an internal CRM tool (Next 16, React 19, App Router, Tailwind v4). Read `AGENTS.md` first — this is NOT the Next.js you know; verify conventions in `node_modules/next/dist/docs/` before touching routing/layout code.

## Goal

The app works but looks and feels rough. Make it **elegant, calm, and precise** — an editorial internal tool, not a generic admin panel. Do NOT redesign from scratch or change the information architecture. Keep the existing identity (warm paper background, slate palette, DM Sans + JetBrains Mono) and refine it into a coherent system. No new UI libraries — no shadcn, no Radix, no framer-motion. Hand-rolled components + Tailwind + CSS transitions only.

## Non-negotiable constraints

- Zero behavioral regressions. Every existing flow (brief → conceits → generate/stream → edit → save draft/final, planner CRUD + sync, dashboard load, deep links `?planner=` / `?campaign=`) must work identically.
- Don't touch API routes, `src/lib/*` (except adding no logic), prompts, or data stores.
- Tailwind v4 (CSS-first config via `@theme` in `globals.css` — no `tailwind.config.js`).
- Streaming generation in `copy-builder/page.tsx` re-renders on every token; keep new components cheap (memoize where sensible, no layout thrash).
- All copy-builder localStorage keys and state shapes stay as-is.

---

## Phase 1 — Design tokens + primitives (do this first, everything else builds on it)

### 1a. Tokens in `src/app/globals.css`

Define a token layer with Tailwind v4 `@theme` and CSS variables. Replace every hardcoded color/radius afterwards.

```
Background:  --color-chrome (#f4f4ef), --color-canvas (#fafaf7), --color-surface (#ffffff)
Ink:         --color-ink (#0f172a), --color-ink-secondary (slate-600), --color-ink-muted (slate-400)
Lines:       --color-line (slate-200), --color-line-strong (slate-300)
Accent:      --color-accent (indigo-600) — the planner already uses indigo; promote it to THE app accent.
Semantic:    success (emerald), warning (amber), danger (rose) — 50/200/600 triads
Radius:      --radius-sm 6px (inputs, chips), --radius-md 10px (cards, buttons), --radius-lg 14px (modals). Use ONLY these three.
Shadow:      --shadow-card (0 1px 2px rgba(15,23,42,.04)), --shadow-pop (0 8px 30px rgba(15,23,42,.12))
Motion:      --ease-out-soft (cubic-bezier(.22,1,.36,1)), durations 150ms (hover) / 250ms (panels, modals)
```

Also in globals.css:
- Restore a visible focus style: `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }`. Remove the `[contenteditable]:focus { outline: none }` rule's outline suppression — replace with a soft accent-tinted background + ring.
- Remove `style={{ background: "#f4f4ef" }}` from `src/app/layout.tsx` and `copy-builder/page.tsx` — use the token class.

### 1b. Primitives in `src/components/ui/`

Create small, dependency-free components and replace ALL ad-hoc usages:

- **`Button.tsx`** — variants: `primary` (ink bg), `secondary` (surface + line border), `ghost` (text only), `danger`; sizes `sm`/`md`. One radius (`--radius-md`), consistent height, `disabled` and `loading` (inline spinner replaces label, width preserved via min-width so buttons don't jump). Replace every hand-rolled `<button>` in `copy-builder/page.tsx`, `InputForm.tsx`, `dashboard/layout.tsx`, `planner/page.tsx`, `Sidebar.tsx`, modals.
- **`Modal.tsx`** — one component replacing the three copy-pasted dialogs in `copy-builder/page.tsx` (new-campaign confirm, planner-handoff confirm, regenerate confirm) and any planner editor modal. Requirements: ESC closes, click-outside closes, focus is moved in on open and restored on close, simple focus trap (Tab cycles), `aria-modal` + labelled title, fade+scale-in transition (opacity 0→1, scale .98→1, 250ms), body scroll locked. Provide a `ConfirmModal` wrapper (title, body, confirm/cancel labels, danger flag).
- **`Toast.tsx`** — minimal toast manager (module-level store + `useToasts()` hook or context; no library). Bottom-right stack, auto-dismiss 3.5s, variants success/error/info, slide-up entrance. Use it for: save draft/final results, planner write-back ("Linked to planner ✓"), copy-to-clipboard, planner sync results summary, delete confirmations' outcomes. Remove status-in-button-label ("Saved!") — buttons show `loading` state only; outcome goes to a toast. Keep inline error banners ONLY for blocking errors (generation failed, Klaviyo fetch failed).
- **`EmptyState.tsx`** — icon slot (inline SVG, not emoji), title, description, optional action button. Replace the `✍` empty canvas state, "No saved campaigns yet", "No data yet" dashboard state, empty planner.
- **`Skeleton.tsx`** — shimmer block (CSS gradient animation). Used in Phase 2/3.
- **`Chip.tsx`** — the status/channel pill used across planner + copy builder (`draft`, `final`, `library`, email/sms, planner statuses). One implementation, consistent padding/radius/mono type.
- **Replace every browser `confirm()`** (`handleDeleteSaved`, `handleDeleteLibrary` in copy-builder, any in planner) with `ConfirmModal`.

### 1c. Typography discipline

The mono-uppercase micro-label is currently used for everything, so nothing has hierarchy. Establish and apply:
- **Page titles**: DM Sans semibold, `text-xl`/`text-2xl`, ink.
- **Section headings within panels**: DM Sans medium `text-sm`, ink.
- **Mono uppercase labels**: ONLY for (a) form field labels, (b) data/metric labels, (c) chips. Never for headings, buttons, or body copy.
- **Body/interactive text**: minimum `text-sm` (13–14px). `text-xs` reserved for metadata lines (dates, ids). Audit `Sidebar.tsx`, `InputForm.tsx`, planner table — much of it is `text-xs` that should be `text-sm`.

---

## Phase 2 — Global chrome

### `src/components/AppNav.tsx`
- Kill the split labels ("Dash/board", "Plan/ner"). Each item: a 20px inline SVG icon (draw simple 1.5px-stroke line icons: pen-line for Copy, bar-chart for Dashboard, calendar for Planner, file-text for Reports) + a single short label under it ("Copy", "Dashboard", "Planner", "Reports") at `text-[11px]`.
- Active state: accent-tinted background (`indigo-50`) + accent icon/text, plus a 2px accent bar on the left edge of the active item — not a solid dark block.
- Replace the "Raycon" text block with a small wordmark treatment: "R" in a rounded ink square, mono. Add `title` tooltips.
- Sign out: icon button pinned to bottom, `ConfirmModal` optional (no) — keep one-click but add a toast is unnecessary; just keep it, restyled as ghost icon+label.

---

## Phase 3 — Copy Builder (`src/app/copy-builder/page.tsx` + components)

This is the flagship screen; it gets the most attention.

### 3a. Stage-aware layout
The three fixed columns (sidebar 240px, brief form 384px, canvas) currently all show all the time. Make the chrome respond to the stage:

- **Stepper**: add a compact horizontal stepper at the top of the canvas column: `Brief → Conceit → Canvas`. Current stage in accent, completed stages ink with a check, future stages muted. Clicking a completed stage navigates back where that's already possible (canvas → conceits already exists via `onConceitEdit`). This replaces the cryptic mono status strings ("Waiting for brief...", "Pick a conceit") as primary orientation — keep a small status line under the stepper during loading phases.
- **Collapsible brief panel**: once `stage === "canvas"`, collapse the 384px form panel to a 48px rail showing a vertical "Brief" label + expand icon. Clicking expands it back (250ms width transition; the form stays mounted — just visually collapsed, so state is never lost). Auto-collapse on entering canvas stage, auto-expand on returning to form stage. Persist the user's manual override in component state only.
- **Collapsible sidebar**: same treatment for the left Saved/Library sidebar (collapse to a rail with an icon). Default open. This gives the canvas real room on a 13" screen.

### 3b. Conceit picking (`ConceitPicker.tsx`)
- While `loadingPhase === "conceits"`: render 3 skeleton cards (title bar + two body lines) instead of the lone spinner.
- Cards: number them (mono `01 02 03`), title in DM Sans semibold `text-base`, description `text-sm` secondary ink. Hover: border-strong + `--shadow-card` + translate-y(-1px). Selected: accent border + accent-50 tint.
- Add a "Shuffle conceits" secondary button next to the heading wired to the existing `handleNewConceits`.
- Stagger-fade the three cards in (CSS animation-delay 0/60/120ms).

### 3c. Streaming generation experience
- While `loadingPhase === "generating"`: under the stepper show `Writing — section {n} of {total}` where n = `campaign.sections.length + 1` and total = `sectionStructure.length` (guard total ≥ n).
- The newest streamed section gets a brief entrance: fade + 4px rise, and a subtle left accent border that fades out after ~1s (CSS animation, no JS timers per token).
- Below the last section while generating: one skeleton section block as a "more coming" affordance.
- When generation completes, toast: "Campaign written — {n} sections".

### 3d. Canvas top bar
- Group actions properly: left = editable campaign name (restyle the borderless input with a pencil affordance on hover) + source `Chip` (draft/library). Right = a single primary action (`Save Draft` or `Save Final` split as today, but using Button variants: Save Final = primary, Save Draft = secondary, Copy = ghost with copy icon, New = ghost).
- Sticky: make the top bar sticky (`top-0`, chrome background, subtle bottom border on scroll) so save/copy are always reachable on long campaigns.
- Keyboard: `⌘/Ctrl+S` → Save Draft (preventDefault), `⌘/Ctrl+Enter` in the brief form → submit. Show the shortcut in button `title`s.

### 3e. Brief form (`InputForm.tsx`)
- Inputs: unify on Input styles from the token layer (radius-sm, line border, focus ring accent, `bg-surface`). Increase input text to `text-sm`.
- Campaign type + audience `<select>`s → segmented control or styled select with a chevron icon (keep native `<select>` under the hood for a11y; just style the wrapper).
- Product picker: currently a tall wall of buttons. Make each category collapsible (`<details>`-style, default open for first category), add a tiny search filter input above, and show selected count per category (`Wireless · 2`). Selected product rows: accent tint instead of full ink-inverse (softer).
- Tone slider: keep, but style the range track (accent fill to thumb position) and put the 5 labels as ticks under it; the current label chip above stays.
- The seed banner (planner prefill) restyle with Chip + Button primitives.

### 3f. Sidebar (`Sidebar.tsx`)
- Tabs → underline-style tabs (text + 2px accent underline on active) instead of the filled toggle; counts as muted `(12)`.
- Cards: title `text-sm` medium; metadata line mono `text-xs` muted; delete button becomes a small ghost icon button that is ALWAYS visible at reduced opacity (0.4 → 1 on hover/focus) — never `opacity-0` (keyboard users can't find it). Same fix for section hover controls in `SectionBlock.tsx` / `globals.css` (`.section-controls`): keep the hover reveal for pointer users but add `:focus-within { opacity: 1 }`.
- Active item (currently loaded draft/library entry): accent left border + tinted background so you can see what's open.

---

## Phase 4 — Dashboard (`src/app/dashboard/layout.tsx` + pages)

- **Auto-load on mount** with the default 30-day range (`useEffect` calling `load(false)` once). Remove the "pick a range and click Load" empty state; replace with skeleton metric cards + skeleton table while loading.
- **Range presets**: segmented control `7d / 30d / 90d / Custom` — presets set start/end and load immediately; Custom reveals the two date inputs. Keep Refresh (secondary) and Force refresh (ghost, icon) buttons.
- Metric cards: restyle with tokens; number `text-3xl` semibold ink, label mono micro, delta/context line `text-sm` secondary. Add `--shadow-card`.
- The "Loaded at / cached at" line → a small muted line right-aligned with a refresh icon.
- Tabs (Flows/Campaigns) → same underline tab style as the copy-builder sidebar for consistency.
- Tables in flows/campaigns pages: sticky header row, row hover tint, numeric columns right-aligned mono, zebra off. Loading → skeleton rows.

---

## Phase 5 — Planner (`src/app/planner/page.tsx`)

- Keep the calendar hand-built. Polish: today's cell gets an accent ring + "Today" mono micro-label; weekend columns very slightly tinted; entries are Chips (channel dot + truncated name) with hover elevation; drag state (via @hello-pangea/dnd, already present) gets `--shadow-pop` and slight rotation (1deg) on the dragged card.
- Month header: `← July 2026 →` with a "Today" jump button; month transitions fade (150ms).
- Calendar/Table toggle + filters row: use the shared segmented control + styled selects; align filters in one row with labels as mono micros above.
- Table: same table treatment as dashboard (sticky header, right-aligned numeric mono, hover tint). Status/channel/copy chips all via `Chip`.
- Row editor (modal or drawer): migrate onto `Modal` (or convert to a right-side drawer sliding in 250ms — drawer preferred if it's currently a modal, since editing benefits from seeing the calendar). Fields use the shared input styles; footer actions use `Button`.
- "Sync metrics": Button with loading state; on completion, toast summarizing (`Synced 4 campaigns · Postscript not connected` as warning variant when applicable) instead of any inline dump.

---

## Phase 6 — Login (`src/app/login/page.tsx`)

- Center a single surface card (radius-lg, shadow-card) on the chrome background with the wordmark, "Raycon Tools" title, mono micro subtitle, styled inputs, primary Button full-width with loading state. Error → inline danger text under the field, shake-free.

---

## Micro-interaction & a11y checklist (apply everywhere)

- All interactive elements: 150ms color/border/shadow transitions with `--ease-out-soft`. No transition on layout-affecting properties except the deliberate panel collapses.
- `prefers-reduced-motion: reduce` → disable entrance animations, keep opacity fades.
- Every icon-only button gets `aria-label` + `title`.
- Modals/drawers: ESC, click-outside, focus trap, focus restore (Phase 1b covers this — verify each migrated usage).
- Nothing interactive is reachable only by hover (audit all `opacity-0 group-hover:opacity-100` — minimum resting opacity 0.4 or `focus-visible` reveal).
- Keyboard shortcuts: ⌘S (save draft), ⌘Enter (submit brief). Don't add more.
- Color contrast: all text ≥ 4.5:1 on its background (check muted slate-400 on white — bump to slate-500 where it carries meaning).

## What NOT to do

- No dark mode.
- No new dependencies of any kind.
- No route changes, no renamed files outside `src/components/ui/` additions.
- No redesign of the generated-campaign section editing UX (`SectionBlock`, `EditableField`, `RegenerateModal` internals) beyond token/primitive adoption and the focus/hover fixes noted — the editing interactions work.
- Don't "brand" it with gradients, glassmorphism, or decorative illustration. Elegance here = restraint, rhythm, and consistency.

## Working order & verification

1. Phase 1 (tokens + primitives) as one commit — app must look near-identical, just systematized.
2. Then phases 2–6, one commit each.
3. After each phase: `npm run build` must pass; manually verify the affected flows (list them in the commit message).
4. Final pass: grep for leftover `rounded-lg`/`rounded-xl`/`rounded ` inconsistencies, raw hex colors, `confirm(`, `opacity-0 group-hover` without focus fallback, and `text-xs` on primary interactive text. Fix stragglers.
