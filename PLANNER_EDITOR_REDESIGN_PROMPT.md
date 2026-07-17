# Planner Editor Redesign — status model, cleaner editor, Klaviyo audience auto-fetch

You are reworking the Campaign Planner's row editor and status system in `raycon-copy-builder` (Next 16, React 19, Tailwind v4). Read `AGENTS.md` first — this is NOT the Next.js you know. The app has a design-token layer and UI primitives in `src/components/ui/` (Button, Chip, Drawer, Modal, Toast, Skeleton) — use them, don't hand-roll.

## Scope

Files you will touch: `src/lib/planner-types.ts`, `src/lib/planner.ts`, `src/app/planner/page.tsx`, `data/campaign-planner.json` (via read-time backfill only — never a manual data rewrite), one new API route under `src/app/api/planner/` or `src/app/api/klaviyo/`, and `src/lib/klaviyo.ts` (additive only). Do NOT touch the copy-builder, dashboard, reports, or metrics-sync systems.

---

## Step 1 — New status model

Replace the planner statuses in `src/lib/planner-types.ts`:

- OLD: `"idea" | "draft" | "scheduled" | "sent" | "cancelled"`
- NEW: `"writing_brief" | "planned" | "scheduled_in_klaviyo" | "cancelled"`

Display labels: "Writing brief", "Planned", "Scheduled in Klaviyo", "Cancelled". Keep the type name `PlannerStatus` and the `PLANNER_STATUSES` array so imports don't break.

**Migration** — follow the repo's read-time backfill idiom (see how `lib/planner.ts` already backfills legacy fields on read; add to that, never bulk-edit the JSON file):
- `idea` → `writing_brief`
- `draft` → `planned`
- `scheduled` → `scheduled_in_klaviyo`
- `sent` → `scheduled_in_klaviyo`
- `cancelled` → `cancelled`

**"Sent" is now derived, not stored.** Anywhere the code previously checked `status === "sent"` (metrics sync eligibility in `src/app/api/planner/sync/`, table filters, the planner↔copy-builder link in `lib/planner-copy-link.ts` if it references status), replace with a helper in `planner-types.ts`:

```ts
export function isEffectivelySent(row: PlannerRow): boolean {
  return row.status === "scheduled_in_klaviyo" && new Date(row.planned_send_at).getTime() < Date.now();
}
```

Grep for every usage of the old status literals (`"idea"`, `"draft"`, `"sent"`, `"scheduled"` in planner contexts) and update each one deliberately. The metrics-sync eligibility rule becomes: row has a link key AND (`isEffectivelySent(row)` OR past `planned_send_at`) — i.e. behavior unchanged in practice.

## Step 2 — Status-driven calendar pills

In the calendar view (`src/app/planner/page.tsx`), campaign entries are currently colored by channel. Change to **status-driven** styling so scheduling state is visible without opening the editor:

- `writing_brief` — neutral: slate-100 background, slate-600 text, slate-200 border.
- `planned` — soft indigo tint: indigo-50 background, indigo-700 text, indigo-200 border.
- `scheduled_in_klaviyo` — the one the user asked for by name: **transparent green** — emerald-50/70 background (semi-transparent), emerald-700 text, emerald-300 border. Add a small check glyph (✓, inline SVG or text) before the name.
- `cancelled` — muted and struck: slate-50 background, slate-400 text, line-through on the name.

