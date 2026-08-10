# August 2026 — Daily Targeted Campaign Calendar (Aug 7–31)

**Purpose:** One campaign per day for the unfilled days of August, each aimed at a **specific segment** with a **specific angle**. The standing offer is present but never the headline — the hook is a product truth, a piece of science, or a real use-case.

**Sources:** targeting cohorts from the app's Lifecycle engine (`src/lib/lifecycle/snapshot.ts`); product facts from `data/products.md` (verified against the live storefront 2026-08-06).

---

## How to read this

Each day gives you: **Segment** (with the rule) · **Angle** (the hook) · **Substance** (the fun fact or insight that carries it) · **Hero** · **Offer role** (how the sale appears, always secondary) · **SMS** (only where it earns it).

### Ground rules baked in
- **Offer is support, never the lead.** The standing evergreen offer is **20% off**; most days carry it as one line and a CTA, nothing more. Real promo moments are marked.
- **Every day is a different segment.** A 25-day daily cadence is only safe because no single person receives all of them. Non-negotiable suppressions below.
- **Catalogue rules respected:** Everyday Earbuds Plus (E26) is excluded entirely — no live product page and it's flash-sale-only per the inclusion rule. H90 excluded (not on storefront). E45 is framed as broad active life, never gym lingo. H41's Bluetooth version is never named (the live page contradicts itself). E25 is called "Everyday Earbuds," never "Classic."

### Suppression rules (apply to every send)
1. Exclude anyone who received a campaign in the **last 2 days**.
2. Exclude **purchasers in the last 14 days** from all promo sends (they get post-purchase flows instead).
3. Exclude **Suppression Watch** (>365d no engagement) from everything except the two dedicated re-permission sends (Aug 19, Aug 29).
4. Cap any individual at **~3 campaigns per week** across all segments.
5. Anyone active in a live flow (Browse/Cart Abandon, Welcome) is excluded from that day's overlapping topic.

---

## Week 1 · Aug 7–9 — Cross-sell and the audio-curious

### Fri, Aug 7 — The cable that can't fray
- **Segment:** Cross-Sell · Earbuds→Power Tech (`owns Earbuds AND NOT Power Tech AND recency ≤120d`)
- **Angle:** Everyone has a graveyard drawer of dead charging cables. Here's why they die.
- **Substance:** Cables almost never fail in the middle — they fail at the connector, from thousands of small twists as you plug in one-handed at a weird angle. The Magic Spin's ends **rotate 180°**, so the cable stops fighting your wrist. Three lengths because the 3 ft that's right for a desk is useless beside a bed.
- **Hero:** Magic Spin Cable ($24.98)
- **Offer role:** One line at the bottom. This is a $25 attach — the story does the work.

### Sat, Aug 8 — You hear this one through your skull
- **Segment:** Cross-Sell · Earbuds→Open Audio (`owns in-ear Earbuds AND NOT Open Audio AND recency ≤120d`)
- **Angle:** There's a way to listen that doesn't involve your ear canal at all.
- **Substance:** Bone conduction sends sound as **vibration through the bones of your skull** straight to the inner ear — your ear canal stays completely open. That's why you can hear a cyclist, a car, or someone saying your name while the music keeps playing. IP68, adjustable speaker arms.
- **Hero:** B42 Bone Conduction Headphones
- **Offer role:** Skip the offer above the fold entirely. Weekend curiosity email.

### Sun, Aug 9 — Book Lovers Day: 50 hours of listening
- **Segment:** Engaged non-purchasers (`opened ≥1 email in 60d AND 0 orders lifetime`)
- **Angle:** For people who listen to books, battery life isn't a spec — it's how many books you get per charge.
- **Substance:** Most audiobooks run **8–12 hours**. The Everyday Headphones' **50-hour** battery means roughly four to five full novels between charges, and Awareness Mode lets you catch an announcement without pulling them off. The 3.5mm AUX cable is in the box for planes.
- **Hero:** H20 The Everyday Headphones
- **Offer role:** 20% off named once, in the CTA.

---

## Week 2 · Aug 10–16 — Back to school, focus, and rest

