# Flow Canvas — Interaction and Layout Fixes

**Status:** proposed, not started.
**Surface:** `src/app/flows/FlowCanvas.tsx`, `src/lib/flow-layout.ts`,
`src/lib/flow-graph.ts`, `src/app/flows/page.tsx`.
**Related:** `docs/FLOW_CANVAS_PERFORMANCE_SPEC.md` (the flicker/drag fixes —
independent of this, both can land in either order).

Seven problems, reported from use. The layout one (§2) is architectural; the rest
are missing affordances.

> **Note on research:** the external documentation sweep for this spec was cut
> short by an org spend limit. The React Flow APIs named below are from working
> knowledge and are accurate to v12, but the builder should confirm exact
> signatures against the official examples linked in §8 before implementing.

---

## 1. Right-click context menu on a node

**Problem:** there is no right-click menu. Deleting a node has no reliable
affordance, which is why a delay node currently cannot be removed at all (§6).

**Build:** React Flow exposes `onNodeContextMenu(event, node)`,
`onEdgeContextMenu(event, edge)` and `onPaneContextMenu(event)` as props on
`<ReactFlow>`. Call `event.preventDefault()`, store `{ id, top, left }` in state
from `event.clientX/clientY`, render an absolutely-positioned menu over the
canvas, and close on pane click, Escape, or scroll.

Menu items per node kind — start minimal, this is the set that earns its place:

| Node kind | Items |
|---|---|
| Email | **Delete**, Duplicate, Insert after → (Email / Wait / Branch) |
| Wait (delay) | **Delete**, Insert after → |
| Branch (split) | **Delete branch and everything below it** (with a count), Insert after → |
| Exit | **Delete** |
| Trigger | *(no delete — a flow always has exactly one trigger)* |

`deleteNode` already exists (`flow-graph.ts:505`) and is already wired
(`page.tsx:351`), returning the list of removed ids. The logic is there; only the
route to it is missing.

Deleting a **middle** node must heal the chain — reconnect its inbound edge to
its outbound target. Deleting a **split** takes its whole subtree, so the confirm
must name how many emails go with it.

---

## 2. Tidy up scrambles the branches ★

**Problem:** after adding a split, "Tidy up" produces crossed edges and puts the
branches on unpredictable sides. In the reported case the `No` branch landed on
the left and the two labels overlapped each other near the split's handles.

**Root cause:** `flow-layout.ts:36-49` hands the graph to dagre with
`rankdir: "TB"`. **Dagre does not offer deterministic sibling ordering.** It runs
a crossing-minimisation heuristic and orders siblings by whatever that heuristic
lands on, which changes as the graph changes. There is no dagre option that says
"this edge goes left, that one goes right."

**Fix: stop using a general-purpose layout engine.** The graph is not an
arbitrary DAG — the invariants in `flow-graph.ts` make it a **binary tree**:
exactly one trigger, splits have exactly one Yes and one No
(`flow-graph.ts:278-279`), every other node has at most one outbound edge, no
cycles. A tree does not need crossing minimisation. It needs a recursive walk,
and that walk gives exact control.

```
layout(node, depth) -> { width, positions }
  if leaf:                width = NODE_W
  if single child:        child directly below, same x
  if split:
      left  = layout(yesChild)        // Yes ALWAYS left
      right = layout(noChild)         // No  ALWAYS right
      width = left.width + GAP + right.width
      centre the split above the two subtree centres
```

Roughly 60 lines, pure, unit-testable, fully deterministic, and it removes the
`@dagrejs/dagre` dependency. Same layout every time for the same graph — which is
what "Tidy up" should mean.

**The rule, stated once:** **Yes is always the left branch. No is always the
right branch.** Never reordered by a heuristic, never dependent on subtree size.

Also fix the label collision visible in the screenshot: the `Yes` and `No` labels
currently render near the split's output handles and overlap both each other and
the `+` buttons. Put each label on its **own edge**, offset toward its own side,
using `EdgeLabelRenderer` (§3) rather than positioning them off the node.

Keep orphan handling: lay orphaned subtrees out in the same recursive way and
place them in a column clear of the main tree, as `flow-layout.ts:102` does now.

---

## 3. A "+" at the midpoint of every connector ★

**Problem:** there is no way to insert something between two existing nodes. The
`+` buttons that exist sit under the split node and are ambiguous.

**Build:** a custom edge component that draws the path and renders a button at
its midpoint.

- `getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })`
  returns `[edgePath, labelX, labelY]`. `labelX`/`labelY` **is** the midpoint —
  no geometry to compute.
- Render the path with `<BaseEdge path={edgePath} />`.
- Render the button inside `<EdgeLabelRenderer>`, which portals HTML out of the
  SVG layer so it can be a real button:
  ```
  transform: translate(-50%, -50%) translate(${labelX}px, ${labelY}px)
  pointer-events: all
  className="nodrag nopan"
  ```
  Both the `pointer-events` and the `nodrag nopan` are required — without them
  the button is unclickable and drags the canvas instead. `InlineText`
  (`FlowCanvas.tsx:181`) already uses this pattern correctly; copy it.
- Quiet at rest (~35% opacity), full on edge hover — the same treatment the
  copy-builder section dividers landed on.
- Clicking opens the existing node picker, and inserting **splices**: the edge
  `A → B` becomes `A → NEW → B`. `insertAfter` in `flow-graph.ts:420` already
  does this; the picker just needs to target an edge instead of a node.

This replaces the `+` buttons currently sitting under the split node.

---

## 4. Drag a Wait node onto an edge to splice it in

**Problem:** wanted — drag a delay from a palette, drop it between Email 2 and
Email 3, have it stick.

**Honest note:** React Flow has an official drag-and-drop-from-palette example,
but **dropping onto an edge to splice is not an official pattern.** It needs a
custom hit test. It is not hard, but the builder should not go looking for a
built-in.

