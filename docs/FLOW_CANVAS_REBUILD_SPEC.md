# Flow Builder — Canvas Rebuild

**Status:** proposed, not started.
**Surface:** `/flows`.
**Read against:** `src/app/flows/page.tsx` (694 lines), `src/app/flows/FlowMap.tsx`
(277), `src/lib/flows.ts`, `src/lib/flow-playbooks.ts`, `src/lib/prompts/flows.ts`,
`src/lib/schemas.ts`, `src/lib/validation/schemas.ts`.

**Supersedes** `docs/FLOW_CANVAS_FEATURE_SPEC.md` (which also proposed React Flow,
but paired it with a Klaviyo structure import — dropped here, see §0.1).

## 0. Decisions taken

| Question | Decision |
|---|---|
| Source of truth | **Planning canvas only.** Nothing is read from Klaviyo. The canvas is where a flow is designed before it is built. |
| Branching | **Real branches.** Yes and No each lead to their own emails, delays and further splits. A genuine graph. |

### 0.1 Note on the earlier recommendation

`FEATURE_OPPORTUNITIES.md` advised *against* building the React Flow canvas, on
the grounds that the lightweight `FlowMap` already did the job. That advice was
correct for the requirement as it stood — a vertical list is a fine way to render
a linear sequence. It stops being correct the moment flows need to **branch**,
because a single-column list cannot represent a graph at all. The requirement
changed, so the recommendation changes with it.

---

## 1. Why the current map can't do this

`FlowMap.tsx` is a single-column stack inside a fixed panel: trigger node,
then `flow.emails.map(...)`, with connectors between. It is not a canvas — no
pan, no zoom, no drag, no coordinates.

The deeper blocker is the data model, not the rendering:

- `FlowEmail.position: number` (`schemas.ts:426+`) — emails are a **linear
  sequence** keyed by an integer. A branch has no representation.
- `FlowSplit` is `{ after_email_position, label, yes_label?, no_label? }`
  (`validation/schemas.ts:305-311`). `yes_label` and `no_label` are **strings
  describing what would happen** — they do not point at anything. `SplitFork`
  (`FlowMap.tsx:42-63`) renders them as two lines of text inside one card. The
  fork never forks.
- `deleteEmail` renumbers survivors `1..n` and re-anchors splits by integer
  position (`page.tsx:237-239`) — logic that only makes sense on a line.

So the fork is a drawing of a decision, not a decision. Everything below follows
from replacing positions with a node/edge graph.

---

## 2. Fix the editing gaps first

These are small, they are almost certainly the "I can't edit a custom flow"
complaint, and they are worth shipping ahead of the canvas.

### 2.1 A flow's name and goal cannot be edited after creation

`createFlow` (`page.tsx:120-149`) sets `name` and `goal`, and nothing anywhere
writes them again. There is no rename control. `flow.name` and `flow.goal` are
only ever read — at `page.tsx:256` and `:259`, to build the generation payload.

For a custom flow this bites hardest: you name it in the create modal before
you've built anything, and you're then stuck with that name and an empty goal.

**Fix:** inline-editable flow name in the canvas header and an editable goal
field, both persisting on blur. The Copy Builder already has this exact pattern
for campaign names (`copy-builder/page.tsx:1478-1484`) — reuse it.

### 2.2 Some edits save themselves, some silently don't

Inconsistent persistence in `page.tsx`:

| Edit | Behaviour |
|---|---|
| Add / update / delete split | `void persist(next)` — auto-saves (`:174`, `:184`) |
| Edit trigger | `void persist(next)` — auto-saves (`:193`) |
| Add email | `void persist(next)` — auto-saves (`:223`) |
| **Edit email delay** | `setDirty(true)` only (`:470`) |
| **Edit email job** | `setDirty(true)` only (`:479`) |
| **Edit email highlights** | `setDirty(true)` only (`:490`) |

The three that matter most for a custom flow — where defining each email's job
*is* the work — are the three that need a Save button the user has to notice
(`:450-451`, which only appears when `dirty`). Navigate away and the work is
gone, with no prompt.

**Fix:** one persistence model. Debounced autosave for every field, matching the
Copy Builder's library autosave (1.5s debounce, single-flight, flush on
`pagehide`, `copy-builder/page.tsx:806-953`). Keep a saving indicator; drop the
manual Save button.

### 2.3 Custom flows can't drop their only email

`deleteEmail` returns early when `emails.length <= 1` (`page.tsx:231`). The
custom playbook scaffolds exactly one email (`flow-playbooks.ts:147-150`), so
delete is permanently a no-op on a new custom flow. Once the canvas exists an
empty flow is a legitimate state — allow it, and render the empty-canvas
affordance from §4.3.

