# Task: Planner ↔ Copy Builder linking — turn "plan it, write it, track it" into one workflow

You are working in the `raycon-copy-builder` Next.js app (Next 16, React 19, App Router, Tailwind v4). Read `AGENTS.md` first — this is NOT the Next.js you know. **Before writing any routing / `useSearchParams` / Suspense code, verify the current App Router conventions in `node_modules/next/dist/docs/`.** The client-side deep-link reading (`useSearchParams`) is the one place Next 16 will bite you (it must sit inside a `<Suspense>` boundary), so confirm that pattern in the docs before you build it.

## Why we're building this

The app is three good tools that don't know about each other. The **Planner** (`/planner`) is where the CRM team decides *what* ships and *when*. The **Copy Builder** (`/copy-builder`) is where they write it. The **Dashboard** (`/dashboard`) is where they see how it did. Today, moving from a planned row to written copy means re-typing the campaign name, offer, promo code, and audience by hand into a blank brief, and once copy exists the planner has no idea it happened.

This feature closes that loop:

1. **Plan it** — a row exists in the Planner (already works).
2. **Write it** — click the row → land in the Copy Builder with the brief already filled in (deterministic fields mapped, plus AI-suggested products + hero angle), review, generate.
3. **Track it** — saving the copy stamps the planner row so it shows "copy drafted / final", links straight back to the draft, and nudges the row's status forward.

The result should feel like one product, not three tools sharing a sidebar.

## Product decisions already made (build to these)

- **Prefill + AI smart-fill, then stop.** Clicking a row prefills the brief and uses AI to *propose* the two fields the planner doesn't carry — featured products and a hero angle — shown as fully editable suggestions. It does **not** auto-run generation. The human reviews and hits Generate. (Rationale below.)
- **Full round-trip.** One-way prefill PLUS write-back. Saving copy links the planner row to the saved campaign and advances its status.
- **Email rows only.** The Copy Builder writes email copy. SMS rows get no copy action.

---

## The core problem: the two data models only partially overlap

This is the crux of the whole feature. Read `src/lib/planner-types.ts` (`PlannerRow`) and `src/lib/schemas.ts` (`BriefInput`) side by side.

A `PlannerRow` carries:
`name`, `channel`, `offer_type` (`evergreen` | `promo`), `offer`, `promo_code`, `planned_send_at`, `status`, `audience_included` / `audience_excluded` (real Klaviyo **segments/lists** as `AudienceRef[]`), `notes`, link ids + synced metrics.

A `BriefInput` needs:
`campaign_name`, `campaign_type` (7-value enum), `offer`, `promo_code`, `audience` (**5-value enum**: `all` | `engaged` | `lapsed` | `post_purchase` | `vip`), `hero_angle` (**required**, the creative core), `products_featured` (SKU ids, e.g. `E45`), `section_structure`, `campaign_specific_rules`, `tone_dial`.

The mismatches you must handle:

| BriefInput field | Source in PlannerRow | Strategy |
|---|---|---|
| `campaign_name` | `name` | direct copy |
| `offer` | `offer` (or `EVERGREEN_OFFER` when `offer_type === "evergreen"`) | direct/derived |
| `promo_code` | `promo_code` | direct copy |
| `campaign_type` | — (no equivalent) | keyword heuristic on `name`/`offer`, default `promo`; AI may override |
| `audience` (enum) | `audience_included` (free-form segments) | keyword map to the enum, default `all`; carry the real segment names into the hero-angle context so nothing is lost |
| `hero_angle` (required) | — (not in planner) | **AI-suggested**, seeded with `notes` + plan context; editable |
| `products_featured` | — (not in planner) | **AI-suggested** from name/offer/notes against the catalogue; editable |
| `section_structure` | — | `DEFAULT_SECTION_STRUCTURE` |
| `tone_dial` | — | default `1` |

Because `products_featured` and `hero_angle` are exactly the inputs that make or break output quality and the planner has neither, **we never silently auto-generate.** We prefill, let AI take a first pass at the two gaps, and hand control to the writer.

---

## What already exists (reuse it, don't duplicate)

