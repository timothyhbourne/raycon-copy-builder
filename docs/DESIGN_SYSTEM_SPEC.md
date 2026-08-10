# Design System — Evernote-Inspired Refinement

**Status:** Ready to implement
**Area:** `src/app/globals.css` (tokens), `src/app/layout.tsx` (fonts), `src/components/ui/*` (primitives), `src/components/AppNav.tsx`
**Goal:** Make the app read as a considered, professional product rather than an internal admin panel — without moving anything users rely on.

---

## 1. Diagnosis — why it currently looks bland

The app is **not** missing a design system. `globals.css` already has a genuinely thoughtful token layer: a three-tier surface ramp, a full indigo ramp, semantic triads, three radii, motion easing, a type scale, reduced-motion support. The blandness comes from six specific choices, not from absence of structure.

1. **Temperature clash (the biggest offender).** Surfaces are *warm* (`--color-chrome: #f4f4ef`, `--color-canvas: #fafaf7` — cream/beige) while ink, lines, and muted text are *cool* Tailwind slate (`#0f172a`, `#e2e8f0`, `#94a3b8`). Warm paper under cool grey borders reads as muddy and accidental. Professional UIs pick **one** temperature and commit.

2. **Elevation is invisible.** `--shadow-card: 0 1px 2px rgba(15,23,42,0.04)` is 4% opacity. Nothing appears to sit above anything else, so every surface is a flat outlined rectangle. Depth is the cheapest signal of polish and it's currently unused.

3. **The surface layers don't separate.** `#f4f4ef` → `#fafaf7` → `#ffffff` are ~1–2% apart in luminance. The intended chrome/canvas/surface hierarchy is imperceptible, so the whole screen is one flat wash.

4. **Everything is separated by hairlines.** With no elevation and minimal value contrast, 1px `slate-200` borders do all the structural work — the classic wireframe look.

5. **The accent carries no meaning.** One indigo does active-nav, focus rings, links, and primary buttons alike. Nothing on screen says "this is the important action." Evernote's fix: **green for actions that create something, neutral/blue for everything else.**

6. **Uppercase micro-labels everywhere.** `.t-label` (11px, uppercase, `letter-spacing: .06em`) is the default label idiom across cards, tables, section headers, and nav groups. An all-caps drumbeat reads utilitarian and dry. Evernote went the other way — plain, readable sentence case, reserving caps for rare structural labels.

Secondary: `html { font-size: 120% }` inflates everything ~20%, which combined with soft radii and no elevation reads "zoomed-in tool" rather than crafted. And DM Sans (geometric, quirky `a`/`g`) is less suited to dense data tables than Inter.

---

## 2. What we're borrowing from Evernote

Evernote's 2024 redesign was explicitly guided by four principles, all of which apply here:

1. **Respect existing workflows** — subtle UI adjustments, not rearranged features. *This spec moves nothing; it re-skins.*
2. **Enhance focus** — they removed visually intrusive chrome (notably the dark sidebar) because it "drew attention away from the content you were working on." Content is the brightest, calmest surface; chrome recedes. *Directly relevant: the Copy Builder canvas is the content and should dominate.*
3. **Infuse modernity** — match contemporary product standards so it sits naturally beside other tools.
4. **Facilitate future iteration** — a simpler, more manageable token set.

Plus two concrete moves: **Inter** as the typeface (chosen because it improves readability "without compromising information density" — near-identical pixel footprint), and **green reserved for create actions** with other actions in neutral/blue.

---

## 3. The token layer (drop-in replacement)

Replace the `@theme` block in `src/app/globals.css`. Every existing utility name (`bg-chrome`, `text-ink`, `border-line`, `shadow-card`, `bg-accent-50`, …) is preserved, so **no component markup has to change** — repointing the tokens re-skins the whole app.

> **Revised against a real Evernote screenshot** (supplied 2026-08-06). Three corrections to earlier drafts, noted inline below: the neutrals are **near-neutral grey, not warm cream**; the secondary action color is **violet, not blue**; and separation comes from an **inset white panel on grey**, not from heavy shadows.

