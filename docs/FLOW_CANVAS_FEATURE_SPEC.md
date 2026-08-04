# Flow Canvas — a live, editable node map of every flow (email + SMS)

Build a new **Flow Canvas** in `raycon-copy-builder` (Next 16, React 19, Tailwind v4): a pannable/zoomable, editable node-graph that gives a helicopter view of all live flows. Each flow is shown as a group of connected nodes representing its internal messages (emails / SMS), time delays, and branches — expandable from a single summary node into its full internal structure. The user can rearrange nodes, annotate, and add manual nodes (e.g. Postscript SMS flows), and the layout persists.

**Read first:** `AGENTS.md` — this is NOT the Next.js you know. Use the design-token layer in `src/app/globals.css` (`bg-surface`/`bg-canvas`/`bg-chrome`, `text-ink`/`-secondary`/`-muted`, `border-line`, `--color-accent`, semantic 50/200/600 triads, `shadow-card`/`shadow-pop`, `radius-*`) and the primitives in `src/components/ui/` (Button, Chip, Drawer, Modal, Toast, Skeleton). Follow existing patterns: the planner's Calendar/Table view toggle (`src/app/planner/page.tsx`), the Klaviyo client conventions (`src/lib/klaviyo.ts`), the metrics store (`src/lib/metrics/`), and the async storage seam (`src/lib/storage.ts`, namespaced `read`/`write`/`list`).

**Scope decisions (locked):**
- Node depth: **expandable internal structure** — a flow collapses to one summary node and expands to show its message/delay/branch nodes.
- Interaction: **editable canvas** — drag to reposition, add annotations, add manual nodes; layout + edits persist.
- Postscript: **no API integration.** Email (Klaviyo) flow structure is auto-pulled; SMS flows are represented by **manually added nodes** so the picture is cohesive. Do not build a Postscript automations client.

---

## Step 1 — Add the canvas library

- Add **React Flow** (`@xyflow/react`, the maintained `reactflow` successor — verify React 19 compatibility) for the node/edge canvas: pan, zoom, minimap, controls, custom node types, and draggable nodes out of the box. Do not hand-roll a canvas.
- Add a lightweight auto-layout dependency (**`dagre`** or `elkjs`) to compute a sensible initial top-to-bottom layout for each flow's nodes before the user's saved positions take over.
- Import React Flow's stylesheet once (in the canvas component or `globals.css`) and immediately override its default palette with our tokens so it doesn't look like stock React Flow (see Step 6). No new fonts.

## Step 2 — Pull Klaviyo flow structure (data layer)

Extend `src/lib/klaviyo.ts` (additive only — mirror its existing pagination/defensive-fetch style; `listFlows()` already returns `{id,name,status}`):

- `getFlowActions(flowId)` → `GET /flows/{id}/flow-actions/` (paginated). Each action has a `type` (e.g. email/SMS send, time delay, conditional split) and a `settings` object; read delay durations and split conditions defensively.
- `getFlowMessages(actionId)` → `GET /flow-actions/{id}/flow-messages/` for the message name/subject/channel on send actions.
- Reference: the Klaviyo MCP tools `get_flow`, `get_flow_action`, `get_flow_message` describe the exact response shapes — use them to confirm field names, then implement against the REST API in `klaviyo.ts` so the app isn't MCP-dependent at runtime.
- Assemble a normalized graph per flow: an ordered/branched list of steps `{ id, type: "trigger"|"email"|"sms"|"delay"|"branch", label, subject?, channel?, delay?, next: string[] }`. Keep this transform pure and in a new `src/lib/flows.ts` so it's testable.

Add an API route `src/app/api/flows/route.ts` that returns `{ flows: FlowGraph[] }` — each flow with its metadata (name, status, channel) and its normalized step graph. Cache/rate-limit sensibly: flow structure changes rarely, so reuse the metrics-store snapshot cadence rather than hammering Klaviyo on every page load (read from the existing dimensions snapshot where possible; fetch structure lazily/per-flow on expand if rate limits bite).

## Step 3 — Canvas data model & types

Create `src/lib/flow-canvas-types.ts`:

- `FlowGraph` — the source-of-truth structure from Step 2 (auto-derived, read-only).
- `CanvasNode` — `{ id, kind: "flow"|"email"|"sms"|"delay"|"branch"|"trigger"|"note", flowId?, label, data, position: {x,y}, source: "klaviyo"|"manual" }`.
- `CanvasEdge` — `{ id, source, target, label? }`.
- `CanvasLayout` — the persisted overlay: `{ positions: Record<nodeId, {x,y}>, collapsed: Record<flowId, boolean>, manualNodes: CanvasNode[], manualEdges: CanvasEdge[], annotations: Note[], updatedAt }`.

The rendered graph = auto-derived Klaviyo structure **merged with** the persisted `CanvasLayout` overlay (positions/collapse/manual/notes win). Never mutate the derived structure with user edits — keep them in the overlay so a flow changing in Klaviyo doesn't wipe the user's annotations.

## Step 4 — Persist the editable layout (storage seam)

- Use the existing `StorageAdapter` (`src/lib/storage.ts`) with a namespace like `flow-canvas` and a single key (e.g. `layout.json`) holding the `CanvasLayout`. This gives Redis in prod and file locally, matching the planner's persistence.
- API route `src/app/api/flows/layout/route.ts`: `GET` returns the saved layout (empty default if none), `POST` upserts it. Debounce writes on the client (e.g. save ~500ms after the last drag) so dragging doesn't spam the backend. Optimistic UI with rollback + a Toast on failure (mirror the planner's `reschedule`).

