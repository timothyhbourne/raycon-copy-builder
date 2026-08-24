# Flow Builder — Regeneration, Export, and Planner Link

**Status:** diagnosed, fixes proposed.
**Scope:** `/flows` only. The Copy Builder is unaffected except where noted (§3.1,
shared module extraction).
**Replaces:** `docs/FLOW_REGENERATION_FIX_SPEC.md` (folded in as Part 1).
**Related:** `docs/FLOW_CANVAS_REBUILD_SPEC.md` — the canvas rework and the
separate editing bugs (name/goal not editable; job, delay and highlights not
autosaving).

Three problems, one theme: **a flow email is a second-class citizen of the app.**
It uses the same canvas as a campaign, but the canvas is wired up with half its
inputs missing and none of its outputs connected. You can write a flow email and
then do nothing with it — you can't rewrite a line, copy it out, or hand it to
anyone.

| Part | Problem |
|---|---|
| 1 | Element and section regeneration are dead |
| 2 | Copy can't be copied out |
| 3 | Copy can't be linked to the planner or handed to design |

---

# Part 1 — Regeneration is dead

## 1.1 Symptom

On a flow email's canvas, rewriting the Body Copy or a Subheader does nothing.
The control is either missing entirely or present with an empty tooltip.

Affected: **rewrite one element**, **rewrite whole section** (the 5 register
variations), and **regenerate subject/preview**. Writing an email from scratch
still works — different route.

## 1.2 Root cause

One hardcoded prop. `src/app/flows/page.tsx:547`:

```tsx
<CampaignCanvas
  campaign={selectedEmail.campaign}
  expandedBrief={null}          // ← here
  chosenConceit={conceit}
```

`CampaignCanvas` gates every AI assist on both a brief and a conceit:

| Assist | Gate | File |
|---|---|---|
| Element rewrite | `assistsEnabled && expandedBrief && chosenConceit` → else `onRegenerateElement` is `undefined` | `CampaignCanvas.tsx:458-462` |
| …its handler | `if (!section \|\| !expandedBrief \|\| !chosenConceit) return null` | `:201` |
| Section variations | `if (!expandedBrief \|\| !chosenConceit \|\| !section) return []` | `:525` |
| Meta regenerate | `if (!expandedBrief \|\| !chosenConceit) return` | `:158` |

`chosenConceit` is supplied — synthesised at `page.tsx:364-371`. `expandedBrief`
never is. All four gates fail.

The server agrees, so passing nothing was never going to work: the request schema
requires `expanded_brief` with a `campaign_type` (`validation/requests.ts:80`,
`:89`), and `api/regenerate-element/route.ts:71-72` reads
`expanded_brief.key_message` and `.deadline_language`.

### Why it looks new

It isn't. `git log -L` shows `expandedBrief={null}` has been on that line since
flows first shipped (`b3fb009`). Flow regeneration has never worked.

What changed on Thursday is how it fails. `SectionBlock.tsx:616`:

```ts
const canRegen = isReview ? !!productSlug : (!!onRegenerateElement || !!assistsDisabledReason);
```

The flows page passes neither, so `canRegen` is `false` and **the control is no
longer rendered**. Previously it rendered and silently did nothing. Also
`regenBlocked` (`:617`) is true here, so the tooltips at `:642` and `:651` render
`assistsDisabledReason` — which is `undefined`. An empty tooltip.

## 1.3 Fix

### Build flow emails a real ExpandedBrief

`api/flows/generate/route.ts:17` says there is "no deterministic brief compile
step" because a flow email is evergreen with no offer, send date or deadline.
Sound for *generation*; the regeneration routes need an `ExpandedBrief` anyway.
Build the flow-shaped one rather than fake a campaign.

New pure module `src/lib/flow-brief.ts` — no LLM, no network, tested like
`brief/compile.ts`:

```ts
export function expandedBriefForFlowEmail(flow: Flow, email: FlowEmail): ExpandedBrief
```

| ExpandedBrief field | Source |
|---|---|
| `campaign_type` | mapped from `flow.type` via an explicit table, not a cast |
| `audience` | inferred from flow type; `all` fallback |
| `key_message` | `email.job` |
| `headline_thesis` | `email.highlights?.trim() \|\| email.job` |
| `audience_mindset` | `FLOW_PLAYBOOKS[flow.type].job` |
| `tonal_direction` | `FLOW_PLAYBOOKS[flow.type].shape` |
| `structural_notes` | `"Email 2 of 4"` |
| `rewritten_hero_angle` | `email.highlights` when set, else `email.job` |
| `hero_angle_verbatim` | `email.highlights` verbatim, when set |
| `products_featured` | SKUs pinned on the email's `section_structure` |
| **`deadline_language`** | **always `undefined`** |