```css
@theme {
  /* ---- Typefaces ---- */
  --font-sans: var(--font-inter), system-ui, -apple-system, sans-serif;
  --font-mono: var(--font-jetbrains-mono), ui-monospace, monospace;

  /* ---- Surfaces: ONE near-neutral grey ramp, visibly separated ----
     CORRECTION: Evernote's ground is a barely-tinted grey (~#F7F7F6), NOT the
     cream/beige an earlier draft proposed. Keeping the tint this low is what
     makes white content panels read as clean rather than yellowish. */
  --color-chrome:  #F7F7F6;  /* app ground / sidebar — the sidebar IS the ground */
  --color-canvas:  #F7F7F6;  /* same ground; panels provide the contrast */
  --color-surface: #FFFFFF;  /* content panels, cards, the copy canvas */
  --color-sunken:  #F2F2F0;  /* filled inputs, table header rows, inline hint cards */

  /* ---- Ink: neutral, agrees with the surfaces ---- */
  --color-ink:           #1F1F1E;
  --color-ink-secondary: #3D3D3B;
  --color-ink-tertiary:  #6B6B67;  /* NEW — default label color */
  --color-ink-muted:     #9A9A95;  /* decorative / micro only, never body text */

  /* ---- Lines ---- */
  --color-line:        #E8E7E4;
  --color-line-strong: #DCDBD7;

  /* ---- Accent: green = CREATE only. Vivid, per the screenshot's "Note" button
     (an earlier draft's forest green was too muted/corporate). ---- */
  --color-accent:     #0E9F55;
  --color-accent-50:  #E7F7EE;
  --color-accent-100: #C6EDD8;
  --color-accent-200: #97DDB9;
  --color-accent-300: #5FC894;
  --color-accent-400: #2FB273;
  --color-accent-500: #14A55D;
  --color-accent-600: #0E9F55;
  --color-accent-700: #0A7B41;
  --color-ramp-min: var(--color-accent-50);
  --color-ramp-max: var(--color-accent-700);

  /* ---- Secondary action: VIOLET (CORRECTION — the screenshot's "New Task"
     action and Task icon are violet, not blue). Used for non-creating actions
     that still need to read as actions, and for AI affordances. ---- */
  --color-action:     #7C4DFF;
  --color-action-50:  #F1ECFF;
  --color-action-200: #D3C4FF;
  --color-action-600: #6A35F5;

  /* ---- Semantic triads ---- */
  --color-success-50: #E7F7EE;  --color-success-200: #97DDB9;  --color-success-600: #0A7B41;
  --color-warning-50: #FDF3E3;  --color-warning-200: #F6DCA8;  --color-warning-600: #B47700;
  --color-danger-50:  #FDECEC;  --color-danger-200: #F5C2C2;   --color-danger-600: #DC2626;
  --color-info-50:    #ECF1FE;  --color-info-200:   #C2D4FB;   --color-info-600:   #2563EB;
  /* Commercial / urgency (the screenshot's amber upsell + expiry countdown). */
  --color-promo-50:   #FDF3E3;  --color-promo-600:  #E8A317;

  /* ---- Categorical data palette (NEW) ---- */
  --color-data-1: #0E9F55;  /* email */
  --color-data-2: #7C4DFF;  /* sms */
  --color-data-3: #E8A317;  /* flows */
  --color-data-4: #2563EB;  /* campaigns */
  --color-data-5: #0E9488;
  --color-data-6: #DC2626;

  /* ---- Radius — panels get a 4th, larger step ---- */
  --radius-sm: 6px;
  --radius-md: 8px;   /* buttons, inputs, nav pills */
  --radius-lg: 12px;  /* content panels, modals */
  --radius-xl: 16px;  /* the app frame / copy canvas sheet */

  /* ---- Elevation — DELIBERATELY RESTRAINED (CORRECTION).
     Evernote is nearly flat: structure comes from the grey ground vs. white
     panel contrast and hairline borders, not from drop shadows. Do NOT reach
     for heavy shadows to fix flatness — fix it with the panel pattern (§4.0). */
  --shadow-card: 0 1px 2px rgba(31,31,30,.05);
  --shadow-raised: 0 2px 6px rgba(31,31,30,.07);
  --shadow-pop: 0 12px 32px rgba(31,31,30,.14), 0 2px 6px rgba(31,31,30,.06);
  --shadow-focus: 0 0 0 3px rgba(14,159,85,.18);

  /* ---- Motion ---- */
  --ease-out-soft: cubic-bezier(0.22, 1, 0.36, 1);
}
```