## Step 5 — The canvas view + navigation

- Add a **canvas view alongside the existing flows table**. Reuse the planner's segmented view-toggle pattern: in `src/app/dashboard/flows/`, add a "Table / Canvas" toggle (Table = the current `FlowsPage`, Canvas = the new component). Keep the existing table untouched as the other tab.
- New component `src/app/dashboard/flows/FlowCanvas.tsx` (client component) hosting `<ReactFlow>` with: background grid (subtle, token color), `<Controls>`, `<MiniMap>` (token-tinted), fit-view on load, pan/zoom. The canvas should fill the available height and **not** be trapped in a short scroll box (the flows table's `max-h` pattern is wrong here — the canvas manages its own viewport).
- Top bar of the canvas: a refresh button (re-pull from `/api/flows`), a "+ Add node" control (manual email/SMS/note — Step 8), a collapse-all/expand-all toggle, and a small legend (email vs SMS vs delay vs branch color key).

## Step 6 — Custom node components (make it look like our product)

Register React Flow custom node types, all styled with tokens (rounded `radius-md`, `border-line`, `shadow-card`, hover `shadow-pop`) — never stock React Flow chrome:

- **Flow (group) node** — collapsed state: flow name, channel glyph (reuse the planner's ✉️/📱 convention), status pill, and headline metrics (revenue, recipients, rev/recipient) from Step 9. A chevron toggles expand.
- **Email message node** — subject/name, small email glyph, accent (indigo) accent border.
- **SMS message node** — message label, SMS glyph, a distinct hue (teal/amber) so email vs SMS is unmistakable (consistent with the planner's platform badges).
- **Delay node** — compact pill showing the wait ("Wait 2 days"), muted styling.
- **Branch/trigger node** — diamond-ish/condition styling for conditional splits and the flow trigger.
- **Annotation/note node** — a sticky-note style free-text node the user can place anywhere (Step 8).

Edges: hairline `border-line`/muted, with subtle labels on branches ("Yes"/"No"). Use smooth/step edges, arrowheads toward the next step.

## Step 7 — Expand / collapse

- Default render: each flow shown **collapsed** as its single summary node (true helicopter view).
- Expanding a flow reveals its internal nodes (trigger → messages → delays → branches), auto-laid-out with dagre on first expand, then respecting saved positions. Collapsing hides the children again. Persist collapsed state per flow in the overlay.
- Expand/collapse should animate/fit-view smoothly and not reflow the whole board jarringly — only lay out the affected flow's subtree.

## Step 8 — Editing

- **Drag to reposition** any node; persist positions (debounced) to the overlay. Klaviyo-derived nodes can be moved but not deleted (they reflect real flows); manual nodes can be edited/deleted.
- **Add manual nodes** via "+ Add node": pick kind (email / SMS / delay / note), give it a label, drop it on the canvas. This is how SMS/Postscript flows are represented — the user builds those flow nodes by hand. Manual nodes and any edges the user draws between nodes are saved in the overlay.
- **Connect nodes**: allow drawing edges between nodes (React Flow `onConnect`) for manual flows; store in `manualEdges`.
- **Annotations**: free-text sticky notes placed anywhere for context ("A/B test running", "under review").
- Everything editable lives in the overlay (Step 3) so a Klaviyo refresh never destroys manual work. Provide a quiet "Reset layout" in the top bar (confirm via `ConfirmModal`).

## Step 9 — Metrics overlay

- Pull per-flow performance from the existing metrics store / `flowValuesReport` (`src/lib/klaviyo.ts`, `src/lib/metrics/`) — revenue, recipients, opens, clicks, rev/recipient — the same numbers the flows table shows. Reuse that data source; don't re-query separately.
- Show headline metrics on the collapsed flow node; optionally show per-message stats on expanded message nodes if available. Blank/unavailable metrics render as a faint `—` (SMS has no opens — never fabricate one, per the Postscript client's note). A small "as of {synced_at}" stamp somewhere on the canvas.

## Step 10 — States, a11y, performance

- Loading: skeleton nodes or a centered Skeleton while `/api/flows` resolves. Error: inline dismissible banner (match the planner's error style) + keep last good layout. Empty: an `EmptyState` ("No live flows found").
- Keyboard: canvas is reachable and pannable; nodes focusable; the add/refresh controls are real buttons with labels.
- Performance: memoize node/edge arrays; avoid re-deriving the graph on every render; virtualize only if flow count is large. Debounce persistence.

## Step 11 — Verification

- Type-check/build passes (`npm run build`); no unused deps; React 19 + `@xyflow/react` render without warnings.
- Canvas loads all live Klaviyo flows collapsed; expanding one shows its real messages/delays/branches; metrics match the flows table.
- Drag a node, reload the page → position persists. Add a manual SMS node + note, reload → both persist. Refresh from Klaviyo → manual nodes/notes/positions survive.
- Email vs SMS nodes are visually distinct; the board pans/zooms freely and isn't clipped in a short scroll box.
- Existing flows **table** view still works unchanged behind the toggle.

## Suggested build order

1. Steps 2–4 (data + persistence) behind the API before any UI.
2. Step 5–6 (canvas shell + node styling) with collapsed flows only.
3. Step 7 (expand/collapse) and Step 9 (metrics).
4. Step 8 (editing/manual nodes/annotations) last.
5. Step 10–11 polish + verification.
