"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Panel,
  Handle, Position, MarkerType, BaseEdge, getSmoothStepPath,
  type Node as RFNode, type Edge as RFEdge, type NodeProps, type EdgeProps,
  type Connection, type NodeChange, type OnReconnect,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { FlowNode, FlowNodeKind, FlowType } from "@/lib/schemas";
import { FLOW_TYPE_META } from "@/lib/schemas";
import {
  type FlowGraph, nodeById, orphanNodes, positionOf, validateGraph,
} from "@/lib/flow-graph";
import { FLOW_PLAYBOOKS } from "@/lib/flow-playbooks";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

// The flow canvas (spec: FLOW_CANVAS_REBUILD_SPEC.md §4). React Flow gives pan,
// zoom, drag, selection, edge routing and a minimap; everything about what a
// legal flow IS lives in lib/flow-graph.ts, so this file only renders and
// dispatches. The visual language is carried over from the old FlowMap — accent
// trigger, status pills, Yes-green / No-red forks — so it still looks like the app.

// ---- what the canvas asks the page to do ----------------------------------
export interface FlowCanvasActions {
  onSelectNode: (id: string | null) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  /** Insert a node of `kind` after `parentId`, on `branch` when the parent is a split. */
  onInsert: (parentId: string, kind: FlowNodeKind, branch?: "yes" | "no") => void;
  onDelete: (id: string) => void;
  /** A user-drawn connection. The page validates it and toasts on rejection. */
  onConnect: (from: string, to: string, branch?: "yes" | "no") => void;
  /** An existing edge dragged to a new target. */
  onReconnect: (edgeId: string, to: string) => void;
  onEditTrigger: (id: string, label: string) => void;
  onEditSplit: (id: string, fields: { label?: string; yes_label?: string; no_label?: string }) => void;
  onEditDelay: (id: string, label: string) => void;
  onEditExit: (id: string, label: string) => void;
  onTidy: () => void;
}

interface FlowCanvasProps extends FlowCanvasActions {
  graph: FlowGraph;
  flowType: FlowType;
  /** Scopes the remembered viewport. A zoom is per-flow, not global. */
  flowId: string;
  selectedNodeId: string | null;
  /** The email node currently being written, for the "writing…" pill. */
  generatingNodeId: string | null;
}

// Pan/zoom is a VIEWPORT, not content: it lives in sessionStorage keyed by flow,
// never on the record (spec §4.2). Persisting it would put one person's scroll
// position into a shared document, and it would show up as a change in every diff.
const VIEWPORT_KEY = (flowId: string) => `rc:flow-viewport:${flowId}`;

function readViewport(flowId: string): { x: number; y: number; zoom: number } | null {
  try {
    const raw = sessionStorage.getItem(VIEWPORT_KEY(flowId));
    if (!raw) return null;
    const v = JSON.parse(raw);
    return typeof v?.x === "number" && typeof v?.y === "number" && typeof v?.zoom === "number" ? v : null;
  } catch {
    return null;   // private mode / blocked storage — fall back to fitView
  }
}

// ---- node payload passed through React Flow -------------------------------
interface NodeData extends Record<string, unknown> {
  node: FlowNode;
  position: number;             // 1-based email position, 0 for non-emails
  orphan: boolean;
  generating: boolean;
  flowType: FlowType;
  actions: FlowCanvasActions;
}

const PILL: Record<string, { label: string; cls: string }> = {
  empty: { label: "Empty", cls: "bg-sunken text-ink-tertiary" },
  draft: { label: "Draft", cls: "bg-warning-50 text-warning-600" },
  final: { label: "Final", cls: "bg-success-50 text-success-600" },
  writing: { label: "Writing…", cls: "bg-action-50 text-action-600 animate-pulse" },
};

function StatusPill({ status }: { status: keyof typeof PILL }) {
  const p = PILL[status] ?? PILL.empty;
  return <span className={`text-[10px] font-semibold tracking-wide rounded px-1.5 py-0.5 ${p.cls}`}>{p.label}</span>;
}