### Mon, Aug 10 — The second-pair problem
- **Segment:** Reorder-Due · Earbuds (`owns Earbuds AND 60–150d since purchase`)
- **Angle:** Not an upgrade pitch. The case for a second pair that lives somewhere else.
- **Substance:** The pair you love is always in the wrong bag. A second pair lives permanently in the work bag or the car and you stop doing the morning search. **Multipoint** means it stays connected to laptop and phone at once, so switching is instant.
- **Hero:** E25 Everyday Earbuds
- **Offer role:** Support line — the second pair is easier to justify at 20% off.

### Tue, Aug 11 — Back to school: the dorm-room problem
- **Segment:** US engaged subscribers, no purchase in 180d (`US AND opened 90d AND last order >180d or none`)
- **Angle:** A shared room means you don't control the noise. You only control what's on your ears.
- **Substance:** Hybrid ANC on the H10 blends **feedforward and feedback** noise cancelling — one mic set reads noise coming at you, the other checks what actually reached your ear and corrects. 50-hour battery covers a full week of library sessions. Cushioned cups for the long ones.
- **Hero:** H10 Essential Headphones
- **Offer role:** Back-to-school framing carries it; offer as a footer line.

### Wed, Aug 12 — Six microphones, no "sorry, say that again"
- **Segment:** High-Value Repeat (`order_count ≥2 AND lifetime spend ≥$173`)
- **Angle:** For people whose day is calls. The unglamorous spec that actually matters.
- **Substance:** The Pro has **6 microphones** working on your voice, not just the audio coming in — the difference between people hearing you and people asking you to repeat. And **10 minutes of charge gives 3 hours** of use, which is the real answer to a dead bud before a meeting.
- **Hero:** E95 Pro Earbuds
- **Offer role:** This segment buys on capability. Mention the offer once, late.

### Thu, Aug 13 — Glasses and hats: the hook problem
- **Segment:** Open Audio interested / clip-curious (`viewed Open Audio 90d AND no Open Audio purchase`)
- **Angle:** If you wear glasses, over-ear hooks are a fight. There's a clip for that.
- **Substance:** The Everyday Clip's arm is **nickel-titanium** — a shape-memory alloy used in aerospace and medical stents. It flexes to your ear and springs back to its exact original shape instead of loosening over time. No hook, no seal, nothing competing with your glasses arm or a cap.
- **Hero:** O55 Everyday Clip Earbuds
- **Offer role:** One line.

### Fri, Aug 14 — Pre-weekend: 56 hours means you stop thinking about it
- **Segment:** Active buyers ≤90d who own Earbuds but not Fitness (`recency ≤90d AND NOT owns E45/O25`)
- **Angle:** Battery anxiety is a small daily tax. Here's the math that removes it.
- **Substance:** **56 hours total, 12 per charge.** A long walk, a commute, a full day of errands, a weekend away — you charge these on a schedule you forget about, not a schedule you manage. IPX7 means rain and sweat are simply not a factor. Stabilizing gel fin holds the fit through motion.
- **Hero:** E45 The Fitness Earbuds
- **Offer role:** Weekend CTA, offer named once.
- **SMS:** ✅ Short Friday nudge — a weekend window is genuinely time-bound.

### Sat, Aug 15 — National Relaxation Day: pink noise vs brown noise
- **Segment:** Sleep-intent (`viewed Sleep Earbuds 180d, OR bought Sleep Earbuds >12mo ago`)
- **Angle:** The most interesting thing about sleep audio is that the *colour* of the noise changes what it does.
- **Substance:** **Pink noise** spreads energy evenly across octaves — softer and more balanced than white noise, which is why it sounds like steady rain. **Brown noise** pushes further into the low end, closer to a distant waterfall or a plane cabin. The Sleep Earbuds have five ambient sounds built in and **Sleep Mode disconnects Bluetooth entirely** — no phone, no app, nothing streaming by your head. Ultra-slim so a side-sleeper can actually use them. 45 hours in Sleep Mode.
- **Hero:** E60 Sleep Earbuds
- **Offer role:** Sleep Earbuds carry a genuine standard promo (DREAMS-ZZ). Even here, lead with the noise-colour story and let the price land second.
- **SMS:** ✅ Evening-of send. "Tonight" is the whole point.