- `src/lib/planner-types.ts` — `PlannerRow`, `AudienceRef`, `EVERGREEN_OFFER`, statuses. Extend here.
- `src/lib/planner.ts` — file-backed CRUD (`upsertPlannerRow` merges and **preserves synced metrics**; `getPlannerRow`, `writeSyncedMetrics`). Add the link writer here.
- `src/app/api/planner/route.ts` — planner CRUD API (`POST` requires `name` + `channel`).
- `src/lib/schemas.ts` — `BriefInput`, `SavedCampaign`, `DEFAULT_SECTION_STRUCTURE`, `SECTION_CATALOGUE`.
- `src/lib/products.ts` — `PRODUCT_CATEGORIES`, `PRODUCT_NAME_BY_ID`, `VALID_PRODUCT_IDS`, `getProductName`. Use `VALID_PRODUCT_IDS` to validate any AI-suggested SKU.
- `src/lib/campaigns.ts` — `SavedCampaign` file store (frontmatter + JSON body). Add `planner_row_id` passthrough here.
- `src/lib/data.ts` — `getBrandContext()` + `buildSystemBlocks()` (prompt-caching aware). Reuse for the smart-fill call.
- `src/lib/anthropic.ts` — `getAnthropic()`, `MODEL` (Sonnet, final copy), `FAST_MODEL` (Haiku — use this for smart-fill).
- `src/app/api/brief/route.ts` — **copy this exact pattern** for the new smart-fill route (Haiku, `buildSystemBlocks`, strip ```` ```json ````, `JSON.parse`, `max_tokens` guard).
- `src/components/InputForm.tsx` — brief form. Holds its own state, hydrated from `localStorage["raycon_brief_draft"]`. Does **not** accept initial values yet — you'll add a `seed` prop.
- `src/app/copy-builder/page.tsx` — the Copy Builder page. Restores an in-progress canvas from `localStorage["raycon_canvas_draft"]` on mount and jumps to the canvas; has `handleLoadSaved(id)`, `handleSaveDraft`, `handleSaveFinal`. Wire the deep-links + write-back here.
- `src/app/planner/page.tsx` — planner UI (`TableView`, `CalendarView`, `RowEditor`). Add the entry points here.
- `@hello-pangea/dnd` already wired in the planner — don't disturb drag-reschedule.

**Do not touch** the metrics sync (`/api/planner/sync`, `writeSyncedMetrics`), the Klaviyo/Postscript clients, or the copy-generation prompts.

---

## Work items, in priority order

### 1. Extend the types (the link keys)

In `src/lib/planner-types.ts`, add to `PlannerRow` (all optional so existing rows backfill cleanly — the store's `backfillRow` will simply leave them `undefined`):

```ts
// --- Copy Builder link (Planner ↔ Copy Builder) ---
// Set when a Copy Builder campaign has been written for this planned send.
copy_campaign_id?: string;          // SavedCampaign id in /generated
copy_status?: "draft" | "final";    // mirrors the saved campaign's status
copy_linked_at?: string | null;     // ISO, last time copy was linked/updated
```

In `src/lib/schemas.ts`, add to both `BriefInput` and `SavedCampaign`:

```ts
/** Back-reference to the Planner row this campaign was written for (if any). */
planner_row_id?: string;
```

`BriefInput` does not otherwise change shape; `planner_row_id` just rides along so the save handlers can persist it.

### 2. Shared mapping lib: `src/lib/planner-copy-link.ts`

Pure, no fs/server imports (importable from client and server). This is the single home for the deterministic half of the mapping so both the copy-builder page and the smart-fill route agree.

Export:

```ts
import type { PlannerRow } from "./planner-types";
import type { BriefInput, CampaignType, AudienceType } from "./schemas";

/** Deterministic PlannerRow → partial BriefInput. No AI. Never throws. */
export function plannerRowToBriefSeed(row: PlannerRow): Partial<BriefInput>;

/** Keyword heuristics (exported for reuse + unit testing). */
export function inferCampaignType(row: PlannerRow): CampaignType; // default "promo"
export function inferAudience(row: PlannerRow): AudienceType;     // default "all"
```

Rules:

- `campaign_name = row.name`
- `offer = row.offer_type === "evergreen" ? EVERGREEN_OFFER : row.offer`
- `promo_code = row.offer_type === "promo" ? row.promo_code : undefined`
- `campaign_type` via `inferCampaignType`: match `name`+`offer` case-insensitively — `launch` → `launch`; `restock`/`back in stock` → `restock`; `winback`/`win back`/`we miss you` → `winback`; `newsletter` → `newsletter`; anything with a promo/`% off`/`sale` → `promo`; else default `promo`.
- `audience` via `inferAudience`: scan `audience_included[].name` + `row.name` — `vip`/`loyal` → `vip`; `engaged`/`active`/`opener` → `engaged`; `lapsed`/`winback`/`churn`/`inactive` → `lapsed`; `post purchase`/`post-purchase`/`buyer`/`customer` → `post_purchase`; else `all`.
- `section_structure = DEFAULT_SECTION_STRUCTURE`
- `tone_dial = 1`
- `products_featured = []` (filled by AI in step 3)
- Do **not** set `hero_angle` here (AI fills it; leave it to step 3/UI).
- `planner_row_id = row.id`

Keep the heuristics small and readable; they're a starting point the AI and the human both refine.

### 3. Smart-fill route: `POST /api/copy-seed`

Model this file on `src/app/api/brief/route.ts` exactly (Haiku via `FAST_MODEL`, `buildSystemBlocks(getBrandContext(), roleInstruction)`, strip code fences, `JSON.parse`, `max_tokens` guard, `try/catch` → `{ error }` 500).

Request body: `{ row: PlannerRow }` (or the minimal fields: name, offer_type, offer, promo_code, audience segment names, notes, planned_send_at, channel).

Put the role instruction + user prompt in a new `src/lib/prompts/copy-seed.ts`. The prompt asks the model, using the product catalogue already in the cached system block, to return **strict JSON only**:

```json
{
  "products_featured": ["E45"],        // 1–3 valid SKU ids from the catalogue
  "hero_angle": "…",                    // 2–4 sentences of INTENT, not final copy
  "campaign_type": "promo",             // one of the 7 enum values
  "audience": "engaged",                // one of the 5 enum values
  "rationale": "one short line"         // why these products/angle (shown as a hint)
}
```

Prompt requirements:
- `products_featured` MUST be a subset of the real catalogue SKU ids. **Validate server-side against `VALID_PRODUCT_IDS` and drop anything invalid**; if the model returns none valid, return `[]` (the UI handles the empty case).
- `hero_angle` must describe intent/hook/feeling (mirroring the guidance in `InputForm`'s hero-angle helper text), reference the offer and the planned moment, and **obey the hard rules** (no em dashes, no banned phrases) since it seeds the writer. Fold `row.notes` in if present.
- `campaign_type` / `audience`: the model may confirm or override the deterministic guesses; still coerce to valid enum values server-side, falling back to the `plannerRowToBriefSeed` values.
- Keep `max_tokens` modest (this is a small structured response).

The endpoint returns `{ seed: Partial<BriefInput>, rationale: string }` where `seed` is `plannerRowToBriefSeed(row)` merged with the validated AI fields (AI wins for `products_featured`, `hero_angle`, and confirmed `campaign_type`/`audience`). Doing the merge server-side keeps the client dumb.

**Degrade gracefully:** if the AI call fails, return `{ seed: plannerRowToBriefSeed(row), rationale: "", ai_failed: true }` with HTTP 200 so the handoff still works (products empty, hero angle blank, user fills them). Never let a smart-fill failure block "Write copy".

### 4. `InputForm` accepts a `seed`

In `src/components/InputForm.tsx`, add an optional prop:

```ts
interface Props {
  onSubmit: (input: BriefInput) => void;
  loading: boolean;
  seed?: Partial<BriefInput> | null;      // from a planner handoff
  seedLabel?: string | null;              // e.g. planner row name, for the banner
  onClearSeed?: () => void;
}
```

Behavior:
- On mount, if `seed` is present it **takes precedence** over the `localStorage["raycon_brief_draft"]` hydration: set `form = { ...DEFAULT_FORM, ...seed }`. Strip invalid product ids from the seed the same way the existing hydration does (`VALID_PRODUCT_IDS`).
- If `seed` arrives/changes after mount (deep-link resolves async), apply it then too (effect keyed on a stable seed identity — e.g. `planner_row_id`, not object identity, to avoid loops).
- Continue persisting edits to `raycon_brief_draft` as today, so a seeded-then-edited brief survives refresh.
- Render a small banner above the form when seeded: **"Prefilled from planner: {seedLabel}"** with a subline noting products + hero angle were AI-suggested — review before generating — and a "Clear" link calling `onClearSeed` (which resets to `DEFAULT_FORM` and drops the seed). Match the app's existing chip/mono-label styling (`font-mono text-xs uppercase tracking-wide`, slate/amber palette).

Accept the tradeoff that a deliberate planner handoff overwrites any unsaved blank-brief draft; the banner + Clear make it recoverable-in-spirit.

### 5. Copy Builder deep-links + write-back (`src/app/copy-builder/page.tsx`)

**Read the params.** Support two:
- `?planner=<rowId>` — start a new seeded brief from a planner row.
- `?campaign=<savedId>` — open an existing saved campaign (reuse `handleLoadSaved`).

Use `useSearchParams()`. **Per Next 16 App Router, `useSearchParams` must be inside a `<Suspense>` boundary** — verify the exact pattern in `node_modules/next/dist/docs/` and wrap the page (or a small child that reads the params) accordingly. Don't guess.

**On `?planner=<rowId>`:**
1. Fetch the row: `GET /api/planner?id=<rowId>`. If missing → toast/error, fall through to a normal empty form.
2. Guard the canvas auto-restore: if a `raycon_canvas_draft` exists AND a planner param is present, **do not** silently jump to the canvas. Show a confirmation ("You have an unsaved campaign. Start the planner brief? / Keep working") reusing the existing dialog style. If they keep working, ignore the param. If they start the brief, proceed and leave the canvas draft in storage (don't destroy it).
3. Set stage to `form`.
4. Call `POST /api/copy-seed` with the row. While it's in flight, seed the form immediately with the deterministic `plannerRowToBriefSeed(row)` (so the name/offer show instantly) and show a subtle "suggesting products & hero angle…" state; when the response lands, merge the AI seed in. If `ai_failed`, show a quiet "AI suggestions unavailable — add products and a hero angle to continue."
5. Store planner link context in page state: `{ rowId, name, channel }` (needed for write-back). Persist it alongside the canvas draft in `raycon_canvas_draft` so it survives the generate→save cycle and a refresh.
6. Pass `seed`, `seedLabel={row.name}`, and `onClearSeed` into `InputForm`. Clearing the seed also clears the stored planner link context.
7. Clean the URL after consuming the param (`router.replace("/copy-builder")`) so a refresh doesn't re-seed over the user's edits.

**On `?campaign=<savedId>`:** call `handleLoadSaved(savedId)`; clean the URL after.

**Write-back on save.** In `handleSaveDraft` and `handleSaveFinal`:
1. Include `planner_row_id` (from the stored link context, or `currentBriefInput.planner_row_id`) in the `SavedCampaign` payload so it's persisted.
2. After a successful save, if there's a linked planner row, call the new link endpoint (step 6):
   `POST /api/planner/link` with `{ row_id, copy_campaign_id: <savedId>, copy_status: "draft" | "final" }`.
3. Fire-and-forget with error logging — a write-back failure must **not** surface as a copy-save failure (the copy is already saved). Optionally show a tiny "linked to planner ✓".

### 6. Link endpoint + store writer

Add to `src/lib/planner.ts`:

```ts
export function linkCopyCampaign(
  rowId: string,
  copyCampaignId: string,
  copyStatus: "draft" | "final",
): PlannerRow | null;
```

It reads the row, and merges in `copy_campaign_id`, `copy_status`, `copy_linked_at = now`, bumps `status` from `idea` → `draft` **only if currently `idea`** (never downgrade `scheduled`/`sent`), and `updated_at = now`. Leave all plan + synced-metric fields untouched (same discipline as `writeSyncedMetrics`). Also add an `unlinkCopyCampaign(rowId)` that clears the three copy fields (used to heal stale links, step 8).

New route `src/app/api/planner/link/route.ts`:
- `POST { row_id, copy_campaign_id, copy_status }` → validate `copy_status ∈ {draft, final}`, call `linkCopyCampaign`, return `{ row }` or 404. Keep it separate from the main planner `POST` so we don't have to send `name`/`channel` just to attach a link.

Thread `planner_row_id` through `src/lib/campaigns.ts` (add to the frontmatter map in `campaignToMarkdown` — remember the `undefined → null` coercion the file already does — and read it back in `markdownToCampaign`) and through `src/app/api/campaigns/route.ts` + `src/app/api/finalize/route.ts` so it round-trips on save/load. When a saved campaign with a `planner_row_id` is re-opened and re-saved, the write-back should still fire.

### 7. Planner UI entry points (`src/app/planner/page.tsx`)

**Recommended placement (advised): both, email-only.**
- **Primary in `RowEditor`** (most discoverable while editing), placed near the Klaviyo-link field.
- **Inline affordance on the table row** for one-click access without opening the modal. Keep the calendar clean (a tiny dot/badge only — no button — to avoid clutter in the small cells).

Behavior, gated to `channel === "email"`:
- **Unlinked** (`!copy_campaign_id`): show **"Write copy"** → navigate to `/copy-builder?planner=<row.id>`.
- **Linked** (`copy_campaign_id` set): show a small **copy status chip** ("Copy: draft" / "Copy: final", reuse the `StatusPill` styling family) and an **"Open copy"** action → `/copy-builder?campaign=<copy_campaign_id>`.
- SMS rows: render nothing for copy.

In the table, add these to the **Name cell** (so you don't have to widen the `GRID` template) as a subtle secondary line or trailing icon-link; make sure clicking the copy action calls `e.stopPropagation()` so it doesn't also open the row editor (the row `onClick` opens edit). In `RowEditor`, make it a proper button row item.

Use `next/link` or `useRouter().push` consistent with how the app already navigates (`AppNav` uses `next/link`).

### 8. Edge cases (handle explicitly)

- **Stale `copy_campaign_id`** (the saved campaign was deleted): "Open copy" would 404. When the planner loads, or when "Open copy" fails, treat a missing campaign as unlinked — offer "Write copy" again and call `unlinkCopyCampaign`. Simplest robust approach: on `handleLoadSaved`/`?campaign=` miss, show "That draft no longer exists" and don't crash.
- **Row deleted mid-write:** write-back `POST /api/planner/link` returns 404 → log, ignore (copy is safe).
- **Old planner rows** without the new fields: `undefined` everywhere → they render as unlinked. No migration needed (the file store backfills on read).
- **Smart-fill returns junk SKUs:** already filtered by `VALID_PRODUCT_IDS` server-side.
- **`?planner=` while an unsaved canvas exists:** confirmation dialog (step 5.2); never silently discard.
- **Double-seed on refresh:** URL is cleaned after consumption (step 5.7) so refresh won't re-apply the seed over edits.
- **Audience info loss:** the real Klaviyo segment names don't fit the 5-value enum — make sure they survive by folding them into the AI hero-angle context, so the writer still sees "this is going to the VIP + lapsed-openers segments."

---

## Suggested build order

1. Types (`planner-types.ts`, `schemas.ts`) — step 1.
2. `planner-copy-link.ts` + a couple of quick unit sanity checks on the heuristics — step 2.
3. `linkCopyCampaign` / `unlinkCopyCampaign` + `/api/planner/link` — step 6.
4. `campaigns.ts` + `/api/campaigns` + `/api/finalize` passthrough of `planner_row_id` — step 6.
5. `/api/copy-seed` + `prompts/copy-seed.ts` — step 3.
6. `InputForm` `seed` prop + banner — step 4.
7. Copy Builder deep-links + write-back + Suspense boundary — step 5.
8. Planner entry points — step 7.
9. Edge-case hardening — step 8.

## Acceptance criteria / verification

Verify end to end, not just per-file:

1. **Forward, happy path:** create an email planner row (e.g. "Fitness Earbuds summer push", promo, code `SUMMER20`, segment "Engaged 90d"). Click **Write copy** → Copy Builder opens on the form, prefilled: name, offer, promo code present; `campaign_type`/`audience` inferred sensibly; **products and hero angle populated by AI and editable**; banner shows "Prefilled from planner: …". Generate works normally.
2. **Smart-fill degradation:** temporarily force `/api/copy-seed` to throw → handoff still lands on a usable prefilled form (deterministic fields only), with a quiet "add products and a hero angle" note. No crash, no blocked flow.
3. **Track it (write-back):** from that seeded brief, generate and **Save Draft** → return to `/planner` → the row shows **"Copy: draft"** and an **Open copy** link; if the row was `idea` it's now `draft`; a `scheduled`/`sent` row keeps its status. **Save Final** later flips the chip to **"Copy: final"**.
4. **Open copy round-trip:** click **Open copy** → the exact saved campaign loads on the canvas.
5. **Deep-link integrity:** refresh after seeding does not re-apply the seed over edits (URL was cleaned); `?campaign=<id>` opens the right saved campaign.
6. **Guards:** with an unsaved canvas present, `?planner=` prompts before replacing; a deleted saved campaign shows "no longer exists" and the row heals to unlinked; SMS rows show no copy action.
7. **No regressions:** planner drag-reschedule, metrics **Sync**, dashboard, and existing copy save/load all still work. Synced metric fields on a row are never wiped by a link write.
8. **Build:** `npm run build` is clean (watch for the `useSearchParams`/Suspense requirement and any server/client import boundary violations from `planner-copy-link.ts`).

## Guardrails

- Reuse existing patterns and styling (mono uppercase labels, slate/amber palette, existing modal/dialog components). Don't introduce a new visual language.
- Keep `planner-copy-link.ts` free of server-only imports so it's safe on the client.
- The smart-fill hero angle passes through the writer — it must obey `data/hard-rules.md`. If in doubt, keep it short and intent-only.
- Don't expand the planner `POST` contract; use the dedicated `/api/planner/link` route for attaching copy.
- Don't touch the metrics sync path.
