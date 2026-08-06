# Raycon Company USP Bank

Brand-level selling points, grouped by theme. **This file is the single source of truth for
shipping, returns, warranty, and brand-proof claims.** If a claim is not in here, the copy
may not make it. That is the whole point: the writer used to be told "never claim free
shipping or a warranty the data does not state" because the data did not exist anywhere.
It exists here now, and only what is here is sayable.

The live promotion is deliberately NOT in this file. It comes from the brief at generation
time (`offer`, `promo_code`, `occasion`, and the computed `deadline_language`) and is
injected alongside this bank into any company-sourced USP slot.

Same format as `data/product-usps.md`: a short bold label, a one-sentence benefit, and an
optional `[tag]`. Anything that could not be reconciled across sources carries
`[unverified]` and the loader drops it from prompts.

---

## Shipping and delivery
**Source:** product page shipping badges and site footer (rayconglobal.com)
**Verified:** 2026-08-06

- **Free US shipping:** Every order ships free within the US, with no minimum to hit first. `[shipping]`
- **Ships free, stated on every product:** The "Ships Free" promise is on the page before the reader ever reaches checkout. `[shipping]`
- **Expedited shipping is available:** Paid expedited options exist at checkout, though those charges are not refundable on a return. `[shipping]`
- **Delivery timing:** Specific standard and expedited delivery windows are not published on the pages checked, so no delivery date or "arrives by" claim may be made. `[shipping] [unverified]`

## Returns and guarantee
**Source:** https://rayconglobal.com/policies/refund-policy plus product page guarantee badges
**Verified:** 2026-08-06

- **30 day satisfaction guarantee:** A full 30 days from purchase to decide, which is long enough to actually live with them. `[returns]`
- **Three ways to resolve it:** Within the 30 days you can take a refund, an exchange, or store credit. `[returns]`
- **Exchanges and store credit carry no fee:** Swapping for a different product or taking credit costs nothing extra. `[returns] [value]`
- **Direct purchases only:** The guarantee covers orders placed on rayconglobal.com; retail and third-party reseller purchases go back through that retailer. `[returns]`
- **Refunds carry a handling fee:** A refund to the original card is issued less shipping, handling, and any promotional discount, and opened or used merchandise carries a 20% restocking fee. Never describe a refund as free or full. `[returns]`
- **Free returns:** The product page badge says "free returns", but the published refund policy sets a 20% restocking fee on opened merchandise and does not cover international return shipping. The two contradict each other, so this claim may not be used. `[returns] [unverified]`

## Warranty and support
**Source:** https://rayconglobal.com/pages/warranty
**Verified:** 2026-08-06

- **1 year limited warranty:** Every product is covered against defects in materials and workmanship for a full year from purchase. `[warranty]`
- **Raycon pays the return leg:** On an approved warranty claim Raycon covers shipping the replacement back to you. `[warranty] [support]`
- **A real support address:** Warranty claims go through support@rayconglobal.com and an RMA, not a form that goes nowhere. `[support]`
- **What the warranty does not cover:** Normal wear and tear, misuse, accidents, shipping damage, and unauthorized repairs fall outside it, so never imply accidental damage is covered. `[warranty]`

## Brand proof
**Source:** product page review widgets and "Over 57,000 Five-Star Reviews" badge
**Verified:** 2026-08-06

- **Over 57,000 five-star reviews:** More than 57,000 people have left five stars across the range. `[proof]`
- **228,362 reviews on one product:** The Everyday Earbuds alone carry 228,362 reviews at a 4.43 average. `[proof]`
- **Reviewed in the tens of thousands, not the hundreds:** The Fitness Earbuds have over 90,000 reviews, with 71% of them at five stars. `[proof]`
- **On shelves at Best Buy Canada:** Raycon products are stocked in Best Buy Canada retail locations, not online-only. `[proof]`

## Value positioning
**Source:** product pages, what's-in-the-box listings
**Verified:** 2026-08-06

- **The accessories are in the box:** Gel tips, stabilizing fins, charging cables, lanyards, and carabiners come included rather than sold back to you. `[value]`
- **Flagship features without the flagship price:** Hybrid ANC, multipoint, and 40 hour plus batteries sit across the range at prices well under the category leaders. `[value]`
- **A product for the specific job:** The lineup is built around distinct jobs, sleep, training, focus, and awareness, rather than one bud asked to do all of them. `[value]`
