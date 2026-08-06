# Raycon Product USP Banks

One block per SKU. Every USP below was checked against the live product page on the
`**Verified:**` date. This file is NOT injected wholesale into prompts — the app parses
it and injects only the bound product's bank into a USPs section (see `src/lib/usps.ts`).

**Format**

```
## SKU — Product Name
**Source:** <live product page URL>
**Verified:** <yyyy-mm-dd>

- **Short label:** One sentence, benefit-led (the spec AND what it does for the reader). `[tag]`
```

**Authoring rules**

- 8 to 12 USPs per product, strongest first.
- Benefit-phrased, never a bare spec. Product-specific, never true of any earbud.
- Numerals and symbols, never words. No em dashes.
- Never invent shipping, returns, warranty, or certification claims. If a claim cannot be
  checked on the live page it gets an `[unverified]` tag and the loader drops it from prompts.
- Tags (for filtering): `fit`, `battery`, `sound`, `durability`, `comfort`, `controls`,
  `connectivity`, `awareness`, `design`, `value`, plus `unverified`.

---

## O15 — Essential Open Earbuds
**Source:** https://rayconglobal.com/products/essential-open-earbuds
**Verified:** 2026-08-06

- **Open-ear hook:** Hooks over the ear and leaves the canal open, so your playlist and the world arrive at the same time. `[design] [awareness]`
- **Featherlight all day:** Minimalist build you stop noticing by the second hour, which is the whole point of an all-day bud. `[comfort]`
- **36 hour total battery:** 8 hours a charge plus the case, so a week of commutes goes by between plug-ins. `[battery]`
- **Wireless charging case:** Set it on any charging pad and skip hunting for a cable at the end of the day. `[battery] [value]`
- **IPX4 water resistance:** Rain on the walk home and sweat on the way there both bounce off. `[durability]`
- **Bluetooth 6.0:** The newest connection standard in the lineup, which means a faster pair and a steadier hold. `[connectivity]`
- **Multipoint for 2 devices:** Stay live on the laptop and the phone at once, so a call never costs you a re-pair. `[connectivity]`
- **DSP call clarity:** Digital signal processing cleans up your voice so the person on the other end hears you, not the street. `[sound]`
- **Pocket-friendly case:** The capsule disappears into a front pocket instead of claiming a bag. `[design]`
- **Easiest way in:** The entry point to open-ear listening, built for anyone curious but not ready to commit to a whole new way of hearing. `[value]`
- **4,187 reviews:** Thousands of people have already tried open-ear this way and said so in writing. `[value]`
- **Tap controls:** Track skips and calls answered with a tap on the bud. `[controls] [unverified]`

---

## O25 — Fitness Open Earbuds
**Source:** https://rayconglobal.com/products/fitness-open-earbuds
**Verified:** 2026-08-06

- **Multi-angular hook:** The buds rotate on an axis to match your ear, so the fit holds through sprints, intervals, and everything after. `[fit]`
- **Fit that won't budge:** No mid-run reseat, no pausing to push a bud back in. `[fit]`
- **40 hour total battery:** 8 hours a charge plus 32 more in the case, which is a month of workouts for most people. `[battery]`
- **IPX5 waterproof:** Rinses off sweat and shrugs off a downpour halfway through the route. `[durability]`
- **Open design:** Nothing seals the ear canal, so you hear the car behind you and the coach beside you. `[awareness] [design]`
- **Breathable open fit:** No pressure, no plugged-up feeling on a long effort in the heat. `[comfort]`
- **DSP clear calls:** Digital signal processing keeps your voice crisp on a call taken mid-walk. `[sound]`
- **Multipoint connection:** Watch and phone stay connected at once, so the workout playlist and the incoming call don't fight. `[connectivity]`
- **Awareness without compromise:** Built for people who need the road, the trail, or the gym floor in their ears alongside the music. `[awareness]`
- **4 colourways:** Midnight Blue, Cool Mint, Carbon Black, and Blush Violet. `[design]`
- **2,282 reviews:** Thousands of active listeners have put the hook through a real training block. `[value]`

---