**Build:**
1. Palette items are `draggable`; on `onDragStart` set the node kind on
   `dataTransfer`.
2. On the canvas wrapper, `onDragOver` → `event.preventDefault()`.
3. On `onDrop`, convert the pointer to canvas space with
   `useReactFlow().screenToFlowPosition({ x: event.clientX, y: event.clientY })`.
4. **Hit test against edges:** for each edge, take its midpoint (the same
   `labelX`/`labelY` from §3, cached on the edge as it renders) and find the
   nearest within a threshold — 40px in canvas units is a sensible start.
   Point-to-segment distance is more precise, but midpoint proximity is enough
   for a tree laid out on clean vertical runs.
5. Hit → splice via `insertAfter`. Miss → drop as an orphan at that position,
   which the canvas already renders with a "not connected" chip.
6. **Highlight the target edge while dragging over it** — thicker stroke, accent
   colour. Without that feedback nobody can tell whether it will land.

Apply the same hit test to `onNodeDragStop` so an *existing* node dragged onto an
edge also splices in. That is the "plug and play" feel, and it costs one extra
call site.

---

## 5. Placeholder copy

Current strings are wrong or unhelpful:

| Where | Now | Should be |
|---|---|---|
| `FlowCanvas.tsx:342` | *"No job set yet"* | **"What is this email for?"** |
| `:386` (split Yes) | *"what happens"* | **"e.g. Send the reminder"** |
| `:395` (split No) | *"what happens"* | **"e.g. Wait and try again"** |
| Delay node, empty | — | **"How long?"** |
| Email, no delay set | *"fires Later"* | **"Set a delay"** |

Two principles: a placeholder should say what to type, not report that nothing is
typed; and it should read as an invitation, not an error. "No job set yet" tells
the user something is missing without telling them what to do about it.

While in there: the exit node currently reads "No — ends here" / "Yes — ends
here". Once §2 fixes the sides, the branch is obvious from position, so these can
just say **"Ends here"** with the branch colour carrying the rest.

---

## 6. Delay nodes cannot be deleted

Covered by §1 — the context menu gives every node kind a Delete. Additionally:

- Set `deletable: true` on all node kinds except `trigger`, so the **Delete/
  Backspace key** works on a selected node. React Flow handles this natively via
  `deleteKeyCode`; wire `onNodesDelete` to `fg.deleteNode` so keyboard and menu
  take the same path.
- Deleting a Wait node must heal the chain: `Email 2 → Wait → Email 3` becomes
  `Email 2 → Email 3`. Never leave the downstream node orphaned.

---

## 7. Data model note

Delay is currently modelled twice — as a `delay` **node kind**
(`FlowCanvas.tsx:410`) and as a `delay` **string on an email**
(`FlowCanvas.tsx:344`, rendered as "fires 1 day later"). The screenshot shows
both in one flow: "fires 3 days later" on Email 3, and a separate "Wait 2 days"
node.

That is genuinely confusing and it is worth resolving before more UI is built on
top. Recommendation: **keep both, but make the distinction explicit in the UI** —
the email's own `delay` is "how long after the previous step this fires" and
should render on the *connector*, not inside the email card; a `Wait` node is a
standalone pause the user inserted. If the builder would rather collapse them
into one concept, the Wait node is the more flexible model, but that is a
migration and should not block the rest of this spec.

---

## 8. Reference examples

Official React Flow examples covering each pattern — confirm the exact API
signatures here:

| Need | Example |
|---|---|
| Right-click menu | `reactflow.dev/examples/interaction/context-menu` |
| Button on an edge | `reactflow.dev/examples/edges/edge-with-button` |
| Custom edges / `EdgeLabelRenderer` | `reactflow.dev/examples/edges/custom-edges` |
| Palette drag-and-drop | `reactflow.dev/examples/interaction/drag-and-drop` |
| Deleting with reconnection | `reactflow.dev/examples/nodes/delete-middle-node` |
| API surface | `reactflow.dev/api-reference/react-flow` |

Open-source flow builders on React Flow worth reading for these patterns:
**Langflow**, **Flowise**, **Dify**, **Typebot**. n8n solves the same problems on
Vue Flow and its canvas is the closest reference for the drop-on-edge and
insert-on-connector interactions specifically.

---

## 9. Acceptance criteria

- Right-clicking any node opens a menu; Delete removes it and heals the chain.
- Right-clicking a split warns and names how many emails will be removed.
- Selecting a node and pressing Delete does the same thing as the menu.
- A Wait node can be deleted. *(Fails today.)*
- **Tidy up puts Yes on the left and No on the right, every time, with no
  crossing edges** — verified on a flow with nested splits. *(Fails today.)*
- Tidy up run twice on the same graph produces identical coordinates.
- Yes/No labels never overlap each other or any button.
- Every connector shows a `+` at its midpoint on hover; clicking inserts between
  the two nodes.
- Dragging a Wait from the palette onto a connector splices it in, and the target
  connector highlights while dragging over it.
- Dragging an existing node onto a connector splices it in.
- No placeholder text tells the user what is missing without telling them what to
  do.
- `@dagrejs/dagre` is removed from `package.json`.
- Unit tests on the new layout: single chain, one split, nested splits, orphans —
  asserting Yes-left/No-right and deterministic output.

---

## 10. Out of scope

- Multi-select and bulk delete.
- Undo/redo on the canvas. Worth doing eventually and it is a bigger piece.
- Copy/paste of a subtree.
- Auto-layout on every change — Tidy up stays explicit, so hand-placed nodes stay
  where they were put.
- The drag flicker and rigidity — `docs/FLOW_CANVAS_PERFORMANCE_SPEC.md`.