That last row matters most. A flow email must never inherit a campaign deadline —
the hard rules ban urgency in Welcome 1, Post-Purchase 1 and Win-Back 1 outright,
and the playbooks anchor urgency to the reader's own action, never a sitewide
clock (`flow-playbooks.ts:54`). Undefined is the correct value, not an omission.

Then:

```tsx
expandedBrief={selectedEmail ? expandedBriefForFlowEmail(flow, selectedEmail) : null}
```

Memoise alongside the existing `conceit` (`page.tsx:364`).

### Never leave an assist silently absent

```tsx
assistsDisabledReason={selectedEmail?.job?.trim() ? undefined : "Set this email's job to enable rewrites."}
```

Same contract the blank canvas work established: a control is either working, or
visibly disabled with a reason. Never missing without explanation.

---

# Part 2 — Getting the copy out

## 2.1 Problem

The Copy Builder has a **Copy** button that puts the whole campaign on the
clipboard in two flavours — HTML formatted for Google Docs (product grids become
`<table>`s) and plain text — via `handleCopyCampaign`
(`copy-builder/page.tsx:1358`, button at `:1795`).

The Flow Builder has no equivalent. A finished flow email exists only inside its
own canvas. It cannot be pasted into a doc, a ticket, a Slack message, or Klaviyo.

## 2.2 Fix

### Extract the exporter, don't copy it

`handleCopyCampaign` is inline in a 1,800-line page component. Duplicating it
into the flows page would guarantee the two drift. Extract to
`src/lib/copy-export.ts`:

```ts
export interface CopyExport { html: string; text: string }
export function buildCopyExport(
  campaign: GeneratedCampaign,
  sectionStructure: SectionSpec[],
  opts?: { title?: string; subtitle?: string }
): CopyExport
```

Pure and testable — no clipboard, no DOM. A thin `writeToClipboard(export)`
helper wraps `navigator.clipboard.write` with the two MIME flavours and the
plain-text fallback for browsers that reject `ClipboardItem`.

Both pages then call the same function. Point the Copy Builder at it in the same
change so there is only one implementation from day one.

### Wire it into the Flow Builder

- A **Copy** button in the flow email header, matching the Copy Builder's
  placement and icon, enabled only when `selectedEmail.campaign` exists.
- Header context for a flow email: `opts.title` = the flow name, `opts.subtitle`
  = `"Email 2 of 4 — Welcome"` plus the delay. Pasted into a doc, a flow email
  should say which flow and which position it is; a campaign's export doesn't
  need that and a flow's is useless without it.
- **Copy whole flow** on the flow header — every written email in sequence, each
  under its own heading with its delay and, once the canvas rebuild lands, its
  branch. This is what actually gets pasted into a brief or a review doc, and
  it's the one that makes the flow builder useful to someone who isn't in the
  app. Skip unwritten emails rather than emitting empty headings.

---

# Part 3 — Linking a flow email to the planner

## 3.1 Problem

`writeBackToPlanner` and the design-handoff deep link exist only in the Copy
Builder. A flow email has no route to either, so it can never be viewed from the
planner or handed to a designer through the normal path.

The plumbing does not currently reach flows at any layer:

| Layer | Handles | Missing |
|---|---|---|
| `api/planner/copy/route.ts:197-241` | draft → library → sms | flows |
| `api/planner/link/route.ts:20-24` `setCopyBackref` | campaigns → sms → library | flows |
| `api/planner/link/route.ts:27-29` `copyExists` | same three | flows |
| `src/lib/flows.ts` | — | no `setFlowEmailPlannerRow` |
| `FlowEmail` (`schemas.ts`) | — | no `planner_row_id` |

There is also an addressing problem: every other copy record is a top-level store
entry with its own id. A flow email is **nested inside a `Flow`**, so
`loadCampaign(id)`-style resolution has nothing to resolve.

## 3.2 Fix

### Composite id

Address a flow email as `"<flowId>::<emailId>"`. Both halves are already
nanoid-safe, and the delimiter can't collide with the existing id format
(`YYYY-MM-DD-slug-nanoid6`).

Add to `src/lib/flows.ts`, mirroring `setSmsPlannerRow` (`sms.ts:82-89`) exactly
so the three stores stay symmetrical:

```ts
export function parseFlowEmailId(id: string): { flowId: string; emailId: string } | null;
export async function loadFlowEmail(id: string): Promise<{ flow: Flow; email: FlowEmail } | null>;
export async function setFlowEmailPlannerRow(id: string, plannerRowId: string | null): Promise<boolean>;
```

`parseFlowEmailId` returns `null` for anything without the delimiter, so the
existing stores are untouched and resolution stays unambiguous.

### Wire the three call sites

1. `setCopyBackref` — add a flows branch. Order matters: try flows **first**,
   since a composite id can't be anything else and the check is cheap.
