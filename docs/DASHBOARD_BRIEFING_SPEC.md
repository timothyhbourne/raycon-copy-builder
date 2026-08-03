# Dashboard Briefing — On-Demand "What Happened & Why" Spec

**Status:** Ready to implement
**Area:** Measurement dashboard (`/dashboard/campaigns`, `/dashboard/flows`)
**Goal:** Add a one-click, plain-English readout of the currently selected range — this period vs. the prior one, top/bottom performers, the flow-vs-campaign split, and a couple of "worth a look" callouts. Turns the dashboard's tables and tiles into something management reads in ten seconds.

---

## 1. Why

The live dashboard shows accurate numbers but doesn't interpret them — every read is a table someone has to eyeball. The weekly report (`src/lib/reports/weekly.ts`) computes rigorous numbers but is a scheduled, channel-level artifact with **no narrative** and no per-campaign detail. Neither tells you, in words, *what happened this month and what to look at*. This feature fills that gap: an interpretation layer over the range already on screen.

**Non-negotiable framing:** this is an *interpretation* layer, not a *calculation* layer. Every number is computed deterministically in code; the model only narrates. See §4 — this is the whole ballgame for trust.

---

## 2. Ground rules

1. **Next.js 16** (`proxy`, not middleware; read `node_modules/next/dist/docs/`). Keep TypeScript `strict`; no `any`.
2. **On-demand only.** A "Brief me" button triggers it. It does NOT auto-run on page load or range change — that would burn tokens on every navigation and reintroduce the "background stuff happening" feel the dashboard rebuild removed.
3. **The model never computes or invents numbers.** All figures, deltas, and rankings are computed server-side and passed to the model as facts. The prompt forbids new numbers (§4, §6).
4. **Use `FAST_MODEL`** (Haiku) from `src/lib/anthropic.ts` — the output is short and low-stakes; speed and cost matter.
5. **Reuse, don't duplicate:** the delta / ratio-guard math already in `src/lib/reports/weekly.ts` (e.g. `revenuePctChange`, null-on-zero-denominator guards), the `getAnthropic()` client, the streaming pattern from `src/app/api/generate/route.ts`, and the `ui/` primitives. Extract shared delta helpers rather than re-implementing them.
6. **Secrets stay server-side.** The Anthropic call happens only in the route handler.

---

## 3. Data sources

The dashboard already fetches the range payload from `/api/klaviyo/measure` and holds it as `OverviewData` in the dashboard layout context (`useDashboardData()`). The briefing reuses that exact payload for the **current** range — no re-fetch. Shape (confirmed from the measure route):

```
revenue: { total, attributed, attributed_from_flows, attributed_from_campaigns, order_count }
flows:      FlowRow[]      // { flow_id, name, status, recipients, opens, clicks, revenue, revenue_per_recipient }
campaigns:  CampaignRow[]  // { campaign_id, name, status, send_time, recipients, opens, clicks, revenue, revenue_per_recipient }
campaign_status: { draft, scheduled, sent }
range: { start, end }
warnings: string[]
```

