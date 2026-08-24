# Raycon Copy Builder — what to build next

A read of the whole repo (`src/`, `docs/` 48 specs, `worker/`, `data/`) against the
question: *which features would genuinely change how the team works, versus which
are polish?*

Branch note: this was read on `copy-voice-rebuild`, which is 2 ahead / 2 behind
`main`. One finding below (`performance-memory.ts`) exists only on `main`.

---

## The three structural gaps

Almost every worthwhile feature falls out of one of these. They are not bugs —
they are the seams where the app stops.

**1. The loop is open.** The app has an excellent *anti*-repetition memory
(`constructions.ts` → `buildAvoidBlock()` → every generate route) and no
*pro-performance* memory. `copy-performance.ts` computes RPR by angle, conceit
architecture, send stage and offer type — and its only consumer is a page nobody
generates from. Nothing measured ever reaches `prompts/generate.ts`. Consequence:
the copy engine can never be better than the day it launched. It varies, it
doesn't improve.

**2. The tool doesn't reach where the work actually happens.** `klaviyo.ts` is
read-only — every POST in it is a reporting endpoint. The only Klaviyo mutation
anywhere in `src/` is the lifecycle create-list route, which is permanently
disabled because member data was never ingested. So the pipeline is: brief →
generate → canvas → **clipboard** → Google Doc → Slack the designer → someone
rebuilds it by hand in Klaviyo → paste the campaign ID back into the planner. The
tool produces a document, not a campaign.

**3. Nothing runs on its own.** `vercel.json` has exactly one cron (weekly report,
Mon 13:00 UTC). `/api/promotions/sync`, `/api/lifecycle/sync` and
`/api/planner/sync` all document a schedule that was never wired —
`planner/sync/route.ts:202` literally says "to run this on a schedule later, wire
a scheduled task to POST here." Every planner number, every promo band and the
lifecycle snapshot are as fresh as the last time a human clicked a button.

---

## Tier 1 — build these

### 1. Push copy into Klaviyo as a draft campaign

**Why it's not a nice-to-have.** This is the single largest recurring labour cost
in the current workflow and the only place transcription errors can enter. Today
the handoff is `navigator.clipboard` HTML formatted for Google Docs
(`copy-builder/page.tsx:1116-1245`) plus a Slack message
(`planner/page.tsx:877-882`). Someone then retypes subject line, preview text and
every headline into Klaviyo.

**Shape.** `create_email_template` from the canvas → `create_campaign` (draft,
audience from the planner row's `audience_included`, which already carries real
Klaviyo segment IDs) → `assign_template_to_campaign_message`. Even a plain
single-column HTML render of the section structure is enough — design replaces
the template later, the *copy* is what has to survive intact.

**Compounding benefit.** It writes `klaviyo_campaign_id` back onto the planner row
automatically. That ID is currently hand-pasted, and when it's missing the metrics
sync returns `not_linked` and the send falls out of Copy Performance entirely.
Fixing the export fixes the attribution coverage problem for free.

**Effort:** medium. **Risk:** low — a draft campaign is not a send.

### 2. Wire the learning loop (it's ~70% built and one import away)

`src/lib/performance-memory.ts` exists **on `main`** — 150-word cap, `MIN_N`
guard, `MIN_ATTRIBUTED_SENDS = 5`, 180-day lookback, states associations not
causes, no dollar figures, fails open to `""`. It is a careful piece of work and
**nothing imports it.** It's also absent from `copy-voice-rebuild`, so it's at
risk of being lost in the next merge.

**Do first, though:** the statistics underneath it are currently too weak to feed
a prompt honestly.

- `copy-performance.ts:215` takes an **unweighted mean** of per-campaign RPRs, so
  a 2k test send counts the same as a 400k blast. `total_revenue` and
  `total_recipients` are already accumulated at `:209-210` — compute the pooled,
  recipient-weighted RPR and rank on that.
- It's univariate across 8 dimensions with no significance test and no
  multiple-comparison correction. "Angle = urgency wins" is confounded with promo
  windows and audience size. At minimum: show dispersion, and require a spread
  wider than the within-group variance before a signal is eligible for the block.

Feeding an unweighted, unconfounded mean back into generation would make the copy
converge on noise. Fix the estimator, then wire it. In that order.

**Effort:** small (wiring) + medium (estimator). **Value:** this is the feature
that makes the tool an asset that appreciates.

### 3. Capture which variant actually shipped

The generator emits 3 subject lines, 3 preview texts and 3 subheader options.
`subheader_selected` is recorded; SMS records `selected_variant`. **Email subject
and preview have no selection field at all** — `MetaBlock.tsx` renders all three
with no chosen state. Nothing, anywhere, knows which subject line was sent.