### 3.1 Root scale
Change `html { font-size: 120% }` → **`112%`**. Inter runs slightly larger on the body than DM Sans at the same size, so this keeps effective reading size while tightening the inflated feel. Tune between 110–115% to taste — one number, whole-app effect.

### 3.2 Typography
- Swap DM Sans → **Inter** in `src/app/layout.tsx` via `next/font` (self-hosted, same pattern), exposing `--font-inter`. Keep JetBrains Mono for tabular numerics only.
- Enable Inter's optical sizing and tabular figures where numbers align:
  ```css
  body { font-feature-settings: "cv11", "ss01"; }
  .font-mono, .tabular { font-variant-numeric: tabular-nums; }
  ```
- Revise the type scale in `globals.css`:
  ```css
  .t-display { font-size: 1.625rem; line-height: 1.15; font-weight: 650; letter-spacing: -0.02em; }
  .t-heading { font-size: 1rem;     line-height: 1.3;  font-weight: 620; letter-spacing: -0.01em; }
  .t-body    { font-size: 0.875rem; line-height: 1.55; font-weight: 400; }
  /* NEW default label — sentence case, readable. Use this in place of .t-label. */
  .t-label   { font-size: 0.75rem;  line-height: 1.3;  font-weight: 550;
               color: var(--color-ink-tertiary); text-transform: none; letter-spacing: 0; }
  /* The old all-caps idiom, kept but RARE: table column heads, nav group heads. */
  .t-micro   { font-size: 0.6875rem; line-height: 1.2; font-weight: 600;
               text-transform: uppercase; letter-spacing: 0.05em;
               color: var(--color-ink-muted); }
  ```
  **This is the highest-impact single change after the palette.** `.t-label` keeps its name so existing markup inherits the new look automatically; anywhere the all-caps read is genuinely wanted, opt in with `.t-micro`.

---

## 4. Component rules

### 4.0 The inset panel — the single most important structural change

This is the pattern that makes the reference UI read as a modern product, and it's what your app is missing most:

- The **app ground** (`--color-chrome`) fills the window. **The sidebar sits directly on it with no border and no separate background** — the sidebar *is* the ground.
- The **content area is a white panel** (`--color-surface`) with `--radius-lg`, a `--color-line` hairline border, and `--shadow-card`, **inset ~8–10px from the window edges** so the grey ground shows around it.
- Optionally the whole app frame gets `--radius-xl` with a hairline border (the reference screenshot does this).

Result: content is unmistakably the figure and chrome is the ground, achieved with **contrast and shape rather than shadow**. Implement in the route layouts (`src/app/dashboard/layout.tsx`, `planner/layout.tsx`, `promotions/layout.tsx`, `reports/layout.tsx`, `lifecycle/layout.tsx`) plus the app shell in `src/app/layout.tsx`.

### 4.1 Action semantics (`src/components/ui/Button.tsx`)
| Variant | Use | Style |
|---|---|---|
| `primary` | **Creates something**: Generate, Add section, New campaign, Save to library | solid `--color-accent` (green), white text, `--radius-md` |
| `secondary` | Non-creating actions: Save draft, Apply, Refresh, Sync | white surface, `--color-line-strong` border, ink text |
| `action` (NEW) | Text-style actions that create a record inline: "+ New task"-style affordances | `--color-action` (violet) text + icon, no fill |
| `ghost` | Tertiary/dismissive: Cancel, Close, inline controls | transparent, ink-secondary, hover `--color-sunken` |
| `danger` | Destructive only: Delete | `--color-danger-50` bg, `--color-danger-600` text; solid red only in confirm dialogs |

