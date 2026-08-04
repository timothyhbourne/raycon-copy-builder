# Copy Builder — Flows Engine + Left-Panel Restructure

> **Status: SPEC / PARKED — not started, no code written.** Pending the four
> decisions in "Open Decisions" below.

## Context

The Copy Builder today is built around **campaigns** — one-off, time-bound
broadcast emails (and SMS) driven by an offer or occasion. Two problems have
surfaced:

1. **Browsing is cramped.** The left panel (`src/components/Sidebar.tsx`)
   is a 3-tab strip (Saved / Library / SMS) of small truncated cards. You only
   ever see "glimpses" of each campaign, and email vs SMS vs flow content isn't
   meaningfully separated.
2. **There is no home for flows.** Flows (Welcome, Abandoned Cart, etc.) exist
   only as *analytics* today (`src/app/dashboard/flows/page.tsx`,
   `flowValuesReport` in `src/lib/klaviyo.ts`). You can't author flow copy, and
   flows are strategically different from campaigns — triggered, evergreen,
   sequential, relationship-driven — so the campaign "brain" writes them badly.

**Desired outcome:** a dedicated Flows experience with (a) its own writing
"brain" tuned to flow psychology, (b) the ability to write "email N of the
Welcome flow, highlighting X/Y/Z," (c) a node-map/mind-map view of the flow with
conditional splits, and (d) a cleaner left panel that cleanly separates
Email campaigns / SMS campaigns / Flows and shows more than a glimpse.

## Goals

- A **second brain** for flows: a flow-specific prompt engine whose strategy,
  psychology, and pacing differ from campaigns.
- **Position + trigger awareness**: an email knows it is "email 3 of 5 in the
  Welcome flow," what the earlier emails did, and the reader's trigger state.
- **Per-email highlights**: the writer specifies what this specific email should
  emphasize (X/Y/Z).
- **Node-map view**: trigger → emails → delays → conditional splits, editable.
- **Restructured left panel**: Email / SMS / Flows as first-class, richer cards.
- Reuse everything reusable — the canvas, the storage seam, the voice module.

## Current State (what we reuse)

| Concern | Existing pattern to mirror |
|---|---|
| Per-type JSON store behind Redis/file seam | `src/lib/sms.ts` via `getAdapter()` in `src/lib/storage.ts` |
| Shared brand voice | `src/lib/prompts/voice.ts` (`rayconVoice()`, `hardRulesGate()`) |
| Channel/format brain | `src/lib/prompts/generate.ts` (campaigns), `src/lib/prompts/sms.ts` (SMS) |
| Per-type job/shape/structure | `PLAYBOOKS` in `src/lib/prompts/playbooks.ts` |
| Generation route (streaming JSONL) | `src/app/api/generate/route.ts`, `src/app/api/sms-generate/route.ts` |
| Canvas renderer for a `GeneratedCampaign` | `src/components/CampaignCanvas.tsx` |
| Real flows from Klaviyo | `listFlows()` in `src/lib/klaviyo.ts` (~line 178) |
| Validation at the store boundary | `src/lib/validation/` (zod + migrate-on-read) |

## Proposed Architecture

### 1. The flow "brain" (dedicated prompt engine)

A new sibling to `generate.ts`, e.g. `src/lib/prompts/flows.ts`, exporting a
`flowRoleInstruction` + `flowUserPrompt(...)`. It composes the shared
`rayconVoice()` + `hardRulesGate()` (brand invariants never fork) but replaces
the campaign strategy with **flow strategy**:

- Flows are **triggered and evergreen** — no artificial broadcast deadline.
  Urgency, when used (e.g. cart), is anchored to the reader's own action, not a
  sitewide sale clock.
- **Relationship arc over the sequence.** Each email has a distinct *job* and
  must advance the arc, aware of what earlier emails said (same "cohesion"
  principle already added to campaigns, but across emails, not sections).
- **Trigger-state empathy.** The reader's state (just subscribed / left items in
  cart / just purchased X / lapsed) shapes tone and content.

A new **flow-type playbook** table (sibling to `PLAYBOOKS`), e.g.
`FLOW_PLAYBOOKS: Record<FlowType, { job, shape, emails: FlowEmailJob[] }>` where
each `FlowEmailJob` names position, default delay, and the email's role in the
sequence. Seed flow types (aligned to standard ecommerce lifecycle):

- `welcome`, `abandoned_cart`, `browse_abandonment`, `post_purchase`,
  `winback` / sunset, `back_in_stock`.

### 2. Data model

Add to `src/lib/schemas.ts`:

- `FlowType` union + `FLOW_TYPES` list.
- `Flow`: `{ id, name, type, channel: "email"|"sms", klaviyo_flow_id?, goal?,
  emails: FlowEmail[], splits: FlowSplit[], created_at, updated_at }`.