Keep the channel signal as the small colored dot inside the pill (email = indigo dot, sms = emerald… change sms dot to amber so it can't be confused with the scheduled-green). Use the `Chip` primitive if it fits; otherwise a local pill component with token classes. Apply the same status colors to the status chips in the table view for consistency.

## Step 3 — Row editor redesign (the Drawer)

The editor is the `Drawer` starting around line 675 of `src/app/planner/page.tsx`. Rebuild its content. Design intent: **clean, minimal, elegant** — generous whitespace, hairline separators, no visual clutter, no boxes-within-boxes.

**Typography** (stay within the existing DM Sans / JetBrains Mono pairing — no new fonts, no serif):
- Campaign name at the top as the title: `text-xl`, DM Sans, `font-medium`, `tracking-tight` — rendered as a borderless input that looks like a heading (subtle bottom border on hover/focus only).
- Field labels: `text-[11px]` mono uppercase `tracking-wider` in muted ink — but use them SPARSELY; group related fields under one label where obvious.
- Field values/inputs: `text-sm`, generous line height, borderless-until-hover where it works (EditableField-style), otherwise the standard token input.
- Section separation: a single hairline (`border-t` line color token) with `pt-5 mt-5` — no cards, no background tints.

**Hierarchy (exact order, top to bottom):**
1. **Name** (title-style input) with the channel shown as a small chip beside it.
2. **Status** — a segmented control (one row of 4 options: Writing brief / Planned / Scheduled in Klaviyo / Cancelled). Selected segment fills with that status's pill color from Step 2. One click to change — this is the "toggle" the user asked for. Changing status saves with the row (existing upsert), and the calendar pill updates on close.
3. **Planned send** (datetime input, existing behavior).
4. **Offer** (offer type toggle + offer text + promo code — compact single group).
5. **Klaviyo campaign link** — moved UP from wherever it currently sits to directly after Offer. The existing campaign picker/typeahead, restyled to match. When linked, show the campaign name + a small external-link anchor to `https://www.klaviyo.com/campaign/{id}` and an "Unlink" ghost button.
6. **Audiences** (see Step 4 — auto-fetched, not manually picked).
7. **Notes / learnings** (textarea, minimal).
8. Footer: Save (primary) / Delete (danger ghost) / synced-metrics summary line if present — right-aligned, single row.

Remove from the visible layout anything not listed above (metrics fields stay read-only wherever they're currently shown in the drawer — if present, render them as a quiet single line under the footer, mono, muted). Keep ALL existing save/delete/sync handlers and the row data shape working — this is a re-skin plus reorder, not a data change (except audiences, Step 4).

## Step 4 — Auto-fetch audiences from the linked Klaviyo campaign

Replace the manual audience include/exclude pickers with automatic population:

**4a. Klaviyo client (`src/lib/klaviyo.ts`, additive).** The campaigns response already exposes `attributes.audiences.included` (ids) — extend the parsed shape to also read `audiences.excluded`. Add a helper `getCampaignAudiences(campaignId)` that: fetches the single campaign (`GET /campaigns/{id}/` — verify the retrieve endpoint + fields against the docs pattern already used in `fetchCampaignsByIds`), reads `audiences.included` / `audiences.excluded` id arrays plus `status`, then resolves ids to names using the existing `listSegments()` + `listLists()` helpers (both cached-per-call; fetch them once inside the helper). Return `{ status, included: AudienceRef[], excluded: AudienceRef[] }`, where unresolvable ids come back as `{ id, name: "(unknown audience)", type: "segment" }` rather than being dropped.

**4b. API route.** `src/app/api/planner/audiences/route.ts` — GET with `?campaign_id=`, returns the helper's result. Same auth posture as the other planner routes. Cache per campaign id in-process for 10 minutes (audiences of a scheduled campaign rarely change).

**4c. Editor behavior (in the Drawer).**
- When a Klaviyo campaign is linked AND its Klaviyo status is scheduled/sending/sent: fetch audiences on link (and on drawer open if the row has a link but empty audiences), write the names into `audience_included` / `audience_excluded` on the row (persisted via the normal upsert, so the table view and metrics keep working), and render them as read-only chips with a tiny "from Klaviyo" mono micro-label. Show a skeleton line while fetching.
- When the linked campaign is still a Klaviyo draft: render the audiences section BLOCKED — muted text "Audiences appear when the campaign is scheduled in Klaviyo." No manual picker.
- When NO campaign is linked: same blocked state with "Link a Klaviyo campaign to pull audiences."
- SMS rows (no Klaviyo link concept): keep whatever the current SMS behavior is, but visually consistent with the blocked state.
- Remove the manual audience picker UI entirely; keep the `AudienceRef[]` fields on the row (they're now machine-written). Legacy rows with manually-entered audiences keep displaying them (read-only) until a fetch overwrites them.
- A fetch failure must not break the drawer: toast a warning, leave existing values.

## Step 5 — Consistency sweep

- Table view: status column uses the new labels + Step 2 colors; status filter dropdown lists the 4 new statuses; any "sent" filter option becomes "Sent" backed by `isEffectivelySent`.
- Planner → Copy Builder handoff (`lib/planner-copy-link.ts`, `/api/copy-seed`): confirm nothing references removed statuses.
- `npm run build` must pass. Grep the whole repo for the old status literals to confirm zero remaining planner references (the SavedCampaign copy system has its own separate "draft"/"final" statuses — do NOT touch those).

## Step 6 — Verify

1. Open a legacy row of each old status → confirm the mapped status shows and saving persists the new value.
2. Toggle a row to "Scheduled in Klaviyo", close the drawer → calendar pill is transparent green with a check, without a reload.
3. Link a scheduled Klaviyo campaign → audiences populate with real segment/list names within a second or two; a draft campaign shows the blocked message.
4. Metrics "Sync metrics" still fills recipients/open rate/etc. for effectively-sent rows.
5. Screenshot-level sanity: drawer shows exactly the Step 3 order, no leftover manual audience picker, typography per spec.

Commit in this order: (1) status model + migration + sweep, (2) calendar/table status styling, (3) drawer redesign, (4) audience auto-fetch. Note any deviation explicitly in your summary rather than improvising silently.
