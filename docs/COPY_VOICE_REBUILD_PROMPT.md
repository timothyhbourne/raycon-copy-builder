# Copy Voice Rebuild — realign generation with the real Raycon voice

You are fixing degraded copy output in `raycon-copy-builder` (Next 16, React 19). Read `AGENTS.md` first. This task touches ONLY `src/lib/prompts/*` and `data/` reference material — no UI, no API route logic, no schemas.

## Diagnosis (already done — don't re-litigate, execute)

The generation prompt (`src/lib/prompts/generate.ts`, 254 lines) accreted patch-on-patch and now works against the brand:

1. **It banned the actual Raycon voice.** Real sent Raycon emails (transcribed in the Appendix below) freely use friendly urgency ("20% off sitewide ends soon", "Hurry back to score some amazing deals before the sale ends Tuesday!"), rhetorical-question openers ("Need new earbuds that can keep up with you?"), exclamation points, and the occasional parallel fragment ("Sound that keeps up. Awareness that keeps you safe."). The current prompt forbids ALL of these as "AI slop". With the natural register fenced off, the model substitutes strained literary cleverness.
2. **It demands the wrong copywriter.** "Conceit as throughline", a "technique palette" (tension and release, unexpected angle, point of view), and dial-5 instructions to be "surprising, edgy, screenshot-worthy" produce paradox constructs ("Sound and awareness. Pick neither."), personified objects ("Your ears have until midnight"), and spec-wall one-liners — none of which appear in real Raycon emails.
3. **Rule dilution.** The instruction load (254-line role prompt + 592-line brand-voice.md + 234-line hard-rules.md + 8 full reference campaigns) is so heavy that even absolute rules leak — the bad outputs contain em dashes despite four separate em-dash bans.

The fix: define the voice **positively** from real emails, cut the rule mass drastically, and keep only a short list of true bans.

## The target voice (source of truth for everything below)

Warm, plain-spoken **retail advertorial**. Professional but friendly. Sells plainly and cheerfully. Second person, contractions, short spoken-rhythm sentences (~grade 6–8 readability). Lighthearted; very occasionally punny (max one gentle, product-tied pun per email — "code DREAMS-ZZ", "Never Gets Old"). Urgency is upbeat, not fearful, and names the day when known ("Deal ends Sunday"). Benefit-first product one-liners of 5–12 words. Mainstream and crowd-pleasing, never ironic, tense, or literary. If in doubt: simpler, warmer, more direct.

---

## Step 1 — Create a shared voice module

Create `src/lib/prompts/voice.ts` exporting a single constant `RAYCON_VOICE` containing exactly this text (verbatim):

