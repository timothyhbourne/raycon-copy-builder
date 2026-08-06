# Raycon Product Catalogue

The complete reference for all active Raycon products. Use product slugs (lowercase, hyphenated) as the canonical identifier in campaign briefs. SKU codes (E25, E45, B42, etc.) are how the products are referenced inside past campaign copy. Both are listed here so the AI can map between them.

**Related files.** This document is the narrative catalogue and is injected into every prompt. The per-product USP banks live in `data/product-usps.md` and the brand-level bank in `data/company-usps.md`; those are injected per section, scoped to the bound product, and are the only sanctioned source for shipping, returns, and warranty claims. Key features below were reconciled against the live product pages on 2026-08-06; where the two disagreed, the live page won.

---

## Open Audio

### Essential Open Earbuds
- **Slug:** `essential-open-earbuds`
- **SKU code:** O15
- **Internal model:** RBO715
- **URL:** https://rayconglobal.com/products/essential-open-earbuds
- **Price:** $63.99 (regular $79.98)
- **Official tagline:** Featherlight, minimalist design for all day comfort.
- **One-liner:** The easiest way into open-ear sound. Hooks over the ear in seconds, tap controlled, featherlight.
- **Key features:** Featherlight open-ear hook, Bluetooth 6.0, Multipoint connectivity (2 devices), 36 Hour Total Battery (8h per charge), IPX4 Water Resistant, Wireless charging case
- **Colours:** Carbon Black, Midnight Blue, Cool Mint, Blush Violet
- **Positioning:** Entry point to Open Audio. For anyone curious about open-ear listening.