That single missing field is what permanently blocks subject-line learning, and
`COPY_PERFORMANCE_SPEC` §11 correctly parks subject correlation as "blocked on
sent-line capture." The cheapest fix isn't a UI toggle — pull the actual subject
from the Klaviyo campaign message during `/api/planner/sync` and match it back to
the generated options. Zero extra work for the writer, and it's ground truth
rather than what someone *intended* to send.

**Effort:** small. **Unblocks:** subject-line performance, A/B winner capture, the
element-level half of the learning loop.

### 4. Wire the remaining crons

Three routes were written for cron and never scheduled. Add them to
`vercel.json` and give `/api/planner/sync` a `CRON_SECRET` path (it's POST-only
with no secret auth today, unlike `lifecycle/sync/route.ts:19-29`).

Small but load-bearing: the weekly report's WoW deltas depend on the *prior*
snapshot existing (`reports/run.ts:63`), so any surface that quietly depends on
regular runs breaks silently when a human forgets.

**Effort:** an afternoon. **Value:** disproportionate.

### 5. Deliverability and list health

`VALUES_REPORT_STATISTICS` (`klaviyo.ts:255-263`) requests recipients, delivered,
opens, opens_unique, clicks, clicks_unique, conversion_value. Klaviyo's values
report also exposes unsubscribes, spam complaints and bounces on the same call.
Repo-wide grep for any of them: zero hits.

A brand mailing ~900k with a "Suppression Watch" tile on its lifecycle page
cannot currently see its own unsubscribe rate. The August campaign calendar
encodes a ~3 sends/week/person cap precisely because over-mailing is the known
risk — and the app has no instrument for the thing that cap exists to prevent.

Also: `delivered` is fetched and then discarded (`measure.ts:32-40`), so every
rate in the app is per-*recipient*, not per-*delivered*, contradicting
`WEEKLY_REPORT_PROMPT.md:188`.

**Effort:** small — extra fields on a call that already runs. **Value:** high.

---

## Tier 2 — real decisions depend on these

### 6. Flow message-level performance

"Which email in the Welcome series is dead weight" is the highest-value question a
lifecycle team asks, and it's currently unanswerable. Values reports group only by
`flow_id` (`klaviyo.ts:276`); Klaviyo supports `flow_message` grouping. Meanwhile
the Flow Builder stores `klaviyo_flow_id` and labels it "reference only"
(`schemas.ts:344`) while `/dashboard/flows` shows revenue keyed by that exact ID
and never joins to it. You cannot see whether the welcome email you wrote works.

### 7. Send-frequency and audience-overlap guardrails in the planner

`AudienceRef.id` on every planner row is a real Klaviyo segment ID, and
`CalendarView.tsx:85-94` already groups entries by day. Nothing warns you about
two sends hitting the same segment on the same day, overlapping included
audiences, or breaching the frequency cap.

Their own `AUGUST_2026_CAMPAIGN_CALENDAR.md` encodes five suppression rules (no
campaign within 2 days, exclude 14-day purchasers, cap ~3/week, exclude anyone in
an overlapping live flow, Suppression Watch excluded). Those rules live in a
markdown file and are enforced by memory. The data to enforce them in software is
already in the planner.

### 8. Turn the checks into a gate at the right moment

`hard-rules-check.ts` computes `report.ok` (`:300`) and **nothing consumes it**.
The result is a single toast showing the first four violations, and
`/api/finalize` never runs the checker at all. Repetition flags are React state,
cleared on reload — reopen a campaign and it shows a clean bill of health
regardless of what was found.

The fix isn't to block authoring (correct call, keep that). It's to make
`ready_for_design` a real transition: run hard rules + repetition + frequency
overlap + deadline-language honesty, persist the result, and make the person
acknowledge what's outstanding. A linter that nobody has to read is decoration; a
check at handoff is CI.

### 9. Lifecycle: resolve the two-model problem before building anything on it

There are two incompatible lifecycle models in the repo.

- `src/lib/lifecycle/model.ts` — 310 lines, 222 lines of tests, 10 stages, two
  axes (P(active) × engagement recency), badges, a fitted-P(alive) seam. **Its
  only importers are its own test file and one constant in a backtest script.**
  It is dead code.
- `src/lib/lifecycle/snapshot.ts` — what actually ships. Five hardcoded
  purchase-recency predicates, **no engagement axis at all**.

They disagree about the same customer: "at risk" is P(active) 0.50–0.80 in one and
"owns earbuds, 151–300 days" in the other. Worse, because the shipped path has no
engagement data, the Suppression Watch tile counts >365 days since last *order*
while the spec defines suppression as >365 days since last *engagement*
(`master_spec:105`). Someone who opens every email but hasn't reordered in 13
months is sitting in the suppression tile.

And the page is currently inert: `membersReady` is false because
`data/lifecycle-customers.json` was never produced, so Create-list and Export CSV
are permanently greyed out, and every "modeled monthly opportunity" dollar on the
page comes from hardcoded 8%/4%/1.5%/3%/6% response rates the page itself admits
are placeholders.

