"use client";
import { useEffect, useRef, useState } from "react";
import type { Flow, FlowSplit } from "@/lib/schemas";
import { FLOW_TYPE_META } from "@/lib/schemas";
import { FLOW_PLAYBOOKS } from "@/lib/flow-playbooks";

// The custom node/mind-map view (spec: FLOWS_COPY_ENGINE_SPEC.md). A lightweight,
// dependency-free vertical map — an EDITABLE trigger node → email nodes with
// status → delay chips on the connectors → editable conditional-split FORKS with
// a Yes and a No branch. Splits are free-text (no logic engine); the fork is a
// visual so the sequence reads the way it will run. Clicking an email opens it.

type EmailStatus = "empty" | "draft" | "final" | "writing";
type SplitFields = { label?: string; yes_label?: string; no_label?: string };

function StatusPill({ status }: { status: EmailStatus }) {
  const map = {
    empty: { label: "Empty", cls: "bg-chrome text-ink-muted" },
    draft: { label: "Draft", cls: "bg-accent-50 text-accent" },
    final: { label: "Final", cls: "bg-success-50 text-success-600" },
    writing: { label: "Writing…", cls: "bg-accent-50 text-accent animate-pulse" },
  }[status];
  return <span className={`text-[10px] font-semibold tracking-wide rounded px-1.5 py-0.5 ${map.cls}`}>{map.label}</span>;
}

function Connector({ delay }: { delay?: string }) {
  return (
    <div className="flex flex-col items-center py-1">
      <span aria-hidden className="w-px h-3 bg-line-strong" />
      {delay && (
        <span className="my-0.5 text-[10px] font-medium text-ink-muted bg-chrome border border-line rounded-full px-2 py-0.5">
          {delay}
        </span>
      )}
      <span aria-hidden className="w-px h-3 bg-line-strong" />
    </div>
  );
}