## O55 — Everyday Clip Earbuds
**Source:** https://rayconglobal.com/products/everyday-clip-earbuds
**Verified:** 2026-08-06

- **Memory metal clip:** A nickel-titanium aerospace clip that springs back to shape, so the grip on day 300 matches day 1. `[fit] [durability]`
- **No hook, no seal:** Clips onto the outer ear instead of hooking over it, which is why glasses and hats stay exactly where they are. `[fit] [design]`
- **Pinch-free comfort:** Built to sit lightly whether you wear them for 10 minutes or 10 hours. `[comfort]`
- **30 hour total battery:** About 8 hours a charge plus the capsule, enough for a full work week of calls and playlists. `[battery]`
- **IPX5 waterproof:** Sweat it, rain it, bring it. `[durability]`
- **Physical push buttons:** Real buttons, not touch panels, so a track skip actually registers with cold or wet hands. `[controls]`
- **Bluetooth 6.0:** The current standard, for a quick pair and a connection that holds across a room. `[connectivity]`
- **Open-ear awareness:** The canal stays open, so a conversation does not require taking anything out. `[awareness]`
- **Charges in about 1.5 hours:** Plug in over lunch and get the rest of the day back. `[battery]`
- **33 foot range:** Leave the phone on the desk and keep the audio through the next room. `[connectivity]`
- **Great, Easy, Comfortable:** The three words customers reach for most in reviews. `[comfort] [value]`

---

## B42 — Bone Conduction Headphones
**Source:** https://rayconglobal.com/products/bone-conduction-headphones
**Verified:** 2026-08-06

- **Nothing in the ear:** Sound travels through the cheekbone instead of the canal, so both ears stay completely open. `[design] [awareness]`
- **Real-time awareness:** You hear the traffic, the doorbell, and the person talking to you without pausing anything. `[awareness]`
- **IP68 waterproof:** The highest water rating in the Raycon lineup, sealed against splashes and sweat. `[durability]`
- **13 hour battery:** A full day of wear on one charge, which is what an all-day frame is for. `[battery]`
- **Adjustable speaker arms:** The arms move to sit exactly where your face needs them, not where the average face does. `[fit]`
- **Featherlight frame:** Light enough for extended wear, so it stops registering as something you are wearing. `[comfort]`
- **No ear fatigue:** No tip, no seal, no pressure building up over a long session. `[comfort]`
- **Standard and small sizes:** Two frame sizes, so the fit is chosen rather than tolerated. `[fit]`
- **Wear-with-anything design:** Nothing to fall out and nothing to lose, which suits glasses, helmets, and hats. `[design] [fit]`
- **Category of one:** The only Raycon product that leaves the ear canal entirely untouched. `[design]`
- **2,915 reviews:** A large body of feedback for a product most people have never tried before. `[value]`

---

## E25 — Everyday Earbuds
**Source:** https://rayconglobal.com/products/the-everyday-earbuds
**Verified:** 2026-08-06

- **32 hour battery life:** Keeps up all day and then some, so charging becomes a weekly thought instead of a daily one. `[battery]`
- **Active noise cancellation:** Tune out the train, the open-plan office, or the flight, and get the quiet back. `[sound]`
- **Awareness mode:** One toggle lets the room back in, so ordering a coffee doesn't mean pulling a bud out. `[awareness] [controls]`
- **Ergonomic gel tips:** Cushioned to sit like a pillow in the ear through long days, pain-free. `[comfort] [fit]`
- **IPX4 weather resistance:** Rain, snow, or the sweatiest workout, and they keep playing. `[durability]`
- **2 built-in microphones:** Your voice lands loud and clear on the other end of the call. `[sound]`
- **Pocket-sized:** Compact enough that carrying them is never the reason you left them at home. `[design]`
- **The default recommendation:** Raycon's most popular earbud and the one most people should start with. `[value]`
- **228,362 reviews at 4.43 stars:** The most-reviewed product Raycon makes, by a wide margin. `[value]`
- **5 colourways:** Carbon Black, Electric Blue, Rose Gold, Cool Mint, and Blush Violet. `[design]`
- **Multipoint connectivity:** Hold a connection to two devices at once. `[connectivity] [unverified]`
- **Physical button controls:** Buttons rather than touch panels, so a press is a press. `[controls] [unverified]`

