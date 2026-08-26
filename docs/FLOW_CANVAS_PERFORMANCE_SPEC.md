# Flow Canvas — Library Decision and Performance Fix

**Status:** researched and diagnosed, fix proposed.
**Surface:** `/flows` — `src/app/flows/FlowCanvas.tsx` (721 lines), `src/app/flows/page.tsx`.
**Related:** `docs/FLOW_CANVAS_REBUILD_SPEC.md` (the build this fixes),
`docs/FLOW_BUILDER_FIXES_SPEC.md`.

---

## 0. The answer to "which library should we use"

**Keep React Flow (`@xyflow/react`). You are already on the right library, on a
current version. Switching would cost weeks and make the problem worse.**

The flicker and rigidity are not the library. They are five specific wiring
mistakes in `FlowCanvas.tsx` and `page.tsx`, every one of which is a documented
React Flow anti-pattern with a documented fix. §1 names them with line numbers.

### 0.1 What the research found

Surveyed against GitHub activity, npm downloads, licence and React 19 support,
August 2026:

| Library | Stars | Latest release | Licence | npm/week | Verdict |
|---|---|---|---|---|---|
| **@xyflow/react** | 38.0k | 12.11.3, 2026-08-12 | MIT | **10.7M** | Category leader, monthly releases |
| tldraw | 49.8k | 5.3.2, 2026-08-18 | **Commercial (~$6k/yr)** | ~223k | Best whiteboard SDK; not a node graph |
| Excalidraw | 129k | 0.18.1, 2026-04-20 | MIT | 467k | Drawing surface, no port/edge model |
| AntV X6 | 6.6k | 3.1.8, 2026-08-11 | MIT | 93k | Real contender; Chinese-first docs |
| JointJS (`@joint/core`) | 5.3k | 4.3.2, 2026-08-21 | MPL-2.0 | 44k | Mature; the useful parts are paid JointJS+ |
| GoJS | 8.4k | 4.0.3, 2026-07-17 | **Commercial ($4k–12k)** | 231k | Most complete; canvas-drawn, poor a11y |
| Rete.js | 12.1k | 2.0.6, **2025-06-30** | MIT | 82k | Stalled 14 months, single maintainer |
| Cytoscape.js | 11.1k | 3.34.1, 2026-08-11 | MIT | 14.8M | Graph *analysis*, not editing |
| Sigma.js | 12.1k | 3.0.3, 2026-04-30 | MIT | 290k | WebGL, 100k nodes — viewer, not editor |
| Konva / react-konva | 14.6k | 10.3.1 / 19.2.5 | MIT | 2.7M | Canvas substrate; you'd build the editor |
| reaflow | 2.5k | 5.4.1, 2025-04-08 | Apache-2.0 | 26k | Small, slowing, less capable |
| Drawflow | 6.0k | 0.0.60, **2024-09-03** | MIT | 20k | Vanilla JS, stale |
| LiteGraph.js | 8.0k | 0.7.18, **2024-01-08** | MIT | 1.5k | Upstream dead; live fork archived into ComfyUI |
| beautiful-react-diagrams | 2.7k | 0.5.1, **2020-11-27** | MIT | 1.3k | **Abandoned** |

React Flow ships roughly monthly, is MIT in perpetuity, does 10.7M downloads a
week, and its showcase includes Stripe, Typeform, Retool, Supabase, OneSignal,
Langflow and Dify. Nothing in the landscape is a strictly better React Flow —
every alternative trades away the React-native node model, the licence, or
maintenance velocity.

The one thing React Flow is genuinely bad at is **scale**: its own maintainers
say it "is not intended to be used in that kind of scale" past ~1000 nodes,
because every node is real DOM and every edge is SVG. A Raycon flow has perhaps
5 to 20 nodes. That constraint will never bind here.

### 0.2 What the research says about the flicker specifically

Known causes of React Flow nodes flickering, blinking or jittering during drag,
from the official performance docs, GitHub issues and the Synergy Codes
benchmark. Roughly 80% of reported cases are misuse. The measured cost of each,
on a 100-node graph:

| Cause | Impact |
|---|---|
| `nodeTypes` / `edgeTypes` recreated each render | Every node **unmounts and remounts** each render |
| Custom nodes not wrapped in `React.memo` | 60 → **10** FPS (simple nodes), 60 → **2** FPS (heavy) |
| Unmemoized handler/object props on `<ReactFlow>` | 60 → **10** FPS from one inline `onNodeClick` |
| Deriving state by mapping/filtering the whole `nodes` array | 60 → **12** FPS |
| Parent state updated on every `onNodesChange` during drag | "almost like a slide show" at **50 nodes** |

