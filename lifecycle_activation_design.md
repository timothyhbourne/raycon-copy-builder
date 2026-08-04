# Lifecycle Data → Activation: UX + Klaviyo Integration + Campaign Playbook

**Reframed objective.** Not a board for browsing individual customers. The product is an **aggregate view of the entire Klaviyo audience grouped into our model's lifecycle stages**, with a one-click way to push any stage into Klaviyo so we can run **targeted, granular daily campaigns** at small high-intent pockets (e.g. about-to-churn, first buyers).

---

## 1. UX — aggregate cohort overview (not a Kanban of cards)

Dashboard design research is consistent: **design for the decision, not the chart**; group by lifecycle stage rather than averaging; put the numbers that drive action on the natural scan path; and **size/prioritize by revenue, not just headcount** (classic pattern: Champions ≈ 10% of customers but ≈ 35% of revenue). The right surface here is a **one-screen cohort overview** where each lifecycle stage is a tile.

**Each stage tile shows:** stage name · **count + % of base** · **value** (total CLV, or *revenue at stake* for At-Risk/Churning/Lapsed) · avg P(active) · trend vs last run · a primary **action button** (push to Klaviyo) + secondary **Export CSV** + "view customers" drill-down. A small **"daily target"** flag marks the stages best suited to granular daily sends.

**Above the tiles:** 3–4 KPI tiles — Total audience, Revenue at stake, Reachable %, Suppression-ready count. Optional secondary tab: a **revenue treemap** (rectangle size = stage revenue) and a **stage-migration view** (how many moved At-Risk→Churning→Lapsed since last run) — migration is the signal that tells you whether your campaigns are working.

See `lifecycle_dashboard_mockup.html` for the concrete layout.

---

## 2. Klaviyo integration — the important architectural choice

Klaviyo has two audience primitives, and they behave differently:

- **List** = *static*. You can push profiles into it via API (create list → add profiles). It stays as-is until you refresh it.
- **Segment** = *dynamic*. Defined by **conditions** on profile data/behavior; profiles enter/exit automatically. **You cannot push profiles into a segment** — only its definition decides membership.

Our lifecycle stage comes from *our* model (P(active) isn't a native Klaviyo field), so there are two viable buttons:

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Static list push** *(simplest)* | App creates a Klaviyo **List** and adds the scored profiles (daily snapshot) | Trivial "Create list" button; works today via `POST /api/lists` + add-profiles | Static — must re-push daily; clutters lists; no auto-exit |
| **B. Write-back property → dynamic segment** *(recommended)* | Worker writes a `lifecycle_stage` (and `p_alive`, `predicted_clv`) **custom property** back to each profile (`PATCH /api/profiles`); a Klaviyo **Segment** is defined once as `lifecycle_stage = Churning` | Every stage becomes a **live, auto-updating segment** usable in campaigns **and** flows; membership refreshes as we rewrite properties daily; Klaviyo gives you the counts for free | Needs the property write-back + one segment per stage (buildable via Create Segment API) |

**Recommendation: B as the primary path, A as a fallback for one-off sends.** B is the idiomatic Klaviyo pattern (segments = conditions on profile properties), makes the cohorts first-class inside Klaviyo, and directly enables flow triggers ("entered segment Churning" → win-back flow) — which is how you get *daily* granularity without manually pushing lists. Highly segmented campaigns are reported to earn ~3× revenue per recipient vs unsegmented, so this is where the value is.

> **Segment-definition tip:** build one stage segment in the Klaviyo UI, open its definition JSON (Update definition → add `.json` to the URL), and reuse that shape in the Create Segment API for the rest.

---

## 3. Architecture note — you need the full base scored, not a sample

The current `/api/lifecycle?limit=N` endpoint scores a *sample* live per request — fine for preview, wrong for an aggregate over ~1.3M profiles. To show real stage totals you need the **batch worker (Phase 2)** to score the whole audience on a schedule and persist (a) per-stage aggregates for the dashboard and (b) the `lifecycle_stage` write-back. After write-back, stage **counts can also be read straight from Klaviyo segment membership**, so Klaviyo does the aggregation. Net: the daily worker is the enabler for both accurate P(active) *and* this whole activation surface.

---

## 4. Campaign playbook by stage

| Stage | Goal | Message / offer | Channel | Cadence | Daily target? |
|---|---|---|---|---|---|
| **Lead / Non-Buyer** | First purchase | Education + first-order incentive | Email | Nurture series | — |
| **New Customer** | Drive 2nd purchase | Onboarding, product tips, replenishment/accessory nudge | Email → SMS | Triggered post-order | ✅ |
| **Active / On-Track** | Maintain | Value content, new drops; low frequency | Email | Light | — |
| **Upsell-Ready** | Expansion revenue | Cross-sell to the category they *don't* own (owns Audio → Home), bundles | Email + SMS | Weekly, behavior-triggered | ✅ |
| **At-Risk (Disengaging)** | Re-engage early | Helpful/social-proof content, soft offer | Email | On entry to stage | ✅ |
| **Churning** | Win back | Escalating incentive; **VIP-at-risk → concierge + SMS** | Email + SMS | On entry (not calendar) | ✅ |
| **Lapsed / Dormant** | Last-chance | Strong win-back, then step down frequency | Email | On entry, capped | — |
| **Suppression-Ready** | Protect deliverability | Single re-permission email, then suppress | Email | One-shot | — |

Best pockets for **granular daily sends** are the small, high-intent, time-sensitive stages — **Churning, At-Risk, Upsell-Ready, New Customer** — fired **on transition into the stage**, not on a calendar. That is exactly what write-back + dynamic segments + flow triggers gives you.

---

## 5. Suggested build order

1. **Phase 2 worker** (already seamed) — score full base daily, persist stage + `p_alive`/`predicted_clv`.
2. **Write-back** `lifecycle_stage` to Klaviyo profiles; create one dynamic **segment per stage**.
3. **Aggregate dashboard** reading stage counts (from the worker store and/or Klaviyo segment counts) — the overview in the mockup.
4. **Actions**: "Sync to Klaviyo" (write-back + ensure segment) as primary; "Create list" / "Export CSV" as fallback.
5. **Flows**: attach win-back / cross-sell / 2nd-order flows to the stage segments.

---

## References

- Klaviyo — *Difference between segments and lists*: https://help.klaviyo.com/hc/en-us/articles/115005061447 · *Segments API overview*: https://developers.klaviyo.com/en/reference/segments_api_overview · *Segment conditions reference*: https://help.klaviyo.com/hc/en-us/articles/115005062847
- Dashboard UX — DataCamp, *Effective Dashboard Design*: https://www.datacamp.com/tutorial/dashboard-design-tutorial · CMSWire, *Customer dashboards that drive growth*: https://www.cmswire.com/customer-experience/how-can-you-build-customer-dashboards-that-drive-experience-and-growth/
- RFM activation — MCP Analytics, *RFM for e-commerce (find/save customers)*: https://mcpanalytics.ai/articles/ecommerce__generic__customers__rfm_segmentation · Bloomreach, *RFM omnichannel win-back*: https://www.bloomreach.com/en/use-cases/rfm-omnichannel-winback-campaign · Datadrew, *RFM segmentation for Klaviyo*: https://datadrew.io/blog/rfm-segmentation-klaviyo/