---

## 3. The graph model

Replace positional ordering with nodes and edges.

```ts
export type FlowNodeKind = "trigger" | "email" | "split" | "delay" | "exit";

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  /** Canvas coordinates. User-draggable, persisted. */
  x: number;
  y: number;
  /** kind: "trigger" */
  trigger?: { label: string };
  /** kind: "email" — FlowEmail minus `position` (the graph carries order now) */
  email?: FlowEmailNode;
  /** kind: "split" */
  split?: { label: string; yes_label?: string; no_label?: string };
  /** kind: "delay" — a wait step between nodes */
  delay?: { label: string };
  /** kind: "exit" — the branch ends (left the flow, converted, suppressed) */
  exit?: { label: string };
}

export interface FlowEdge {
  id: string;
  from: string;                    // FlowNode.id
  to: string;                      // FlowNode.id
  /** Set only on the two edges leaving a split node. */
  branch?: "yes" | "no";
}
```

`Flow` gains `nodes: FlowNode[]` and `edges: FlowEdge[]`.

Rules, enforced in a pure module (`src/lib/flow-graph.ts`) with unit tests, in
the spirit of `campaign-sections.ts` and `calendar-grid.ts`:

- Exactly one `trigger` node. It has no inbound edges.
- A `split` node has exactly two outbound edges, one `yes` and one `no`.
- Every other node has at most one outbound edge.
- No cycles. Adding an edge that would create one is rejected with a toast, not
  silently dropped.
- Every node is reachable from the trigger. Orphans are surfaced visually (§4.4)
  rather than deleted — an orphan is usually work in progress.

Deleting a node reconnects its inbound edge to its outbound target where that is
unambiguous; deleting a split deletes its whole downstream subtree after a
confirm that names how many emails will go.

### 3.1 Why `delay` becomes a node

Today `delay` is a string on the email (`"Immediately"`, `"Later"`) rendered on
the connector. On a branching graph a wait can sit between a split and its first
email, where there is no email to hang it on. Making it a node keeps that
expressible. Migration folds each existing `email.delay` into a delay node ahead
of that email — or, to keep the canvas from getting noisy, keeps short delays
rendered on the edge and only promotes to a node when the user adds a standalone
wait. **Recommend the latter**: `FlowEdge.delay?: string` for the common case,
`delay` nodes only where one is explicitly inserted.

---

## 4. The canvas

### 4.1 Library

**React Flow (`@xyflow/react`)** for the canvas, **dagre** for auto-layout. Both
were already named in the superseded spec. React Flow gives pan, zoom, drag,
selection, custom node renderers, edge routing and a minimap without hand-rolling
any of it. `@hello-pangea/dnd` — already a dependency — is not a substitute; it
does list reordering, not graph editing.

### 4.2 Layout

- Nodes are freely draggable; positions persist to `FlowNode.x/y`.
- **Tidy up** button runs dagre top-to-bottom and rewrites all positions. This is
  the escape hatch for a canvas the user has tangled, and the layout engine for
  any flow that has never been arranged (a migrated flow, or one built by adding
  nodes without dragging).
- New nodes are placed below their parent and offset horizontally on the `no`
  branch, so a split immediately reads as two paths without the user arranging
  anything.
- Pan/zoom state is per-flow and session-scoped only (`sessionStorage`), not
  persisted to the record — it's a viewport, not content.

### 4.3 Node rendering

Each kind gets a custom React Flow node component, carrying over the existing
visual language from `FlowMap.tsx` so it still looks like the app:

- **Trigger** — accent-bordered, bolt icon, the trigger text. Editable inline.
- **Email** — position label, status pill (`empty` / `draft` / `final` /
  `writing`, reusing `StatusPill`), the job as two clamped lines. Click selects
  it and opens the email in the right-hand pane, exactly as today.
- **Split** — the condition as the node title, with two labelled output handles,
  **Yes** in success green and **No** in danger red, matching the current
  `SplitFork` colours.
- **Delay** — a small pill node, e.g. "Wait 2 days".
- **Exit** — a terminal node, e.g. "Purchased — exit flow".

Empty canvas (a flow with only a trigger) shows a centred **Add your first
email** affordance rather than a blank grid.

### 4.4 Editing on the canvas

- **Add a node**: `+` handles on the bottom edge of any node, plus a canvas
  toolbar. Choosing a kind inserts it connected, using the same searchable
  picker pattern built for section insertion (`SectionPicker.tsx`) so the two
  canvases behave alike.
- **Add a split**: pick "Split" and the node arrives with two empty branches, one
  `exit` node on each, ready to be replaced. That way a split is never left in an
  invalid one-outbound state.