Sources: [React Flow performance docs](https://reactflow.dev/learn/advanced-use/performance) ·
[common errors](https://reactflow.dev/learn/troubleshooting/common-errors) ·
[discussion #2353](https://github.com/xyflow/xyflow/discussions/2353) ·
[Synergy Codes benchmark](https://medium.com/@lukasz.jazwa_32493/the-ultimate-guide-to-optimize-react-flow-project-performance-42f4297b2b7b)

---

## 1. Diagnosis — what our code actually does

Three things are already right, so rule them out: `NODE_TYPES` (`:374`) and
`EDGE_TYPES` (`:403`) are module-scope constants; the stylesheet is imported
(`:9`); and `@xyflow/react ^12.11.3` is current, so the recent upstream
re-render fixes in 12.10–12.11.2 are already in.

The problem is the update path. **Every single pointermove during a drag runs
this chain:**

**1. Position is committed to global app state on every frame.**
`FlowCanvas.tsx:533-540`:
```ts
const onNodesChange = useCallback((changes: NodeChange[]) => {
  for (const c of changes) {
    if (c.type === "position" && c.position) {
      actions.onMoveNode(c.id, Math.round(c.position.x), Math.round(c.position.y));
    }
  }
}, [actions]);
```
`onMoveNode` (`page.tsx:286-288`) calls `setFlow`, rebuilding the entire `Flow`
record through `fg.withGraph(...)`. So a drag re-renders the whole 62KB
`page.tsx` tree — canvas, email pane, everything — about 60 times a second.

The comment above that handler says the write rate "is handled upstream instead:
the page's autosave debounce collapses a whole drag into one save." That is true
of the **network** write and irrelevant to the **React render**. The state update
still happens every frame; only the POST is debounced. This is the core
misdiagnosis.

**2. Every node object is rebuilt on every frame.**
`FlowCanvas.tsx:499-517` derives `rfNodes` with a `useMemo` keyed on `graph`. New
`graph` → new array, new node objects, and critically a **new `data` object per
node**. Even a perfectly memoized node component would re-render, because its
props are new by identity every frame.

**3. Nothing is memoized.** `TriggerNodeView`, `EmailNodeView`, `SplitNodeView`,
`DelayNodeView`, `ExitNodeView` (`:210`, `:235`, `:270`, `:327`, `:354`) are all
plain function declarations. No `React.memo` anywhere in the file. Per the
benchmark above, that alone is a 60 → 10 FPS change.

**4. Full graph traversals run on every frame.**
```ts
const orphans  = useMemo(() => new Set(orphanNodes(graph).map(n => n.id)), [graph]);
const problems = useMemo(() => validateGraph(graph), [graph]);
```
(`:496-497`) Both are keyed on `graph`, so both re-run 60×/sec during a drag —
even though dragging a node changes no structure and can never change either
result.

**5. `actions` is in the dependency array.** `rfNodes` depends on `actions`
(`:517`), which arrives as a spread (`{...canvasActions}`, `page.tsx:926`). If
`canvasActions` is an object literal rebuilt each render, `rfNodes` invalidates
on *every* render regardless of whether the graph changed.

### 1.1 The "rigid" feeling is a separate bug

`Math.round(c.position.x)` on line 537 quantises every position to whole pixels
**during** the drag. At any zoom level above 1, one screen pixel is less than one
graph unit, so the node snaps between integers instead of tracking the cursor.
That is the stiffness, and it is independent of the flicker.

Round on drop if you want tidy stored coordinates. Never round mid-drag.

---

## 2. The fix

The governing principle: **React Flow owns node positions while the user is
dragging. The app state hears about it once, when the drag ends.**

### 2.1 Let React Flow own the drag

Use the uncontrolled/local pattern the maintainers recommend for exactly this
symptom ([discussion #2353](https://github.com/xyflow/xyflow/discussions/2353)):

```ts
const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
```

- `onNodesChange` from `useNodesState` applies changes to React Flow's own state
  via `applyNodeChanges`. No app-state write, no page re-render.
- Commit to `graph` in **`onNodeDragStop`** only — one write per drag instead of
  several hundred.
- Sync `graph` → local nodes only on **structural** change (a node added,
  deleted, reconnected), never on position. Key that effect on a structural
  signature — `nodes.length`, edge ids, node ids — not on the `graph` object.

If keeping the controlled model is preferred for consistency with the rest of the
app, the minimum viable version of the same idea is: keep applying position
changes locally, but only call `actions.onMoveNode` when
`change.dragging === false`. Filtering by `dragging` is the single highest-value
line in this document.

### 2.2 Memoize the node components

```ts
const EmailNodeView = memo(function EmailNodeView({ data, selected }: NodeProps) { … });
```

All five node views, plus `BranchEdge` (`:385`). Required, not optional — the
docs state that components passed to `<ReactFlow>` "should either be memoized
using `React.memo` or declared outside the parent component."

### 2.3 Make `data` referentially stable

`memo` is useless while `data` is a fresh object every render. Two changes:

- Move `actions` out of node `data` entirely. Put it in a React context that the
  node views consume, so it never participates in prop comparison. This also
  removes `actions` from the `rfNodes` dependency array.
- Build each node's `data` from primitives that actually change — `orphan`,
  `generating`, `position`, `selected` — and let position live on the React Flow
  node, not inside `data`.

### 2.4 Take the traversals off the drag path

`orphans` and `problems` describe **structure**. Key them on a structural
signature rather than the whole graph:

```ts
const structureKey = useMemo(
  () => graph.nodes.map(n => n.id).join(",") + "|" + graph.edges.map(e => `${e.from}>${e.to}`).join(","),
  [graph]
);
const problems = useMemo(() => validateGraph(graph), [structureKey]);
```

Cheaper still: recompute them in `page.tsx` when the graph structure changes and
pass the results down as props.

### 2.5 Stabilise `canvasActions`

Wrap it in `useMemo` in `page.tsx` with every handler already `useCallback`'d,
so the object identity holds across renders. Verify `onMoveNode`'s
`useCallback` dependency array is genuinely empty (`page.tsx:288` — it is) and
that the others are too.

### 2.6 Smoothness polish

- **Drop the mid-drag rounding** (§1.1). Round in `onNodeDragStop`.
- Add `will-change: transform` to `.react-flow__viewport` while panning or
  zooming and remove it after — a documented community fix for edge compositing
  stutter ([discussion #4617](https://github.com/xyflow/xyflow/discussions/4617)),
  reported as "buttery smooth." Do not leave it on permanently; it causes
  rasterisation blur.
- Drive hover styling from CSS (`.react-flow__node:hover`) rather than
  `onNodeMouseEnter`/`Leave`, which have a known flicker bug
  ([#4523](https://github.com/xyflow/xyflow/issues/4523)) and round-trip through
  React state for something purely visual.
- Set `elevateNodesOnSelect={false}` unless the z-order change is wanted.
- Leave `onlyRenderVisibleElements` **off**. It adds overhead and causes its own
  pop-in flicker at viewport edges, and is pointless at our node counts.

---

## 3. Acceptance criteria

- Dragging a node tracks the cursor smoothly at any zoom level, with no snapping
  to whole pixels.
- No visible flicker, blink or remount of any node during a drag, a pan, or a
  zoom.
- React DevTools Profiler: dragging one node re-renders **that node only** —
  not every node, and not the email pane.
- `onMoveNode` fires **once per drag**, not once per frame. Verify by counting
  calls.
- `validateGraph` and `orphanNodes` do not run during a drag.
- No console warning about `nodeTypes`/`edgeTypes` object identity in a
  production build.
- A 20-node flow holds 60 FPS while dragging, measured in the Performance panel.
- Structural operations — add, delete, reconnect, split — still update the canvas
  immediately.
- Positions still persist: drag a node, wait for autosave, reload, node is where
  it was left.

---

## 4. What not to do

- **Do not switch libraries.** The evidence says the problem is ours. Switching
  to Rete (stalled 14 months, single maintainer), tldraw (~$6k/yr and not a node
  graph), or GoJS ($4k–12k and canvas-drawn) would cost weeks and inherit new
  constraints while leaving the same update-path mistake to be made again.
- **Do not rewrite onto canvas/WebGL.** That trade only pays above ~1000 nodes.
  Our flows have under 20.
- **Do not reach for `onlyRenderVisibleElements` or virtualization.** Wrong
  problem entirely.
- **Do not add a global state library** to "fix" the re-renders. Routing drag
  positions through Redux or Zustand is the *cause* pattern in most reported
  cases, not the cure.
- **Do not rely on the React Compiler** to memoize this away. It cannot fix
  object identity you create explicitly inside a `useMemo`.

---

## 5. Verification note

If flicker survives all of §2, check whether it also occurs in a production
build. React StrictMode double-renders in development and can produce a
one-frame mount flash plus a spurious `nodeTypes` warning
([#3835](https://github.com/xyflow/xyflow/issues/3835)). Flicker that disappears
in `next build && next start` is a dev-mode artifact, not a real defect.