Exactly **one** green primary per view. Audit existing `Button` usages and demote any that aren't creating something — that single pass is most of the perceived professionalism gain.

**Icon-led secondary buttons.** In the reference, the two buttons beside the primary carry *colored outline icons* on a white face (violet, coral) while the label stays ink. Use this for paired secondary actions rather than tinting the whole button.

### 4.1b Table & list patterns (from the screenshot)
- **Header row:** `--color-sunken` background, ink-secondary text at label size, sentence case, no vertical dividers.
- **Rows:** hairline `--color-line` dividers only, generous height (~44px at base scale), hover `--color-sunken`.
- **Grouped rows:** collapsible group headers in **bold sentence-case ink** with a muted count beside them (`Overdue 2`, `No due date 4`) and a chevron — *not* uppercase labels. Groups may carry an inline `+` to add directly into that group.
- **Empty cells render an em dash** (`–`) in `--color-ink-muted`, never blank.
- **Counts beside titles:** page titles carry a muted count (`Campaigns 9`) at the same size, lighter weight.
- **Overdue / negative values** in `--color-danger-600` text — color on the value itself, no badge needed.
- **Row meta icons** (priority, flags, alerts) are small colored glyphs — this is where color enters a dense table, not via buttons.

### 4.1c Tabs & filters
Active tab is an **outlined white pill** (`--radius-md`, `--color-line-strong` border) on the panel; inactive tabs are plain ink-tertiary text with no chrome. Filter/settings controls sit right-aligned as thin outline icon buttons. A search input in a toolbar is white with a border; a search input in the sidebar is **filled** `--color-sunken` with no border.

### 4.2 Elevation usage
- `flat` (no shadow): table rows, list items, inline elements.
- `--shadow-card`: standard cards, inputs, the nav rail.
- `--shadow-raised`: stat cards, dropdowns, popovers, hovered cards.
- `--shadow-pop`: modals, drawers, toasts.
- On hover, cards may step from `card` → `raised` with a 150ms transition. Never animate to `pop`.

