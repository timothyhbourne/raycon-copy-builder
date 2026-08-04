# Task: Campaign Planner v2 — promote to its own feature, add drag-to-reschedule, Klaviyo-connected audiences, an offer toggle, fix Sync Metrics, and polish the table

You are working in the `raycon-copy-builder` Next.js app (Next 16, React 19, App Router, Tailwind v4). Read `AGENTS.md` first — verify App Router route/layout conventions in `node_modules/next/dist/docs/` before adding routes.

The Campaign Planner already exists as a **tab inside the dashboard** at `src/app/dashboard/planner/page.tsx`, backed by `src/lib/planner.ts`, `src/lib/planner-types.ts`, `src/app/api/planner/route.ts` (CRUD), `src/app/api/planner/sync/route.ts` (metrics sync), and `src/lib/postscript.ts`. `@hello-pangea/dnd` is already a dependency — use it for drag-and-drop. Do not touch the unrelated `SavedCampaign` email-copy system.

Work items below, in priority order.

## 1. Promote the Planner to its own top-level feature (out of the dashboard)
The dashboard (`/dashboard`) should be **performance only** (Flows + Campaigns). The Planner becomes its own feature in the left rail.
- Create a new route group `src/app/planner/` with its own `layout.tsx` (matching the dashboard's shell: `max-w-6xl` container, header) and move the planner UI there as `src/app/planner/page.tsx`. Delete `src/app/dashboard/planner/page.tsx` and remove the Planner entry from the dashboard's tab toggle so `/dashboard` only toggles Flows/Campaigns.
- Add a Planner item to `src/components/AppNav.tsx` `FEATURES` (e.g. `{ href: "/planner", label: "Plan", sublabel: "ner" }` or "Cal"/"endar" — pick a clean 2-line label consistent with the existing "Copy/Builder", "Dash/board").
- Update any imports (`../format`, `../types`) now that the file moved; keep the shared helpers importable (move or re-export as needed).

## 2. Drag-and-drop to reschedule campaigns
Use `@hello-pangea/dnd`.
- **Calendar view (primary):** each day cell is a `Droppable`; each campaign entry is a `Draggable`. Dropping an entry on a different day updates that row's `planned_send_at` to the new date while **preserving the original time-of-day**. Persist via the existing planner POST (upsert). Optimistically move the entry, and roll back + show an error if the save fails.
- **Table view:** rows are grouped/sorted by `planned_send_at`; allow dragging a row to change its date too (e.g. drag between date groups, or a simpler inline date control if grouped DnD is awkward — your call, but dragging must persist the new date). 
- Keep click-to-edit working (drag vs click must not conflict — use a drag handle or a movement threshold).

## 3. Offer toggle: evergreen vs promo
Add `offer_type: "evergreen" | "promo"` to `PlannerRow` in `planner-types.ts`.
- Define a constant `EVERGREEN_OFFER = "20% off"` (the standing offer).
- In the row editor, add a segmented toggle: **Evergreen (20% off)** vs **Custom promo**. When evergreen, hide the promo-code field, set `offer` to `EVERGREEN_OFFER`, and null out `promo_code`. When promo, show both `offer` and `promo_code` inputs.
- Table + calendar display accordingly (e.g. "Evergreen · 20% off" vs "PRIME · 20% off sitewide").
- Backfill existing rows in `lib/planner.ts` on read: no `offer_type` → `"promo"` if `promo_code` present, else `"evergreen"`.

## 4. Connect Klaviyo segments/lists for audience include/exclude
Stop free-typing audiences; pick from real Klaviyo audiences so naming stays consistent and searchable.
- In `src/lib/klaviyo.ts`, add `listSegments()` and `listLists()` (GET `/segments/` and `/lists/`, paginated via `links.next` like `listFlows`, routed through `klaviyoFetch`). Return `{ id, name, type: "segment" | "list" }`.
- Add `src/app/api/klaviyo/audiences/route.ts` (GET) returning the combined, de-duplicated list, cached in-process (audiences change rarely; ~10 min TTL is fine).
- Change `audience_included` / `audience_excluded` in `PlannerRow` from `string[]` to `Array<{ id: string; name: string; type: "segment" | "list" }>`. Backfill existing string entries on read to `{ id: "", name: <string>, type: "segment" }` so old rows don't break.
- In the editor, replace the two comma-separated text inputs with a **searchable multi-select** (typeahead filter over the fetched audiences, click to add, chip to remove) for both include and exclude. No new UI library — build a lightweight combobox with an input + filtered dropdown, matching the slate/mono style.
- Table renders the chip names (same as today, `+ included` / `− excluded`).
- If the audiences fetch fails or Klaviyo is unreachable, fall back to letting the user free-type a name (degrade gracefully, don't block saving).

## 5. Fix "Sync metrics" (currently returns "Synced 0" silently)
Root causes in `src/app/api/planner/sync/route.ts` today:
- (a) It matches `report.byId.get(row.klaviyo_campaign_id)` and **silently `continue`s** when there's no match — so a mistyped/wrong id, or a campaign with no email activity in the window, produces zero feedback.
- (b) The report window is `min(planned_send_at) → today`. If a row's `planned_send_at` is later than the campaign's real send date (or set in the future), the window misses the actual send and returns nothing.
- (c) `isSyncable` requires `status === "sent"` OR `planned_send_at <= now`, so a linked row still marked "idea"/"scheduled" with a future planned date is filtered out entirely.

Fix all three, and make the mechanism reliable:
- **Link via a searchable Klaviyo campaign picker**, not a pasted id. In the editor (email channel), add a typeahead backed by `listKlaviyoCampaigns()` (already exists — returns id, name, status, send_time). Selecting a campaign stores its `klaviyo_campaign_id` **and** captures the real `send_time`/`status`. Keep manual id entry as a fallback. This eliminates wrong-id errors. (For confirmation: the id after `/campaign/` in a Klaviyo campaign URL is the API campaign id and should match `groupings.campaign_id` in the values report — verify once against a live campaign.)
- Build the report window from the **linked campaign's real `send_time`** (send date − 1 day → today), not from `planned_send_at`, so post-send conversion accrual is captured and the window can't miss the send.
- Make a row **syncable** if it is linked AND its linked campaign's `send_time` is in the past, regardless of the local `status`.
- Return **per-row sync results** (`{ id, matched: boolean, reason?: "not_sent_yet" | "no_activity_in_window" | "not_linked" }`) and surface them in the UI so the user sees exactly why a row didn't sync instead of a bare "Synced 0". Keep the existing `postscript_connected` and `warnings` reporting.
- Do the same picker treatment for SMS/Postscript where feasible (`listPostscriptCampaigns()` exists); if Postscript isn't connected, keep manual entry.

## 6. Table UI polish — especially status
- Replace the plain uppercase status text with colored **status pills**. Suggested palette (Tailwind, matching the slate aesthetic): idea → `bg-slate-100 text-slate-600`; draft → `bg-amber-50 text-amber-700 border-amber-200`; scheduled → `bg-indigo-50 text-indigo-700 border-indigo-200`; sent → `bg-emerald-50 text-emerald-700 border-emerald-200`; cancelled → `bg-rose-50 text-rose-700 border-rose-200` (with a subtle strikethrough on the name). Reuse these pills in the calendar entries and the editor too.
- General table cleanup: clearer visual separation between the **plan** columns (name/channel/status/date/offer/audience) and the **performance** columns (recipients/open/click/revenue/rev-per-recip) — e.g. a subtle left border or lighter background on the performance group — so the "results" read as distinct from the "plan". Improve row spacing/hover and align the channel chip + status pill nicely.

## 7. Also fix / add (proactively)
- **Aggregate summary row** at the top or bottom of the table (respecting current filters): total campaigns, total recipients, total revenue, and average open/click rate — the at-a-glance "learnings" view for higher-ups.
- **Confirm before delete** in the editor (small confirm step; deletion is currently one click).
- **Deep link**: once a row is linked, show a small "Open in Klaviyo ↗" link (`https://www.klaviyo.com/campaign/<id>/reports`) so users can jump to the source.
- **Duplicate campaign** action in the editor for recurring sends (clones plan fields, clears synced metrics + link + id, new id).
- **Empty/loading states**: a friendly empty state when there are no campaigns yet, and skeletons while loading.
- Sensible **column sorting** in the table (at least by planned send and revenue).

## Constraints & data migration
- Migrate `PlannerRow` shape changes (`offer_type`, audience objects) with read-time backfill in `lib/planner.ts` so existing saved rows keep working — do not require a manual data wipe.
- Reuse existing helpers (`klaviyoFetch`, `listKlaviyoCampaigns`, `dayRangeISO`, `resolvePlacedOrderMetric`, the planner store, `postscript.ts`). Keep external calls sequential (rate limits) and secrets server-side.
- Match the existing visual language; the only DnD library is the already-installed `@hello-pangea/dnd`.

## Acceptance criteria — verify before reporting done
1. `npm run build` passes; no type errors.
2. Planner is its own left-rail item at `/planner`; `/dashboard` no longer shows a Planner tab and only toggles Flows/Campaigns.
3. In calendar view, dragging a campaign to another day changes its planned send date and persists across reload; time-of-day is preserved. Table drag also re-dates and persists.
4. The offer toggle switches between Evergreen (20% off, no code) and Custom promo (offer + code); existing rows still render correctly.
5. Audience include/exclude are searchable pickers sourced from live Klaviyo segments + lists; selections persist and show as chips; a Klaviyo outage falls back to free-type without blocking save.
6. Linking an email campaign via the picker + clicking "Sync metrics" fills recipients/open rate/click rate/revenue/rev-per-recipient and the numbers match Klaviyo for that campaign; when a row can't sync, the UI states the specific reason. SMS open rate stays "—".
7. Status renders as colored pills in table, calendar, and editor; the performance columns are visually distinct from the plan columns; the summary row totals respect active filters.

Before writing audience and sync logic against Klaviyo, confirm the real response shapes/field names for `/segments/`, `/lists/`, and the campaign-values-report `groupings.campaign_id` against a live call under the current API revision — that's the usual source of back-and-forth.