- `FlowEmail`: `{ id, position, job, delay?, highlights?: string,
  campaign: GeneratedCampaign, section_structure: SectionSpec[], status }`.
  The generated body reuses `GeneratedCampaign` so the **existing canvas renders
  it unchanged**.
- `FlowSplit`: `{ id, after_email_position, label }` — free-text conditional
  splits (editable, no logic engine).

### 3. Storage

`src/lib/flows.ts`, a near-copy of `src/lib/sms.ts`:
`getAdapter(DATA_ROOT, "flows")`, `STORE_KEY = "flows.json"`, with
`readAll/writeAll/listFlows(meta)/getFlow/saveFlow/deleteFlow`. Redis-backed in
prod, file-backed locally — durable, same as SMS/library/planner. Add
`parseFlows` at the validation boundary (`src/lib/validation/`).

### 4. Generation pipeline

`src/app/api/flows/generate/route.ts`, mirroring
`src/app/api/generate/route.ts` but calling the flow brain. Input carries the
flow context (type, this email's position + job + highlights, and compact
summaries of the sibling emails for cohesion). Output is the same streaming JSONL
a campaign produces, so the client + canvas are reused. Regeneration/variations
reuse the section routes with the flow brain swapped in.

### 5. UI restructure — left panel

Replace the 3-tab `Sidebar` with a clearer top-level split. Recommended:

- **Two first-class modes**: **Campaigns** and **Flows**.
- Within Campaigns, an **Email / SMS** filter (channel), plus the existing
  Draft/Library distinction surfaced as a status facet rather than a separate
  tab.
- **Richer cards**: subject-line preview, date, status, channel glyph
  (📧 / 📱), audience, offer — so each row shows substance, not a glimpse.
  (Exact card layout is a Phase-3 design pass.)

### 6. Flows section (the authoring flow)

1. **Pick / create a flow** — choose a flow type (scaffolds the sequence) and,
   optionally, link the real Klaviyo flow by name via `listFlows()` so "the
   current Welcome flow" maps to reality.
2. **Node-map view** — a custom, lightweight vertical map (no new dependency):
   trigger node → email nodes → delay chips → conditional-split nodes. Nodes are
   clickable and show status; splits are editable text.
3. **Write an email** — clicking an email node opens a brief panel ("email 3 of
   Welcome; highlight X/Y/Z") → generates via the flow brain → edits in the
   **existing canvas**.

### 7. Klaviyo linkage

Add `/api/klaviyo/flows-list` (mirroring `campaigns-list`) backed by
`listFlows()`, for the "link to a real flow" typeahead. Reference/metrics only —
authoring stays in-app.

## Phasing (recommended)

- **Phase 1 — Foundation (ship first):** flow data model + store + validation;
  the flow brain (`flows.ts` + `FLOW_PLAYBOOKS`); `/api/flows/generate`; minimal
  Flows entry in the left panel; write a single flow email (pick flow → pick
  email N → highlights → generate → canvas). Delivers the "second brain" value
  fast.
- **Phase 2 — Node map:** the custom node/mind-map view with delays + editable
  conditional splits; click-to-open an email.
- **Phase 3 — Browse redesign:** the richer left-panel/card redesign and the
  full Email / SMS / Flows separation polish.

## Open Decisions (confirm before Phase 1)

1. **Scope/order** — Foundation-first (recommended) vs one big build vs
   left-panel redesign first.
2. **Flow model** — In-app templates + optional Klaviyo link (recommended) vs
   Klaviyo-driven vs freeform.
3. **Node-map** — Custom lightweight (recommended) vs `react-flow` dependency.
4. **Flow types** — Confirm the seed set (welcome, abandoned_cart,
   browse_abandonment, post_purchase, winback, back_in_stock).

## Files (Phase 1)

- New: `src/lib/prompts/flows.ts`, `src/lib/flows.ts`,
  `src/app/api/flows/generate/route.ts`, flow UI entry in the copy-builder.
- Edit: `src/lib/schemas.ts` (Flow types),
  `src/lib/validation/schemas.ts` + `src/lib/validation/index.ts`
  (parse/validate — **remember the enum gotcha: new types must be added to the
  zod enums too**), `src/app/copy-builder/page.tsx` +
  `src/components/Sidebar.tsx` (Flows entry),
  `src/lib/prompts/playbooks.ts` (pattern reference for `FLOW_PLAYBOOKS`).

## Verification

- Unit-test the flow brain's prompt assembly and `FLOW_PLAYBOOKS` (pure, like
  the existing prompt tests).
- `npx tsc --noEmit` + `npx vitest run` + `npm run build` clean.
- End-to-end in the running app (behind login): create a Welcome flow → write
  "email 3, highlight X/Y/Z" → confirm the copy reads like a sequenced flow
  email (not a broadcast promo), persists, reloads, and renders in the canvas.
- Confirm SMS/campaign flows are untouched (no regression in existing stores).