function OrphanChip() {
  return (
    <span
      title="Not connected to the trigger — nothing reaches this yet. Drag an edge into it, or delete it."
      className="text-[10px] font-semibold tracking-wide rounded px-1.5 py-0.5 bg-danger-50 text-danger-600"
    >
      not connected
    </span>
  );
}

/** A single-line field that commits on blur or Enter and reverts on Escape. Used
 * for every inline-editable label on the canvas. */
function InlineText({
  value, placeholder, onCommit, className = "", multilineHint,
}: {
  value: string;
  placeholder: string;
  onCommit: (next: string) => void;
  className?: string;
  multilineHint?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) { setDraft(value); ref.current?.focus(); ref.current?.select(); } }, [editing, value]);

  if (!editing) {
    return (
      <button
        type="button"
        title={multilineHint ?? "Click to edit"}
        // nodrag/nopan stop React Flow from treating a click on a control as a
        // canvas gesture — without them the field can never be focused.
        className={`nodrag nopan text-left w-full truncate ${value ? "" : "text-ink-muted italic"} ${className}`}
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      >
        {value || placeholder}
      </button>
    );
  }
  return (
    <input
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setEditing(false); if (draft.trim() !== value) onCommit(draft.trim()); }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") { e.currentTarget.blur(); }
        if (e.key === "Escape") { setDraft(value); setEditing(false); }
      }}
      onClick={(e) => e.stopPropagation()}
      placeholder={placeholder}
      className={`nodrag nopan w-full bg-surface border border-accent rounded px-1.5 py-0.5 text-xs text-ink focus:outline-none ${className}`}
    />
  );
}

// ---- the "+" affordance ---------------------------------------------------
// A node's bottom edge carries an add button; a split carries one per branch.
function AddButton({
  onClick, label, tone = "neutral",
}: { onClick: () => void; label: string; tone?: "neutral" | "yes" | "no" }) {
  const cls = tone === "yes"
    ? "border-success-600/40 text-success-600 hover:bg-success-50"
    : tone === "no"
      ? "border-danger-200 text-danger-600 hover:bg-danger-50"
      : "border-line text-ink-tertiary hover:text-ink hover:bg-chrome";
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`nodrag nopan w-5 h-5 rounded-full border bg-surface leading-none text-[11px] flex items-center justify-center transition-colors ${cls}`}
    >
      +
    </button>
  );
}