```
THE RAYCON VOICE. You are writing for Raycon, a friendly, mainstream consumer electronics brand. The register is a warm retail advertorial: professional, clear, upbeat, lightly playful. You are a helpful salesperson the reader likes, not a clever ad-school copywriter.

How it sounds (these are real Raycon lines — match this register):
- Body copy: "Tap into Sleep Mode and let five built-in ambient sounds handle the rest. No app, no phone, no counting sheep. Just a slim, side-sleeper-approved fit and 15 hours of quiet."
- Body copy: "Friendly reminder that Mother's Day is on May 10th this year. And that our Mother's Day sale is still running and everything is up to 50% off."
- Body copy: "There's a couple reasons these are our most popular earbuds ever. They fit comfortably and hold a charge all day. They come in colors that go with whatever you're wearing."
- Product one-liners: "Comfortable listening for all-day play." / "No-budge fit with a 56 hour battery life." / "Pocket-sized sound for active days." / "Fresh workouts with sweatproof cushions that swap."
- Headlines: "Time to Lock In" / "Let's Get Moving" / "Open For Everyone" / "Tonight's your night" / "Never Gets Old" / "Time's Almost Up!"
- Urgency: "Deal ends Sunday." / "Hurry back to score some amazing deals before the sale ends Tuesday!" / "You've got time. Make this Mother's Day count with these great deals."

Voice rules:
1. Short, plain, spoken sentences. Contractions always ("you're", "we've", "don't"). Second person. Starting a sentence with "And" or "Then" is fine. Aim for how a friendly person actually talks.
2. Benefit first, spec second. Name what the product does for the reader's day (sleep, workouts, commute, calls), then back it with 1–2 concrete specs. Never stack more than 2 specs in one sentence.
3. Product one-liners are 5–12 words, benefit-led, plain. Not spec inventories.
4. Urgency is cheerful and concrete. "Ends soon" is fine; naming the day is better ("Deal ends Sunday"). Exclamation points are allowed, max 2 per email. Urgency never sounds fearful or dramatic.
5. Friendly question openers are allowed ("Need new earbuds that can keep up with you?", "Looking for something else?") — at most one per email.
6. A parallel fragment pair may close a section ("Sound that keeps up. Awareness that keeps you safe.") — at most one per email, and only when it lands naturally.
7. Light wordplay is welcome but rare: at most one gentle, product-tied pun per email, and only when it comes easily. When in doubt, skip it.
8. The offer is stated plainly and proudly ("30% off the Fitness Earbuds", "everything is up to 50% off"). No coyness about selling — this is a sale email and the reader knows it.

Hard bans (short list — these are absolute):
- Em dashes and en dashes anywhere. Use a period, comma, or colon.
- Literary tension or paradox constructs: "It's not X, it's Y", "Pick neither", "Both. Right Now.", clever inversions, antithesis. Raycon never poses riddles.
- Personifying objects or body parts ("Your ears have until midnight", "Your run wants the world").
- Hype intensifiers: "game-changer", "next-level", "unleash", "elevate", "revolutionary", "seamless", "effortless", "curated", "must-have", "obsessed".
- Invented facts: product names, specs, and numbers match the catalogue exactly; never invent reviews, quotes, or people. Numerals and symbols, never words ("30%", "$79.99", "56 hours").
- Offer mechanics (discount %, promo code) inside a product one-liner. They live in CTAs, taglines, and body copy.
- More than one parallel-fragment pair per email, and never as the default sentence shape.

The failure mode to avoid is over-writing: copy that is tense, conceptual, self-consciously clever, or literary. If a line sounds like it is trying to impress another copywriter, replace it with the line that would make a shopper smile and click.
```

## Step 2 — Rewrite `generateRoleInstruction` in `src/lib/prompts/generate.ts`

Replace the entire `generateRoleInstruction` string. New structure, in order (target: under 100 lines total, versus 135 today):