---

## E26 — Everyday Earbuds Plus
**Source:** *No live product page. Not listed in the store catalogue, the earbuds collection, or /collections/all as of 2026-08-06. Specs below carry over from the internal catalogue and could not be page-verified.*
**Verified:** 2026-08-06

- **IP66 dust and waterproof:** Sealed against dust as well as water, which the standard Everyday is not. `[durability] [unverified]`
- **32 hour battery life:** All-day playtime with the case. `[battery] [unverified]`
- **Ergonomic comfortable fit:** Fits like a glove for long wear. `[comfort] [fit] [unverified]`
- **Weather-ready in-ear:** The tougher, more weather-resistant take on the Everyday. `[durability] [unverified]`
- **Violet colourway:** The active US SKU. `[design] [unverified]`

---

## E45 — Fitness Earbuds
**Source:** https://rayconglobal.com/products/the-fitness-earbuds
**Verified:** 2026-08-06

- **Stabilizing gel fins:** An ergonomic fin locks the bud into the ear, so the fit outlasts the effort. `[fit]`
- **56 hour total battery:** 12 hours a charge with ANC off plus the capsule, which outlives any training block you throw at it. `[battery]`
- **IPX7 rating:** Certified to survive full submersion, not just a splash, so sweat and rain are not even a question. `[durability]`
- **Active noise cancellation:** Shut out the room when the session needs your full attention. `[sound]`
- **Awareness mode:** Let the road back in on the run home without touching your phone. `[awareness]`
- **3 listening profiles:** Toggle ANC, Awareness, and standard straight from the bud. `[controls]`
- **Dual beam-forming microphones:** Calls come through clean even with wind and traffic behind you. `[sound]`
- **Bluetooth 5.3 with multipoint:** Connect to 2 devices at once and move between them without re-pairing. `[connectivity]`
- **3 sets of fins and 5 sets of tips:** Eight ways to dial in the fit, all in the box. `[fit] [value]`
- **Lanyard and carabiner included:** The capsule clips to a bag or a belt loop instead of rattling around loose. `[design] [value]`
- **Charges in about 1 hour:** A short plug-in is enough to reset the whole battery. `[battery]`
- **90,770 reviews:** One of the most-reviewed products in the range, with 71% at five stars. `[value]`

---

## E60 — Sleep Earbuds
**Source:** https://rayconglobal.com/products/sleep-earbuds
**Verified:** 2026-08-06

- **Ultra-slim profile:** Low enough to lie on, which is the one thing every other earbud gets wrong for side-sleepers. `[design] [comfort]`
- **Built for side-sleepers:** Sits flush against the ear so a pillow does not press it into your head. `[comfort] [fit]`
- **5 built-in sleep sounds:** Pink noise, brown noise, and nature ambience, already loaded on the buds. `[sound]`
- **Sleep Mode disconnects Bluetooth:** The phone goes away entirely, which is half the reason you were awake. `[connectivity] [sound]`
- **No app required:** No account, no setup, no software puzzle at 11pm. `[controls]`
- **45 hours in Sleep Mode:** 15 hours in the buds plus two full recharges from the case, so a week of nights fits on one charge. `[battery]`
- **27 hours in Bluetooth Mode:** 9 hours a charge when you want a podcast or an album instead. `[battery]`
- **Comfort gel tips:** All-in-one tips that stay put through every flop and turn. `[fit] [comfort]`
- **Passive isolation tuned for sleep:** Quiet through fit rather than active cancellation, so nothing hisses in your ear all night. `[sound]`
- **Touch controls:** Change tracks, volume, and modes without finding a phone in the dark. `[controls]`
- **IPX4 water resistance:** Fine for a warm room and a restless night. `[durability]`
- **Single-purpose by design:** Built for one job rather than compromised across five. `[design] [value]`

---

## E75 — Impact Earbuds
**Source:** https://rayconglobal.com/products/the-impact-earbuds
**Verified:** 2026-08-06