function NodeShell({
  selected, orphan, tone, children, footer,
}: {
  selected: boolean;
  orphan: boolean;
  tone: "accent" | "plain" | "split" | "exit" | "delay";
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const base = {
    accent: "border-accent-200 bg-accent-50",
    plain: "border-line bg-surface",
    split: "border-line-strong bg-surface border-dashed",
    exit: "border-line bg-chrome",
    delay: "border-line bg-chrome",
  }[tone];
  return (
    <div className="relative">
      <div
        className={`rounded-md border px-2.5 py-2 shadow-sm transition-[border-color,box-shadow] ${base}
          ${selected ? "ring-2 ring-accent ring-offset-1" : ""}
          ${orphan ? "opacity-60 border-dashed" : ""}`}
      >
        {children}
      </div>
      {footer && (
        <div className="absolute left-0 right-0 -bottom-3 flex justify-center gap-6 pointer-events-none">
          <div className="flex gap-6 pointer-events-auto">{footer}</div>
        </div>
      )}
    </div>
  );
}

// ---- one component per node kind (spec §4.3) ------------------------------

function TriggerNodeView({ data, selected }: NodeProps) {
  const d = data as NodeData;
  return (
    <>
      <NodeShell
        selected={!!selected}
        orphan={false}
        tone="accent"
        footer={<AddButton label="Add a step after the trigger" onClick={() => d.actions.onInsert(d.node.id, "email")} />}
      >
        <div className="w-[190px]">
          <div className="t-label text-accent leading-none mb-1">Trigger</div>
          <InlineText
            value={d.node.trigger?.label ?? ""}
            placeholder="What fires this flow?"
            className="text-xs text-ink"
            onCommit={(next) => d.actions.onEditTrigger(d.node.id, next)}
          />
        </div>
      </NodeShell>
      <Handle type="source" position={Position.Bottom} className="!bg-accent !w-2 !h-2" />
    </>
  );
}

function EmailNodeView({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const status = d.generating ? "writing" : (d.node.email?.status ?? "empty");
  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-ink-tertiary !w-2 !h-2" />
      <NodeShell
        selected={!!selected}
        orphan={d.orphan}
        tone="plain"
        footer={<AddButton label="Add a step after this email" onClick={() => d.actions.onInsert(d.node.id, "email")} />}
      >
        <div className="w-[200px]">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="t-label text-ink-secondary leading-none">
              {d.position > 0 ? `Email ${d.position}` : "Email"}
            </span>
            <span className="ml-auto flex items-center gap-1">
              {d.orphan && <OrphanChip />}
              <StatusPill status={status} />
            </span>
          </div>
          <div className="text-xs text-ink leading-snug line-clamp-2">
            {d.node.email?.job?.trim() || <span className="text-ink-muted italic">No job set yet</span>}
          </div>
          {d.node.email?.delay?.trim() && (
            <div className="text-[10px] text-ink-muted mt-1">fires {d.node.email.delay.trim()}</div>
          )}
        </div>
      </NodeShell>
      <Handle type="source" position={Position.Bottom} className="!bg-ink-tertiary !w-2 !h-2" />
    </>
  );
}

function SplitNodeView({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const suggestions = SPLIT_SUGGESTIONS(d.flowType);
  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-ink-tertiary !w-2 !h-2" />
      <NodeShell
        selected={!!selected}
        orphan={d.orphan}
        tone="split"
        footer={
          <>
            <AddButton tone="yes" label="Add a step on the Yes branch" onClick={() => d.actions.onInsert(d.node.id, "email", "yes")} />
            <AddButton tone="no" label="Add a step on the No branch" onClick={() => d.actions.onInsert(d.node.id, "email", "no")} />
          </>
        }
      >
        <div className="w-[200px]">
          <div className="t-label text-ink-secondary leading-none mb-1 flex items-center gap-1.5">
            Branch
            {d.orphan && <span className="ml-auto"><OrphanChip /></span>}
          </div>
          <InlineText
            value={d.node.split?.label ?? ""}
            placeholder={suggestions[0] ?? "Condition?"}
            className="text-xs font-medium text-ink"
            onCommit={(next) => d.actions.onEditSplit(d.node.id, { label: next })}
          />
          <div className="mt-1.5 space-y-0.5">
            <div className="flex items-baseline gap-1.5 text-[11px]">
              <span className="font-semibold text-success-600 shrink-0">Yes</span>
              <InlineText
                value={d.node.split?.yes_label ?? ""}
                placeholder="what happens"
                className="text-ink-secondary"
                onCommit={(next) => d.actions.onEditSplit(d.node.id, { yes_label: next })}
              />
            </div>
            <div className="flex items-baseline gap-1.5 text-[11px]">
              <span className="font-semibold text-danger-600 shrink-0">No</span>
              <InlineText
                value={d.node.split?.no_label ?? ""}
                placeholder="what happens"
                className="text-ink-secondary"
                onCommit={(next) => d.actions.onEditSplit(d.node.id, { no_label: next })}
              />
            </div>
          </div>
        </div>
      </NodeShell>
      {/* Two labelled outputs — the fork actually forks now. */}
      <Handle id="yes" type="source" position={Position.Bottom} style={{ left: "28%" }} className="!bg-success-600 !w-2 !h-2" />
      <Handle id="no" type="source" position={Position.Bottom} style={{ left: "72%" }} className="!bg-danger-600 !w-2 !h-2" />
    </>
  );
}

function DelayNodeView({ data, selected }: NodeProps) {
  const d = data as NodeData;
  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-ink-tertiary !w-2 !h-2" />
      <NodeShell
        selected={!!selected}
        orphan={d.orphan}
        tone="delay"
        footer={<AddButton label="Add a step after this wait" onClick={() => d.actions.onInsert(d.node.id, "email")} />}
      >
        <div className="w-[130px] flex items-center gap-1.5">
          <span aria-hidden className="text-ink-tertiary text-[11px]">⏱</span>
          <InlineText
            value={d.node.delay?.label ?? ""}
            placeholder="Wait 2 days"
            className="text-[11px] text-ink"
            onCommit={(next) => d.actions.onEditDelay(d.node.id, next)}
          />
          {d.orphan && <OrphanChip />}
        </div>
      </NodeShell>
      <Handle type="source" position={Position.Bottom} className="!bg-ink-tertiary !w-2 !h-2" />
    </>
  );
}