### Sun, Aug 16 — What your ears do all day
- **Segment:** New Customer · 2nd-order (`1st order ≤45d`)
- **Angle:** A genuinely useful how-to-get-more-out-of-it email, not a sell.
- **Substance:** Most people never change the gel tips that shipped in the box, and tip size is the single biggest factor in both comfort and how much bass you actually hear — a loose seal thins the low end before the driver ever gets blamed. Walk them through sizing, then Awareness vs ANC, then multipoint pairing.
- **Hero:** Whatever they bought (dynamic), accessory as soft secondary
- **Offer role:** **None.** This one earns trust. No discount at all.

---

## Week 3 · Aug 17–23 — Travel, durability, productivity

### Mon, Aug 17 — One adapter, 180+ countries
- **Segment:** Travel intent (`bought Travel Adapter/Impact >6mo ago, OR viewed Power Tech 90d`) + high-value repeat overlap
- **Angle:** The specific indignity of arriving somewhere with the wrong plug.
- **Substance:** The Magic Travel Adapter has **UK, EU, AU and US/JP sockets built in** with retractable prongs, plus **2 USB-C, 2 USB-A and 2 AC outlets** — it charges five to seven devices at once and works in **180+ countries**. It replaces the tangle of adapters *and* the power strip.
- **Hero:** Travel Adapter 45W ($24.99)
- **Offer role:** Already half price off regular. State the price plainly; no discount theatrics.

### Tue, Aug 18 — Tested to a military standard
- **Segment:** Outdoor / rugged intent (`owns Fitness or Open Audio AND recency ≤180d`)
- **Angle:** "Durable" is marketing. **MIL-STD-810** is a document.
- **Substance:** MIL-STD-810 is the **US military's environmental test standard** — real protocols for drops, shock, temperature and dust. The Impact Earbuds are built with MIL-SPEC impact-resistant materials, IP67, and **90 hours of total battery**. The part nobody expects: the capsule has **800mAh of power-bank capability**, so it can charge your phone. Carabiner and lanyard in the box.
- **Hero:** E75 The Impact Earbuds
- **Offer role:** One line, late.

### Wed, Aug 19 — Re-permission: still want these?
- **Segment:** Suppression Watch (`no engagement >365d`) — **the one send this segment gets**
- **Angle:** Honest, plain, slightly self-aware. Not a discount grab.
- **Substance:** Tell them straight: they haven't opened anything in a year, and Raycon would rather email fewer people who want it than more people who don't. One button to stay, one to leave. Mention what's actually changed in the lineup since (Open Audio range, AI Notetaker) as the reason to reconsider.
- **Hero:** None — brand-level
- **Offer role:** No offer. A discount here reads as desperation and trains the wrong behaviour.
- **Note:** This protects deliverability for all 24 other sends. Do not skip it.

### Thu, Aug 20 — Your meetings, transcribed
- **Segment:** High-Value Repeat + professional intent (`spend ≥$173 AND viewed AI Notetaker, OR owns Pro Earbuds`)
- **Angle:** A different kind of Raycon product — and the honest version of what it does.
- **Substance:** The AI Notetaker records in person or on calls, transcribes in **120+ languages**, identifies speakers, and produces a summary with action items. It's **0.19 inches thick**, MagSafe-compatible, and runs **60 hours**. The free tier covers 5 hours a month, so it can be tried without committing to a subscription.
- **Hero:** AI Notetaker ($104.99, 30% off launch)
- **Offer role:** Launch pricing is genuinely part of the news here — but lead with the capability.

### Fri, Aug 21 — Cushions that come off and wash
- **Segment:** Fitness Headphones interest + Cross-Sell · Earbuds→Headphones (`owns Earbuds AND NOT Headphones AND recency ≤120d`)
- **Angle:** The reason most workout headphones get retired isn't sound. It's smell.
- **Substance:** Every pair of over-ears you've trained in has absorbed a year of sweat into a cushion you can't remove. The Fitness Headphones ship with **three Quick Swap cushions** — one PU leather, two breathable — so the contact surface is replaceable. IPX4, 45-hour battery with ANC off.
- **Hero:** H41 The Fitness Headphones *(do not name a Bluetooth version)*
- **Offer role:** H41 sits well below regular price already. Weekend CTA.
- **SMS:** ✅ Friday, short window framing.

