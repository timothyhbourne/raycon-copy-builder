# Copy Performance — "What Actually Works" Spec

**Status:** Ready to implement
**Area:** Measurement (new tab under the **Measure** nav group)
**Goal:** Close the generate → send → measure loop. Join the copy we *wrote* (angle, conceit, campaign type, structure, occasion) to what it *earned* (revenue-per-recipient), so the team can see which creative choices actually drive revenue instead of guessing.

---

## 1. Why

The app can write copy (Copy Builder, SMS, Flows) and measure results (live dashboard, planner per-campaign metrics), but the two halves don't talk. Nobody can currently answer "do offer-led or story-led angles earn more?", "does adding a reviews section lift RPR?", or "which conceit architecture wins for winback?". This view answers those by correlating copy attributes with per-campaign revenue.

**The good news:** the join already exists in the data. A **planner row** is the hub — it links the written copy (`copy_campaign_id`) to the sent Klaviyo campaign (`klaviyo_campaign_id`) and already stores that campaign's synced metrics (`revenue`, `revenue_per_recipient`, `recipients`, `open_rate`, `click_rate`, `northbeam_revenue`). This feature is mostly an **analytical read + aggregation** over stores that already exist and are Redis-durable. No new data pipeline.

---

## 2. Ground rules

1. **Next.js 16** (middleware is `proxy`; read `node_modules/next/dist/docs/` before routing changes). Keep TypeScript `strict`; no `any`.
2. **This is a read-only analytics view.** It must not mutate planner rows, saved campaigns, or library entries. The only write-ish action allowed is triggering the *existing* planner metrics sync (§7).
3. **Reuse existing building blocks:** the planner store (`src/lib/planner.ts`), the saved-campaign store (`src/lib/campaigns.ts`), the library store (`src/lib/library.ts`), the `DateRangePicker`, and the `ui/` primitives (`Card`, `Stat`, `FilterBar`, `Skeleton`, `EmptyState`). Do not re-fetch from Klaviyo for the numbers — the planner rows are the metrics source of truth (§4).
4. **Secrets stay server-side** (only relevant if you add the optional refresh in §7).

---

## 3. The join model (the crucial part)

For each **sent** campaign, we assemble one "performance record" by walking these keys — all durable in Redis:

```
PlannerRow  (src/lib/planner.ts — listPlannerRows())
  ├─ isEffectivelySent(row) === true        → it actually went out
  ├─ metrics on the row                     → recipients, revenue, revenue_per_recipient,
  │                                            open_rate, click_rate, northbeam_revenue
  ├─ copy_campaign_id  ──────────────►  SavedCampaign  (loadCampaign(id), src/lib/campaigns.ts)
  │                                        → campaign_type, angle, chosen_conceit{name,architecture},
  │                                          occasion, promotion_id, send_stage, urgency, audience,
  │                                          offer, promo_code, section_structure, campaign.meta.subject_lines
  ├─ klaviyo_campaign_id                    → the Klaviyo send (for optional live re-fetch only)
  └─ channel, offer_type, audience_included, planned_send_at, klaviyo_send_time
```

**Fallback for attributes:** if `copy_campaign_id` doesn't resolve (draft pruned), fall back to the **LibraryCampaign** joined by `planner_row_id` (`getLibraryCampaigns()` → find where `planner_row_id === row.id`). The library carries fewer dimensions (`campaign_type`, `conceit` name, `structured.section_structure`, `hero_angle`) but enough to keep the record in most aggregates.

**Attribution / coverage transparency (required):** a sent row may have metrics but **no linked copy** (written outside the app, or never linked). Do NOT drop these silently — bucket them as **"unattributed"** and show, prominently, `unattributed_revenue` and `attributed_coverage = attributed_campaigns / sent_campaigns`. If coverage is low, the insights are unreliable and the UI must say so.

---

## 4. Metrics (measures)

Per performance record, read **from the planner row** (already synced by `/api/planner/sync`):
- `recipients`, `open_rate`, `click_rate`, `revenue`, `revenue_per_recipient` (platform/Klaviyo basis), `northbeam_revenue`, `metrics_synced_at`.

**Primary KPI: revenue-per-recipient (RPR).** Ranking by *total revenue* is confounded by audience size — a mediocre email to a huge list beats a great one to a small segment. RPR is the fair comparison and must be the default sort/aggregate everywhere.