function ExitNodeView({ data, selected }: NodeProps) {
  const d = data as NodeData;
  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-ink-tertiary !w-2 !h-2" />
      <NodeShell selected={!!selected} orphan={d.orphan} tone="exit">
        <div className="w-[160px] flex items-center gap-1.5">
          <span aria-hidden className="text-ink-tertiary text-[11px]">■</span>
          <InlineText
            value={d.node.exit?.label ?? ""}
            placeholder="Exit the flow"
            className="text-[11px] text-ink-secondary"
            onCommit={(next) => d.actions.onEditExit(d.node.id, next)}
          />
        </div>
      </NodeShell>
    </>
  );
}

const NODE_TYPES = {
  trigger: TriggerNodeView,
  email: EmailNodeView,
  split: SplitNodeView,
  delay: DelayNodeView,
  exit: ExitNodeView,
};

// ---- edges ----------------------------------------------------------------
// A branch edge carries its Yes/No word in the app's colours, so the fork reads
// at a glance without hovering.
function BranchEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd } = props;
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const branch = (data as { branch?: "yes" | "no" } | undefined)?.branch;
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={{ strokeWidth: 1.5 }} />
      {branch && (
        <foreignObject x={labelX - 18} y={labelY - 10} width={40} height={20} className="overflow-visible">
          <div className={`text-[10px] font-semibold text-center rounded px-1 ${
            branch === "yes" ? "bg-success-50 text-success-600" : "bg-danger-50 text-danger-600"}`}>
            {branch === "yes" ? "Yes" : "No"}
          </div>
        </foreignObject>
      )}
    </>
  );
}
const EDGE_TYPES = { branch: BranchEdge };

// ---- the node picker ------------------------------------------------------
// Same shape as the section-insertion picker so the two canvases behave alike.
const KIND_META: { kind: FlowNodeKind; label: string; hint: string }[] = [
  { kind: "email", label: "Email", hint: "A message. Write its copy in the pane on the right." },
  { kind: "split", label: "Split", hint: "A Yes/No branch. Arrives with both sides ready to fill in." },
  { kind: "delay", label: "Wait", hint: "A pause with no message — e.g. between a branch and its first email." },
  { kind: "exit", label: "Exit", hint: "The branch ends here: converted, suppressed, or left the flow." },
];

/** Suggested conditions, seeded from the flow's playbook. A type-ahead, never a
 * restriction — splits stay free text (spec §4.4). */
function SPLIT_SUGGESTIONS(flowType: FlowType): string[] {
  const trigger = FLOW_PLAYBOOKS[flowType]?.trigger;
  return [
    "Opened the last email?",
    "Clicked?",
    "Purchased?",
    ...(trigger ? [`${trigger}?`] : []),
  ];
}