### Sat, Aug 22 — Featherlight, and why that matters after hour three
- **Segment:** Open Audio curious, price-sensitive (`viewed Open Audio 120d AND 0 Open Audio orders`)
- **Angle:** The entry point to open-ear, argued on comfort rather than price.
- **Substance:** Open-ear earbuds live *on* the ear, not in it, so there's no pressure inside the canal and no seal to get hot — the difference shows up at hour three, not minute one. The Essential Open hooks on in seconds, runs **36 hours total**, has **Bluetooth 6.0** and multipoint, and the case charges wirelessly.
- **Hero:** O15 Essential Open Earbuds
- **Offer role:** Lowest-priced open-audio entry; state the price, skip the hype.

### Sun, Aug 23 — Baseball, on your ears
- **Segment:** MLB Edition owners + US sports-engaged (`owns E25-MLB, OR US AND clicked a sports/MLB campaign 12mo`)
- **Angle:** Late-season baseball, and the pair that picks a side.
- **Substance:** The Everyday Earbuds MLB Editions cover **Dodgers, Yankees, Astros, Phillies, Cubs and Red Sox**. Physical button controls, which matters more than it sounds when your hands are full of a hot dog and a scorecard — no mis-taps from a raindrop or a sleeve.
- **Hero:** E25 Everyday Earbuds — MLB Edition
- **Offer role:** One line.

---

## Week 4 · Aug 24–31 — Win-back, loyalty, end of summer

### Mon, Aug 24 — What's changed since you last looked
- **Segment:** Win-Back · 6–12mo (`last order 181–365d AND still engaged`)
- **Angle:** Not "we miss you." A genuine catch-up on a lineup that actually moved.
- **Substance:** Since they last bought, the Open Audio line expanded (clip, hook, bone conduction), the Impact arrived with 90-hour battery, and the AI Notetaker opened a category that isn't audio at all. Frame it as a change-log, not a plea.
- **Hero:** Open Audio range as the headline change
- **Offer role:** Win-back is the one place a stronger offer is legitimate. Still put the news first.

### Tue, Aug 25 — Overdue, and honest about it
- **Segment:** At-Risk · Earbuds overdue (`owns Earbuds AND 181–365d, past typical replacement window`)
- **Angle:** Buds have a lifespan and pretending otherwise is silly.
- **Substance:** Batteries in anything this small lose capacity with cycle count — the honest signal that a pair is ageing is that a charge stops lasting the day. If that's happening, here's what a current-generation pair does differently: bigger totals, multipoint, better ANC.
- **Hero:** E25 or E95 (by what they own)
- **Offer role:** Support — replacement is a considered purchase, the offer helps close.

### Wed, Aug 26 — National Dog Day: hear the leash *and* the podcast
- **Segment:** Open Audio owners + dog-walker proxy (`owns Open Audio, OR clicked a walking/outdoor campaign 12mo`)
- **Angle:** The single best real-world argument for open-ear audio, on the perfect day for it.
- **Substance:** Anyone who walks a dog knows the problem: you need to hear traffic, another dog approaching, and your own name — while still listening to something. Open-ear leaves the canal open so all of that arrives normally. The Fitness Open's **multi-angular hook** doesn't budge when you lunge for a squirrel-bound leash, and IPX5 handles the weather.
- **Hero:** O25 Fitness Open Earbuds
- **Offer role:** Fun day, light offer.
- **SMS:** ✅ Day-of, morning. Walk-timed.

### Thu, Aug 27 — Two devices, no switching
- **Segment:** Cross-Sell · Earbuds→Headphones (`owns Earbuds AND NOT Headphones AND recency ≤120d`)
- **Angle:** The most-used feature nobody shops for.
- **Substance:** **Multipoint** keeps a pair connected to laptop and phone simultaneously — a call comes in and it just switches, no menu-diving, no forgetting-then-re-pairing. Once you've worked this way you can't go back, and it's the strongest reason to make the *headphones* the desk pair while the buds stay mobile. H20 adds Personalized Surround Sound and five beam-forming mics.
- **Hero:** H20 The Everyday Headphones
- **Offer role:** One line.

