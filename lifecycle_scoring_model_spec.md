# Raycon Lifecycle Scoring Model — Specification (v1)

**Purpose.** Give every customer an accurate lifecycle *tag* (Kanban column) and *badges*, computed from a documented model rather than ad-hoc thresholds. This is the scoring layer beneath the planned "customer lifecycle Kanban" feature.

**Account.** Raycon Klaviyo `LuhenE`. Model validated on a 126-profile real sample pulled 2026-07-24 (see companion workbook `lifecycle_kanban_data_check.xlsx`).

---

## 1. Design principle: two independent axes

The core mistake in the first draft was collapsing two different questions into one score. They are separated here:

| Axis | Question | Primary signal | What it decides |
|---|---|---|---|
| **Purchase** | Is this still a *live customer*? | orders + purchase cadence → **P(active)** | the lifecycle **stage** |
| **Engagement** | Can we still *reach* them? | `last_event_date` recency | **reachability** + **suppression** |

A customer is only labeled "gone" when **both** axes have decayed. Engagement acts as a guardrail so an actively-engaging customer is never mislabeled dead (this is what rescued Ray — see §6).

Klaviyo's native `churn_probability` is **not** used to drive any stage. On this account it is saturated (median 0.99, even for repeat buyers), so it carries almost no discriminating information. It is retained only as a raw *reference badge*.

---

## 2. Theoretical grounding

- **RFM (Recency, Frequency, Monetary).** The long-standing, parsimonious, interpretable backbone of lifecycle segmentation; an established predictor of CLV and churn. Recency = how recently they purchased, Frequency = order count, Monetary = spend.
- **Buy-Till-You-Die (BTYD).** Pareto/NBD (Schmittlein, Morrison & Colombo 1987) and the easier-to-fit **BG/NBD** (Fader, Hardie & Lee 2005) model a latent "alive/dead" process: a customer's **probability of being alive** falls as they go silent relative to their own buying rhythm. This is the rigorous replacement for a saturated churn score.
- **Gamma-Gamma** (Fader & Hardie). Models monetary value independent of frequency; combined with BG/NBD it yields predicted CLV. Used for the value/upsell dimension.
- **Email sunset policy.** Deliverability best practice: reduce sending ~90d after disengagement, stop ~180d, **suppress ~365d**. This is the basis of the new *Suppression-Ready* label.

---

## 3. P(active) — our Phase-1 proxy for BG/NBD P(alive)

We approximate the BTYD "probability still alive" with a transparent, explainable decay:

```
cycles_overdue = max(0, days_past_expected_reorder) / customer_avg_days_between_orders
P(active)      = 0.5 ^ cycles_overdue
```

Interpretation: a **half-life of one purchase cycle**. On cadence → 1.0; one cycle overdue → 0.50; two cycles → 0.25. When a customer's own cadence is unknown (one-time buyers), we fall back to the population median (~420 days for this sample — Raycon's repurchase cycle is long, typical of electronics).

**Stage cutoffs on P(active):** `>=0.80` live · `0.50–0.80` at-risk · `0.20–0.50` churning · `<0.20` purchase-gone.

> Phase 2 replaces this proxy with a **fitted BG/NBD + Gamma-Gamma** model on real transaction histories (`lifetimes`/PyMC), producing statistically estimated P(alive) and CLV per customer.

---

## 4. Label set & assignment rules (v1)

Evaluated top-to-bottom, first match wins. `R_e` = days since last engagement; `age` = days since profile created; `n` = order count.

| # | Column | Rule |
|---|---|---|
| 1 | **Suppression-Ready** *(new)* | `R_e > 365` (or never engaged & account > 365d & no orders). Sunset for deliverability. |
| 2 | **Lead / Non-Buyer** | `n = 0`. Subscribed, never purchased. |
| 3 | **New Customer** | `n ≥ 1` and `age ≤ 45d`. |
| — | *(engagement guardrail)* | `180 < R_e ≤ 365` → **Lapsed / Dormant** (last-chance win-back), regardless of purchase signal. |
| 4 | **Lapsed / Dormant** | `P(active) < 0.20` **and** engagement already cooled (`R_e > 45`). Purchase-gone + not currently reachable. |
| 5 | **Churning** | `P(active) < 0.20` **but** engaged `≤ 45d` (reachable → urgent reactivation), **or** `0.20 ≤ P(active) < 0.50`. |
| 6 | **At-Risk (Disengaging)** | `0.50 ≤ P(active) < 0.80` (≈ one cycle overdue). |
| 7 | **Upsell-Ready** | `P(active) ≥ 0.80`, `n ≥ 2`, `total_CLV ≥ $265` (75th pctl of repeat buyers), engaged `≤ 90d`. |
| 8 | **Active / On-Track** | `P(active) ≥ 0.80`, not upsell. On cadence. |
| 9 | **Unknown (no signals)** | Buyer with no engagement or cadence data (data gap to investigate). |