function NodePicker({
  flowType, onClose, onPick,
}: {
  flowType: FlowType;
  onClose: () => void;
  onPick: (kind: FlowNodeKind, splitLabel?: string) => void;
}) {
  const [kind, setKind] = useState<FlowNodeKind>("email");
  const [splitLabel, setSplitLabel] = useState("");
  const suggestions = SPLIT_SUGGESTIONS(flowType);

  return (
    <Modal
      open
      onClose={onClose}
      title="Add a step"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onPick(kind, kind === "split" ? splitLabel.trim() : undefined)}>
            Add {KIND_META.find((k) => k.kind === kind)?.label.toLowerCase()}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {KIND_META.map((k) => (
            <button
              key={k.kind}
              onClick={() => setKind(k.kind)}
              className={`text-left p-2.5 rounded-md border transition-colors ${
                kind === k.kind ? "border-accent bg-accent-50" : "border-line hover:border-line-strong bg-surface"}`}
            >
              <div className="text-sm font-medium text-ink">{k.label}</div>
              <div className="text-[11px] text-ink-muted mt-0.5 leading-snug">{k.hint}</div>
            </button>
          ))}
        </div>

        {kind === "split" && (
          <div>
            <label className="t-label block mb-1.5">Condition <span className="font-normal text-ink-muted">(free text — you can edit it on the canvas)</span></label>
            <input
              list="flow-split-suggestions"
              value={splitLabel}
              onChange={(e) => setSplitLabel(e.target.value)}
              placeholder={suggestions[0]}
              className="w-full text-sm border border-line rounded-md px-3 py-2 bg-surface focus:outline-none focus:border-accent transition-colors"
            />
            <datalist id="flow-split-suggestions">
              {suggestions.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---- the canvas -----------------------------------------------------------

function FlowCanvasInner({
  graph, flowType, flowId, selectedNodeId, generatingNodeId, ...actions
}: FlowCanvasProps) {
  const [pending, setPending] = useState<{ parentId: string; branch?: "yes" | "no" } | null>(null);
  // Read once per flow: a remembered viewport wins over fitView, so coming back to
  // a flow returns you to where you were rather than re-framing the whole graph.
  const savedViewport = useMemo(() => readViewport(flowId), [flowId]);

  const orphans = useMemo(() => new Set(orphanNodes(graph).map((n) => n.id)), [graph]);
  const problems = useMemo(() => validateGraph(graph), [graph]);

  const rfNodes: RFNode[] = useMemo(() => graph.nodes.map((n) => ({
    id: n.id,
    type: n.kind,
    position: { x: n.x, y: n.y },
    selected: n.id === selectedNodeId,
    data: {
      node: n,
      position: n.kind === "email" ? positionOf(graph, n.id) : 0,
      orphan: orphans.has(n.id),
      generating: n.id === generatingNodeId,
      flowType,
      actions,
    } satisfies NodeData,
    // The trigger is fixed: it is the one node whose place in the flow is not a
    // choice, and letting it be dragged into the middle of a branch reads as a
    // structural change that isn't one.
    draggable: true,
  })), [graph, orphans, selectedNodeId, generatingNodeId, flowType, actions]);

  const rfEdges: RFEdge[] = useMemo(() => graph.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    sourceHandle: e.branch ?? null,
    type: "branch",
    data: { branch: e.branch },
    reconnectable: true,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
  })), [graph.edges]);

  // The `nodes` prop is fully controlled, so EVERY position change has to be
  // applied or the node stops following the cursor mid-drag. The write rate is
  // handled upstream instead: the page's autosave debounce collapses a whole drag
  // into one save 1.5s after it ends.
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    for (const c of changes) {
      if (c.type === "position" && c.position) {
        actions.onMoveNode(c.id, Math.round(c.position.x), Math.round(c.position.y));
      }
    }
  }, [actions]);

  const onConnectHandler = useCallback((c: Connection) => {
    if (!c.source || !c.target) return;
    actions.onConnect(c.source, c.target, (c.sourceHandle as "yes" | "no" | null) ?? undefined);
  }, [actions]);

  const onReconnectHandler: OnReconnect = useCallback((oldEdge, newConnection) => {
    if (!newConnection.target) return;
    actions.onReconnect(oldEdge.id, newConnection.target);
  }, [actions]);

  // Delete on the keyboard, for the selected node. React Flow's own deletion is
  // disabled (deleteKeyCode={null}) because a split deletes a whole subtree and
  // that has to go through the page's confirm.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (!selectedNodeId) return;
      const node = nodeById(graph, selectedNodeId);
      if (!node || node.kind === "trigger") return;
      e.preventDefault();
      actions.onDelete(selectedNodeId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedNodeId, graph, actions]);

  return (
    <div className="w-full h-full relative">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        onConnect={onConnectHandler}
        onReconnect={onReconnectHandler}
        onNodeClick={(_, n) => actions.onSelectNode(n.id)}
        onPaneClick={() => actions.onSelectNode(null)}
        deleteKeyCode={null}
        edgesReconnectable
        reconnectRadius={16}
        onMoveEnd={(_, viewport) => {
          try { sessionStorage.setItem(VIEWPORT_KEY(flowId), JSON.stringify(viewport)); } catch { /* blocked storage */ }
        }}
        {...(savedViewport ? { defaultViewport: savedViewport } : { fitView: true })}
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.25}
        maxZoom={1.6}
        proOptions={{ hideAttribution: false }}
        className="bg-canvas"
      >
        <Background gap={18} size={1} className="!bg-canvas" color="var(--color-line, #e5e5e5)" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!bg-surface" />

        <Panel position="top-left" className="flex items-center gap-1.5">
          <Button size="sm" variant="secondary" onClick={actions.onTidy} title="Re-arrange the whole canvas top-down">
            Tidy up
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title="Add a step at the end of the flow"
            onClick={() => {
              // Append after the last node on the main path that can still take a
              // next step, falling back to the trigger.
              const tail = [...graph.nodes].reverse().find((n) => n.kind !== "exit" && !orphans.has(n.id))
                ?? graph.nodes.find((n) => n.kind === "trigger");
              if (tail) setPending({ parentId: tail.id });
            }}
          >
            + Add step
          </Button>
        </Panel>

        {problems.length > 0 && (
          <Panel position="bottom-center" className="max-w-md">
            <div className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-[11px] text-warning-600 space-y-0.5">
              {problems.slice(0, 3).map((p, i) => <div key={i}>{p.message}</div>)}
              {problems.length > 3 && <div>…and {problems.length - 3} more.</div>}
            </div>
          </Panel>
        )}
      </ReactFlow>

      {pending && (
        <NodePicker
          flowType={flowType}
          onClose={() => setPending(null)}
          onPick={(kind) => {
            actions.onInsert(pending.parentId, kind, pending.branch);
            setPending(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * The canvas. `ReactFlowProvider` is mounted here rather than in the page so the
 * provider's lifetime matches the canvas's — remounting it per flow would reset
 * the viewport, and keeping it above the page would leak one flow's zoom into the
 * next.
 */
export default function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

/** The canvas's empty state: a flow with nothing but a trigger. Rendered by the
 * page over the canvas, so the grid stays visible behind it. */
export function EmptyCanvasPrompt({ onAdd, flowType }: { onAdd: () => void; flowType: FlowType }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="pointer-events-auto text-center bg-surface/95 border border-line rounded-lg px-6 py-5 shadow-sm max-w-xs">
        <div className="t-label text-ink-secondary mb-1">{FLOW_TYPE_META[flowType]?.label ?? flowType} flow</div>
        <div className="text-sm text-ink font-medium">Nothing in this flow yet</div>
        <p className="text-xs text-ink-muted mt-1 leading-relaxed">
          Add the first email and the canvas builds out from the trigger.
        </p>
        <Button size="sm" variant="primary" className="mt-3" onClick={onAdd}>Add your first email</Button>
      </div>
    </div>
  );
}
