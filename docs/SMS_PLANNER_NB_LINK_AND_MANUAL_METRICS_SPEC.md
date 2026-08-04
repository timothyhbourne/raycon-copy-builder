# SMS in the Planner — Northbeam-Linked Revenue + Manual Metrics Entry

Status: ready to implement (nothing applied yet)
Date: 2026-07-23
Companion: `NB_REV_PLANNER_RETROFIT_SPEC.md` (the confirmed Northbeam export recipe — implement that first or together; this spec depends on it).

## The finding that shapes everything

**Postscript's public partner API has no campaign, flow, or analytics endpoints.** Confirmed 2026-07-23 against the complete endpoint index (developers.postscript.io/llms.txt): the API is subscribers, custom events, webhooks, unsubscribe/redact. Nothing else. The existing `src/lib/postscript.ts` calls `GET /campaigns` / `GET /campaigns/{id}` — endpoints that do not exist; the client was written defensively before a key existed and could never have worked. This is why entering any Postscript ID (campaign or flow) into the SMS modal does nothing.

Checked alternatives, all dead ends today: third-party ETL connectors wrap the same public API (no analytics); the internal dashboard API is unsupported and brittle (disqualifying for revenue data). One open avenue **outside this spec**: ask the Postscript CSM whether the account can get partner analytics access or scheduled CSV exports — if that ever lands, a CSV importer can replace the manual entry below without changing the data model.

Consequences:
1. **Attributed revenue for SMS comes from Northbeam** (campaign-level export, platform = Postscript, matched by utm_campaign name) — CONFIRMED working via sandbox probe #2 with the platform selector.
2. **Recipients, click rate, platform revenue, revenue/recipient are manual entry** — Tim has these from the Postscript UI. They must be first-class, typed, formatted fields, not a workaround.

---

## Part 1 — Remove the fiction

- **`src/lib/postscript.ts`:** delete `listPostscriptCampaigns`, `getPostscriptCampaignMetrics`, `getPostscriptCampaign` and the campaign/metrics parsing (`parseCampaign`, `extractMetrics`, `extractList`). Keep `isPostscriptConfigured` only if anything else uses it; otherwise delete the module. Add a header comment pointing at this spec so nobody rebuilds the client against imaginary endpoints.
- **Sync route (`src/app/api/planner/sync/route.ts`):** delete the "SMS → Postscript" pass. SMS platform metrics are manual (Part 3); the sync must NEVER overwrite a manual value. Replace the `postscript_not_connected` / `no_activity_in_window` reasons for SMS rows with `sms_manual` (surfaced in the toast as informational, not an error).
- **SMS modal:** remove/deprecate the `postscript_campaign_id` input (keep the field in the schema for saved-row compatibility, hidden in UI). It linked to nothing.

## Part 2 — Link SMS rows to Northbeam by campaign name

The join key is the **Northbeam-reported campaign name** (utm_campaign of the SMS send), exactly as probed.

- **Schema:** add `northbeam_campaign_name?: string` to the planner row (both channels get it; for email it can default from the linked Klaviyo campaign name, keeping one mechanism).
- **UI (SMS modal):** replace the Postscript-ID field with a **Northbeam campaign picker**: a combo/select populated from the Postscript-platform campaign names Northbeam reported in a recent window, with free-text fallback. Feed it from a small endpoint (`GET /api/planner/northbeam-campaigns?platform=postscript[&start&end]`) that reuses the probe machinery (`runCampaignProbe`'s candidates path, or a thin `listNorthbeamCampaignNames()` wrapper) with a short server-side cache (exports take minutes; cache ~1h, manual refresh param). Picking from the list eliminates typos in the join key.
- **Sync (Northbeam pass):** for SMS rows, match on `(smsLabel, normalize(northbeam_campaign_name))` — replacing the current resolution through the dead `getPostscriptCampaign`. Email rows keep their existing linked-Klaviyo-name resolution. Unmatched still surfaces as `northbeam_unmatched`, never a silent 0.

## Part 3 — Manual metrics entry for SMS rows (Tim's requirements, verbatim honored)

For **SMS rows only**, these four cells in the planner table become click-to-edit inline inputs:

| Field | Entry format | Stored as | Display format |
|---|---|---|---|
| Recipients | whole number ("41,250" or "41250" both accepted) | integer | thousands-separated number (existing number formatter) |
| Click rate | percentage as typed: "2.4" or "2.4%" | fraction 0..1 (`0.024`) | "2.4%" (existing pct formatter) |
| Revenue | dollars: "1,842.50" or "$1842.5" | number (USD) | `money()` — "$1,842.50" |
| Revenue / recipient | dollars, same parsing | number (USD) | `money()` |

Behavior rules:
- **Parsing is forgiving, storage is canonical.** Strip `$ , % spaces` on blur, validate numeric, reject negatives; a bad entry keeps focus with the cell outlined, never silently drops or coerces to 0.
- **Revenue/recipient auto-derives** (`revenue / recipients`) the moment both are present, displayed as a prefilled value that remains manually overridable (Tim sometimes has the platform's own figure). An override sticks; clearing the override re-derives.
- **Click rate is stored as a 0..1 fraction** to match the email rows' `click_rate` — the column formatter is shared, so email (synced) and SMS (manual) render identically.
- **Empty = em dash**, same as today. Zero is a real entered value, distinct from empty.
- **Manual values are sticky:** persisted via a new `PATCH /api/planner/manual-metrics` (row id + partial fields), written with `metrics_source: "manual"` and `metrics_entered_at`. The sync route skips platform-metric writes for any row whose `metrics_source` is `"manual"` (for SMS this is always; the guard makes it structural). The NB rev column is a separate field and keeps syncing regardless.
- **Affordance:** editable cells get a subtle affordance on row hover (e.g. dotted underline / pencil on hover) and a tooltip "Manual entry — from Postscript dashboard". Email rows' cells stay non-editable; their tooltip already implies sync.
- Editing works from the table view directly (primary path, per Tim); the SMS modal shows the same four fields for completeness.

## Acceptance tests

1. SMS row: click Recipients, type "41,250" → displays "41,250"; click rate "2.4%" → displays "2.4%", stored 0.024; revenue "$1,842.5" → "$1,842.50"; rev/recipient auto-fills to "$0.04" and accepts an override.
2. Invalid entry ("abc", "-5") keeps the cell in edit state with an error outline; value unchanged on escape.
3. Run Sync metrics: manual values untouched; NB rev populates for an SMS row whose `northbeam_campaign_name` was picked from the picker; toast shows `sms_manual` info, `northbeam_unmatched` only for genuinely unlinked rows.
4. The picker lists the same Postscript campaign names probe #2's candidates showed for the window.
5. Email rows: no editable cells, no behavior change; typecheck + existing tests pass.
6. Grep confirms no remaining call sites of the deleted Postscript campaign functions.

## Out of scope
- CSV import of Postscript UI exports (future replacement for manual entry if the CSM avenue lands; the `metrics_source` field is already shaped for it — a future importer writes `"postscript_csv"`).
- Any change to email-row syncing or the Klaviyo path.
- Backfilling historical SMS rows (enter manually as needed).