### 4.3 Chrome recedes, content leads (Evernote principle 2)
- Nav rail (`AppNav.tsx`): sits on `--color-chrome` with **no background of its own and no right border** (§4.0).
- **Active nav item: a quiet `--color-sunken` pill** with ink text at medium weight. **CORRECTION** — an earlier draft proposed a green tint; the reference uses a neutral grey pill. **Drop the left accent bar too.** Reserve the accent for actions, never for navigation state. This is the clearest expression of "chrome recedes."
- Nav group labels (`CREATE` / `PLAN` / `MEASURE`) are the **one sanctioned use of all-caps** — `.t-micro`, muted (the reference's `RECENT NOTES`).
- Nav icons: thin outline glyphs (1.5px stroke), monochrome ink-tertiary, accent-free. The existing `AppNav` icons already match this.
- Primary create button lives **at the top of the sidebar**, full width, solid green — the most prominent single element in the chrome.
- The Copy Builder canvas (`.rc-canvas-sheet`) stays pure `--color-surface` at `--radius-xl` — the brightest thing on screen, because it's the work.
- An **inline hint card** in the sidebar (onboarding/empty state) uses `--color-sunken`, ink title + ink-tertiary body, with a dismiss `✕`.
- Optional: a circular **AI affordance** bottom-right (solid ink or violet) for generate-anywhere. Only if it earns its place.

### 4.4 Status chips (`Chip.tsx`, `PlatformBadge.tsx`)
Informational, never competing with buttons: tinted `-50` background, `-600` text, no border, `--radius-sm`. Sent → success, Draft → warning, Scheduled → info, Cancelled → neutral `--color-sunken`.

### 4.5 Data viz
Replace single-indigo-ramp usage with `--color-data-1…6` for categorical series (email/sms/flows/campaigns). Keep the sequential `--color-ramp-min → max` for heatmaps only. Always pair color with a text label — never color alone.

### 4.6 Focus
Keep `:focus-visible` but use the new ring: `outline: 2px solid var(--color-accent); outline-offset: 2px`, and `--shadow-focus` on inputs. Update the `[contenteditable]:focus` tint to `--color-accent-50` / `--color-accent-200` (it already references those tokens, so it follows automatically).

---

## 5. Migration plan (low risk, ordered)

1. **Tokens + fonts + type scale** — replace the `@theme` block, swap to Inter, revise `.t-label`/`.t-micro`, set root to 112%. *This alone delivers ~70% of the change with zero markup edits.*
2. **Screenshot pass** — walk every route (copy-builder, flows, planner, promotions, dashboard/campaigns, dashboard/flows, copy-performance, reports, lifecycle, login) and note anything that reads wrong.
3. **Fix hardcoded colors.** Many components use raw Tailwind slate/indigo (`text-slate-400`, `bg-indigo-50`, `border-slate-200`) rather than tokens — `SectionBuilder.tsx`, `SectionBlock.tsx`, `RegenerateModal.tsx` are known offenders. Replace with token utilities; these are exactly the places that will otherwise stay cool-grey and look broken against warm surfaces. **Grep for `slate-`, `indigo-`, `amber-`, `red-` in `src/components` and `src/app`.**
4. **Button variant audit** (§4.1) — demote non-creating primaries.
5. **Elevation pass** (§4.2) and **nav refinement** (§4.3).
6. **Accessibility check** — verify contrast: `--color-ink-tertiary` (#6E675C) on `--color-surface` ≈ 5.5:1 ✓; `--color-ink-muted` (#8A8275) on white ≈ 3.5:1 — **body text must not use muted**, decorative/micro only. White on `--color-accent` (#1C7A4A) ≈ 4.8:1 ✓. Run the `design:accessibility-review` skill if available.

---

## 6. Acceptance criteria

- No component uses raw `slate-*` / `indigo-*` Tailwind color classes; all color comes from tokens.
- Chrome, canvas, surface, and sunken are visibly distinct when screenshotted side by side.
- Cards cast a visible shadow; modals are clearly above cards.
- Exactly one green primary button per view, and it always creates something.
- `.t-label` renders sentence case; all-caps appears only via `.t-micro` on table/nav group heads.
- Inter is self-hosted through `next/font` with no external font request; numerics are tabular in metric columns.
- Charts use the categorical data palette, with text labels alongside color.
- Contrast: all body/label text ≥ 4.5:1; `--color-ink-muted` never used for body copy.
- Dashboards, the copy canvas, planner, and modals all still function identically — this is a re-skin, not a re-layout.
- `build`, `typecheck`, `lint` pass.

## 7. Out of scope
- Dark mode (the token structure supports adding it later; not now).
- Layout/IA changes, new components, or moving features (Evernote principle 1).
- The marketing-style illustration/pattern work from Evernote's website refresh — that's brand, not product UI.

---

## Sources
- [Evernote — Designing the future: interface upgrades for 2024](https://evernote.com/blog/new-ui-2024) (four design principles; Inter typeface rationale; dark-sidebar/focus reasoning)
- [Evernote UI Redesign — Diego Collo for Bending Spoons (Dribbble)](https://dribbble.com/shots/23375473-Evernote-UI-Redesign)
- [Redesigning Evernote for iOS — Evernote Design (Medium)](https://medium.com/evernote-design/redesigning-evernote-for-ios-2c72d8dce419) (green reserved for create actions)
- [Evernote unveils interface overhaul — AlternativeTo](https://alternativeto.net/news/2024/1/evernote-unveils-interface-overhaul-for-enhanced-user-experience-and-modern-look)
