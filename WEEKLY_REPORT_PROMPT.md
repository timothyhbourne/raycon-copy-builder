# Task: Weekly Email + SMS Performance Report — Northbeam-attributed, auto-run each week

You are working in the `raycon-copy-builder` Next.js app (Next 16, React 19, App Router, Tailwind v4). Read `AGENTS.md` first — this is NOT the Next.js you know; verify App Router route/handler conventions (and cron/route-segment config) in `node_modules/next/dist/docs/` before writing routing code.

## Why we're building this

Every week the CRM team reports email + SMS performance to the whole company, and it's assembled by hand from three tools: **Northbeam** (attribution — the source of truth for channel revenue), **Klaviyo** (email — recipients), and **Postscript** (SMS — recipients). We're going to capture those numbers automatically once a week and compute a small, trustworthy set of figures so the report is ready before the meeting instead of stitched together manually.

**The report answers, for the reporting week:**

Email (Klaviyo, as attributed in Northbeam under a 1-day click window):
1. Email revenue.
2. Email revenue as a % of total store revenue.
3. Email revenue per recipient (see the dedicated section — the current method is flawed and we're redefining it).

SMS (Postscript, as attributed in Northbeam under a 1-day click window):
4. SMS revenue.
5. SMS revenue as a % of total store revenue.
6. SMS revenue per recipient.

Plus week-over-week deltas for each, because "up or down from last week" is the first thing anyone asks.

## Decisions already locked (build to these)

- **Attribution basis:** Northbeam, **1-day click** window, for all revenue numbers. Northbeam is the single source of truth for revenue; Klaviyo/Postscript are used **only for recipient counts**. Do not use Klaviyo-attributed revenue anywhere in this report.
- **Denominator (total store revenue): Shopify / store actual.** Not Klaviyo's Placed Order metric. See "Total store revenue" below for the recommended pragmatic source.
- **Email/SMS revenue = the Klaviyo / Postscript figure as shown in Northbeam.** The exact Northbeam breakdown page + the exact channel/platform labels are the one thing that must be confirmed against the live account (see "OPEN ITEMS TO CONFIRM").
- **Delivery:** auto-run weekly (scheduled). The job computes the week's numbers and persists a snapshot; a lightweight read-only view renders the latest snapshot. (A Slack/Docs export is an easy follow-on — noted at the end, not required for v1.)

---

## What already exists (reuse it, don't duplicate)

- `src/lib/klaviyo.ts` — Klaviyo client. Reuse: `campaignValuesReport({ start, end, conversionMetricId })` (returns per-campaign `statistics.recipients`), `resolvePlacedOrderMetric()`, `getAccountTimezone()`, `dayRangeISO(startYMD, endYMD)`, `sumArray()`, `listKlaviyoCampaigns()`. These already handle 429 retries, account-timezone alignment, and pagination-truncation warnings — **do not reinvent recipient fetching.**
- `src/lib/postscript.ts` — Postscript client. Reuse: `isPostscriptConfigured()`, `listPostscriptCampaigns()`, `getPostscriptCampaignMetrics(id)` (returns `recipients`, defensively parsed). SMS has **no opens** — never fabricate one.
- `src/app/api/klaviyo/overview/route.ts` and `src/app/api/planner/sync/route.ts` — reference implementations for how the app already sums campaign recipients over a date window (`byCampaign` accumulation, `t.recipients += r.statistics.recipients ?? 0`, activity filtering). Mirror this shape.
- The env-key fallback pattern in `src/lib/anthropic.ts` (`process.env.X` → parse `.env.local`) — mirror it in the Northbeam client so it behaves consistently in the Claude-desktop dev environment where system env may set keys to `""`.
- The file-store pattern in `src/lib/planner.ts` (`ensureStore`, `readAll`/`writeAll`, safe-id guard, `data/*.json`) — mirror it for the weekly-report snapshot store.
- The dashboard nav pattern in `src/components/AppNav.tsx` and the planner shell in `src/app/planner/layout.tsx` if you add a view.

**Do not touch** the copy-generation prompts, the Planner↔Copy linking work, or the existing Klaviyo/Postscript sync logic beyond importing from it.

---

## Data capture

### 1. Northbeam client — `src/lib/northbeam.ts`

Northbeam's Data Export API is **asynchronous**: you create an export job, poll until it's ready, then download the result file. Build a small typed client mirroring `klaviyo.ts` conventions.

**Auth (two headers, both required):**
```
Authorization: Basic <NORTHBEAM_API_KEY>
Data-Client-ID: <NORTHBEAM_CLIENT_ID>
Accept: application/json
Content-Type: application/json
```
Note: `Authorization: Basic <key>` uses the API key **directly** (Northbeam issues the key already formatted for the Basic header — do not base64-re-encode `user:pass`). Confirm on first live call; if you get 401, try the raw key vs base64 and settle it once.

**Base URL:** `https://api.northbeam.io/v1`

**Flow:**
1. `POST /exports/data-export` with the body below → response includes a `data_export_id`.
2. Poll `GET /exports/data-export/result/<data_export_id>` **once per second** (backstop cap ~60 attempts). A `200 OK` does NOT mean it's ready — check the body:
   - `{ "status": "PENDING", "result": [], ... }` → keep polling.
   - `{ "status": "SUCCESS", "result": ["<link_to_file>"], ... }` → done; `result[0]` is a signed file URL.
   - Any error/failed status → throw with the body snippet (same style as `postscriptFetch`'s error text).
3. `GET` the signed file URL from `result[0]` and parse it (CSV or JSON per the export). Parse **defensively** (like `postscript.ts`'s `pickNum`/fallback keys) since column/field names are not guaranteed stable.

**Request body.** Most values below are **CONFIRMED** by decoding the team's saved Northbeam view (the "Sales" dashboard URL Tim uses). Only the attribution model/window and the exact `/metrics` ids for `rev`/`total_sales` remain to verify.
```jsonc
{
  "level": "platform",              // platform/channel level (matches the "Platform (Northbeam)" breakdown the team uses)
  "time_granularity": "WEEK",       // Mon–Sun week (see scheduling); or DAY and sum
  "period_type": "FIXED",
  "period_options": {                // CONFIRM exact key names against the docs
    "period_starting_at": "<weekStart ISO, Monday>",
    "period_ending_at": "<weekEnd ISO, Sunday>"
  },
  "breakdowns": ["Platform (Northbeam)"],   // ✅ CONFIRMED (decoded from the team's saved view)
  "metrics": [
    { "id": "rev" },                 // ✅ CONFIRMED revenue metric id on the team's page; if /metrics names the export field differently, map to it
    { "id": "txns" },                // transactions — on their page; keep as a sanity check
    { "id": "total_sales" }          // store/Shopify total revenue for the % denominator — NOT on their current page, ADD it. CONFIRM exact id from /metrics
  ],
  "attribution_options": {
    "attribution_models": ["<clicks-only model id from /attribution-models>"],  // ✅ DECIDED: 1-day CLICK ⇒ clicks-only model
    "attribution_windows": ["1"],    // ✅ DECIDED: 1-day click window
    "accounting_modes": ["cash"]     // ✅ CONFIRMED
  }
}
```

> **✅ Attribution basis is DECIDED: strict 1-day click.** Use `attribution_windows: ["1"]` with a **clicks-only** attribution model (get its exact id from `GET /attribution-models`; it is NOT `northbeam_custom__enh`). Note this will differ from the ROAS/CAC columns on the team's saved dashboard view, which are pinned to Northbeam Custom Enhanced — that's expected and intended. Use this same 1-day-click basis for every weekly run so the trend stays comparable.

Export from the client:
```ts
export function isNorthbeamConfigured(): boolean;   // both key + client id present
export interface NorthbeamChannelRevenue {
  emailRevenue: number;      // Klaviyo email, 1d click
  smsRevenue: number;        // Postscript SMS, 1d click
  totalStoreRevenue: number; // see "Total store revenue"
  raw: unknown;              // keep the parsed rows for debugging / audit
}
export async function getWeeklyChannelRevenue(weekStartISO: string, weekEndISO: string): Promise<NorthbeamChannelRevenue>;
```
Internally: create → poll → download → find the Email row and SMS row by matching the confirmed platform labels (case-insensitive, trimmed; centralize the label matching in ONE helper so it's the single place to adjust). If a row is absent for the week, treat that channel's revenue as `0` (not an error) and add a warning.

### 2. Recipients (Klaviyo email + Postscript SMS)

Recipients come from the existing clients, summed over the same week window used for Northbeam.

- **Email recipients:** reuse `campaignValuesReport({ start, end, conversionMetricId: resolvePlacedOrderMetric().id })` inside a `dayRangeISO(weekStartYMD, weekEndYMD)` window (align to `getAccountTimezone()` exactly as `overview/route.ts` does). Sum `statistics.recipients` across campaigns that had activity in the window. Surface the report's `truncated` flag as a warning (same as elsewhere).
- **SMS recipients:** if `isPostscriptConfigured()`, list campaigns, filter to those sent in the window (`send_time` within the week), and sum `getPostscriptCampaignMetrics(id).recipients`. If Postscript isn't connected, mark SMS recipients unavailable and degrade gracefully (revenue still shows from Northbeam; RPR shows "—").

Keep email/SMS **campaign** recipients and, if cheaply available, **flow/automation** sends separate — the RPR section needs the population to match the revenue population.

### 3. Total store revenue (the % denominator)

Decision is **Shopify / store actual**. The app has no Shopify client today. My recommendation, in order:

- **Recommended (no new integration): use Northbeam's total-sales metric.** Northbeam ingests Shopify orders, so its "total sales / store revenue" metric *is* the store-actual number, and you already have it in the same export call (the `total_sales` metric above). This keeps the denominator store-actual while avoiding a second integration and a second timezone/window to reconcile. **Do confirm** that Northbeam's total-sales for a known week matches the Shopify admin figure within an acceptable tolerance before trusting it (put this in the verification step).
- **Alternative (only if NB total-sales doesn't match Shopify):** add a minimal Shopify Admin API read for order revenue over the week. More correct-by-definition but adds a client, credentials, and a fourth data window to align. Note there's a Shopify connector available in the workspace you can use to *validate* the NB number even if you don't wire Shopify into the app.

Whichever source is used, record which one on the snapshot (`denominator_source: "northbeam_total_sales" | "shopify"`) so the report is self-documenting.

---

## The calculation mechanism

Put all math in a **pure, dependency-free** module `src/lib/reports/weekly.ts` (no fs, no fetch) so it's trivially testable and the capture layer stays separate from the arithmetic. The route/job fetches raw inputs, hands them to this module, and persists the result.

```ts
export interface WeeklyReportInputs {
  weekStartYMD: string; weekEndYMD: string;
  emailRevenue: number; smsRevenue: number;      // Northbeam, 1d click
  totalStoreRevenue: number;                      // store actual
  emailRecipients: number | null;                 // per the RPR definition below
  smsRecipients: number | null;
  denominatorSource: "northbeam_total_sales" | "shopify";
  warnings: string[];
}

export interface ChannelBlock {
  revenue: number;
  pctOfStore: number | null;        // revenue / totalStoreRevenue (0..1); null if denom <= 0
  recipients: number | null;
  revenuePerRecipient: number | null; // null if recipients <= 0 or unavailable
  revenuePer1kSends: number | null;   // readability metric (RPR * 1000)
}

export interface WeeklyReport {
  week: { startYMD: string; endYMD: string; isoWeek: string }; // e.g. "2026-W27"
  email: ChannelBlock;
  sms: ChannelBlock;
  totalStoreRevenue: number;
  denominatorSource: string;
  generatedAt: string;
  warnings: string[];
  wow?: { email: Deltas; sms: Deltas };  // filled by comparing to the previous snapshot
}
```

Rules that keep the numbers honest:
- Every ratio guards its denominator (`> 0` else `null`, rendered "—"). Never emit `NaN`/`Infinity`.
- `pctOfStore` is a fraction internally; format as `%` in the UI only.
- Round only at render time; store full-precision numbers.
- Week-over-week deltas compare against the immediately preceding stored snapshot (absolute + percentage-point change for `pctOfStore`, % change for revenue/RPR). If there's no prior snapshot, omit `wow`.

---

## Revenue-per-recipient: recommended definition (your "advise here")

**Why the current method is flawed.** Today RPR is computed per campaign as `attributed_revenue / recipients` and then effectively read at the channel level. Four problems compound:

1. **Population mismatch.** A channel-level revenue number from Northbeam includes *all* Klaviyo email (flows/automations **and** campaigns), but recipients are counted from campaigns only. Numerator and denominator describe different populations, so the ratio is meaningless.
2. **Attribution mismatch.** Revenue attributed by Klaviyo ≠ revenue attributed by Northbeam (different models/windows). Reporting NB revenue over Klaviyo-implied recipients mixes systems.
3. **Double-counting people.** Summing `recipients` across every campaign in the week counts a subscriber once per send. That's revenue per *send*, not per *person* — but it's labeled as if per person.
4. **Flows aren't campaigns.** Automations have rolling, trigger-based audiences that don't compare to a campaign blast, so folding them into a single RPR hides what's actually happening.

**Recommended definition (make numerator and denominator agree on population + attribution + window):**

> **Email RPR = (Northbeam 1-day-click revenue attributed to Klaviyo _campaigns_ sent in the week) ÷ (total _delivered_ recipients of those same campaigns).**
> **SMS RPR = (Northbeam 1-day-click revenue attributed to Postscript _campaigns_ sent in the week) ÷ (total delivered SMS recipients of those campaigns).**

Concretely:
- **Campaigns only, both sides.** Exclude flows/automations from *both* the revenue numerator and the recipient denominator. This is the apples-to-apples number the team actually wants ("what did this week's sends return per message"). Report flow revenue separately in the headline total if desired, but keep it out of RPR.
- **"Delivered," not "targeted."** Use delivered/sent recipients (what Klaviyo's `statistics.recipients` / Postscript's recipients report), not audience size.
- **Label it precisely: "revenue per email sent" (per delivery), not "per subscriber."** We cannot dedupe a person across multiple sends without identity-level data, so don't imply uniqueness.
- **Also show revenue per 1,000 sends (eRPM/“per 1k”).** RPR values like `$0.38` are hard to feel; `$380 per 1k emails` reads better in a team meeting. Compute both, show whichever the team prefers.
- **Same week window, same 1-day-click attribution** for numerator and denominator, every week, so the trend line is comparable.

**Data requirement + fallback.** This requires Northbeam revenue broken out at the **campaign level** (by campaign / UTM `campaign`), not just channel level. If the account's Northbeam setup can isolate campaign-vs-flow revenue (via the breakdown or UTMs), use the definition above. **If it can't**, fall back to a clearly-labeled **program-level RPR** = (all NB email revenue) ÷ (all delivered emails, flows + campaigns), and label it "program revenue per send (incl. flows)" so no one mistakes it for campaign performance. Record which mode was used on the snapshot (`rpr_mode: "campaign" | "program"`). Decide the mode once, after confirming what the Northbeam breakdown supports (see OPEN ITEMS).

---

## Persistence

`src/lib/reports/weekly-store.ts`, mirroring `planner.ts`:
- Store at `data/weekly-reports.json` as an array of `WeeklyReport`, keyed by `isoWeek`.
- `upsertWeeklyReport(report)` (replace same-week), `listWeeklyReports()`, `getWeeklyReport(isoWeek)`, `getLatestWeeklyReport()`, `getPreviousWeeklyReport(isoWeek)` (for WoW).
- Safe-id/`ensureStore` guards like the planner store. This file persists on the user's disk, so the team keeps a running history for free.

---

## Scheduling (auto-run weekly)

The app is a Next.js app; use a cron-triggered route.

- Route: `GET /api/reports/weekly/run?week=<isoWeek?>` (defaults to the just-finished week). It: resolves the week window → captures Northbeam revenue + recipients + total store revenue → computes via `weekly.ts` → fills WoW from the prior snapshot → `upsertWeeklyReport`. Returns the computed report JSON.
- Protect it with a shared secret: require `Authorization: Bearer <CRON_SECRET>` (or `?key=`); reject otherwise. Never leave it open.
- Schedule via `vercel.json` cron (if deployed on Vercel), e.g. Monday 13:00 UTC to report the previous Mon–Sun week. Verify the current cron config format in the Next/Vercel docs before writing it. If not on Vercel, document the equivalent external scheduler curl.
- Also expose a manual trigger (a "Run now" button on the view, POST to the same handler with the secret server-side) so the team can regenerate on demand.
- **Week definition:** decide and document Mon–Sun vs Sun–Sat, in the Klaviyo account timezone (reuse `getAccountTimezone()`), and keep it identical to the window handed to Northbeam so all three sources line up.

---

## Minimal view (read-only)

Add `src/app/reports/page.tsx` (+ a `layout.tsx` matching the planner shell, and a "Report" entry in `AppNav.tsx`). It fetches the latest snapshot from `GET /api/reports/weekly` (a read endpoint listing/serving snapshots) and renders:
- Week label + generated-at + which denominator/RPR mode was used.
- Two blocks (Email, SMS), each: revenue, % of store, revenue per send (+ per-1k), recipients, and WoW deltas (green up / red down).
- The `warnings` (truncation, Postscript not connected, missing NB row) shown as an unobtrusive banner, same style as the planner's sync summary.
- A week picker to view historical snapshots.
Keep the styling consistent with the dashboard/planner (mono uppercase labels, slate palette, `Intl.NumberFormat` currency/percent helpers already used in `planner/page.tsx`).

---

## Config / env additions (`.env.local`, mirror existing commented style)

```
# Northbeam (attribution) — server-side only.
NORTHBEAM_API_KEY=
NORTHBEAM_CLIENT_ID=89574596-2232-4ac4-a31d-4adf38d20c77  # Data-Client-ID header (from the team's dashboard URL — confirm it's the API client id too)
# Confirmed from the team's saved "Sales" view; defaults below are strong but verify against a live breakdown row:
NORTHBEAM_ATTRIBUTION_MODEL_ID=  # clicks-only model id from /attribution-models (DECIDED: 1-day click — NOT northbeam_custom__enh)
NORTHBEAM_ATTRIBUTION_WINDOW=1   # ✅ 1 = 1-day click (decided)
NORTHBEAM_EMAIL_PLATFORM_LABEL=Klaviyo    # email row in the "Platform (Northbeam)" breakdown — confirm exact casing live
NORTHBEAM_SMS_PLATFORM_LABEL=Postscript   # SMS row — confirm exact casing live
NORTHBEAM_ACCOUNTING_MODE=cash            # ✅ confirmed
# Cron protection for the weekly run route.
CRON_SECRET=
```
Read them via the same `process.env.X || parse(.env.local)` fallback used in `anthropic.ts`.

---

## Work items, in order

1. `src/lib/northbeam.ts` — client (auth, create/poll/download, defensive parse, `getWeeklyChannelRevenue`, `isNorthbeamConfigured`). Ship a tiny script or temporary route to dump one live export so the field/label mapping can be confirmed, then lock the label helper.
2. Recipient capture helpers (email via `campaignValuesReport`, SMS via Postscript), windowed + timezone-aligned like `overview/route.ts`.
3. Total store revenue via Northbeam `total_sales` (recommended) with the source recorded.
4. `src/lib/reports/weekly.ts` — pure calc + WoW. Add unit tests for the guards (zero denominators, missing channel, WoW with/without prior).
5. `src/lib/reports/weekly-store.ts` — snapshot store.
6. `GET /api/reports/weekly/run` (secret-protected) + `GET /api/reports/weekly` (read) + `vercel.json` cron.
7. `src/app/reports/` view + `AppNav` entry.
8. Edge-case hardening + verification.

## Edge cases

- **Northbeam export never reaches SUCCESS** within the poll cap → fail the run with a clear error; do not persist a partial snapshot. The manual "Run now" lets them retry.
- **Missing channel row** (no email or no SMS that week) → that channel's revenue = 0, add a warning, still compute the rest.
- **Postscript not connected** → SMS revenue still comes from Northbeam, but SMS recipients/RPR show "—" with a warning (don't block email).
- **Klaviyo report truncated** → surface the truncation warning; recipients may undercount.
- **Zero / tiny total store revenue** → `pctOfStore = null`, render "—".
- **NB total-sales ≠ Shopify** beyond tolerance → warn and note the discrepancy; consider the Shopify Admin fallback.
- **First-ever run** → no prior snapshot, omit WoW cleanly.
- **Auth/format ambiguity** on the Basic header → resolve once on first live call and hard-code the correct form with a comment.

## Verification / acceptance

1. **Live capture:** with real Northbeam creds, a run for a known past week returns non-zero email + SMS revenue matching (within rounding) what the team sees on the Northbeam page they use, under the 1-day click window. This is the gate — the whole report is only as good as this match.
2. **Denominator sanity:** the total-store-revenue figure matches the Shopify admin total for that week within an agreed tolerance (validate using the Shopify connector). If not, switch to the Shopify fallback.
3. **Percentages:** email% + SMS% are plausible (each < 100%, sum sane) and recompute by hand from the stored raw numbers.
4. **RPR:** numerator and denominator cover the *same* population (campaign-only if `rpr_mode: campaign`); the label matches the mode; per-1k matches RPR × 1000.
5. **WoW:** a second run for the following week shows correct deltas vs the first snapshot.
6. **Scheduling:** the cron route rejects without the secret, accepts with it, and produces the same result as a manual run.
7. **Degradation:** with Postscript unset, email still reports fully and SMS RPR shows "—" with a warning.
8. **Build:** `npm run build` clean; no server-only imports leaking into the client view; `weekly.ts` stays pure.

---

## OPEN ITEMS — status after decoding the team's saved view

**✅ CONFIRMED (decoded from Tim's Northbeam "Sales" dashboard URL):**
- Breakdown dimension: **`"Platform (Northbeam)"`**.
- Revenue metric id: **`rev`** (page also shows `txns`, `spend`, `roas`, `cac`, `ecr`, `avgTouchpointsPerOrderNew`).
- Accounting mode: **cash**.
- Client id (URL path): **`89574596-2232-4ac4-a31d-4adf38d20c77`** → `Data-Client-ID`.
- Email/SMS rows: **`Klaviyo`** (email) and **`Postscript`** (SMS) — strong defaults; confirm exact casing on a live breakdown row.
- Week definition: **Monday–Sunday**.
- Attribution basis: **strict 1-day click** (`attribution_windows: ["1"]` + clicks-only model, cash).

**⛔ STILL TO CONFIRM (small lookups, not decisions):**
1. The **clicks-only model id** from `GET /attribution-models` (to pair with the 1-day window). The basis itself is decided — this is just fetching the id string.
2. **`total_sales` metric id** from `GET /metrics` for the % denominator — it is NOT on the team's current page, so it must be added to the export (validate NB total-sales ≈ Shopify actual for a known week).
3. Whether Northbeam can split **campaign-vs-flow** revenue for this account (via the breakdown / UTMs) → sets `rpr_mode` to `campaign` (preferred) or `program` (fallback).
4. The **Basic auth header** exact form (raw key vs base64) — settle on the first 401/200.
5. The saved view also carries a **`quickFilterId`** (`89f95496-…`). Reading the two platform rows directly makes it unnecessary, but confirm the quick filter isn't silently changing the attribution window on the page (which would inform item 1).