- **MIL-STD-810 materials:** Built to a military durability standard, so a drop onto concrete is an inconvenience rather than a replacement. `[durability]`
- **IP67 water and dust resistant:** Sealed against grit as well as water, which matters on a trail more than in a gym. `[durability]`
- **90 hour total battery:** 12 hours a charge plus 78 more in the capsule, enough for a long trip with no outlet in sight. `[battery]`
- **800mAh power bank:** The capsule charges your phone, so the earbuds become the thing that rescues you. `[battery] [value]`
- **Active noise cancellation:** Cuts engine drone and crowd noise on the way to wherever you are going. `[sound]`
- **Awareness mode:** Bring the environment back the moment the terrain needs your attention. `[awareness]`
- **Bluetooth 5.3 with multipoint:** Two devices connected at once, held steady at up to 10 meters. `[connectivity]`
- **Touch controls:** Volume, tracks, calls, and voice assistant without reaching for a phone. `[controls]`
- **4 sets of fins and 5 sets of tips:** Nine fit options in the box for a bud that has to stay put. `[fit] [value]`
- **Lanyard and carabiner included:** Clip the capsule to a pack rather than trusting a pocket. `[design] [value]`
- **Charges in about 1 hour:** Back to full before you have finished packing. `[battery]`
- **The most rugged in the lineup:** Nothing else Raycon makes is built to take this much abuse. `[durability] [value]`

---

## E95 — Pro Earbuds
**Source:** https://rayconglobal.com/products/pro-earbuds
**Verified:** 2026-08-06

- **Hybrid ANC:** Blends feedforward and feedback cancellation, which is why it holds up against a plane cabin and not just an office. `[sound]`
- **6 microphones:** Six mics on call duty, so a meeting taken from a busy street still sounds like a meeting. `[sound]`
- **40 hour total battery:** 10 hours a charge plus 30 more in the case, sized for a work week rather than a workday. `[battery]`
- **10 minute quick charge:** A 10 minute plug-in buys 3 hours, which covers the commute you almost missed. `[battery]`
- **Awareness mode:** Amplifies what is around you when the room needs to come back in. `[awareness]`
- **Multipoint for 2 devices:** Laptop and phone stay live together, so joining a call is not a re-pair. `[connectivity]`
- **Wireless charging capsule:** Drop it on a pad at the end of the day and stop thinking about it. `[battery] [value]`
- **5 sets of gel tips:** Five sizes in the box, because ANC only works as well as the seal does. `[fit]`
- **IPX5 water resistance:** Rain on the walk between meetings is not a problem. `[durability]`
- **Built for work:** The productivity earbud in the range, tuned for focus and call quality over everything else. `[value] [design]`
- **5 colourways:** Onyx Black, Chrome Blue, Digital Purple, Platinum Silver, and Silk White. `[design]`

---

## H10 — Essential Headphones
**Source:** https://rayconglobal.com/products/essential-headphones
**Verified:** 2026-08-06

- **Hybrid active noise cancellation:** Proper hybrid ANC at the entry price point, not a token version of it. `[sound] [value]`
- **About 50 hours of battery:** Charge them at the start of a trip and never think about it again until you are home. `[battery]`
- **5 microphones:** Five mics keep your voice clear on a call taken anywhere. `[sound]`
- **Awareness mode:** Let the announcement or the barista through without lifting an earcup. `[awareness]`
- **Cushioned earcups:** Comfort built for hours, which is the only thing that matters in an over-ear. `[comfort]`
- **Bluetooth 5.3:** A stable, current connection that holds across a room at up to 10 meters. `[connectivity]`
- **Multipoint for 2 devices:** Move between laptop and phone without disconnecting anything. `[connectivity]`
- **Charges in about 2 hours:** A short plug-in returns the full 50 hours. `[battery]`
- **The comfort-led entry over-ear:** The easiest way into Raycon headphones without giving up ANC. `[value]`
- **4 colourways:** Frost White, Carbon Black, Midnight Blue, and Blush Violet. `[design]`

---