// Read-only fork visual — reused (exported) by the canvas branch context so a
// split reads identically in the map and next to the email it branches from.
export function SplitFork({ split }: { split: FlowSplit }) {
  return (
    <div className="rounded-md border border-dashed border-line-strong bg-surface px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <BranchIcon />
        <span className="flex-1 min-w-0 text-xs font-medium text-ink-secondary truncate">{split.label || "Untitled branch"}</span>
      </div>
      {(split.yes_label || split.no_label) && (
        <div className="mt-1.5 ml-5 space-y-1">
          <div className="flex items-start gap-1.5 text-[11px] text-ink-secondary">
            <span className="font-semibold text-success-600 shrink-0">Yes →</span>
            <span className="min-w-0">{split.yes_label || "—"}</span>
          </div>
          <div className="flex items-start gap-1.5 text-[11px] text-ink-secondary">
            <span className="font-semibold text-danger-600 shrink-0">No →</span>
            <span className="min-w-0">{split.no_label || "—"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

interface FlowMapProps {
  flow: Flow;
  selectedEmailId: string | null;
  generatingEmailId: string | null;
  onSelectEmail: (id: string) => void;
  onAddSplit: (afterPosition: number) => void;
  onUpdateSplit: (id: string, fields: SplitFields) => void;
  onDeleteSplit: (id: string) => void;
  onAddEmail: () => void;
  onUpdateTrigger: (value: string) => void;
}

export default function FlowMap({
  flow, selectedEmailId, generatingEmailId,
  onSelectEmail, onAddSplit, onUpdateSplit, onDeleteSplit, onAddEmail, onUpdateTrigger,
}: FlowMapProps) {
  const pb = FLOW_PLAYBOOKS[flow.type];
  const triggerText = flow.trigger ?? pb.trigger;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [d, setD] = useState({ label: "", yes: "", no: "" });
  const firstInputRef = useRef<HTMLInputElement>(null);

  const [editingTrigger, setEditingTrigger] = useState(false);
  const [triggerDraft, setTriggerDraft] = useState(triggerText);
  const triggerRef = useRef<HTMLInputElement>(null);

  // A freshly-added split arrives with an empty label — drop straight into edit.
  useEffect(() => {
    if (editingId) return;
    const fresh = flow.splits.find((s) => !s.label);
    if (fresh) { setEditingId(fresh.id); setD({ label: "", yes: "", no: "" }); }
  }, [flow.splits, editingId]);

  useEffect(() => { if (editingId) firstInputRef.current?.focus(); }, [editingId]);
  useEffect(() => { if (editingTrigger) { setTriggerDraft(triggerText); triggerRef.current?.focus(); } }, [editingTrigger, triggerText]);

  const startEdit = (split: FlowSplit) => {
    setEditingId(split.id);
    setD({ label: split.label, yes: split.yes_label ?? "", no: split.no_label ?? "" });
  };
  const commit = () => {
    if (!editingId) return;
    const label = d.label.trim();
    if (!label) onDeleteSplit(editingId); // no condition → the split is cancelled
    else onUpdateSplit(editingId, { label, yes_label: d.yes.trim() || undefined, no_label: d.no.trim() || undefined });
    setEditingId(null);
  };
  const cancel = () => {
    if (editingId && !flow.splits.find((s) => s.id === editingId)?.label) onDeleteSplit(editingId);
    setEditingId(null);
  };

  const commitTrigger = () => { onUpdateTrigger(triggerDraft.trim()); setEditingTrigger(false); };

  const splitsAfter = (position: number) => flow.splits.filter((s) => s.after_email_position === position);

  const renderSplits = (position: number) =>
    splitsAfter(position).map((split) => (
      <div key={split.id} className="w-full">
        <Connector />
        {editingId === split.id ? (
          <div className="rounded-md border border-accent bg-accent-50 px-2.5 py-2 space-y-1.5">
            <input
              ref={firstInputRef}
              value={d.label}
              onChange={(e) => setD((p) => ({ ...p, label: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") cancel(); }}
              placeholder="Condition, e.g. Opened Email 1?"
              className="w-full bg-surface border border-line rounded px-2 py-1 text-xs text-ink focus:outline-none focus:border-accent placeholder:text-ink-muted"
            />
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-success-600 w-8 shrink-0">Yes</span>
              <input
                value={d.yes}
                onChange={(e) => setD((p) => ({ ...p, yes: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") cancel(); }}
                placeholder="what happens if yes"
                className="flex-1 min-w-0 bg-surface border border-line rounded px-2 py-1 text-xs text-ink focus:outline-none focus:border-accent placeholder:text-ink-muted"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-danger-600 w-8 shrink-0">No</span>
              <input
                value={d.no}
                onChange={(e) => setD((p) => ({ ...p, no: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") cancel(); }}
                placeholder="what happens if no"
                className="flex-1 min-w-0 bg-surface border border-line rounded px-2 py-1 text-xs text-ink focus:outline-none focus:border-accent placeholder:text-ink-muted"
              />
            </div>
            <div className="flex justify-end gap-2 pt-0.5">
              <button onClick={cancel} className="text-[11px] text-ink-muted hover:text-ink">Cancel</button>
              <button onClick={commit} className="text-[11px] font-medium text-accent hover:opacity-80">Save branch</button>
            </div>
          </div>
        ) : (
          <div className="group/split relative">
            <SplitFork split={split} />
            <div className="absolute top-1.5 right-2 flex gap-1.5 opacity-0 group-hover/split:opacity-100 focus-within:opacity-100 transition-opacity">
              <button onClick={() => startEdit(split)} aria-label="Edit branch" title="Edit branch" className="text-ink-muted hover:text-ink text-[11px]">✎</button>
              <button onClick={() => onDeleteSplit(split.id)} aria-label="Delete branch" title="Delete branch" className="text-ink-muted hover:text-danger-600 text-[11px]">✕</button>
            </div>
          </div>
        )}
      </div>
    ));

  // A render helper (invoked, not instantiated as <Component/>) so it doesn't
  // count as a component created during render.
  const addBranch = (afterPosition: number) => (
    <button
      onClick={() => onAddSplit(afterPosition)}
      className="mt-1 text-[11px] font-medium text-ink-muted hover:text-accent transition-colors"
    >
      + Add branch
    </button>
  );

  return (
    <div className="p-5">
      {/* Flow header */}
      <div className="t-label text-ink-secondary mb-1">{FLOW_TYPE_META[flow.type].label} flow</div>
      <div className="text-lg font-semibold text-ink leading-tight">{flow.name}</div>
      {flow.klaviyo_flow_name && (
        <div className="text-xs text-ink-muted mt-1">Linked to Klaviyo: {flow.klaviyo_flow_name}</div>
      )}
      {flow.goal && <p className="text-sm text-ink-secondary mt-2 leading-relaxed">{flow.goal}</p>}
      <p className="text-xs text-ink-muted mt-3 leading-relaxed italic">{pb.shape}</p>

      {/* The map */}
      <div className="mt-5 flex flex-col items-stretch">
        {/* Trigger node — editable */}
        {editingTrigger ? (
          <div className="rounded-md border border-accent bg-accent-50 px-3 py-2">
            <div className="t-label text-accent leading-none mb-1">Trigger</div>
            <input
              ref={triggerRef}
              value={triggerDraft}
              onChange={(e) => setTriggerDraft(e.target.value)}
              onBlur={commitTrigger}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitTrigger(); } if (e.key === "Escape") setEditingTrigger(false); }}
              placeholder="What fires this flow?"
              className="w-full bg-surface border border-line rounded px-2 py-1 text-xs text-ink focus:outline-none focus:border-accent placeholder:text-ink-muted"
            />
          </div>
        ) : (
          <button
            onClick={() => setEditingTrigger(true)}
            title="Edit trigger"
            className="group/trig text-left flex items-center gap-2 rounded-md border border-accent-200 bg-accent-50 px-3 py-2 hover:border-accent transition-colors"
          >
            <BoltIcon />
            <div className="min-w-0 flex-1">
              <div className="t-label text-accent leading-none">Trigger</div>
              <div className="text-xs text-ink mt-0.5 truncate">{triggerText}</div>
            </div>
            <span className="opacity-0 group-hover/trig:opacity-100 text-ink-muted text-[11px] transition-opacity">✎</span>
          </button>
        )}
        {renderSplits(0)}
        <div className="flex flex-col items-start">{addBranch(0)}</div>

        {flow.emails.map((email) => (
          <div key={email.id} className="flex flex-col items-stretch">
            <Connector delay={email.delay} />
            <button
              onClick={() => onSelectEmail(email.id)}
              className={`w-full text-left p-3 rounded-md border transition-colors ${
                selectedEmailId === email.id
                  ? "border-accent bg-accent-50 ring-1 ring-accent"
                  : "border-line bg-surface hover:border-line-strong"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-ink">Email {email.position}</span>
                <StatusPill status={generatingEmailId === email.id ? "writing" : email.status} />
              </div>
              <p className="text-xs text-ink-secondary mt-1 leading-snug line-clamp-2">{email.job || "No job set yet — open to define it."}</p>
            </button>
            {renderSplits(email.position)}
            <div className="flex flex-col items-start">{addBranch(email.position)}</div>
          </div>
        ))}

        {/* Add an email to the sequence (custom flows and extensions) */}
        <Connector />
        <button
          onClick={onAddEmail}
          className="w-full rounded-md border border-dashed border-line-strong bg-surface hover:border-accent hover:text-accent text-ink-muted text-sm font-medium py-2 transition-colors"
        >
          + Add email
        </button>
      </div>
    </div>
  );
}

function BranchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="w-3.5 h-3.5 shrink-0 text-ink-muted">
      <circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="9" r="2" />
      <path d="M6 8v8M8 6h6a2 2 0 0 1 2 2v-1" />
    </svg>
  );
}
function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="w-4 h-4 shrink-0 text-accent">
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
    </svg>
  );
}
