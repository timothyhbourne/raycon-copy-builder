# Raycon Lifecycle Engine — Master Spec

**Status:** authoritative build spec (supersedes `lifecycle_scoring_model_spec.md` and `lifecycle_activation_design.md`, which remain valid background).
**Owner:** Tim (tharrington@rayconglobal.com) · **Account:** Klaviyo `LuhenE`
**Grounded in:** `shopify_orders_l24m.csv` — 1,808,556 order line-items · 911,466 customers · 1,144,752 orders · 2024-07-24 → 2026-07-24.

---

## 0. TL;DR

Build a daily engine that scores **every** Klaviyo customer into a lifecycle stage using **real Shopify purchase history** (not Klaviyo's stale `expected_date_of_next_order`), then each morning surfaces the **top handful of cohorts worth messaging today** — each with a reason, a size, a recommended message, and a suggested offer — and lets Tim export/create the list in Klaviyo and send. Refreshed daily.

Two headline accuracy corrections already proven from the data:
- **Cadence:** population repurchase cadence is **~95–120 days**, not the 420 we had. (Median 1st→2nd order = 94d; overall median inter-order = 118d.)
- **High-value gate:** 24-month net sales are **median $85 / p75 $119 / p90 $173** — the old `$265` gate sat near the 97th percentile and excluded ~95% of buyers.

And one strategy correction: for this catalog the dominant repeat behavior is **replenishment/upgrade within Earbuds (82% of returners)**, not cross-category — so the engine is **replenishment-first**, cross-sell second.

---

## 1. Product vision — the "Send Today" experience

Tim opens the app in the morning and sees a ranked list of **today's best sends** — e.g. five cards:

> **① Reorder-Due · Earbuds replenishment — 8,400 people**
> Bought earbuds ~60–150 days ago, entering their reorder window, no order since.
> *Send:* "time for a fresh pair / spare tips." *Suggested offer:* 15% off next earbuds or free ear tips.
> `[ Create Klaviyo list ]  [ Export CSV ]  [ Preview audience ]`
>
> **② New Customer · 2nd-order nudge — 3,100 people** …
> **③ VIP Reactivation — 640 people** …
> **④ Churning win-back — 12,900 people** …
> **⑤ Cross-sell · Earbuds → Power Tech — 5,500 people** …

He picks one, clicks **Create list** (or **Export**), builds his campaign in Klaviyo using the recommended angle + offer, and sends. Tomorrow the list is different because the engine re-scored the base overnight and re-ranked the opportunities.

**Design principles** (from dashboard UX research): design for the decision, not the chart; rank by **opportunity value**, not headcount; keep the primary screen to a handful of cards; every card ends in one clear action.

---

## 2. Data foundation & key findings

| Finding | Value | Why it matters |
|---|---|---|
| One-time buyers | **83.2%** (758k of 911k) | Retention / 2nd-order is the biggest lever; upsell pools are smaller by nature |
| Repeat cadence (1st→2nd order) | median **94d** (p25 25 · p75 245 · p90 388) | Sets the reorder trigger window and the P(active) cadence |
| Overall inter-order cadence | median **118d** | Confirms ~3–4 month rhythm |
| 24-mo net sales / customer | p50 **$85** · p75 **$119** · p90 **$173** | Real high-value gate (replaces $265) |
| Hardware ownership | Earbuds 626k · Headphones 174k · Power Tech 168k · Audio 81k | Earbuds-dominant catalog |
| Own exactly 1 hardware category | **85%** | Huge cross-sell headroom |
| Next purchase of Earbuds buyers | **Earbuds 82%** · Headphones 15% · Power Tech 14% · Accessories 13% · Audio 8% | **Replenishment-first**, cross-sell secondary |
| Reorder cumulative | 30d 29% · 90d 49% · 180d 66% · 365d 88% | Early attach spike + main window ~60–180d |

**Valid purchase** = payment status in `paid`, `partially_paid`, `partially_refunded` (exclude `voided`, `expired`, `authorized`, `pending`; treat `refunded` as not-owned). **Non-product categories excluded from ownership:** Delivery Guarantee, Shipping Protection, Extend/clyde protection plans, Fondue Cashback, Software, Subscription, null.

---

## 3. The scoring engine

### 3.1 Signals & data model — REPLACING `expected_date_of_next_order`

**Deprecate** Klaviyo's `predictive_analytics.expected_date_of_next_order` as a scoring input. It is stale (drove the false "Ray is 448d overdue") and absent for ~58% of profiles. **Replace** it with signals derived from Shopify order events, joined to Klaviyo by lowercased email:

| Input | Source (new) | Notes |
|---|---|---|
| `orderCount` (Frequency) | count of distinct valid orders | replaces `historic_number_of_orders` |
| `lastOrderDate` | max order `Day` | the true purchase-recency anchor |
| `firstOrderDate` | min order `Day` / `Customer first order date` | onboarding window |
| `avgDaysBetweenOrders` (cadence L) | mean gap between a customer's orders | per-customer when ≥2 orders |
| `monetary` / CLV | Σ `Total sales` (24-mo net); Klaviyo `total_clv` for lifetime | see §3.3 caveat |
| `ownedProductIds` / categories | order line-item SKUs → catalogue categories | source of truth for affinity |
| `engagementRecencyDays` (R_e) | Klaviyo `last_event_date` | unchanged — reachability/suppression axis |

**Derived purchase signal (the direct replacement):**
```
cadence L      = avgDaysBetweenOrders  (if ≥2 orders)
               = POP_REORDER_MEDIAN (~95d)  (one-time buyers)
expectedNext   = lastOrderDate + L
daysPastReorder= today − expectedNext          # >0 = overdue, from REAL dates
```
This feeds the **existing** P(active) formula unchanged — we are only swapping a stale field for an accurate one. The `scoreProfile(..., {fittedPAlive})` seam is untouched.

### 3.2 P(active) — proxy now, fitted BG/NBD next

- **Phase-1 proxy (transparent):** `P(active) = 0.5 ^ (max(0, daysPastReorder) / L)` — half-life of one purchase cycle. On cadence → 1.0; one cycle overdue → 0.5.
- **Phase-2 fitted (accuracy target):** fit **BG/NBD** (Fader-Hardie-Lee) for statistical **P(alive)** + **Gamma-Gamma** for predicted CLV, using the real transaction histories now available. Inject via `opts.fittedPAlive`; all stage/badge logic identical. This is the "as accurate as it can be" endpoint and removes every remaining reliance on Klaviyo predictive fields.

### 3.3 Corrected constants (evidence-based)

| Constant | Old | New | Basis |
|---|---|---|---|
| `POPULATION_MEDIAN_CADENCE_DAYS` | 420 | **~95–120** (use 95 for one-time fallback, per 1st→2nd median) | order data |
| `HIGH_VALUE_CLV` | $265 | **recompute vs Klaviyo lifetime `total_clv`**; interim $119 (24-mo p75) | order data + Klaviyo |
| P(active) cutoffs | .80 / .50 / .20 | keep, **confirm via backtest (§7)** | to validate |
| Engagement windows | 45 / 90 / 180 / 365 | keep | sunset norms |

> **CLV caveat:** the model gates on Klaviyo lifetime `total_clv`; the $119 above is 24-month Shopify net sales. Pull the Klaviyo CLV distribution during the worker run and set the gate to its p75 to keep it apples-to-apples.

### 3.4 Lifecycle stages — definitions (two-axis, first-match-wins)

Purchase axis (P(active)) sets the stage; engagement axis (R_e) gates the "gone" stages and suppression. Unchanged from the committed model except the inputs now come from real orders.

| Stage | Rule |
|---|---|
| **Suppression-Ready** | R_e > 365d (or never-engaged non-buyer, aged acct) |
| **Lead / Non-Buyer** | 0 orders |
| **New Customer** | ≥1 order, first order ≤ 45d ago |
| **Lapsed / Dormant** | 180 < R_e ≤ 365, or P(active) < 0.20 with engagement cooled (R_e > 45) |
| **Churning / Win-Back** | P(active) < 0.20 but reachable (R_e ≤ 45), or 0.20 ≤ P(active) < 0.50 |
| **VIP Reactivation** | churning **and** high-value **and** reachable (priority) |
| **At-Risk (Disengaging)** | 0.50 ≤ P(active) < 0.80 (≈ one cycle overdue) |
| **Upsell-Ready** | P(active) ≥ 0.80, ≥2 orders, high-value, reachable |
| **Active / On-Track** | P(active) ≥ 0.80, otherwise |

### 3.5 Badges & product affinity (replenishment-first)

Ownership from order line-items → owned categories vs. cross-sell targets. **For this catalog, prioritize replenishment/upgrade within the owned category and accessory attach; treat cross-category as the secondary play.** Badges: `repeat xN` · `single-purchase` · `high value` · `reorder-due` · `VIP at-risk` · `recently re-engaged` · `owns: Earbuds` · `cross-sell: Headphones/Power Tech`. Klaviyo `churn_probability` shown as raw reference only.

---

## 4. The daily recommendation engine — "cohorts to send today"

Each morning, after re-scoring, compute candidate cohorts, rank by opportunity, surface the top 5.

### 4.1 Candidate cohorts

| Cohort | Definition | Primary offer angle |
|---|---|---|
| **Reorder-Due (Replenishment)** | owns Earbuds, last order 60–150d ago, no order since, reachable | Upgrade to newest / spare tips / bundle |
| **New Customer → 2nd order** | 1 order, 14–45d ago | Welcome-back bundle, accessory attach |
| **Cross-Sell** | owns Earbuds, recent (≤120d), missing Headphones **or** Power Tech | Complementary category |
| **At-Risk (just tipped)** | P(active) crossed into 0.50–0.80 this week | Soft re-engagement, social proof |
| **Churning Win-Back** | P(active) < 0.50, reachable | Escalating incentive |
| **VIP Reactivation** | churning + high-value + reachable | Concierge / early access, higher-touch |
| **Lapsed last-chance** | purchase-gone + cooled (R_e 90–365) | Strong final win-back |
| **Suppression cleanup** | R_e > 365 | Single re-permission, then suppress |

### 4.2 Opportunity scoring (ranking the top 5)

```
opportunity = size × expected_conversion × expected_AOV × urgency_weight × freshness
```
- `expected_conversion`: seed from empirical base rates — Reorder-Due uses the reorder curve (≈ share expected to buy in the window); Cross-Sell uses next-best-product rates (~14–15%); refine from live campaign results over time.
- `expected_AOV`: category AOV from order data (Earbuds ≈ $85 median line).
- `urgency_weight`: higher for time-sensitive transitions (reorder window closing, about to hit suppression).
- `freshness`: **fatigue guard** — down-weight profiles messaged in the last N days so the same people aren't surfaced daily.

### 4.3 Offer-suggestion logic (Tim has authority to create offers)

Discount depth scales with need/margin; message angle set by cohort. Suggestions only — Tim approves/creates.

| Cohort | Suggested offer | Depth |
|---|---|---|
| New Customer | Accessory add-on / bundle | none–low |
| Reorder-Due | % off next earbuds **or** free ear tips | low–mid |
| Cross-Sell | Bundle discount on the missing category | mid |
| At-Risk | Value content + light incentive | low |
| Churning | Meaningful single-use code | mid–high |
| VIP Reactivation | Concierge + exclusive/early access | high-touch, not always $ |
| Lapsed | Strongest last-chance code | high |

### 4.4 Reorder windows (from the curve)

Attach spike **0–30d** (29% of repeaters) → accessory/complementary. Main replenishment **~60–180d** (median 94d) → the reorder nudge, sent *before* momentum fades. Past **~245d** (p75) with no reorder → shift to At-Risk / Win-Back.

---

## 5. Klaviyo activation

- **Primary (recommended): write-back → dynamic segment.** Worker writes `lifecycle_stage`, `p_active`, `predicted_clv`, `owned_categories`, `reorder_due` back to each profile (`PATCH /api/profiles` / create-or-update). Define one **dynamic segment per stage/cohort** (`profile_attribute` condition, buildable via Create Segment API — prototype in the GUI, copy the definition JSON). Segments auto-refresh daily as properties are rewritten, and can trigger **flows** ("entered Reorder-Due" → replenishment flow).
- **Secondary (ad-hoc): list export.** "Create list" builds a static Klaviyo **List** and pushes the cohort (`POST /api/lists` + add-profiles); "Export CSV" for manual upload. Use for one-off daily sends. *(Segments cannot be populated by pushing profiles — only lists can.)*

---

## 6. Architecture & daily pipeline

```
Shopify orders ──nightly──▶ Python worker ──writes──▶ fitted store (store.ts seam)
(24-mo + incremental)        • RFM from real dates        { profileId: {p_alive, predicted_clv,
Klaviyo events ─────────────▶ • BG/NBD + Gamma-Gamma          owned_products, last_order_date,
                              • owned categories               cadence, stage, reorder_due } }
                              • daily cohort builder
                                     │
                                     ├─ write-back lifecycle_stage → Klaviyo (dynamic segments)
                                     └─ app /api/lifecycle reads store → "Send Today" UI + board
```
- **Worker:** Python (`lifetimes`/PyMC for BG/NBD + Gamma-Gamma) — the language/service choice already approved. Ingests order data (nightly Shopify export to a known path, or Shopify Admin API incremental pull; 24-mo backfill is one-time). Idempotent; first run bounded (`--years 1`), reconcile a few known customers, then schedule.
- **Store:** existing `src/lib/lifecycle/store.ts` seam (file locally / Redis in prod), keyed by Klaviyo profile id.
- **App:** `src/app/api/lifecycle` reads the store, builds the board + ranked daily cohorts; new **"Send Today"** page + dashboard nav link.
- **Schedule:** daily cron ~05:00 ET → worker → property write-back → app shows fresh cohorts. Store `pActiveSource` so UI shows proxy vs fitted.

---

## 7. Validation & backtest (do before trusting cutoffs)

Hold out the last 90 days. Score every customer **as of T−90** (using only data available then), then check reality in the following 90 days:
- **Churn precision:** of those labeled Churning/Lapsed, what share indeed did *not* purchase? (want high)
- **Reorder recall:** of those labeled Reorder-Due/Active, what share actually reordered? (want high)
- **Cross-sell base rate:** conversion of the cross-sell cohort into the target category vs. control.
Tune cutoffs (.80/.50/.20, cadence, windows) to maximize precision/recall, then re-run. Ongoing: track live campaign conversion by cohort and feed it back into `expected_conversion` (§4.2).

---

## 8. Build plan

- **P0 (accuracy quick win):** in the committed TS model, swap `expected_date_of_next_order` → order-derived `daysPastReorder`; fix `POPULATION_MEDIAN_CADENCE_DAYS` and `HIGH_VALUE_CLV`. Ship behind the existing seam.
- **P1 (the product):** nightly order ingestion → per-customer store; daily ranked-cohort endpoint; **"Send Today" UI**; list export / CSV.
- **P2 (max accuracy + activation):** BG/NBD + Gamma-Gamma fit → `p_alive`/`predicted_clv`; write-back property → dynamic segments + flow triggers; offer engine; backtest harness; campaign feedback loop.

---

## 9. Appendix — constants & references

**Constants (v1, real-data):** `POP_REORDER_MEDIAN=95` · `POP_INTERORDER_MEDIAN=118` · `HIGH_VALUE_CLV=119`* (recompute vs Klaviyo CLV) · P(active) cutoffs `0.80/0.50/0.20`* · engagement `45/90/180/365`* (*confirm via backtest).

**Data snapshot:** 911,466 buyers · 83.2% one-time · Earbuds 626k / Headphones 174k / Power Tech 168k / Audio 81k · reorder cumulative 30d 29% / 90d 49% / 180d 66% / 365d 88% · Earbuds-first next purchase: Earbuds 82% / Headphones 15% / Power Tech 14% / Accessories 13%.

**References:** RFM — Fader & Hardie, *Probability Models for Customer-Base Analysis*. BG/NBD — Fader, Hardie & Lee (2005), *"Counting Your Customers" the Easy Way* (Marketing Science). Gamma-Gamma — Fader & Hardie. Klaviyo — Segments vs Lists (help.klaviyo.com/hc/en-us/articles/115005061447); Segments API (developers.klaviyo.com/en/reference/segments_api_overview). Sunset policy — Klaviyo list-hygiene guidance.