## H20 — Everyday Headphones
**Source:** https://rayconglobal.com/collections/headphones/products/the-everyday-h20-headphones
**Verified:** 2026-08-06

- **50 hour battery:** For listening all day, and then the next day, and the one after that. `[battery]`
- **Cloud Comfort fit:** Cushioning designed for a cozy fit across a full day of wear rather than a good first impression. `[comfort]`
- **Active noise cancellation:** Microphones read the noise around you and build a filter to cancel it, so you can lock in. `[sound]`
- **Awareness mode:** Mixes your surroundings back into the audio when you want to stay present. `[awareness]`
- **5 beam-forming microphones:** Five mics aimed at your voice for high-quality calls every time. `[sound]`
- **Personalized surround sound:** Speakers tuned for a theater-like, 360 degree listen rather than a flat one. `[sound]`
- **IPX4 water resistance:** Ready for a workout or a walk in the rain. `[durability]`
- **Charges in about 2 hours:** A single plug-in covers the week. `[battery]`
- **3.5mm AUX cable included:** A wired option for the plane seat or the desk that will not pair. `[connectivity] [value]`
- **The default headphone:** The over-ear equivalent of the Everyday Earbuds, and the one most people should start with. `[value]`
- **4,953 reviews at 4.59 stars:** The highest-rated headphone in the range by review average. `[value]`
- **3 colourways:** Carbon Black, Rose Gold, and Frost White. `[design]`

---

## H41 — Fitness Headphones
**Source:** https://rayconglobal.com/products/the-fitness-headphones
**Verified:** 2026-08-06

- **3 quick-swap cushions:** One PU leather set and two breathable sets, so the pair that just did a workout is not the pair you wear to the office. `[comfort] [design]`
- **Swappable means fresh:** Cushions come off and go back on, which is the fix every other gym headphone skips. `[durability] [comfort]`
- **45 hours with ANC off:** Nearly two full days of playtime between charges. `[battery]`
- **38 hours with ANC on:** Even with cancellation running the whole time, it outlasts the week. `[battery]`
- **Active noise cancellation:** Shut the gym floor out when the set needs your attention. `[sound]`
- **Awareness mode:** Let the room back in between sets or on the walk home. `[awareness]`
- **IPX4 sweat resistance:** Rated for the sweat a real session produces. `[durability]`
- **5 microphones:** Five in-unit mics keep calls clear mid-session. `[sound]`
- **Multipoint connectivity:** Phone and watch connected at once, no re-pairing between them. `[connectivity]`
- **Charges in about 2 hours:** Plug in after training and they are ready before you are. `[battery]`
- **AUX cable included:** A wired backup for the treadmill screen or a dead battery. `[connectivity] [value]`
- **Snug, ready-to-move fit:** Built to stay put when the workout does not. `[fit]`

---

## NOTETAKER — AI Notetaker
**Source:** https://rayconglobal.com/products/raycon-ai-notetaker
**Verified:** 2026-08-06

- **5 microphones:** Five mics pick up the room, so the person at the far end of the table lands in the transcript too. `[sound]`
- **Dual recording modes:** Records in-person conversations and phone calls, which is the difference between one useful device and two. `[design]`
- **60 hour battery:** 60 hours of conversation recording, or 40 hours of calls, on a charge. `[battery]`
- **0.19 inch thin:** Thinner than most phone cases, so carrying it is not a decision you have to make. `[design]`
- **MagSafe compatible:** Snaps onto a phone, a case, or any magnetic surface and stays there. `[fit] [design]`
- **Transcription in 120+ languages:** Real-time transcription across more than 120 languages. `[sound]`
- **AI summaries and action items:** The summary and the to-dos are written for you before you have left the room. `[value]`
- **Speaker identification:** Who said what, labelled, without you tagging anything. `[value]`
- **Unlimited cloud storage:** Every plan includes unlimited storage, so nothing gets deleted to make room. `[value]`
- **Works standalone or with the app:** Record with one tap whether or not your phone is anywhere near you. `[controls]`
- **A free tier that is actually usable:** 5 hours a month at no cost, with 25 hours a month on the paid plans. `[value]`