**Sequence:** run `scripts/ingest-orders.ts` → pick one model → feed realized
campaign results back into `assumed_response` (the planner already stores
`revenue`, `recipients` and `click_rate` per send; lifecycle never reads them).
Only then is the page falsifiable enough to act on.

### 10. Lifecycle activation via profile write-back

Both `lifecycle_activation_design.md:31-33` and the master spec call property
write-back → dynamic segments the **primary** path, because it's the only one that
gives auto-updating membership and **flow triggers on stage transition** — the
whole point ("fired on transition into the stage, not on a calendar"). It is
entirely unbuilt. The static-list fallback that was built caps at 10k of e.g.
303k win-back members, must be re-pushed daily, and carries its own comment
saying it was never verified against a live account.

Depends on #9. Once the models are reconciled and members exist, this is what
turns the lifecycle page from a dashboard into a revenue driver.

### 11. Cohort → planner row → brief, in one click

The two halves of the app never touch. A lifecycle cohort's recommendation is a
static string in a dashed box. `plannerRowToBriefSeed()` exists,
`inferAudience()` already recognises "lapsed"/"vip"/"winback". Small work,
converts an insight into a scheduled send.

---

## Tier 3 — worth doing, not urgent

- **Version history.** `saveToLibrary()` replaces by ID, autosave POSTs every
  1.5s, and final IDs are `YYYY-MM-DD-slug` with no suffix — two finals with the
  same name on the same day silently overwrite each other. No diff, no restore.
- **Real multi-user auth.** One shared credential, session token is a static HMAC
  of the username. No authorship, no locking: two tabs on the same library
  campaign overwrite each other via debounced autosave, last write wins, silently.
  Fine for one user; the first day two people write copy it's a data-loss bug.
- **Postscript CSV importer.** `metrics_source: "postscript_csv"` is declared in
  the type and has no writer. Every SMS number is hand-typed today.
- **`promotion_id` on planner rows.** Today the promotion is *guessed* from the
  send date via `promoOnDate()`. No way to say "this send is Black Friday," no
  promo-level revenue rollup — and `Promotion.targetRevenue` exists in the parsed
  data and is surfaced nowhere, so there's no plan-vs-actual anywhere in the app.
- **Surface the promo consolidation warnings.** `consolidate()` produces them,
  `/api/promotions` returns them, `promotions/page.tsx` destructures only
  `promotions/years/synced_at`. A sheet row with a broken date silently vanishes
  from the calendar with no signal.
- **Klaviyo → planner backfill.** Rows are hand-created, and Copy Performance
  measures coverage against planner rows — so a campaign sent but never planned in
  the app is invisible to both numerator and denominator, and coverage overstates
  itself.
- **USP bank editing in-app.** `SectionBuilder.tsx:302` tells a marketer "add them
  in `data/product-usps.md`." A code edit and a deploy to add a product benefit is
  the wrong shape for the person who has the knowledge.

---

## Things I'd not build

Naming these matters as much as the list above.

- **The React Flow canvas** (`FLOW_CANVAS_FEATURE_SPEC.md` — `@xyflow` + dagre +
  persisted layout). The lightweight `FlowMap.tsx` already does the job. Two
  competing specs; the lighter one won on merit. Don't relitigate.
- **Embeddings-based repetition.** Explicitly parked as phase 2 in
  `CONSTRUCTION_INDEX_PROMPT.md`. Char-trigram Jaccard at 0.65 catches
  near-duplicate wording well. Repeated *ideas* in different words is a real
  problem, but a small one relative to everything above — and the current auto-
  retry loop already handles the common case.
- **Dark mode, localisation, brand-voice admin UI.** Voice rules change rarely
  enough that the code-edit-and-deploy friction is a feature, not a bug. (The USP
  *bank* is different — that changes with the catalogue, see Tier 3.)
- **Splitting the two god components.** `copy-builder/page.tsx` is 1,846 lines and
  `planner/page.tsx` is 1,317 against a "~500 line" acceptance criterion in
  `ARCHITECTURE_REMEDIATION_SPEC` §7. It's the only unbuilt part of that spec.
  Do it *while* building #1 and #2 — as a standalone refactor sprint it produces
  no user-visible value, and the generation/autosave/repetition-retry loops in
  those files have no test coverage today, which is the actual risk.

---

## If you only do three things

1. **Push to Klaviyo as a draft campaign** — removes the manual retype, and
   auto-links the campaign ID that everything downstream depends on.
2. **Fix the RPR estimator, then wire `performance-memory.ts` into
   `/api/generate`** — the difference between a tool that varies and a tool that
   improves.
3. **Capture the sent subject line during metrics sync** — one field, and it's
   the prerequisite for every element-level learning feature on the roadmap.