When cadence data is missing, stages fall back to engagement-recency bands (45 / 90 / 180 / 365 days).

---

## 5. Badges (card overlays, non-exclusive)

`single-purchase` · `repeat xN` · `high value` (CLV ≥ $265) · `purchase-overdue Nd` · `recently re-engaged` (engaged ≤30d but purchase-lapsed → win-back in progress) · `VIP at-risk` (high value + overdue + still reachable → priority) · `Klaviyo churn (raw) 0.xx` (reference only) · `missing engagement data`.

---

## 6. What the sanity check proved

1. **Churn score is unusable as a trigger.** Median `churn_probability` = 0.99 across the sample, including repeat buyers → demoted to a badge.
2. **~48% of contacts are non-buyers** (no predictive data). "Lead / Non-Buyer" and null-handling are first-class.
3. **The `expected_date_of_next_order` field is stale for some customers.** Ray — 11 orders, $1,668 CLV, engaged 7 days ago — appeared "448 days overdue." The engagement guardrail correctly kept him out of "Lapsed" (now *Churning → reactivate now, VIP at-risk*), **but this is proof the profile fields alone are not reliable for purchase recency.**
4. **Barbara (the row you flagged)** moved from a wrong "Churning" (2,809 days overdue) to **Lapsed / Dormant** — purchase-gone and engagement cooled. Correct.
5. **Long repurchase cadence (~420-day median).** Cadence-relative P(active) is more appropriate than fixed day-count thresholds.

> The sample is 3 sort slices and is **not** representative of population sizes. True per-column counts should come from Klaviyo segment membership.

---

## 7. Phased plan

**Phase 1 — now (this model).** Transparent RFM + P(active) proxy + sunset rules, computed from profile predictive fields. Good enough to design UI against and to validate logic.

**Phase 2 — production accuracy (recommended next).** Ingest `Placed Order` events to obtain true last-order dates and full transaction histories; fit **BG/NBD + Gamma-Gamma** for statistically-grounded P(alive) and predicted CLV. This removes the stale-`eno` problem entirely.

**Phase 3 — serving.** Either (a) express each column as a Klaviyo **segment** and read membership (live, cheap, reuses Klaviyo's engine), or (b) run the model in our own pipeline and write a `lifecycle_stage` property back to each profile. Recommendation: segments for the columns Klaviyo can express, our pipeline for P(active)-based ones.

---

## 8. Open decisions

- **A.** Split "Churning" into *Win-Back (still engaged)* vs *VIP Reactivation* for high-value overdue-but-engaged customers (Ray)? Currently one column + badges.
- **B.** Confirm P(active) cutoffs (.80 / .50 / .20) and engagement windows (45 / 180 / 365 days).
- **C.** Approve Phase 2 (order-event ingestion + fitted BG/NBD). Required for production accuracy.
- **D.** Add product-affinity upsell (e.g., owns Audio, not Home)? Needs the profile `properties` field.

---

## References

- RFM — Optimove, *RFM Segmentation, Analysis & Model*: https://www.optimove.com/resources/learning-center/rfm-segmentation ; *RFM-Based Customer Segmentation* (Journal for Advancement of Marketing Education): https://jame.scholasticahq.com/article/157562-rfm-based-customer-segmentation-a-pedagogical-case-study-for-marketing-analytics-education ; *LRFMV* (PMC): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9767363/
- BG/NBD & Pareto/NBD — Fader, Hardie & Lee (2005), *"Counting Your Customers" the Easy Way* (Marketing Science): https://pubsonline.informs.org/doi/10.1287/mksc.1040.0098 ; SSRN: https://www.ssrn.com/abstract=578087 ; Fader & Hardie, *Probability Models for Customer-Base Analysis*: https://faculty.wharton.upenn.edu/wp-content/uploads/2012/04/Fader_hardie_jim_09.pdf ; derivation notes: http://www.brucehardie.com/notes/039/bgnbd_derivation__2019-11-06.pdf
- Gamma-Gamma / CLV — *Estimating CLV via probabilistic modeling* (Towards Data Science): https://towardsdatascience.com/customer-lifetime-value-estimation-via-probabilistic-modeling-d5111cb52dd/ ; Gamma-Gamma in PyMC (Orduz): https://juanitorduz.github.io/gamma_gamma_pymc/
- Email sunset / suppression — Klaviyo, *Clean your list to maintain deliverability*: https://help.klaviyo.com/hc/en-us/articles/360044054732 ; Suped, *When to remove unengaged subscribers*: https://www.suped.com/knowledge/email-deliverability/sender-reputation/when-to-remove-unengaged-subscribers-from-email-lists