- **Conditional split, typed by hand** — as requested. The condition, the Yes
  label and the No label are all free text (`split.label`, `yes_label`,
  `no_label` carry over unchanged). No logic engine, no Klaviyo condition schema.
  A short list of suggested conditions seeded from the flow's playbook trigger
  ("Opened Email 1?", "Purchased?", "Clicked?") as type-ahead, not as a
  restriction.
- **Reconnect** by dragging an edge endpoint. Rejected if it would cycle.
- **Delete** via node context menu or the Delete key on selection.
- Orphaned nodes render dimmed with a "not connected" chip.

### 4.5 What stays

The right-hand email pane is unchanged — job, delay, highlights, Write this
email, the canvas of the email itself. Selecting an email node drives it exactly
as selecting an email in the list does today. This spec changes navigation and
structure, not the copy-writing surface.

---

## 5. Generation with branches

`/api/flows/generate` currently takes a single `position` and sibling summaries
(`page.tsx:253`) so each email knows its place in the arc. With a graph there is
no single integer position, and this needs replacing rather than patching.

Add to `src/lib/flow-graph.ts`:

- `linearizePath(flow, nodeId)` — the ordered list of nodes from the trigger to
  this one, following whichever branches were taken.
- `pathContext(flow, nodeId)` — a human-readable description of that path,
  including the branch conditions that lead here.

Then the prompt gets something it cannot currently express:

> This is the 2nd email on the **"Did not open Email 1" → No** branch. The reader
> has received: Email 1 (welcome). They have **not** opened it.

That is a copy-quality gain, not just plumbing. A win-back email on the "didn't
open" branch should not be written as though the reader read the last one — and
today the flow brain has no way to know the difference.

Sibling summaries should come from the **path**, not from `flow.emails`, or an
email on the Yes branch will be given context from the No branch.

---

## 6. Migration

Existing flows are linear, so migration is deterministic and lossless:

1. Create a `trigger` node from `flow.trigger ?? playbook.trigger`.
2. Create one `email` node per `FlowEmail`, in `position` order, chained by edges.
   Carry each `email.delay` onto its inbound edge.
3. For each `FlowSplit`, insert a `split` node after the email at
   `after_email_position`, and hang an `exit` node off each branch carrying
   `yes_label` / `no_label` as its text. The old labels described outcomes, so an
   exit node is their honest translation — the user can replace either with real
   emails afterwards.
4. Run dagre once to assign initial coordinates.

Run it at the read boundary in `parseFlows`, stamping the new `schema_version`,
so a flow migrates the first time it is opened. Keep `emails` and `splits` on the
record for one release as a rollback path, derived from the graph on write, then
remove them.

Bump the zod schema (`validation/schemas.ts:288-325`) and mind the standing
gotcha noted there: a shape that isn't in the enum is **dropped silently on
read**. A migration that writes nodes the schema doesn't know about will delete
people's flows.

---

## 7. Acceptance criteria

**Editing (§2)**
- A flow's name and goal can be changed after creation and survive a reload.
- Editing an email's job, delay or highlights and navigating away without
  pressing anything loses nothing. *(Fails today.)*
- A custom flow's single email can be deleted.

**Canvas**
- Opening a saved flow shows a pan/zoom canvas with draggable nodes; positions
  persist.
- **Tidy up** produces a readable top-down layout on a branched flow.
- A split can be added, its condition and both branch labels typed by hand, and
  each branch can then hold its own emails, delays and further splits.
- A branch can be three or more levels deep and still renders and saves.
- An edge cannot be created that forms a cycle.
- Deleting a split warns, naming how many downstream emails will be removed.
- Existing linear flows migrate on open with every email, delay and split label
  intact, and nothing is dropped on read.

**Generation**
- An email on a branch is generated with that branch's path as context, and its
  sibling summaries come only from its own path.

---

## 8. Out of scope

- **Reading flow structure from Klaviyo, or pushing to it.** Decided above. The
  data model does not preclude adding an importer later — `FlowNode`/`FlowEdge`
  map onto Klaviyo's actions/messages reasonably well — but nothing here assumes
  it.
- **A real conditions engine.** Splits stay free text. Typed conditions
  (`opened_email`, `placed_order`) only earn their keep if the app one day drives
  Klaviyo, and encoding them now would be guessing at Klaviyo's schema.
- **Flow performance overlay on the canvas.** Wants flow-message-grain metrics,
  which the app doesn't pull (`klaviyo.ts:276` groups by `flow_id` only). It's a
  good idea and belongs in the analytics work, not here.
- **A/B variants inside a flow email.** A flow email still has one body.
- **SMS nodes in a flow.** `Flow.channel` stays a single value per flow.
- **Multi-user editing.** Single shared credential; unchanged.