### Fitness Open Earbuds
- **Slug:** `fitness-open-earbuds`
- **SKU code:** O25
- **Internal model:** RBO725
- **URL:** https://rayconglobal.com/products/fitness-open-earbuds
- **Price:** $79.99 (regular $99.98)
- **Official tagline:** Go further with a secure fit that won't quit.
- **One-liner:** Hooks over the ear, delivers big sound while keeping you tuned into the world around you. Built for runs, walks, commutes.
- **Key features:** Multi-Angular Hook (fit that won't budge), IPX5 Waterproof, 40 Hour Total Battery (8h per charge), Open Design, Multipoint connectivity, DSP call clarity
- **Colours:** Midnight Blue, Cool Mint, Carbon Black, Blush Violet
- **Positioning:** For active listeners who need awareness alongside their soundtrack.

### Bone Conduction Headphones
- **Slug:** `bone-conduction-headphones`
- **SKU code:** B42
- **Internal model:** RBB842
- **URL:** https://rayconglobal.com/products/bone-conduction-headphones
- **Price:** $79.99 (regular $99.98)
- **Official tagline:** Total awareness with bud-free listening.
- **One-liner:** Sits beside the ear and transmits audio as vibrations to the inner ear. Leaves the ear canal fully open. The most open way to listen.
- **Key features:** Bone conduction technology, IP68 Waterproof, 13 Hour Battery Life, Adjustable speaker arms, No ear canal seal, Featherlight frame
- **Colours:** Gray, Blush Violet, Royal Blue, Cool Mint, Jolly Rancher Watermelon
- **Sizes:** Standard and Small (verified live 2026-08-06)
- **Positioning:** Premium, understated, category-of-one. Wear all day and forget they're there.

### Everyday Clip Earbuds
- **Slug:** `everyday-clip-earbuds`
- **SKU code:** O55
- **Internal model:** RBO755
- **URL:** https://rayconglobal.com/products/everyday-clip-earbuds
- **Price:** $79.99 (regular $99.98)
- **Official tagline:** So light you'll forget they're there.
- **One-liner:** Open-ear sound that stays put through every motion. Sits on the side of the ear, no hook, no seal. Easy to wear with glasses or hats.
- **Key features:** Nickel-Titanium aerospace memory metal clip (holds shape, featherlight), Physical Button Control, Bluetooth 6.0, IPX5 Water Resistant, 30 Hour Total Battery (8h per earbud)
- **Colours:** Carbon Black, Midnight Blue, Blush Violet
- **Top customer feedback words:** Great, Easy, Comfortable
- **Positioning:** Style-forward open audio. For glasses-wearers and hat-wearers who can't use ear hooks.

---

## Earbuds (In-Ear)

### The Everyday Earbuds
- **Slug:** `everyday-earbuds-classic`
- **SKU code:** E25
- **URL:** https://rayconglobal.com/products/the-everyday-earbuds
- **Price:** $63.99 (regular $79.98)
- **Official tagline:** Pocket-sized buds, marathon-sized battery.
- **One-liner:** Timeless, confident, familiar. Fits just right, goes all day, comes in colours worth choosing.
- **Key features:** Ergonomic gel-tip fit, ANC / Awareness mode, IPX4 Water Resistant (rain, snow, sweat), 2 Microphones for calls, 32 Hour Battery Life
- **Live-page note (2026-08-06):** IPX4 and the 2-microphone count are confirmed on the product page and were missing here. "Physical button controls" and multipoint are NOT stated on the live page — do not claim either for the E25.
- **Colours:** Carbon Black, Electric Blue, Rose Gold, Cool Mint, Blush Violet
- **Positioning:** The flagship. Most popular earbud. The default Raycon recommendation.
- **NAMING:** Call this "Everyday Earbuds" (or "the Everyday Earbuds"). The "Classic" name is retired in all new copy. The slug `everyday-earbuds-classic` stays unchanged internally and is never shown to readers. Full rule in `copy-system.md`.
- **Special editions:** MLB Edition (Dodgers, Yankees, Astros, Phillies, Cubs, Red Sox), Hershey's collab (Silver Foil, Cotton Candy, Mango, Donut Operator).

### Everyday Earbuds Plus
- **Slug:** `everyday-earbuds-plus`
- **SKU code:** E26
- **URL:** *NONE. Verified 2026-08-06: there is no live product page. `/products/everyday-earbuds-plus` returns 404, and the Plus does not appear in `/collections/earbuds` or `/collections/all`. Every spec below is internal-only and unverifiable against the storefront.*
- **Official tagline:** Feels like nothing, sounds like everything.
- **One-liner:** Fits like a glove and delivers great sound. Ready if life gets a little wild.
- **Key features:** Ergonomic and comfortable fit, IP66 Dust and Waterproof, 32 Hour Battery Life
- **Stock note:** Violet colourway is the active US SKU (other colours phased out).
- **Positioning:** Premium, tougher, more weather-ready in-ear.
- **INCLUSION RULE (flash sale only):** Feature the Everyday Earbuds Plus only when the campaign is a huge flash sale on the Plus itself (a deep, headline-grade discount, e.g. codes PLUS40, EDAY60, BLOOM50). In every other campaign, leave it out and substitute another in-ear product. Full rule in `copy-system.md`.

### The Fitness Earbuds
- **Slug:** `fitness-earbuds`
- **SKU code:** E45
- **URL:** https://rayconglobal.com/products/the-fitness-earbuds
- **Price:** $95.99 (regular $119.98)
- **Official tagline:** No-budge fit with a 56 hour battery life.
- **One-liner:** Secure fit that stays through the whole workout. Battery life that runs past the session. Sound that rewards you for showing up.
- **Key features:** Stabilizing gel fin (no-budge fit), ANC / Awareness Mode, IPX7 Waterproof, 56 Hour Total Battery (12h per charge), Multipoint connectivity, Bluetooth 5.3
- **Colours:** Cobalt Blue, Onyx Black, Everest Green, Lavender Purple
- **Positioning:** For anyone who moves and needs sound that stays with them — runs, training, hikes, long days on the go. The secure fit and big battery are the draw.
- **COPY GUIDANCE (not gym-only):** Lead with the broad active life (runners, walkers, commuters, parents on the move, travellers), not gym lingo ("gym", "leg day", "lifters", "reps", "sets"). Let the no-budge fit, IPX7, and 56-hour battery carry it. Full rule in `copy-system.md`.

### The Impact Earbuds
- **Slug:** `impact-earbuds`
- **SKU code:** E75
- **Internal model:** RBE745
- **URL:** https://rayconglobal.com/products/the-impact-earbuds
- **Price:** $119.99 (regular $149.98)
- **Official tagline:** Ultra-durable earbuds built for any adventure.
- **One-liner:** MIL-SPEC certified, IP67 waterproof, 90 hours total battery. Built to take a hit and keep playing.
- **Key features:** MIL-STD-810 impact resistant materials, IP67 Water and Dust Resistant, Drop resistant, ANC / Awareness Mode, 90 Hour Total Battery (12h per charge plus 78h in the capsule), Multipoint connectivity, 800mAh power bank capability (charges other devices), Bluetooth 5.3, Touch controls, 4 sets of stabilizing gel fins and 5 sets of gel tips, includes carabiner and lanyard
- **Live-page note (2026-08-06):** the page states "IP67 rating, water and dust resistant". The "1m immersion" figure was NOT on the page and has been removed.
- **Colours:** Graphite Black
- **Positioning:** Durability-first. For athletes, adventurers, and anyone in rough conditions. The most rugged earbud in the lineup.

### Sleep Earbuds
- **Slug:** `sleep-earbuds`
- **SKU code:** E60
- **Internal model:** RBE760
- **URL:** https://rayconglobal.com/products/sleep-earbuds
- **Price:** $84.99 (regular $149.98; frequently discounted)
- **One-liner:** Tap into Sleep Mode and let five built-in ambient sounds handle the rest. No app, no phone, no counting sheep.
- **Key features:** Ultra-slim low-profile design (side-sleeper optimised), Sleep Mode with 5 built-in ambient sounds (pink noise, brown noise, nature sounds), Sleep Mode disconnects Bluetooth entirely, No app required, Bluetooth 6.0 mode for music/podcasts, Touch controls, Passive isolation (no ANC), IPX4 Water Resistant, 45 Hour Total Battery in Sleep Mode (15h per charge), 27 Hour Total in Bluetooth Mode (9h per charge)
- **Standard promo codes:** DREAMS-ZZ ($65 off), DREAMS-ZZZ ($70 off)
- **Colour:** Midnight Blue is the hero
- **Positioning:** Calm, unhurried, sleep-specific. Single-purpose product.

### Pro Earbuds
- **Slug:** `pro-earbuds`
- **SKU code:** E95
- **URL:** https://rayconglobal.com/products/pro-earbuds
- **Price:** $119.99 (regular $149.98)
- **Official tagline:** Elite noise cancellation without the tech drama.
- **One-liner:** Hybrid ANC, six precision-tuned microphones, and 40 hours of battery. The Pro is for people who need it to just work.
- **Key features:** Hybrid Active Noise Cancellation (blends feedforward and feedback), Awareness Mode, 6 microphones for call clarity, Multipoint connectivity (2 devices), IPX5 Water Resistant, 40 Hour Total Battery (10h per charge), Quick Charge (10 min = 3 hours), Wireless charging case, 5 gel tip sizes
- **Colours:** Onyx Black, Chrome Blue, Digital Purple, Platinum Silver, Silk White
- **Positioning:** Premium productivity earbud. Best-in-class ANC and call quality for work and focus.

---

## Headphones

### Essential Headphones
- **Slug:** `essential-headphones`
- **SKU code:** H10
- **Internal model:** RBH810
- **URL:** https://rayconglobal.com/products/essential-headphones
- **Price:** $71.99 (regular $89.98)
- **Official tagline:** Reliable sound for your daily rhythm.
- **One-liner:** Comfort and immersive sound for travel, focus work, or finally getting a moment to yourself.
- **Key features:** Hybrid Active Noise Cancellation, Awareness Mode, 5 microphones for calls, Multipoint connectivity, Bluetooth 5.3, 50 Hour Battery Life, Cushioned earcups
- **Colours:** Frost White, Carbon Black, Midnight Blue, Blush Violet
- **Positioning:** Entry-level over-ear. Comfort-led. Strong ANC for the price.

### The Everyday Headphones
- **Slug:** `everyday-headphones`
- **SKU code:** H20
- **URL:** https://rayconglobal.com/collections/headphones/products/the-everyday-h20-headphones
- **Price:** $79.99 (regular $99.98)
- **Official tagline:** Your comfy, go everywhere, do everything, never-run-out-of-juice headphones.
- **One-liner:** Goes all day without quitting. Comfortable in any situation.
- **Key features:** Cloud Comfort cushioned fit, 50 Hour Battery, Active Noise Cancellation, Awareness Mode, Personalized Surround Sound, 5 beam-forming microphones, IPX4 Water Resistant, Bluetooth 5.0, 3.5mm AUX cable included
- **Colours:** Carbon Black, Rose Gold, Frost White
- **Positioning:** The headphones equivalent of the Classic earbud. Default recommendation.

### The Fitness Headphones
- **Slug:** `fitness-headphones`
- **SKU code:** H41
- **Internal model:** RBH841
- **URL:** https://rayconglobal.com/products/the-fitness-headphones
- **Price:** $64.99 (regular $129.98)
- **Official tagline:** Fresh workouts with sweatproof cushions that swap.
- **One-liner:** Sweat-proof, snug fit, ready to move when you are. Cushions swap out so they stay fresh.
- **Key features:** ANC / Awareness Mode, 3 Quick Swap removable cushions (PU leather + 2 breathable options included), Multipoint connectivity, 5 microphones, IPX4 Sweat Resistant, 45 Hour Battery (ANC off) / 38 Hour Battery (ANC on), AUX cable included
- **Colours:** Graphite Black, Frost White
- **Live-page note (2026-08-06):** the page lists Bluetooth 5.1 in the feature copy and 5.0 in the spec table. The two contradict, so do not name a Bluetooth version for the H41 in copy.
- **Positioning:** Headphones built for the gym and active use. Unique selling point: interchangeable cushions.

### Everyday Headphones Pro
- **Slug:** `everyday-headphones-pro`
- **SKU code:** H90
- **URL:** *NONE. Verified 2026-08-06: not present in `/collections/headphones` or `/collections/all`.*
- **Positioning:** Premium headphone tier. Not on the live storefront — do not feature it in campaign copy.

---

## Accessories

### Magic Spin Cable
- **Slug:** `magic-spin-cable`
- **SKU codes:** RACSPN3 (3 ft), RACSPN6 (6 ft), RACSPN10 (10 ft)
- **URL:** https://rayconglobal.com/collections/power-tech/products/magic-spin-cable
- **Price:** $24.98 per variant
- **Official tagline:** Ends rotate 180 degrees for frayproof charging.
- **Key features:** 180-degree rotating ends (prevents fraying), available in USB-C (Android/iPhone 15+) and Lightning (iPhone 13/14 and older), 3 lengths
- **Colours:** Black, Blue, Purple, Mint
- **Positioning:** Charging accessory. Cross-sell with any earbud or headphone purchase. Durability angle — "never fray" hook.

### Travel Adapter
- **Slug:** `travel-adapter`
- **SKU code:** ADAPTER45
- **URL:** https://rayconglobal.com/products/magic-travel-adapter-45w
- **Price:** $24.99 (regular $49.98)
- **Key features:** 45W USB-C power delivery, 2 USB-C + 2 USB-A ports, 2 AC outlets, charges 5-7 devices at once, built-in JP/US, AU, EU and UK sockets, works in 180+ countries, retractable prongs, retractable USB-C cable included
- **Colour:** Midnight Blue
- **Positioning:** Travel-ready charging companion.

---

## Recent Launches

### AI Notetaker
- **Slug:** `ai-notetaker`
- **SKU code:** N/A (new product line)
- **URL:** https://rayconglobal.com/products/raycon-ai-notetaker
- **Price:** $104.99 (regular $149.98; 30% off launch pricing)
- **Official tagline:** Record with one tap for instant AI transcription and smart summaries.
- **One-liner:** Records your conversations, transcribes in real time, gives you an AI-generated summary when it's over.
- **Key features:** 5 microphones, Dual recording modes (in-person + phone calls), 60 Hour Battery Life (40h for calls), 0.19" ultra-slim profile, MagSafe compatible, AI transcription in 120+ languages, Automatic summaries and action items, Speaker identification, Cloud storage (unlimited), Works standalone or with app
- **App:** Raycon Notes App (Apple App Store and Google Play)
- **Subscription tiers:** Free (5 hrs/month), Monthly Premium $15.99/mo (25 hrs/month), Annual Premium $99.99/yr (best value)
- **Standard promo:** 30% off launch pricing
- **Positioning:** Sharp, capable, calm. Professional setting. New category for Raycon — productivity device, not audio.

---

## SKU Code Reference Table

For parsing past campaigns where products are referred to by code:

| Code | Product |
|---|---|
| E25 | The Everyday Earbuds (historically labelled "Classic" in old copy — use "Everyday Earbuds" going forward) |
| E25-LE | Everyday Earbuds (Limited Edition) |
| E25-MLB | Everyday Earbuds (MLB Edition) |
| E26 | Everyday Earbuds Plus |
| E45 | The Fitness Earbuds |
| E60 | Sleep Earbuds |
| E75 | The Impact Earbuds |
| E95 | Pro Earbuds |
| O15 | Essential Open Earbuds |
| O25 | Fitness Open Earbuds |
| O41 | Open Headphones |
| O55 | Everyday Clip Earbuds |
| B42 | Bone Conduction Headphones |
| H10 | Essential Headphones |
| H20 | The Everyday Headphones |
| H41 | The Fitness Headphones |
| H90 | Everyday Headphones Pro |
| RACSPN3 | Magic Spin Cable (3 ft) |
| RACSPN6 | Magic Spin Cable (6 ft) |
| RACSPN10 | Magic Spin Cable (10 ft) |

---

## Common Promo Codes Seen in Past Campaigns

For pattern recognition only. Always use the code the user inputs for a new campaign.

| Code | Used For |
|---|---|
| MOTHER | Mother's Day sitewide extra 5% |
| EDAYMOM | Everyday Earbuds Classic Mother's Day flash |
| PLUS40 | Everyday Earbuds Plus 40% flash |
| EDAY60 | Everyday Earbuds Plus 60% final inventory |
| STRONGER | Fitness Earbuds 30% flash |
| GOALS | Fitness Earbuds and Open last day |
| FITOP30 | Fitness Open Earbuds 30% |
| HEARIT | Fitness Open Earbuds 25% Spring Refresh |
| LIVEWELL | Fitness Earbuds 30% flash |
| DREAMS-ZZ | Sleep Earbuds standard $65 off |
| FRESH40 | Fitness Headphones Spring Refresh |
| FRESH50 | All Headphones 50% Spring Refresh |
| GETFIT30 | Fitness Earbuds Spring Refresh weekend |
| BLOOM50 | Everyday Earbuds Plus Spring Refresh weekend |
| STEPUP50 | MLB Everyday Earbuds Classic |
| OUTDOOR | Get Outdoors Sale 15% sitewide |
| MEMDAY | Memorial Day Open Audio 25% |
| TOPDAD | Father's Day bundle |
| FRESH50 | Headphones 50% flash |

---

## Notes on this document

- Verify URLs and SKUs against the live Raycon store before relying on them in production copy. Last full reconciliation: 2026-08-06.
- Update when new products launch or existing ones are deprecated.
- The AI Notetaker's canonical URL is confirmed. The Everyday Earbuds Plus (E26) and Everyday Headphones Pro (H90) have NO live product page as of 2026-08-06 and their specs cannot be verified against the storefront.
- Shipping, returns, and warranty claims do not belong in this file. They live in `data/company-usps.md`, which is the only sanctioned source for them.
- Special editions (MLB colourways, Hershey's collab, etc.) inherit the parent product slug and are referenced by colourway in campaign copy.