**Prior-period comparison.** The briefing compares the current range to the immediately-preceding window of equal length (e.g. a 30-day range compares to the 30 days before it). Because measurement is live-on-demand, getting prior-period numbers means one more range fetch (~3 Klaviyo reporting calls). Handle it like this:
- Extract the range-aggregation in `src/app/api/klaviyo/measure/route.ts` into a shared server function `fetchRangeOverview(startYMD, endYMD): Promise<OverviewData>` (new `src/lib/measure.ts`). Both the measure route and the briefing call it — no duplicated aggregation.
- The briefing route accepts the **current** `OverviewData` in the POST body (from the client's session cache) and fetches **only the prior** range via `fetchRangeOverview`.
- **Degrade gracefully:** if the prior fetch fails or is rate-limited, generate the briefing for the current range anyway and state that period-over-period comparison was unavailable. The briefing must never fail because the comparison couldn't load.

---

## 4. Deterministic fact pack (computed in code, never by the model)

Create `src/lib/briefing.ts` — a **pure, unit-tested** module that takes current + (optional) prior `OverviewData` and produces a compact `BriefingFacts` object. The model receives ONLY this. Compute:

- **Range:** label + day count for current and prior windows.
- **Revenue:** placed-order `total`, `attributed` total, order count; flow vs campaign split as `$` and as `%` of attributed.
- **Deltas vs prior** (reuse weekly.ts-style guards — return `null`, not `0`/`Infinity`, when a denominator is ≤ 0): total revenue %Δ, attributed %Δ, flow-revenue %Δ, campaign-revenue %Δ, program RPR %Δ.
- **Top / bottom performers:** top 3 campaigns by revenue and by RPR; the single weakest sent campaign (meaningful recipients, low RPR relative to the range's campaign-average RPR); top 3 flows by revenue.
- **Concentration:** share of attributed revenue from the top campaign and top 3 (is revenue concentrated in one send or spread out?).
- **Volume:** counts of sent / scheduled / draft campaigns in range.
- **Data caveats:** pass through `warnings` (truncation, unknown names) and a low-data flag when the range has very few sends.

Everything the model might say a number about must be a field here. If it's not in the fact pack, the model may not state it.

---

## 5. API route

Create **`src/app/api/dashboard/briefing/route.ts`** — `POST`.
- Body: `{ range: {start,end}, channel?: "email"|"sms"|"all", current: OverviewData, includePrior?: boolean }`. Validate with a zod shape in `src/lib/validation/` (follow `parseBody` pattern).
- Steps: if `includePrior !== false`, compute the prior window and `fetchRangeOverview` it (graceful failure per §3) → build `BriefingFacts` via `src/lib/briefing.ts` → call `FAST_MODEL` with the analyst prompt (§6) and the fact pack as JSON → return the briefing.
- `export const dynamic = "force-dynamic";` `export const maxDuration = 30;`
- **Streaming (recommended):** stream the prose token-by-token, mirroring `src/app/api/generate/route.ts`, so it feels instant. A non-streamed JSON response is an acceptable v1 given the short output — pick one.
- Errors return a friendly message; on Anthropic failure, surface "Couldn't generate the briefing — the numbers above are still accurate."

---

## 6. Prompt (`src/lib/prompts/briefing.ts`)

A new, small prompt module. **This is an internal analyst voice — NOT the Raycon marketing voice.** Do not import `rayconVoice()`.

Instruction essentials:
- You are a sharp, plain-spoken marketing analyst briefing a busy manager. Interpret the numbers provided; do not compute or invent any.
- Use ONLY the figures in the provided fact pack. Never state a number, percentage, or name that isn't in it. If something isn't provided, don't mention it.
- Be concise and concrete. No hype, no filler, no marketing adjectives.
- Explain *what* happened and *what's worth a look* — but do not assert causes you can't know. Say "worth investigating" / "associated with," never invent a reason (no unearned "due to seasonality").
- If data is sparse or comparison is unavailable, say so plainly and keep it short.
- Output shape: a one-line **headline**, a 2–4 sentence **summary**, and up to 3 short **callouts** (each a single sentence — an outlier, a risk, or a thing to check). Total under ~180 words.

Return either streamed markdown in that shape, or a `{ headline, summary, callouts[] }` JSON — match whichever the route uses.

---

## 7. UI

A `DashboardBriefing` component rendered in the dashboard layout (`src/app/dashboard/layout.tsx`), above the revenue tiles, as a `Card`.
- Collapsed by default: a single **"Brief me on this range"** button (with a subtle AI glyph).
- On click: show a loading shimmer (or stream the text in), then render headline (bold), summary (prose), and callouts (a short list). Include a tiny "based on live data · fetched {time}" line and echo any data caveats.
- A small **Regenerate** affordance re-runs it (bypassing the session cache below).
- **Session cache:** cache the generated briefing per `range + channel` key in the same client-session manner as the measurement cache, so toggling tabs or revisiting a range shows the last briefing instantly without re-billing tokens. Regenerate and range-change-to-a-new-range produce a fresh one.
- Keep the visual language identical to the dashboard. Calm and professional — this is for management.

---

## 8. Cost, caching, trust

- **Cost control:** on-demand button + per-range session cache + `FAST_MODEL` keeps spend negligible. Never auto-fire.
- **Trust:** because every number is computed server-side and the tiles/tables on the same screen show those same numbers, a hallucinated figure would be visibly inconsistent with the page. The prompt forbids inventing numbers; the fact pack is the only source. Consider (v2) rendering the key deltas as real chips beside the prose so the interpretation sits next to its evidence.
- **Honesty:** mirror the copy-performance spec's ethos — association not causation, sample-size awareness (don't over-read a range with 2 sends), and explicit "comparison unavailable" when the prior window didn't load.

---

## 9. Edge cases

- Empty/near-empty range → one honest line ("Almost no send activity in this window."), no fabricated insight.
- Prior window unavailable (rate-limited/failed) → current-range briefing only, comparison noted as unavailable.
- SMS vs email: if a `channel` filter is active, brief only that channel and say so; never pool RPR across channels.
- `warnings` present (truncation/unknown names) → the briefing notes the numbers may be slightly incomplete.
- Model returns a number not in the fact pack (shouldn't happen) → acceptable for v1; v2 can add a lightweight guard that flags prose containing digits absent from the fact pack.

---

## 10. Files

**Create**
- `src/lib/measure.ts` — extract `fetchRangeOverview(start,end)` from the measure route; the route imports it too (no logic duplication).
- `src/lib/briefing.ts` — pure fact-pack + delta builder (unit-tested; reuse weekly.ts delta guards, extracting shared helpers if cleaner).
- `src/lib/prompts/briefing.ts` — the analyst prompt.
- `src/app/api/dashboard/briefing/route.ts` — the POST route.
- `src/components/DashboardBriefing.tsx` — the card/button UI.
- zod shapes in `src/lib/validation/` for the request.

**Edit**
- `src/app/api/klaviyo/measure/route.ts` — refactor its aggregation to call `fetchRangeOverview` (behavior unchanged).
- `src/app/dashboard/layout.tsx` — mount `<DashboardBriefing />` and pass the current `OverviewData` + range.

**Do not touch**
- The Klaviyo client internals, the planner, the copy stores.

---

## 11. Acceptance criteria

- A "Brief me on this range" button appears on the dashboard; nothing generates until it's clicked.
- The briefing's headline, summary, and callouts contain **only** numbers/names present in the deterministic fact pack — every figure it states matches the tiles/tables on screen.
- It compares to the prior equal-length window when available and says so; when the prior fetch fails, it still produces a current-range briefing and notes the comparison is unavailable.
- Re-opening a range shows the cached briefing instantly (no new Anthropic call); Regenerate forces a fresh one.
- Uses `FAST_MODEL`; output is under ~180 words in the headline/summary/callouts shape; voice is plain analyst, not marketing.
- Sparse ranges and channel filters are handled honestly; no invented causes.
- `src/lib/briefing.ts` has unit tests (delta guards, top/bottom selection, concentration, low-data flag, missing-prior handling).
- `npm run build`, `typecheck`, `lint` pass; no `any` introduced.

---

## 12. Out of scope (v2)
- Digit-guard post-check on model output.
- Rendering deltas as chips beside the prose.
- Auto-including copy-performance context ("story-led angles led this month") — a natural merge with `docs/COPY_PERFORMANCE_SPEC.md` once both exist.
- Scheduled/emailed briefings — this is on-demand only; the weekly report already covers scheduled delivery.