---

## RACSPN3 — Magic Spin Cable (3 ft)
**Source:** https://rayconglobal.com/collections/power-tech/products/magic-spin-cable
**Verified:** 2026-08-06

- **Ends rotate 180 degrees:** The connectors turn with the cable instead of fighting it, which is where fraying starts. `[durability] [design]`
- **Frayproof by design:** The failure point on every other cable is engineered out of this one. `[durability]`
- **3 foot length:** Short enough to stay tidy on a desk or a nightstand without a loop of slack. `[design]`
- **USB-C version:** For Android and iPhone 15 and newer. `[connectivity]`
- **Lightning version:** For iPhone 13, 14, and older, so the older phone in the house is covered too. `[connectivity]`
- **4 colourways:** Black, Blue, Purple, and Mint. `[design]`
- **Pairs with any Raycon purchase:** Every product in the range charges over cable, so this is the accessory that is never wasted. `[value]`
- **2,836 reviews:** The most-reviewed accessory Raycon sells. `[value]`

---

## RACSPN6 — Magic Spin Cable (6 ft)
**Source:** https://rayconglobal.com/collections/power-tech/products/magic-spin-cable
**Verified:** 2026-08-06

- **Ends rotate 180 degrees:** The connectors turn with the cable instead of fighting it, which is where fraying starts. `[durability] [design]`
- **Frayproof by design:** The failure point on every other cable is engineered out of this one. `[durability]`
- **6 foot length:** Reaches from a wall socket to a sofa or a bed, which 3 feet never quite does. `[design]`
- **USB-C version:** For Android and iPhone 15 and newer. `[connectivity]`
- **Lightning version:** For iPhone 13, 14, and older, so the older phone in the house is covered too. `[connectivity]`
- **4 colourways:** Black, Blue, Purple, and Mint. `[design]`
- **The everyday length:** Long enough to use the device while it charges, short enough not to tangle. `[value]`
- **2,836 reviews:** The most-reviewed accessory Raycon sells. `[value]`

---

## RACSPN10 — Magic Spin Cable (10 ft)
**Source:** https://rayconglobal.com/collections/power-tech/products/magic-spin-cable
**Verified:** 2026-08-06

- **Ends rotate 180 degrees:** The connectors turn with the cable instead of fighting it, which is where fraying starts. `[durability] [design]`
- **Frayproof by design:** The failure point on every other cable is engineered out of this one, and 10 feet of cable has more of them. `[durability]`
- **10 foot length:** Crosses a room, so the socket behind the sofa stops dictating where you sit. `[design]`
- **USB-C version:** For Android and iPhone 15 and newer. `[connectivity]`
- **Lightning version:** For iPhone 13, 14, and older, so the older phone in the house is covered too. `[connectivity]`
- **4 colourways:** Black, Blue, Purple, and Mint. `[design]`
- **Built for the awkward outlet:** The one that is always too far from the bed, the desk, or the seat. `[value]`
- **2,836 reviews:** The most-reviewed accessory Raycon sells. `[value]`

---

## ADAPTER45 — Magic Travel Adapter (45W)
**Source:** https://rayconglobal.com/products/magic-travel-adapter-45w
**Verified:** 2026-08-06

- **45W USB-C power delivery:** Enough to fast-charge a phone and keep a laptop alive off one plug. `[value]`
- **4 USB ports:** 2 USB-C and 2 USB-A, so the new devices and the old ones charge together. `[connectivity]`
- **2 AC outlets:** Two full sockets on top of the USB ports. `[connectivity]`
- **Charges 5 to 7 devices at once:** One adapter replaces the tangle of chargers in the bag. `[value]`
- **Built-in JP/US, AU, EU, and UK sockets:** Four plug standards folded into one body, so there is nothing else to remember. `[design]`
- **Works in 180+ countries:** Enough coverage that you stop checking before you book. `[design]`
- **Retractable prongs:** The pins fold away instead of catching on everything in the bag. `[durability] [design]`
- **Retractable USB-C cable included:** The cable lives in the adapter, so it cannot be the thing you left at home. `[value]`
