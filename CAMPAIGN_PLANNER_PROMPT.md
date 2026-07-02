# Task: Build a Campaign Planner in the dashboard app — a planning calendar + performance/learnings table that merges Klaviyo (email) and Postscript (SMS) data

You are working in the `raycon-copy-builder` Next.js app (Next 16, React 19, App Router, Tailwind v4). Read `AGENTS.md` first — this is NOT the Next.js you know; verify App Router route/layout conventions in `node_modules/next/dist/docs/` before writing routing code.

## Why we're building this
The CRM team currently plans upcoming email + SMS campaigns in a messy Google Sheet, and the VP of marketing wants that sheet enriched with offer, audience segments (inclusion/exclusion), open rate, click rate, revenue per recipient, and notes. A flat spreadsheet mixes forward planning with backward performance and has no views, so it reads as raw data, not a tool. We're replacing it with a **Campaign Planner** inside the existing dashboard app so planning and results live in one place: the CRM team plans there, and higher-ups get a clean calendar of what's shipping plus the learnings from what shipped.

The dashboard already syncs Klaviyo (email). The planner adds a **human planning layer**, a **calendar view**, and a **second data source (Postscript for SMS)**.

## What already exists (reuse it, don't duplicate)
- `src/lib/klaviyo.ts` — Klaviyo HTTP client with `klaviyoFetch` (429 retry), `campaignValuesReport` (returns per-campaign `recipients`, `opens_unique`, `clicks_unique`, `conversion_value`, with a shared email-only `REPORT_CHANNEL_FILTER`), `listKlaviyoCampaigns` (names/status/send_time), `dayRangeISO`, `getAccountTimezone`, the pinned Placed Order metric via `KLAVIYO_PLACED_ORDER_METRIC_ID`. Reuse these for email metrics.
- `src/app/dashboard/` — dashboard feature with a shared client layout and toggleable `/dashboard/flows` and `/dashboard/campaigns` pages. Add the planner as a peer tab/route here, matching the existing segmented-toggle pattern and slate/mono visual style.
- `src/app/api/klaviyo/overview/route.ts` — reference for how Klaviyo data is assembled server-side and cached.
- NOTE: `src/lib/campaigns.ts` / `src/app/api/campaigns/route.ts` handle unrelated local **email-copy drafts** (`SavedCampaign`). The planner is a DIFFERENT concept — do not overload that system; create a separate store.

## Data model
A planner row = one planned campaign. Fields:

**Human-entered (editable, persisted):**
- `id` (slug), `name`, `channel` ("email" | "sms")
- `offer` (e.g. "20% off sitewide"), `promo_code?`
- `planned_send_at` (datetime — drives the calendar)
- `status` ("idea" | "draft" | "scheduled" | "sent" | "cancelled")
- `audience_included` (string[] — segments/lists), `audience_excluded` (string[])
- `notes` / `learnings` (freeform — the VP's "what we learned" column)
- Link keys to pull metrics: `klaviyo_campaign_id?` (email), `postscript_campaign_id?` (sms)

**Synced (read-only, filled from the platform when linked & sent):**
- `recipients`, `open_rate` (email only — SMS has no opens; leave null/`—`, never 0), `click_rate`, `revenue`, `revenue_per_recipient`, `metrics_synced_at`

Persistence: create a file-backed store (a `data/planner/` dir of JSON/markdown rows, or a single `data/campaign-planner.json`), mirroring the repo's existing file-store pattern, with a new `src/lib/planner.ts` (CRUD + safe-id validation like `lib/campaigns.ts`) and a `src/app/api/planner/route.ts` (GET list/one, POST upsert, DELETE). Add a comment noting this is single-process/file-based and should move to SQLite/Postgres if it becomes multi-editor in production.

## Postscript (SMS) integration — NEW
There is no Postscript MCP/connector, so integrate via their REST API with a key the user will provide.
- Add `POSTSCRIPT_API_KEY` to `.env.local` (server-side only — never expose to the client or a client component).
- Create `src/lib/postscript.ts` mirroring the shape of `klaviyo.ts`: a `postscriptFetch` wrapper with auth header + basic retry, a `listPostscriptCampaigns()` (id, name, status, send time), and a metrics fetch returning per-campaign `recipients/sent`, `clicks`/click rate, `revenue`, and `revenue_per_recipient`.
- IMPORTANT: **verify Postscript's current API** (base URL, auth scheme, campaign + analytics endpoints, field names, date filtering, pagination) against Postscript's official API docs before writing the parser — do not assume. Confirm auth is a bearer/API-key header and confirm which endpoint returns campaign-level analytics (recipients, clicks, revenue). SMS has NO opens — do not fabricate an open rate for SMS.
- If the key is missing, degrade gracefully: SMS rows still show plan fields; performance columns show "—" with a small "Postscript not connected" note rather than erroring the whole page.

## Metrics sync
Add `src/app/api/planner/sync/route.ts` (or extend the planner route) that, for each planner row with a link key and `status` sent (or a past `planned_send_at`):
- email → pull from Klaviyo (`campaignValuesReport` / existing helpers), matching on `klaviyo_campaign_id`.
- sms → pull from Postscript, matching on `postscript_campaign_id`.
- Write the synced fields + `metrics_synced_at` back to the store.
Trigger it on-demand from a "Sync metrics" button in the UI. Leave a hook/comment for wiring it to a scheduled task later (the app supports scheduling); don't build the schedule now.
Reuse the existing per-range cache approach so repeated syncs of the same window are cheap, and keep Klaviyo/Postscript calls sequential (rate limits).

## UI — add to the dashboard feature
Add a **Planner** tab alongside Flows/Campaigns (extend the shared dashboard toggle + layout). Two sub-views, toggleable, matching existing styling (slate palette, `font-mono` uppercase micro-labels, rounded white cards; no new UI libraries):

1. **Calendar** (default) — a custom month grid (build it, don't add a calendar dependency). Plot rows by `planned_send_at`. Color/tag by channel (email vs SMS) and show status. This is the higher-up "what's shipping" view. Support prev/next month. Clicking a day/entry opens the row editor.
2. **Table** — every campaign as rows with columns: Name, Channel, Status, Planned send, Offer, Audience (incl/excl), Recipients, Open rate (email only), Click rate, Revenue, Rev/recipient, Notes/Learnings. Filterable by channel, status, and date range. This is the planning + learnings grid that replaces the sheet.
- A row editor (modal or drawer) to create/edit plan fields, set status, paste the Klaviyo/Postscript campaign id to link for metrics, and type notes/learnings. New rows can be created at "idea" stage before any platform campaign exists.
- A "Sync metrics" button that calls the sync route and refreshes.

## Constraints
- Match the existing visual language; no new UI libraries (calendar is hand-built).
- Keep secrets server-side; all Klaviyo/Postscript calls happen in route handlers / server code, never the client.
- Don't touch the `SavedCampaign` email-copy system.
- Handle the two channels' metric differences honestly (no SMS open rate).
- Sequential external calls; reuse existing retry/cache patterns.

## Acceptance criteria — verify before reporting done
1. `npm run build` passes with no type errors.
2. A **Planner** tab appears in the dashboard; toggling Calendar/Table is instant and preserves state.
3. I can create a campaign at "idea" stage, edit all plan fields, and it persists across reloads.
4. Linking an email row to a Klaviyo `campaign_id` and clicking "Sync metrics" fills recipients/open rate/click rate/revenue/rev-per-recipient from Klaviyo; the numbers match the Klaviyo dashboard for that campaign.
5. Linking an SMS row to a Postscript campaign fills recipients/click rate/revenue/rev-per-recipient from Postscript; open rate shows "—" (not 0) for SMS.
6. With `POSTSCRIPT_API_KEY` unset, SMS rows still render plan fields and show a clear "not connected" note instead of erroring.
7. The calendar shows upcoming email + SMS sends on their planned dates, channel-distinguished; the table filters by channel/status/date.

Before writing the Postscript parser and any metric-matching logic, confirm the real Postscript API response shapes and the Klaviyo field names against a live call or the official docs — that's the usual source of back-and-forth.