**Revenue basis toggle (do not mix):** a single control switches all numbers between:
- **Platform (Klaviyo):** `revenue` / `revenue_per_recipient` on the row.
- **Northbeam (clicks-only, cash):** `northbeam_revenue`; derive `northbeam_rpr = northbeam_revenue / recipients`.
Never average across bases in one number. Default to **Platform** (broadest coverage); note Northbeam is the reconciled "truth" but its per-row coverage may be partial. Records missing the chosen basis are excluded from that basis's aggregates (and counted as "no data").

---

## 5. Dimensions (what we correlate)

Group/segment the records by these copy attributes (primary source SavedCampaign; note the source):

| Dimension | Source | Values |
|---|---|---|
| Campaign type | SavedCampaign `campaign_type` | promo / launch / restock / story / seasonal / winback / newsletter |
| Angle | SavedCampaign `angle` | offer_led / product_led / story_led / occasion_led |
| Conceit architecture | SavedCampaign `chosen_conceit.architecture` | offer_led / story_led / product_truth_led |
| Send stage | SavedCampaign `send_stage` | launch / reminder / last_call |
| Urgency tier | SavedCampaign `urgency` | 1 / 2 / 3 |
| Occasion kind | SavedCampaign `occasion` / `promotion_id` | promo-calendar occasion vs flash sale vs none |
| Offer type | PlannerRow `offer_type` | evergreen vs promo |
| Audience | SavedCampaign `audience` (+ real segment names from row `audience_included`) | all / engaged / lapsed / post_purchase / vip |
| Structure signature | SavedCampaign `section_structure` | ordered section-type string, e.g. `header→body→usps→footer_cta`; also boolean flags: includes `reviews`? `product_grid`? `product_card_review`? |
| Channel | PlannerRow `channel` | email / sms (always separate — never pool RPR across channels) |

Subject-line style (length, has number/%, emoji, question vs statement) is **v2** — see §11 — because the app generates 3 subject lines but Klaviyo decides which one ships, and the sent line isn't captured yet.

---

## 6. New API route

Create **`src/app/api/copy-performance/route.ts`** — `GET ?start=YYYY-MM-DD&end=YYYY-MM-DD&channel=email|sms|all&basis=platform|northbeam`.

Logic:
1. `listPlannerRows()`; keep rows where `isEffectivelySent(row)` and `planned_send_at` (or `klaviyo_send_time`) falls in `[start, end]`, filtered by `channel`.
2. For each kept row, resolve attributes: `loadCampaign(row.copy_campaign_id)`; else library-by-`planner_row_id`; else mark `unattributed`.
3. Build a flat array of **performance records** `{ row_id, name, channel, send_date, recipients, rpr, revenue, northbeam_revenue, northbeam_rpr, open_rate, click_rate, attributes{...}, attribution_source: "saved"|"library"|"unattributed" }`.
4. Compute **aggregates** server-side per dimension for the chosen `basis`: for each dimension value → `{ n, mean_rpr, median_rpr, total_revenue, total_recipients }`. Also top-level: `sent_count`, `attributed_count`, `attributed_coverage`, `unattributed_revenue`.
5. Return `{ records, aggregates, coverage, range, basis }`. Validate params with the shared `YMD_RE`; `400` on bad input.

`export const dynamic = "force-dynamic";` No Klaviyo calls on this path — pure store reads, so it's fast.

Add a request/response shape to `src/lib/validation/` (zod), consistent with the codebase's boundary-validation pattern.

---

## 7. Metrics freshness (optional refresh)

Records use the metrics already synced onto planner rows. Add a single **"Refresh metrics"** button that POSTs to the **existing** `/api/planner/sync` (it re-pulls Klaviyo + Northbeam per-row for sent rows), then re-reads. Do not build a new sync. If a row shows `metrics_synced_at` that's stale or null, surface a small "not synced yet" note rather than treating 0 as real.

---

## 8. Page / UI

Mount a new page in the **Measure** nav group (`src/components/AppNav.tsx`), e.g. `href: "/dashboard/copy-performance"`, label **"What Works"** (or "Copy Performance"). Reuse the just-built `DateRangePicker` for the range (default **month-to-date**, same as the live dashboard) plus the channel and basis toggles via `FilterBar`/`SegmentedToggle`.