### Fri, Aug 28 — End of summer, one last long weekend
- **Segment:** Active ≤90d, high engagement, no order in 60d (`recency ≤90d AND opened 30d AND no order 60d`)
- **Angle:** Pre-Labor-Day framing without pretending it's a huge event.
- **Substance:** One more road trip, one more long walk in decent weather. The pairing worth having for it: something that stays put and shrugs off weather (E45, IPX7) plus a cable that survives the glovebox (Magic Spin). Practical, specific, short.
- **Hero:** E45 + Magic Spin Cable bundle framing
- **Offer role:** Bundle logic carries it; offer supports.
- **SMS:** ✅ Friday, holiday-weekend window.

### Sat, Aug 29 — Second re-permission pass
- **Segment:** Dormant >365d **not** reached on Aug 19 (`>365d AND not sent Aug 19`)
- **Angle:** Same honest posture as Aug 19, different framing — one useful thing rather than a question.
- **Substance:** Lead with genuinely useful content (the tip-size and ANC guidance from Aug 16). If they engage with something helpful, they're worth keeping; if not, suppress them.
- **Hero:** None — brand-level
- **Offer role:** None.

### Sun, Aug 30 — The quiet upgrade: awareness mode
- **Segment:** Engaged owners of ANC products (`owns E25/E45/E95/H10/H20/H41 AND opened 30d`)
- **Angle:** An education email about a button most people never press.
- **Substance:** Awareness Mode isn't just "ANC off" — it actively pipes outside sound *in*, so you can order a coffee or hear a platform announcement without removing anything. Most owners never try it. Show them when to use which: ANC for the plane and the open-plan office, Awareness for the street and the counter.
- **Hero:** Whatever they own (dynamic)
- **Offer role:** **None.** Pure retention value. Ends the month on generosity.

### Mon, Aug 31 — Month-end: the pair you keep meaning to buy
- **Segment:** Browse-abandon 30d, no purchase (`viewed a product ≥2× in 30d AND 0 orders in 30d`) — **exclude anyone currently in the Browse Abandon flow**
- **Angle:** The gentle, specific nudge that a flow's fixed fourth email can't do — and the exact experiment your post-flow-drop-off idea is built for.
- **Substance:** Reference the *category* they looked at and answer the one question that stalls that decision (fit for open-ear, battery for headphones, durability for Impact). One product, one objection, one answer.
- **Hero:** Dynamic by browsed category
- **Offer role:** Month-end deadline is a legitimate reason for the offer to be prominent here. This is the one day it can lead.
- **SMS:** ✅ Evening, genuine deadline.

---

## Coverage check

**Segments used (14 distinct):** Cross-Sell→Power Tech · Cross-Sell→Open Audio · Cross-Sell→Headphones · Reorder-Due Earbuds · At-Risk Overdue · Win-Back 6–12mo · New Customer 2nd-order · High-Value Repeat · Suppression Watch (×2 passes) · Engaged non-purchasers · Sleep intent · Travel intent · Browse-abandon · Sports/MLB engaged

**Products featured (14):** O15 · O25 · O55 · B42 · E25 (+MLB) · E45 · E60 · E75 · E95 · H10 · H20 · H41 · Magic Spin Cable · Travel Adapter · AI Notetaker
*Excluded by rule:* E26 Everyday Earbuds Plus, H90 Everyday Headphones Pro.

**Offer posture:** 4 days carry **no offer at all** (Aug 16, 19, 29, 30) · 1 day the offer leads (Aug 31, month-end) · the remaining 20 keep it to a single supporting line or the CTA.

**SMS:** 6 days only (Aug 14, 15, 21, 26, 28, 31) — each on a genuine time window.

---

## Before you send

1. **Verify the general-knowledge facts.** Product specs come from `data/products.md` (verified 2026-08-06). The wider facts — nitinol in stents, MIL-STD-810, pink vs brown noise, typical audiobook length — are accurate as written but worth a sanity check, since a wrong fun fact costs more credibility than a dull email.
2. **Check segment sizes first.** Several cohorts (Cross-Sell→Power Tech, MLB owners) may be too small to be worth a send. If a segment is under a few thousand, merge it into an adjacent day rather than sending to a handful of people.
3. **Aug 19 and Aug 29 are load-bearing.** The re-permission sends are what make a 25-day cadence safe for deliverability. Don't drop them because they have no revenue attached.
4. **Watch total frequency, not per-campaign frequency.** The suppression rules above matter more than any single day's targeting.
