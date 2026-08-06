# Learning Loop — Feed Copy Performance Back Into Generation

**Status:** Ready to implement
**Area:** Copy generation (`/api/generate`, `/api/sms-generate`, `/api/flows/generate`) + Copy Performance
**Goal:** Make the writing engine aware of what has actually earned revenue on this account. Today `copy-performance.ts` knows which angles, conceits, and structures perform — and the generator never sees any of it. This closes that loop.

---

## 1. Why

The app measures performance (`src/lib/copy-performance.ts`, `/copy-performance`) and it writes copy (`src/lib/prompts/generate.ts`), but the two are disconnected. Every campaign is written from brand rules + retrieved examples + an anti-repetition memory — none of which know that, say, story-led conceits have out-earned offer-led ones for winbacks on this account.

The app already has the exact pattern for this: **`buildAvoidBlock()`** in `src/lib/constructions.ts` injects a recency/anti-repetition block into `generateUserPrompt(..., avoidBlock, ...)`. We add a sibling — a **performance block** — built from real revenue data. Same shape, same injection point, new signal.

**This is a nudge, not a straitjacket.** The block informs the writer; it never overrides brand voice, hard rules, or the user's explicit instructions.

---

## 2. Ground rules

1. **Next.js 16**; TypeScript `strict`; no `any`.
2. **Priority order is sacred.** The existing hierarchy (hard rules > user's literal instructions > brand voice > retrieved examples) gains performance guidance at a **low authority tier** — above generic examples, below everything the brand and user demand. It must never justify breaking a hard rule or ignoring a user instruction.
3. **Statistical honesty carries over from `COPY_PERFORMANCE_SPEC.md` §9.** Reuse `MIN_N` (currently 3). If a dimension value lacks the sample size, **it does not enter the prompt at all**. No guidance from n=1.
4. **Zero added Klaviyo calls.** Copy Performance is built on Redis store reads (`listPlannerRows` + saved/library campaigns) — the route explicitly makes no Klaviyo calls. Keep it that way. See `docs/ANALYTICS_RATE_LIMIT_SPEC.md`; this feature must not add upstream load.
5. **Fail open.** If performance data is thin, missing, or errors, generation proceeds exactly as it does today with an empty block. Never block writing on analytics.

---

## 3. What the block contains

Create **`src/lib/performance-memory.ts`** — pure, unit-tested, no fs/network (it receives resolved records, mirroring how `copy-performance.ts` is structured).

Input: the `PerformanceRecord[]` + `DimensionAgg[]` that `copy-performance.ts` already produces, plus the **current brief** (`BriefInput`) so guidance can be scoped.

Output: a short markdown block, **capped at ~150 words**, containing only well-evidenced signal:

1. **Scoped comparisons.** Where sample size allows, prefer guidance matching the brief's own `campaign_type` (e.g. for a winback, what has worked *for winbacks*). Fall back to account-wide patterns when the type-scoped sample is too small — and say which scope is being reported.
2. **Up to 3 "lean toward" signals** — dimension values with the highest mean RPR and `n >= MIN_N` (e.g. angle, conceit architecture, `includes_reviews`, send stage).
3. **Up to 2 "historically weaker" signals** — clearly underperforming values with adequate n. Framed as "has underperformed here," never "banned."
4. **Optional: 1–2 top-performing past campaigns** by RPR, named with their conceit/angle, as concrete reference points (the retrieval system already injects examples — these are flagged as *revenue-proven* ones).
5. **Explicit sample sizes** in the text (e.g. "across 7 sends") so the model can weight it appropriately.

**Never include:** raw dollar revenue figures (irrelevant to writing and risks the model quoting them into copy), customer data, or any value below `MIN_N`.

### Guardrails baked into the block's wording
- Prefix it as *context on what has performed on this account*, explicitly lower authority than brand rules and the user's instructions.
- State that it describes **association, not causation**, and must not be copied into the email as claims.
- Instruct that it must **not** flatten variety: the anti-repetition memory still governs, and "story-led has performed well" must not become "write the same story-led email every time." If the performance block and the avoid block conflict, **the avoid block wins** (variety beats optimization — otherwise the loop collapses into self-imitation).

---

## 4. Wiring

**Server helper:** `src/lib/performance-context.ts` (or extend the copy-performance route's internals) — an async function that does the store reads (planner rows + saved/library campaigns), runs the existing join/aggregate from `copy-performance.ts`, and returns `buildPerformanceBlock(brief)`. Reuse the route's logic; do not duplicate the join.

**Lookback window:** default the analysis to the **last ~180 days** of sent campaigns so guidance reflects current reality, not two-year-old sends. Make it a constant.

**Inject into generation** exactly like `avoidBlock`:
- `src/lib/prompts/generate.ts` — add a `performanceBlock = ""` parameter to `generateUserPrompt(...)` and render it (when non-empty) in a clearly-labeled section near the avoid block, below the brief and above the output rules.
- `src/app/api/generate/route.ts` — build the block alongside `buildAvoidBlock()` and pass it through.
- **SMS** (`src/lib/prompts/sms.ts`, `/api/sms-generate`): same treatment, but SMS records only — never pool email and SMS RPR (per `COPY_PERFORMANCE_SPEC.md`).
- **Flows** (`src/lib/prompts/flows.ts`, `/api/flows/generate`): campaign-derived guidance is weak evidence for triggered flows. **Phase 2** — skip for now, or inject only account-wide voice-level signals clearly labeled as campaign-derived.

**Performance:** the block is built from Redis reads on a path that already streams an LLM call — the added latency is negligible. Optionally memoize the computed block per process for a few minutes, keyed by campaign type, since it changes only when metrics sync.

---

## 5. Visibility & control (important for trust)

The writer must be able to see and disable this — a silent invisible influence on copy is a debugging nightmare.

- **Show it in the UI.** In the Copy Builder (`InputForm` or a small disclosure near generate), display "Using performance data from N sends" with a hover/expand revealing the exact block text being sent.
- **A toggle** to generate without it (per-session; default on). Useful when the writer deliberately wants an unbiased take.
- **Env kill switch:** `PERFORMANCE_MEMORY_OFF=1` disables injection globally — same spirit as the existing `COPY_PROMPT_LEGACY` rollback lever.
- **Log** (server-side) whether the block was included, so a copy-quality regression can be traced to it.

---

## 6. Edge cases

- Fewer than ~5 attributed sends in the window → return an empty block (nothing trustworthy to say).
- All dimension values below `MIN_N` → empty block.
- Metrics unsynced/null on most rows → treat as insufficient data, empty block.
- Type-scoped sample too small → fall back to account-wide and label the scope.
- Conflict with the avoid/repetition block → avoid block wins (§3).
- Northbeam vs platform basis: pick **one** basis for the memory (default platform, matching Copy Performance's default) and never mix.

---

## 7. Files

**Create**
- `src/lib/performance-memory.ts` — pure block builder + selection logic (unit-tested).
- `src/lib/performance-memory.test.ts` — MIN_N filtering, scoping fallback, word cap, empty-data cases, email/SMS separation.
- `src/lib/performance-context.ts` — async server helper that assembles inputs and returns the block.

**Edit**
- `src/lib/prompts/generate.ts` — new `performanceBlock` param + render.
- `src/app/api/generate/route.ts` — build + pass the block.
- `src/lib/prompts/sms.ts`, `src/app/api/sms-generate/route.ts` — same, SMS-scoped.
- `src/app/copy-builder/*` (form/components) — the disclosure + toggle.
- Refactor the copy-performance route's join into a reusable server function if it isn't already, so both it and this feature share one implementation.

**Do not touch**
- `src/lib/copy-performance.ts` statistics (reuse as-is), the hard-rules gate, the voice module, or the Klaviyo layer.

---

## 8. Acceptance criteria

- Generating a campaign includes a performance block when there are enough attributed sends, and omits it entirely otherwise.
- No dimension value with `n < MIN_N` ever appears in the block; sample sizes are stated in the text.
- Type-scoped guidance is preferred; the scope used is stated.
- Email and SMS guidance never mix; the block is capped at ~150 words and contains no dollar figures.
- The Copy Builder shows what's being injected and can turn it off; `PERFORMANCE_MEMORY_OFF=1` disables it globally.
- **Zero additional Klaviyo calls** on the generate path (verify: no `lib/klaviyo` import reachable from the new modules).
- Generation still succeeds normally when performance data is absent or the helper throws.
- Unit tests cover selection, filtering, scoping, and empty states.
- `npm run build`, `typecheck`, `lint`, `test` pass.

---

## 9. Out of scope
- Flow-specific performance guidance (Phase 2 — needs flow-level attribution).
- Subject-line guidance (blocked until the sent-line capture lands; see the Copy Performance spec's v2).
- Automatic A/B testing or auto-selecting winners — this informs a human writer, it doesn't decide.
- Changing how metrics are synced.