Layout, top to bottom:
1. **Coverage banner** (only if coverage < ~80%): "Showing N of M sent campaigns — $X of revenue isn't attributed to app-written copy, so treat these as directional."
2. **Insight panels** — a small grid of "RPR by <dimension>" cards for the highest-signal dimensions (Angle, Conceit architecture, Campaign type, Structure includes-reviews, Send stage). Each shows the ranked values with mean RPR, n, and total revenue; visually flag any value with `n` below the min threshold (§9) as "low confidence."
3. **The record table** — every sent campaign as a row: name, send date, channel, recipients, RPR (primary, sortable desc), revenue, and its key attributes as chips (angle, conceit, type, structure). Sortable by any column; default sort RPR desc. Unattributed rows shown at the bottom, visually muted, excluded from panels.
4. Empty state via `EmptyState` when no sent+linked campaigns exist in range.

Loading: `Skeleton` while the (fast) fetch runs. Keep the visual language identical to the live dashboard.

---

## 9. Statistical honesty (required, not optional)

Small numbers of campaigns make averages noisy. Enforce:
- A **minimum-n threshold** (default `n >= 3`) below which a dimension value is shown but clearly marked "not enough data — directional only," and excluded from any "winner" highlighting.
- Show **n and total revenue** next to every mean RPR, always. Never show a mean without its sample size.
- Prefer **median** alongside mean where n is small (one whale campaign skews the mean).
- **Never pool across channels** (email vs SMS have different RPR scales) or across revenue bases.
- Don't imply causation. Labels say "associated with higher RPR," not "causes."

---

## 10. Edge cases

- Sent row, metrics present, no linked copy → **unattributed** bucket (counts toward coverage, excluded from attribute aggregates).
- Linked copy, metrics null / not synced yet → excluded from aggregates; shown as "pending sync" in the table.
- SavedCampaign missing but Library entry exists → use library attributes (`attribution_source: "library"`, fewer dimensions).
- SMS rows: `open_rate` is null by design — don't render 0; RPR still valid (often manual-entered metrics — respect `metrics_source: "manual"`).
- Chosen basis missing on a record (e.g. no `northbeam_revenue`) → excluded from that basis's aggregates, surfaced as "no NB data."
- Same copy linked to multiple rows → treat each sent row as its own record (a resend is a real, separate data point).

---

## 11. Phasing

**v1 (buildable today):** everything in §3–§10 — the join, the read route, the record table, RPR-by-dimension panels, coverage transparency, min-n guards, refresh button.

**v2 (later):**
- **Sent subject-line correlation.** Capture the actually-sent subject line (fetch from Klaviyo via `klaviyo_campaign_id` → campaign message, or store the chosen line at link time), then correlate subject-line style features with open rate and RPR.
- **AI "what's working" summary** (pairs with the dashboard-briefing idea): a short generated readout of the strongest and weakest associations in the current range.
- **Holdout / A-B awareness:** if two variants were sent to comparable audiences, show head-to-head lift — the payoff for the flow drop-off experiment idea.

---

## 12. Files

**Create**
- `src/app/api/copy-performance/route.ts` — the read + aggregation route (§6).
- `src/app/dashboard/copy-performance/page.tsx` — the view (§8). (Path per nav decision.)
- Zod shapes in `src/lib/validation/` for the route response.
- Optional: `src/lib/copy-performance.ts` for the join + aggregation logic (keep it pure/testable and unit-test it — this is exactly the kind of deterministic logic the audit said to cover).

**Edit**
- `src/components/AppNav.tsx` — add the "What Works" item to the Measure group.

**Do not touch**
- Planner/saved-campaign/library write paths, the Klaviyo client, the live measurement route.

---

## 13. Acceptance criteria

- A new "What Works" tab appears under Measure, defaults to month-to-date, and loads fast (pure store reads, zero Klaviyo calls on the default path).
- The table lists every sent, linked campaign in range with its attributes and RPR, sortable; unattributed sends are shown separately and excluded from the insight panels.
- Insight panels rank RPR by angle, conceit architecture, campaign type, structure(includes-reviews), and send stage — each showing n and total revenue, with low-n values flagged.
- The Platform/Northbeam basis toggle switches all numbers consistently and never mixes bases; the channel toggle never pools email and SMS.
- A coverage figure is always visible; when coverage is low the directional warning shows.
- "Refresh metrics" re-runs the existing planner sync and re-reads; it does not introduce a new sync path.
- The join + aggregation module has unit tests (min-n handling, basis selection, unattributed bucketing, per-channel separation).
- `npm run build`, `typecheck`, and `lint` pass; no `any` introduced.

---

## 14. Out of scope
- Any change to how metrics are synced (reuse `/api/planner/sync`).
- Live Klaviyo calls for the numbers (planner rows are the source).
- Subject-line-sent tracking, AI summaries, and holdout analysis (all v2).
- Editing copy or planner data from this view — it's read-only.