1. One-line job statement ("Your job in this step is to write the full email campaign copy.").
2. Interpolate `RAYCON_VOICE` (import from `./voice`).
3. **Campaign angle** (replaces "conceit as throughline" and the technique palette — DELETE both): "The chosen conceit is the campaign's angle: an occasion, a product truth, or a customer moment, expressed in plain retail language. Let it shape the headline and body naturally. Do not force it into every module, and never treat it as a literary theme to develop. Each module's first job is to sell clearly."
4. **Structure hierarchy**: keep the existing single-product-above-the-fold block verbatim (it's good and unrelated to the voice problem).
5. **Element craft**, compressed to essentials:
   - Headline: 2–4 words, warm and plain.
   - Tagline: one sentence, max 12 words; states the offer or the promise, not both.
   - Subheader: max 6 words; keep the 3-variant array requirement exactly as it exists today (output shape must not change).
   - Body copy per module: 2–4 short sentences in the voice; may restate the offer/code at the end.
   - One-liners: per the voice rules (5–12 words, benefit-led).
   - CTAs: 2–4 word action phrases; offer mechanics belong here ("Get 30% Off", "Shop the Sale"); no product names inside CTAs.
   - Hero Image Direction: 30–50 words of designer notes, no editorial commentary.
   - Closing line: one plain sentence, max 12 words.
6. **Subject lines / preview texts**: keep three slots but redefine to the real register: (1) DIRECT — the offer or product, plainly ("Fitness Earbuds: 30% off ends tonight."); (2) FRIENDLY/PLAYFUL — warm, human, maybe the one light pun; (3) CONVERSATIONAL/CURIOSITY — sounds like a person, opens a small gap without shouting the discount. All under the existing caps (50/90 chars). Distinct in rhythm and opening word. Preview complements its subject, never repeats it. DELETE the "one breath / two-part structure" cadence lecture entirely.
7. **References**: "Study the reference campaigns for register and rhythm. At low tone dials, stay close to the closest match; at higher dials, write fresh copy in the same voice." (Two sentences — delete the long imitation-strictness treatise; the voice module now carries the register.)
8. **Final pass**, cut to four gates: (a) length caps + Subheader = array of 3 distinct options; (b) every hard ban in the voice rules holds; (c) offer integrity (mechanics in CTAs/taglines only, per-product discounts exact, scope honest); (d) catalogue accuracy.

Preserve untouched: the JSONL output contract, section catalogue references, the COMPLETENESS block, and the "USER'S LITERAL INSTRUCTIONS outrank" block in `generateUserPrompt` — only the role instruction and the reference-usage paragraph in the user prompt change.

## Step 3 — Recalibrate `toneDirective` (same file)

The dial now scales **playfulness and distance from the references**, never register. Rewrite the five levels (keep them short, 2–3 sentences each):

- 1: Trace the closest reference closely; adapt it to the new offer; no phrasing absent from the references.
- 2: Stay close to the references; smooth for flow; pick the sharper of two on-brand options.
- 3: Fresh copy in the Raycon voice. Natural, conversational, warm. No tracing, no straining.
- 4: More personality: playful headlines, a lighter touch, the one allowed pun is welcome here. Still plainly a friendly retail email.
- 5: Maximum warmth and play WITHIN the same register: the punniest, most personality-forward version of a friendly Raycon email. Explicitly state: dial 5 is NOT license for literary devices, tension constructs, edginess, or "screenshot-worthy" originality — those violate the voice at every dial. It's the difference between a cheerful salesperson and a very charming cheerful salesperson.

## Step 4 — Align the sibling prompts

- `src/lib/prompts/conceits.ts`: conceits must be simple retail angles (an occasion, a product truth, a customer moment, a deal framing) described in plain language — e.g. "Last-call urgency: the sale ends tonight, lead with the deadline" — never literary conceits like "Caught Between Two Worlds". Import `RAYCON_VOICE` or add a two-sentence version of the register note. Keep the output schema (id/name/description) identical.
- `src/lib/prompts/regenerate-section.ts` and `regenerate-meta.ts`: replace any duplicated voice/cadence rules with the shared `RAYCON_VOICE` import so a single source of truth governs all generation paths. Keep their mechanical/output instructions unchanged.
- `src/lib/prompts/brief.ts` and `copy-seed.ts`: read them; only change if they contain the old banned-cadence lists or "conceit as literary theme" language (align, don't rewrite).

## Step 5 — Reconcile the grounding docs (report, don't bulldoze)

Read `data/brand-voice.md` and `data/hard-rules.md`. They are user-authored. Do NOT mass-edit. Produce a section in your final summary listing every rule in them that **contradicts** the new voice spec (e.g. bans on rhetorical questions, "ends soon", exclamation points, parallel fragments — if present), so the team can approve removals. Only make edits that are unambiguous corrections (e.g. if a doc bans something the real sent emails in the Appendix demonstrably do). When you do edit, keep a changelog comment at the top of the file.

## Step 6 — Add the real emails as reference material

The Appendix below transcribes 9 real sent Raycon emails (the voice benchmark). Convert each into a library entry in `data/library/` using the existing library-entry format (inspect an existing file in `data/library/` first and match its frontmatter/structure exactly; dates approximate from context; `conceit` = one plain sentence describing the angle). These will then be retrieved as reference campaigns at generation time. Mark them in frontmatter as e.g. `source: sent-email-benchmark` if the format has a source field; otherwise note it in the body.

## Step 7 — Rollback safety + A/B verification

1. Before rewriting, copy the current `generateRoleInstruction` and `toneDirective` into `src/lib/prompts/legacy-generate.ts` (exported, unused). Add env flag `COPY_PROMPT_LEGACY=1` support in `src/app/api/generate/route.ts`: when set, use the legacy instruction. One `if`, clearly commented — this is the rollback lever.
2. Verification: `npm run build` passes. Then run the SAME brief through both prompts (legacy flag on, then off) — use a realistic brief: flash-sale, Fitness Earbuds, 30% off, code, 5-section structure, tone dial 3. Save both raw outputs to `data/raw/prompt-ab/` as markdown. In your final summary, show the two side by side for: subject lines, headline, tagline, one body section, one one-liner — and check the new output against the voice rules (no em dashes, no tension constructs, one-liners 5–12 words, plain warm register).
3. Do not delete the legacy file — the team decides after reviewing the A/B.

## Commit order

1. voice.ts + generate.ts rewrite + toneDirective
2. sibling prompt alignment
3. library entries from the Appendix
4. legacy fallback + A/B outputs
Summary must include: the brand-voice/hard-rules conflict list (Step 5) and the A/B comparison (Step 7).

---

# Appendix — transcribed sent Raycon emails (voice benchmark)

## 1. Sleep Earbuds (product spotlight, Mother's Day period)
- Headline: "Tonight's your night" / Sub: "The Sleep Earbuds."
- Offer: "$65 off with code DREAMS-ZZ" / CTA: "MEET THE SLEEP EARBUDS"
- Body: "Tap into Sleep Mode and let five built-in ambient sounds handle the rest. No app, no phone, no counting sheep. Just a slim, side-sleeper-approved fit and 15 hours of quiet. $65 off with code DREAMS-ZZ." / CTA: "CLAIM IT"
- USPs: "Built-in ambient sounds" / "Side-sleeper fit" / "45 hours of battery"
- Cross-sell: "Looking for something else? The full collection is 15–50% off during our Mother's Day Sale. Find your next great audio upgrade today." / CTA: "SHOP EVERYTHING"

## 2. New Year Sale (headphones, promo)
- Headline: "TIME TO LOCK IN" / Tagline: "Block out distractions and focus on your goals with new headphones." / CTA: "SHOP NOW"
- Body: "Say no to distractions this year at school, at work or the gym with our headphones and save 20% off today. Upgrade your sound and save 20% off sitewide during our New Year Sale. Pick up any Fitness audio and save even more while they're 25% off."
- Cards: "Everyday Headphones — Comfortable listening for all-day play." / "Fitness Headphones — Fresh workouts with sweatproof cushions that swap." / "Pro Headphones — Experience premium audio with power that lasts."

## 3. Everyday Earbuds Classic (evergreen product story)
- Headline: "NEVER GETS OLD" / Sub: "THE EVERYDAY EARBUDS CLASSIC STILL GOT IT" / CTA: "GET 15% OFF"
- Body: "There's a couple reasons these are our most popular earbuds ever. They fit comfortably and hold a charge all day. They come in colors that go with whatever you're wearing. And the button controls mean you don't have to fidget with multiple taps to control your playlist. Some things earn their reputation. Find out why the Classic is one of them." / CTA: "GRAB YOURS"
- USPs: "ERGONOMIC FIT — comfortable fit for long wear, stable and secure" / "BUTTON CONTROLS — reliable, control every time" / "ACTIVE NOISE CANCELLATION — block out the noise"

## 4. Open Audio collection (Mother's Day, multi-product)
- Headline: "Open For Everyone" / Tagline: "Find the Open Audio that's right for you. PLUS save an extra 5% off sitewide deals with code: MOTHER." / CTA: "FIND YOUR MATCH"
- Card 1: "Fitness Open Earbuds — You've got a route, a playlist, and you don't want to miss either. The Fitness Open Earbuds hook over the ear and deliver big sound while keeping you tuned into what's around you. Sound that keeps up. Awareness that keeps you safe." / CTA: "GET 25% OFF"
- Card 2: "Everyday Clip Earbuds — The ones that stay out of the way and still turn heads. The Everyday Clip Earbuds sit at the side of the ear, perfect for glasses or hats. Great sound with a style to match." / CTA: "GET 20% OFF"
- Card 3: "Bone Conduction Headphones — Completely clear of the ear. The Bone Conduction Headphones sit beside the ear, leaving the ear canal fully open. Wear them all day. Forget they're there. The most open way to listen." / CTA: "GET 25% OFF"
- Cross-sell: "Our entire collection is 15–50% off during the Mother's Day Sale. (PLUS you save an additional 5% with your exclusive code, MOTHER) Find your next great audio upgrade today." / CTA: "SHOP THE SALE"

## 5. Mother's Day reminder (promo)
- Headline: "Great Gear, Better Prices" / Tagline: "15–50% off sitewide for Mother's Day" / CTA: "SHOP NOW"
- Body: "Friendly reminder that Mother's Day is on May 10th this year. And that our Mother's Day sale is still running and everything is up to 50% off. Everyday Earbuds Classic built for all-day wear. Fitness Open Earbuds made for her workouts. Everything in colors she'll want to reach for every morning. You've got time. Make this Mother's Day count with these great deals."
- Offer block: "PLUS, as a special thank you, we're throwing in an extra 5% off. Use code MOTHER to activate your exclusive subscriber discount today." / CTAs: "USE CODE: MOTHER" / "GET EXTRA 5% OFF"
- Cards: "Fitness Open Earbuds — Go further with a secure fit that won't quit." / "Fitness Earbuds — No-budge fit with a 56 hour battery life." / "Everyday Earbuds Classic — Pocket-sized sound for active days."

## 6. Go For Gold Sale (Olympics-timed promo)
- Banner: "GO FOR GOLD SALE" / Headline: "Sound That Flows" / Tagline: "Champion-level sound built for bold moves and nonstop momentum." / CTA: "SHOP NOW"
- Body: "The podium's still open. And at Raycon, everyone's a winner this month with 20% off everything. Whether you're chasing playlists, power or peace and quiet, we've got tech built to perform."
- Cards: "Essential Open Earbuds — Featherlight, minimalist design for all day comfort." / "Everyday Headphones — Comfortable listening for all-day play." / "Fitness Earbuds — No-budge fit with a 56 hour battery life."

## 7. Fitness Earbuds weekend flash sale
- Headline: "LET'S GET MOVING" / Tagline: "30% off Fitness Earbuds this weekend!" / CTA: "GET 30% OFF"
- Body: "Need new earbuds that can keep up with you? Then this exclusive, weekend flash sale is for you:"
- Offer block: "30% OFF THE FITNESS EARBUDS / USE CODE: GETFIT30 / Deal ends Sunday" / CTA: "GET 30% OFF"
- Spec callouts: "No-budge fit" / "IPX7 Waterproof" / "56 Hour Battery life"
- Cross-sell: "Everything is 20–50% off this month during the Spring Refresh Sale. You're sure to find a great deal on your next favorite audio at Raycon!" / CTA: "GET 30% OFF"

## 8–9. Sale last call (sitewide, sent twice)
- Headline: "Time's Almost Up!" / Tagline: "20% off sitewide ends soon." / CTA: "SHOP ALL DEALS"
- Body: "Time's running out to score winning deals on all our earbuds, headphones and Open Audio! Choose anything from longtime favorites like the Everyday Earbuds to our latest Open Audio that just came out this week, the Everyday Clip Earbuds."
- Banner: "Hurry back to score some amazing deals before the sale ends Tuesday!"
- Cards: "Everyday Clip Earbuds — Lightweight, clip-on sound that keeps you aware" / "Essential Open Earbuds — Featherlight, minimalist design for all day comfort." / "Everyday Headphones — Comfortable listening for all-day play."
- Kickstarter block: "RAYCON AI NOTETAKER — NOW LIVE ON KICKSTARTER. Early Bird Pricing $149 → $97, while supplies last, limited to first 1,000 backers. Your meetings, transcribed. Your ideas, captured. Your flow, uninterrupted." / CTA: "GET EARLY BIRD"