2. `copyExists` — same.
3. `/api/planner/copy` — resolve a composite id to the flow email and return it
   in the existing `CopyBase` shape, with `source: "flow"` added to the union at
   `:18`. `CopyDocModal` then renders a flow email with no changes.

Add `planner_row_id?: string` to `FlowEmail` and to its zod schema
(`validation/schemas.ts:295-304`). **Mind the standing gotcha in that file**: a
shape the schema doesn't know is dropped silently on read, so ship the schema
change with the type change or flows will start disappearing.

### In the Flow Builder UI

- **Link to planner** on the selected email — the same row picker the Copy
  Builder uses, writing through `POST /api/planner/link` with the composite id.
- Show the linked row in the email header with an unlink control, per the
  planner-autolink fix: a link is an explicit act, visible and reversible, never
  inherited.
- **Copy handoff link** — the `/planner?copy=<id>&as=<draft|final>` deep link plus
  the Slack-ready message, exactly as `planner/page.tsx:877-882` builds it.

### One semantic caveat worth deciding on

A `PlannerRow` models a **scheduled send** — it has `planned_send_at`, and
`isEffectivelySent()` derives "sent" from that date passing
(`planner-types.ts:134-136`). A flow email is **triggered and evergreen**; it has
no send date and will send thousands of times.

So linking a flow email to a planner row makes it look, to every planner
consumer, like a one-off send that happened on a particular day. That will feed
false rows into metrics sync and into Copy Performance, which counts planner rows
as its denominator.

Two honest options:

- **(a) Recommended — mark the row.** Add `row_kind: "campaign" | "flow_email"`
  to `PlannerRow`, defaulting to `"campaign"`. Flow-email rows appear on the
  calendar as a build/QA task, are excluded from metrics sync
  (`api/planner/sync/route.ts`), and are excluded from Copy Performance. You get
  the handoff and the visibility without corrupting the numbers.
- **(b) Link without a row.** Skip the planner entirely and give flow emails only
  the shareable copy link and the Slack handoff message. Less work, and it
  delivers the actual need — getting the copy to a designer — but the email won't
  appear in the planner at all.

Go with (a) unless you specifically don't want flow emails on the calendar. The
extra field is cheap and it's the difference between the planner staying a
trustworthy source for revenue reporting and quietly not being one.

---

# 4. Reproduction

**Part 1** — open `/flows`, select a flow with a written email, hover Body Copy
or a Subheader. Observed: no rewrite control. Expected: control present and
working, as in the Copy Builder.

**Part 2** — with a written flow email on screen, look for any way to get the
text out. There is none.

**Part 3** — with a written flow email on screen, look for any way to link it to
the planner or produce a handoff link. There is none.

---

# 5. Acceptance criteria

**Regeneration**
- Rewriting a single element on a flow email works and returns new copy.
- The 5-register section variations work on a flow email.
- Subject/preview regeneration works on a flow email.
- No flow email regeneration request ever carries a `deadline_language`.
- An email with no job set shows rewrite controls **disabled with a stated
  reason**, not missing.
- Copy Builder behaviour unchanged — `CampaignCanvas` is shared, so verify a
  campaign element rewrite still works.
- Unit tests on `expandedBriefForFlowEmail`: each flow type's mapping,
  highlights-vs-job precedence, products collected from the section structure,
  and `deadline_language` always undefined.

**Export**
- A written flow email can be copied and pasted into Google Docs with formatting
  and product grids intact.
- The pasted output names the flow, the email's position and its delay.
- **Copy whole flow** produces every written email in order, skipping unwritten
  ones.
- The Copy Builder's Copy button produces byte-identical output to before the
  extraction.

**Planner link**
- A flow email can be linked to a planner row and the link survives a reload.
- The planner's copy viewer opens a linked flow email correctly.
- The handoff deep link and Slack message work for a flow email.
- Unlinking works from both the flow builder and the planner.
- A flow-email row does not appear in metrics sync or in Copy Performance
  (assuming option (a)).
- Flows still load after the schema change — verify against an existing flow
  record saved before it.

---

# 6. Out of scope

- **Pushing flow copy into Klaviyo.** Same gap as campaigns; belongs with the
  wider Klaviyo write work, not here.
- **Flow-level performance.** Needs flow-message-grain metrics the app doesn't
  pull (`klaviyo.ts:276` groups by `flow_id` only).
- **Flow copy entering the library or the constructions index.** Flow copy still
  neither contributes to nor benefits from the anti-repetition memory. Worth its
  own ticket — it is the reason two flow emails can open the same way and nothing
  notices.
- **The canvas rebuild and the flow editing bugs** — `FLOW_CANVAS_REBUILD_SPEC.md`.
