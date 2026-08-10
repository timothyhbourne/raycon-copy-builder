"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import type { PlannerRow, PlannerChannel, PlannerStatus, OfferType, AudienceRef, SyncResult } from "@/lib/planner-types";
import { PLANNER_STATUSES, PLANNER_CHANNELS, PLANNER_STATUS_LABELS, statusLabel, EVERGREEN_OFFER, isEffectivelySent } from "@/lib/planner-types";
import Button from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import { SegmentedToggle } from "@/components/ui/FilterBar";
import { StatCard } from "@/components/ui/Stat";
import EmptyState from "@/components/ui/EmptyState";
import Chip from "@/components/ui/Chip";
import Drawer from "@/components/ui/Drawer";
import Modal, { ConfirmModal } from "@/components/ui/Modal";
import SkeletonBlock from "@/components/ui/Skeleton";
import PlatformBadge from "@/components/ui/PlatformBadge";
import DateRangePicker from "@/components/ui/DateRangePicker";
import CopyDocModal from "@/components/CopyDocModal";
import { toast } from "@/components/ui/Toast";

import {
  money, int, pct, rpr, fmtDate, fmtDateTime, isoToLocalInput, localInputToIso,
  ymdOf, offerValue, discountCode, reDate, microLabel, selectCls, STATUS_STYLE,
  type CopyEntry, type CopyPreview, type CampaignItem,
} from "./format";
import { ChannelGlyph, StatusPill, CopyLink, Chevron } from "./components";
import CalendarView from "./CalendarView";

export default function PlannerPage() {
  const [rows, setRows] = useState<PlannerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"calendar" | "table">("calendar");
  const [editing, setEditing] = useState<PlannerRow | "new" | null>(null);
  const [newDate, setNewDate] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  // Full-copy viewer, opened from the drawer's Copy section or a calendar glyph.
  const [copyDoc, setCopyDoc] = useState<{ id: string; status?: "draft" | "final" } | null>(null);
  const openCopyDoc = useCallback((id: string, status?: "draft" | "final") => setCopyDoc({ id, status }), []);
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });

  // Campaigns for the editor's Klaviyo link typeahead (fetched once). Audiences
  // are no longer picked manually — they auto-fetch from the linked campaign.
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);

  // Set of saved copy ids (drafts + finalized) so we can detect a stale link
  // (the saved campaign was deleted) and render/heal the row as unlinked.
  const [copyIds, setCopyIds] = useState<Set<string>>(new Set());
  const [copyIdsLoaded, setCopyIdsLoaded] = useState(false);
  const healedRef = useRef<Set<string>>(new Set());

  // table filters + sort
  const [fChannel, setFChannel] = useState<"all" | PlannerChannel>("all");
  // "sent" is a derived filter (isEffectivelySent), not a stored status.
  const [fStatus, setFStatus] = useState<"all" | PlannerStatus | "sent">("all");
  const [fStart, setFStart] = useState("");
  const [fEnd, setFEnd] = useState("");
  const [sortBy, setSortBy] = useState<"date" | "revenue">("date");

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/planner");
      // Parse defensively: an empty/HTML body (e.g. a bare 500) must not surface
      // as the opaque "Unexpected end of JSON input".
      const text = await res.text();
      let json: { rows?: PlannerRow[]; error?: string } = {};
      try { json = text ? JSON.parse(text) : {}; } catch { /* non-JSON error body */ }
      if (!res.ok) throw new Error(json.error || `Failed to load planner (HTTP ${res.status})`);
      setRows((json.rows ?? []) as PlannerRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);
  // Deep link for design handoff: /planner?copy=<id>&as=<draft|final> opens the
  // full-copy viewer straight away, so a link pasted in Slack lands the designer
  // on the copy. Clean the query afterwards so a refresh doesn't reopen it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const copy = params.get("copy");
    if (!copy) return;
    openCopyDoc(copy, params.get("as") === "final" ? "final" : "draft");
    window.history.replaceState(null, "", window.location.pathname);
  }, [openCopyDoc]);
  useEffect(() => {
    fetch("/api/klaviyo/campaigns-list").then((r) => r.json()).then((j) => {
      if (j.campaigns) setCampaigns(j.campaigns);
    }).catch(() => { /* picker just won't have suggestions */ });
    // Which copy campaigns actually still exist (drafts in /generated + finalized
    // in the library). Used to detect stale links.
    Promise.all([
      fetch("/api/campaigns").then((r) => r.json()).catch(() => ({})),
      fetch("/api/library").then((r) => r.json()).catch(() => ({})),
    ]).then(([saved, lib]) => {
      // Only trust the id set if BOTH lists loaded. If either failed, stay
      // optimistic (treat existing links as valid) and don't heal — otherwise a
      // transient fetch failure would wrongly wipe every valid copy link.
      if (!Array.isArray(saved.campaigns) || !Array.isArray(lib.campaigns)) return;
      const ids = new Set<string>();
      saved.campaigns.forEach((c: { id: string }) => ids.add(c.id));
      lib.campaigns.forEach((c: { id: string }) => ids.add(c.id));
      setCopyIds(ids);
      setCopyIdsLoaded(true);
    });
  }, []);

  // Heal stale links: a row points at a copy campaign that no longer exists.
  // Render already treats it as unlinked (copyEntry below); this persists it.
  useEffect(() => {
    if (!copyIdsLoaded) return;
    const stale = rows.filter((r) =>
      r.channel === "email" && r.copy_campaign_id && !copyIds.has(r.copy_campaign_id) && !healedRef.current.has(r.id));
    if (stale.length === 0) return;
    stale.forEach((r) => healedRef.current.add(r.id));
    Promise.all(stale.map((r) =>
      fetch(`/api/planner/link?row_id=${encodeURIComponent(r.id)}`, { method: "DELETE" }).catch(() => {})
    )).then(() => fetchRows());
  }, [rows, copyIds, copyIdsLoaded, fetchRows]);

  // Resolve a row's Copy Builder link state. Before the id set loads, assume a
  // set copy_campaign_id is valid (avoids a flash of "unlinked").
  const copyEntry = useCallback((row: PlannerRow): CopyEntry => {
    // SMS copy lives in its own store (ids not in copyIds); trust the backref.
    // Stale-healing stays email-only, so an SMS link is never wrongly wiped.
    if (row.channel !== "email") {
      if (!row.copy_campaign_id) return "unlinked";
      return row.copy_status === "final" ? "final" : "draft";
    }
    const linked = !!row.copy_campaign_id && (!copyIdsLoaded || copyIds.has(row.copy_campaign_id));
    if (!linked) return "unlinked";
    return row.copy_status === "final" ? "final" : "draft";
  }, [copyIds, copyIdsLoaded]);

  // Sync metrics from Klaviyo/Postscript. Outcome goes to a toast (no inline dump).
  const sync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/planner/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Sync failed");
      setRows(json.rows as PlannerRow[]);
      // sms_manual is informational (SMS platform metrics are manual entry by
      // design — no Postscript analytics API), never counted as a failure.
      const failed = (json.results ?? []).filter((r: SyncResult) => !r.matched && r.reason !== "sms_manual").length;
      const smsManual = (json.results ?? []).filter((r: SyncResult) => r.reason === "sms_manual").length;
      const nbUnmatched = (json.northbeam_results ?? []).filter((r: SyncResult) => !r.matched).length;
      const parts = [`Synced ${json.synced} campaign${json.synced === 1 ? "" : "s"}`];
      if (failed > 0) parts.push(`${failed} unmatched`);
      if (json.northbeam_configured && nbUnmatched > 0) parts.push(`${nbUnmatched} no NB match`);
      if (smsManual > 0) parts.push(`${smsManual} SMS manual-entry`);
      const msg = parts.join(" · ");
      // No dedicated warning tone in the toast manager — info carries the caveats.
      if (failed === 0 && nbUnmatched === 0) toast.success(msg);
      else toast.info(msg);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  // Persist a re-date (drag). Optimistic; rollback on failure.
  const reschedule = async (rowId: string, newYmd: string) => {
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    const prev = rows;
    const newIso = reDate(row.planned_send_at, newYmd);
    setRows(rows.map((r) => (r.id === rowId ? { ...r, planned_send_at: newIso } : r)));
    try {
      const res = await fetch("/api/planner", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, name: row.name, channel: row.channel, planned_send_at: newIso }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setRows(prev); // rollback
      toast.error("Could not save the new date. Reverted.");
    }
  };

  const filtered = useMemo(() => rows.filter((r) => {
    if (fChannel !== "all" && r.channel !== fChannel) return false;
    if (fStatus === "sent") { if (!isEffectivelySent(r)) return false; }
    else if (fStatus !== "all" && r.status !== fStatus) return false;
    const day = ymdOf(r.planned_send_at);
    if (fStart && day < fStart) return false;
    if (fEnd && day > fEnd) return false;
    return true;
  }), [rows, fChannel, fStatus, fStart, fEnd]);

  return (
    <div>
      <PageHeader
        className="mb-4"
        eyebrow="Campaign Planner"
        title="Plan &"
        accent="learnings"
        description="Schedule email & SMS campaigns, link the copy, and sync performance back onto each send."
        meta={
          <>
            <Button variant="secondary" size="sm" loading={syncing} onClick={sync}>Sync metrics</Button>
            <Button variant="primary" size="sm" onClick={() => { setNewDate(null); setEditing("new"); }}>+ New campaign</Button>
          </>
        }
      />

      <div className="mb-4">
        <SegmentedToggle
          ariaLabel="Planner view"
          options={[{ value: "calendar", label: "Calendar" }, { value: "table", label: "Table" }]}
          value={view}
          onChange={setView}
        />
      </div>

      {error && (
        <div className="bg-danger-50 border border-danger-200 rounded-md p-3 mb-4 text-sm text-danger-600 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss" className="opacity-70 hover:opacity-100 transition-opacity">✕</button>
        </div>
      )}

      {loading ? (
        <div className="bg-surface border border-line rounded-md shadow-card p-4 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonBlock key={i} className="h-9 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-surface border border-line rounded-md shadow-card">
          <EmptyState
            icon={
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
            }
            title="No campaigns yet"
            description="Plan your first email or SMS campaign. Start with a brief, fill in the details later."
            action={<Button variant="secondary" size="sm" onClick={() => { setNewDate(null); setEditing("new"); }}>+ New campaign</Button>}
          />
        </div>
      ) : view === "calendar" ? (
        <CalendarView rows={rows} cursor={cursor} setCursor={setCursor}
          onEntry={(r) => setEditing(r)} onDay={(d) => { setNewDate(`${d}T09:00`); setEditing("new"); }}
          onReschedule={reschedule} copyEntry={copyEntry} onViewCopy={openCopyDoc} />
      ) : (
        <TableView rows={filtered} onEdit={(r) => setEditing(r)} onReschedule={reschedule}
          onRowUpdated={(row) => setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)))}
          fChannel={fChannel} setFChannel={setFChannel} fStatus={fStatus} setFStatus={setFStatus}
          fStart={fStart} setFStart={setFStart} fEnd={fEnd} setFEnd={setFEnd}
          sortBy={sortBy} setSortBy={setSortBy} copyEntry={copyEntry} />
      )}

      {editing && (
        <RowEditor row={editing === "new" ? null : editing} defaultDateIso={newDate}
          campaigns={campaigns} allRows={rows}
          onClose={() => setEditing(null)}
          onLinkChanged={fetchRows} onViewCopy={openCopyDoc}
          onSaved={async () => { setEditing(null); await fetchRows(); }} />
      )}

      {copyDoc && (
        <CopyDocModal copyId={copyDoc.id} status={copyDoc.status}
          plannedSendAt={rows.find((r) => r.copy_campaign_id === copyDoc.id)?.planned_send_at}
          onClose={() => setCopyDoc(null)} onStale={fetchRows} />
      )}
    </div>
  );
}

// ---------- table ----------
// One template drives the header and every body row. Layout: plan columns
// (Campaign · Status · Planned · Offer) | a single hairline divider | the
// performance cluster (Recipients · Open · Click · Rev/recip) | the emphasized
// revenue pair (Revenue · NB rev). Sized to fit the planner's ~1088px content
// column without a horizontal scrollbar — no hard minWidth. Totals live in the
// KPI cards at the top, so there is no bottom summary row.
const GRID = "minmax(200px,2fr) 132px 96px minmax(130px,1fr) 82px 60px 60px 78px 98px 98px";

// One metric cell renderer so all six share weight/alignment and a uniformly
// faint em-dash for blanks. `emphasize` marks the revenue pair (stronger ink +
// weight); everything else is quiet. `fmt` runs only on non-null values.
function Num({ v, fmt, emphasize = false }: { v: number | null | undefined; fmt: (n: number) => string; emphasize?: boolean }) {
  if (v == null || Number.isNaN(v)) return <span className="text-ink-muted/50">—</span>;
  return <span className={emphasize ? "text-ink font-medium" : "text-ink-muted"}>{fmt(v)}</span>;
}

// ---------- manual metrics (SMS rows) ----------
// Postscript's public API has no analytics endpoints, so SMS platform metrics
// are typed in from the Postscript dashboard. Parsing is forgiving ($ , % and
// spaces stripped), storage is canonical (integers, 0..1 fractions, USD).
type ManualField = "recipients" | "click_rate" | "revenue" | "revenue_per_recipient";

// raw text → canonical value. "" → null (clear; empty ≠ 0). "invalid" keeps the
// cell in its error state — never silently drop or coerce to 0.
function parseManual(field: ManualField, raw: string): number | null | "invalid" {
  const s = raw.replace(/[$,%\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  if (field === "recipients") return Math.round(n);
  if (field === "click_rate") {
    const f = n / 100; // percentage as typed: "2.4" or "2.4%" → 0.024
    return f > 1 ? "invalid" : f;
  }
  return n;
}
// Canonical value → the text shown when a cell enters edit mode.
function manualEditText(field: ManualField, v: number | null | undefined): string {
  if (v == null) return "";
  if (field === "recipients") return String(Math.round(v));
  if (field === "click_rate") return `${(v * 100).toFixed(1)}`;
  return v.toFixed(2);
}

// Click-to-edit metric cell for SMS rows. Commit on blur/Enter; Escape reverts;
// an invalid entry keeps focus with an error outline. A commit PATCHes
// /api/planner/manual-metrics and hands the updated row back to the table.
function ManualCell({ row, field, fmt, emphasize = false, onRowUpdated }: {
  row: PlannerRow; field: ManualField; fmt: (n: number) => string; emphasize?: boolean;
  onRowUpdated: (r: PlannerRow) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [saving, setSaving] = useState(false);
  const initial = useRef("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const v = row[field] as number | null | undefined;

  const start = (e: React.MouseEvent) => {
    e.stopPropagation();
    initial.current = manualEditText(field, v);
    setText(initial.current);
    setInvalid(false);
    setEditing(true);
  };
  const close = () => { setEditing(false); setInvalid(false); };
  const commit = async () => {
    if (saving) return;
    if (text.trim() === initial.current.trim()) { close(); return; } // untouched — never turns a derived rpr into an override
    const parsed = parseManual(field, text);
    if (parsed === "invalid") {
      setInvalid(true);
      inputRef.current?.focus(); // bad entry keeps focus, outlined
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/planner/manual-metrics", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, [field]: parsed }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      onRowUpdated(json.row as PlannerRow);
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the metric.");
      setInvalid(true);
      inputRef.current?.focus();
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        value={text}
        disabled={saving}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => { setText(e.target.value); setInvalid(false); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); close(); } // value unchanged
        }}
        className={`w-full min-w-0 text-right font-mono tabular-nums text-sm bg-surface border rounded-sm px-1 py-0.5 focus:outline-none ${
          invalid ? "border-danger-600 ring-1 ring-danger-200" : "border-accent"
        }`}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={start}
      title="Manual entry — from Postscript dashboard"
      className={`min-w-0 text-right underline-offset-2 decoration-dotted decoration-ink-muted/50 group-hover:underline focus-visible:underline ${
        v == null || Number.isNaN(v) ? "text-ink-muted/50" : emphasize ? "text-ink font-medium" : "text-ink-muted"
      }`}
    >
      {v == null || Number.isNaN(v) ? "—" : fmt(v)}
    </button>
  );
}

// Audience summary for a row's expanded detail line (+included / −excluded).
function audienceSummary(r: PlannerRow): string {
  const inc = r.audience_included.map((a) => a.name).join(", ");
  const exc = r.audience_excluded.map((a) => a.name).join(", ");
  if (!inc && !exc) return "—";
  return [inc && `+ ${inc}`, exc && `− ${exc}`].filter(Boolean).join("  ");
}

// Row expand/collapse control. A distinct affordance (stopPropagation) so it
// never triggers the row's onClick → editor.
function ExpandToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button type="button" aria-label={open ? "Hide details" : "Show details"} aria-expanded={open}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className="shrink-0 -ml-1 mr-0.5 w-5 h-5 inline-flex items-center justify-center rounded-sm text-ink-muted hover:bg-accent-50 hover:text-accent transition-colors">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden
        className={`transition-transform duration-150 ease-out-soft ${open ? "rotate-90" : ""}`}>
        <path d="m9 18 6-6-6-6" />
      </svg>
    </button>
  );
}

function TableView({ rows, onEdit, onReschedule, onRowUpdated, fChannel, setFChannel, fStatus, setFStatus, fStart, setFStart, fEnd, setFEnd, sortBy, setSortBy, copyEntry }: {
  rows: PlannerRow[]; onEdit: (r: PlannerRow) => void; onReschedule: (id: string, ymd: string) => void;
  onRowUpdated: (r: PlannerRow) => void;
  fChannel: "all" | PlannerChannel; setFChannel: (v: "all" | PlannerChannel) => void;
  fStatus: "all" | PlannerStatus | "sent"; setFStatus: (v: "all" | PlannerStatus | "sent") => void;
  fStart: string; setFStart: (v: string) => void; fEnd: string; setFEnd: (v: string) => void;
  sortBy: "date" | "revenue"; setSortBy: (v: "date" | "revenue") => void;
  copyEntry: (r: PlannerRow) => CopyEntry;
}) {
  // Audience + notes live behind per-row progressive disclosure.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }), []);
  // Summary respects current filters.
  const summary = useMemo(() => {
    const recip = rows.reduce((a, r) => a + (r.recipients ?? 0), 0);
    const rev = rows.reduce((a, r) => a + (r.revenue ?? 0), 0);
    const nbRev = rows.reduce((a, r) => a + (r.northbeam_revenue ?? 0), 0);
    const opens = rows.filter((r) => r.open_rate != null);
    const clicks = rows.filter((r) => r.click_rate != null);
    return {
      count: rows.length, recipients: recip, revenue: rev, nbRevenue: nbRev,
      avgOpen: opens.length ? opens.reduce((a, r) => a + (r.open_rate ?? 0), 0) / opens.length : null,
      avgClick: clicks.length ? clicks.reduce((a, r) => a + (r.click_rate ?? 0), 0) / clicks.length : null,
    };
  }, [rows]);

  // date sort → grouped by day with DnD; revenue sort → flat, drag disabled.
  const groups = useMemo(() => {
    if (sortBy === "revenue") return [{ day: "", rows: [...rows].sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0)) }];
    const m = new Map<string, PlannerRow[]>();
    for (const r of rows) { const k = ymdOf(r.planned_send_at); (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, rs]) => ({ day, rows: rs }));
  }, [rows, sortBy]);

  const onDragEnd = (res: DropResult) => {
    if (!res.destination) return;
    const dest = res.destination.droppableId.replace("tbl:", "");
    const src = res.source.droppableId.replace("tbl:", "");
    if (dest && dest !== src) onReschedule(res.draggableId, dest);
  };

  // Comfortable row rhythm; hairline separators do the dividing, not boxes or
  // zebra fills — every row sits on white, color appears only on hover.
  const cell = "px-3 py-3 text-sm flex items-center min-w-0";
  const numCell = `${cell} justify-end font-mono tabular-nums`;
  // Header cell for a right-aligned metric column.
  const numHead = "px-3 py-2 text-right";

  return (
    <div>
      {/* KPI stat cards — totals for the current filter set, as singular rounded
          boxes. They sit above the pinned filter/header block and scroll away. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <StatCard label="Campaigns" value={int(summary.count)} />
        <StatCard label="Recipients" value={int(summary.recipients)} />
        <StatCard label="Avg open" value={pct(summary.avgOpen)} />
        <StatCard label="Avg click" value={pct(summary.avgClick)} />
        <StatCard label="Revenue" value={money(summary.revenue)} />
        <StatCard label={<>NB rev · <span className="normal-case tracking-normal">1d click</span></>} value={money(summary.nbRevenue)} />
      </div>

      {/* Filter bar + column header pinned together to the top of the page
          scroll (the planner layout's overflow-y-auto region). One solid
          background so rows never bleed through while scrolling. */}
      <div className="sticky top-0 z-20 bg-surface">
        <div className="flex items-end gap-3 px-1 py-3 border-b border-line flex-wrap">
          <label className="flex flex-col gap-1">
            <span className={microLabel}>Channel</span>
            <div className="relative">
              <select value={fChannel} onChange={(e) => setFChannel(e.target.value as "all" | PlannerChannel)} className={selectCls}>
                <option value="all">All channels</option>{PLANNER_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select><Chevron />
            </div>
          </label>
          <label className="flex flex-col gap-1">
            <span className={microLabel}>Status</span>
            <div className="relative">
              <select value={fStatus} onChange={(e) => setFStatus(e.target.value as "all" | PlannerStatus | "sent")} className={selectCls}>
                <option value="all">All statuses</option>
                {PLANNER_STATUSES.map((s) => <option key={s} value={s}>{PLANNER_STATUS_LABELS[s]}</option>)}
                <option value="sent">Sent</option>
              </select><Chevron />
            </div>
          </label>
          <div className="flex flex-col gap-1">
            <span className={microLabel}>Date range</span>
            <DateRangePicker start={fStart} end={fEnd}
              onChange={(s, e) => { setFStart(s); setFEnd(e); }} />
          </div>
          <label className="flex flex-col gap-1">
            <span className={microLabel}>Sort</span>
            <div className="relative">
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "date" | "revenue")} className={selectCls}>
                <option value="date">Planned send</option><option value="revenue">Revenue</option>
              </select><Chevron />
            </div>
          </label>
          <div className="ml-auto self-end text-xs text-ink-muted pb-1.5">{rows.length} campaign{rows.length === 1 ? "" : "s"}</div>
        </div>

        {/* column header — aligned to GRID */}
        {/* Column header — white and quiet (a single bottom hairline), so it
            blends into the surface instead of reading as a gray bar. */}
        <div className="grid bg-surface border-b border-line t-label" style={{ gridTemplateColumns: GRID }}>
          <div className="px-3 py-2">Campaign</div>
          <div className="px-3 py-2">Status</div>
          <div className="px-3 py-2">Planned</div>
          <div className="px-3 py-2">Offer</div>
          <div className={`${numHead} border-l border-line`}>Recipients</div>
          <div className={numHead}>Open</div>
          <div className={numHead}>Click</div>
          <div className={numHead}>Rev/recip</div>
          <div className={numHead}>Revenue</div>
          <div className={numHead} title="Northbeam attributed revenue — Clicks only · 1-day · cash — reconciles with CRM Campaign (v2). Matched by linked campaign name; window ends yesterday (last fully processed day). Distinct from the platform-reported Revenue.">NB rev</div>
        </div>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        {groups.map((g, gi) => (
          <div key={g.day || "flat"}>
            {sortBy === "date" && g.day && (
              // Airy, quiet day label — no band, no fill; generous space above
              // each group so days read as gentle sections that flow into the
              // table. Left gutter so it feels like a margin note.
              <div className={`px-1 ${gi === 0 ? "pt-3" : "pt-8"} pb-2 t-label`}>
                {fmtDate(g.day + "T00:00:00")}
              </div>
            )}
            <Droppable droppableId={`tbl:${g.day}`} isDropDisabled={sortBy !== "date"}>
              {(provided, snap) => (
                <div ref={provided.innerRef} {...provided.droppableProps} className={snap.isDraggingOver ? "bg-accent-50/40 rounded-md" : ""}>
                  {g.rows.map((r, idx) => {
                    const isOpen = expanded.has(r.id);
                    return (
                      <div key={r.id}>
                        <Draggable draggableId={r.id} index={idx} isDragDisabled={sortBy !== "date"}>
                          {(dp, snap2) => (
                            <div ref={dp.innerRef} {...dp.draggableProps} {...dp.dragHandleProps}
                              onClick={() => onEdit(r)}
                              className={`group grid bg-surface border-b border-line hover:bg-accent-50/50 cursor-pointer transition-colors ${snap2.isDragging ? "shadow-pop" : ""}`}
                              style={{ gridTemplateColumns: GRID, ...dp.draggableProps.style }}>
                              <div className={cell}>
                                <ExpandToggle open={isOpen} onToggle={() => toggle(r.id)} />
                                <ChannelGlyph channel={r.channel} className="shrink-0 mr-1.5" />
                                <div className="min-w-0 flex flex-col">
                                  <span className={`truncate ${r.status === "cancelled" ? "line-through text-ink-muted" : "text-ink"}`}>{r.name}</span>
                                  <CopyLink entry={copyEntry(r)} rowId={r.id} copyId={r.copy_campaign_id} channel={r.channel} />
                                </div>
                              </div>
                              <div className={cell}>
                                <div className="flex items-center gap-1.5 min-w-0 whitespace-nowrap">
                                  <StatusPill status={r.status} />
                                  {r.status === "scheduled" && <PlatformBadge channel={r.channel} compact className="shrink-0" />}
                                </div>
                              </div>
                              <div className={`${cell} text-ink-secondary whitespace-nowrap`}>{fmtDate(r.planned_send_at)}</div>
                              <div className={cell}>
                                <div className="min-w-0 flex flex-col gap-0.5">
                                  <span className="truncate text-ink-secondary">{offerValue(r)}</span>
                                  {discountCode(r) && (
                                    <span className="w-fit max-w-full truncate whitespace-nowrap font-mono text-[10px] tracking-tight text-ink-muted border border-line rounded-sm px-1 py-px">
                                      {discountCode(r)}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {/* SMS platform metrics are click-to-edit manual entry (no
                                  Postscript analytics API); email cells stay synced/read-only.
                                  NB rev keeps syncing for both channels. */}
                              <div className={`${numCell} border-l border-line`}>
                                {r.channel === "sms" ? <ManualCell row={r} field="recipients" fmt={int} onRowUpdated={onRowUpdated} /> : <Num v={r.recipients} fmt={int} />}
                              </div>
                              <div className={numCell}>{r.channel === "sms" ? <span className="text-ink-muted/50">—</span> : <Num v={r.open_rate} fmt={pct} />}</div>
                              <div className={numCell}>
                                {r.channel === "sms" ? <ManualCell row={r} field="click_rate" fmt={pct} onRowUpdated={onRowUpdated} /> : <Num v={r.click_rate} fmt={pct} />}
                              </div>
                              <div className={numCell}>
                                {r.channel === "sms" ? <ManualCell row={r} field="revenue_per_recipient" fmt={rpr} onRowUpdated={onRowUpdated} /> : <Num v={r.revenue_per_recipient} fmt={rpr} />}
                              </div>
                              <div className={numCell}>
                                {r.channel === "sms" ? <ManualCell row={r} field="revenue" fmt={money} emphasize onRowUpdated={onRowUpdated} /> : <Num v={r.revenue} fmt={money} emphasize />}
                              </div>
                              <div className={numCell}><Num v={r.northbeam_revenue} fmt={money} emphasize /></div>
                            </div>
                          )}
                        </Draggable>
                        {isOpen && (
                          <div className="border-b border-line bg-accent-50/30 pl-10 pr-4 py-3 grid gap-1.5 text-[11px] text-ink-secondary rc-animate-fade">
                            <div className="flex gap-2">
                              <span className="shrink-0 w-16 t-label">Audience</span>
                              <span className="min-w-0">{audienceSummary(r)}</span>
                            </div>
                            <div className="flex gap-2">
                              <span className="shrink-0 w-16 t-label">Notes</span>
                              <span className="min-w-0">{r.notes || "—"}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </div>
        ))}
      </DragDropContext>

      {sortBy === "revenue" && <div className="px-1 py-2 text-[11px] text-ink-muted">Switch sort to “Planned send” to drag-reschedule.</div>}
    </div>
  );
}

// ---------- row editor ----------
function RowEditor({ row, defaultDateIso, campaigns, allRows, onClose, onLinkChanged, onViewCopy, onSaved }: {
  row: PlannerRow | null; defaultDateIso: string | null;
  campaigns: CampaignItem[]; allRows: PlannerRow[];
  onClose: () => void; onLinkChanged: () => void;
  onViewCopy: (id: string, status?: "draft" | "final") => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(row?.name ?? "");
  const [channel, setChannel] = useState<PlannerChannel>(row?.channel ?? "email");
  const [status, setStatus] = useState<PlannerStatus>(row?.status ?? "writing_brief");
  const [plannedSendAt, setPlannedSendAt] = useState(row ? isoToLocalInput(row.planned_send_at) : defaultDateIso ? defaultDateIso : isoToLocalInput(new Date().toISOString()));
  const [offerType, setOfferType] = useState<OfferType>(row?.offer_type ?? "evergreen");
  const [offer, setOffer] = useState(row?.offer ?? EVERGREEN_OFFER);
  const [promoCode, setPromoCode] = useState(row?.promo_code ?? "");
  const [included, setIncluded] = useState<AudienceRef[]>(row?.audience_included ?? []);
  const [excluded, setExcluded] = useState<AudienceRef[]>(row?.audience_excluded ?? []);
  const [klaviyoId, setKlaviyoId] = useState(row?.klaviyo_campaign_id ?? "");
  const [klaviyoSendTime, setKlaviyoSendTime] = useState<string | null>(row?.klaviyo_send_time ?? null);
  // Northbeam campaign name — the join key for the NB rev match on SMS rows.
  // (postscript_campaign_id is deprecated: it linked to endpoints that don't
  // exist. The field is preserved on saved rows but has no UI.)
  const [nbName, setNbName] = useState(row?.northbeam_campaign_name ?? "");
  const [nbOpen, setNbOpen] = useState(false);
  const [nbCandidates, setNbCandidates] = useState<{ name: string; revenue: number }[]>([]);
  const [nbLoading, setNbLoading] = useState(false);
  const nbFetched = useRef(false);
  const [notes, setNotes] = useState(row?.notes ?? "");
  // Manual platform metrics (SMS): same four fields as the table's inline
  // entry, here for completeness. Strings, parsed on Save; initial strings are
  // kept so only touched fields get PATCHed (an untouched derived rev/recip
  // must never become an override).
  const manualInitial = useRef({
    recipients: manualEditText("recipients", row?.recipients),
    click_rate: manualEditText("click_rate", row?.click_rate),
    revenue: manualEditText("revenue", row?.revenue),
    revenue_per_recipient: manualEditText("revenue_per_recipient", row?.revenue_per_recipient),
  });
  const [manual, setManual] = useState(manualInitial.current);

  // Lazily load the Northbeam-reported Postscript campaign names (cached ~1h
  // server-side; the export takes minutes on a cold cache, hence on-demand).
  const loadNbCandidates = useCallback(async () => {
    if (nbFetched.current) return;
    nbFetched.current = true;
    setNbLoading(true);
    try {
      const res = await fetch("/api/planner/northbeam-campaigns?platform=postscript");
      const j = await res.json();
      if (res.ok && Array.isArray(j.names)) setNbCandidates(j.names);
      else if (j.error) toast.info(`Northbeam names unavailable — type the campaign name manually. (${j.error})`);
    } catch {
      toast.info("Northbeam names unavailable — type the campaign name manually.");
    } finally {
      setNbLoading(false);
    }
  }, []);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [campQ, setCampQ] = useState("");
  const [campOpen, setCampOpen] = useState(false);
  // Audience auto-fetch state.
  const [audLoading, setAudLoading] = useState(false);
  const [klaviyoStatus, setKlaviyoStatus] = useState<string | null>(null);
  const [audFromKlaviyo, setAudFromKlaviyo] = useState(false);
  // Copy-embed state: the link is persisted immediately (not on Save), so track
  // it locally and refresh the parent rows via onLinkChanged.
  const [copyId, setCopyId] = useState<string | undefined>(row?.copy_campaign_id);
  const [copyStatus, setCopyStatus] = useState<"draft" | "final" | undefined>(row?.copy_status);
  const [copyPreview, setCopyPreview] = useState<CopyPreview | null>(null);
  const [copyLoading, setCopyLoading] = useState(false);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [unlinkConfirm, setUnlinkConfirm] = useState(false);

  // Minimal editor styling: sparse mono micro-labels, hairline section rules.
  const label = "block t-label mb-1.5";
  const input = "w-full border border-line rounded-sm px-2 py-1.5 text-sm bg-surface focus:outline-none focus:border-accent transition-colors";
  const section = "border-t border-line pt-5 mt-5";

  // Pull audiences from the linked Klaviyo campaign. Only OVERWRITE the row's
  // audiences when Klaviyo says the campaign is scheduled/sending/sent (a draft
  // has none yet, and we must not wipe legacy manual values). A failure keeps
  // existing values and warns.
  const fetchAudiences = useCallback(async (id: string) => {
    setAudLoading(true);
    try {
      const res = await fetch(`/api/planner/audiences?campaign_id=${encodeURIComponent(id)}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      setKlaviyoStatus(typeof j.status === "string" ? j.status : null);
      if (/scheduled|sending|sent|queued/i.test(j.status || "")) {
        setIncluded(Array.isArray(j.included) ? j.included : []);
        setExcluded(Array.isArray(j.excluded) ? j.excluded : []);
        setAudFromKlaviyo(true);
      }
    } catch {
      toast.error("Couldn't load audiences from Klaviyo — keeping existing values.");
    } finally {
      setAudLoading(false);
    }
  }, []);

  // On open: refresh audiences if this row already carries a Klaviyo link.
  useEffect(() => {
    if (channel === "email" && klaviyoId) fetchAudiences(klaviyoId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the linked copy preview; a 404 means the copy was deleted — heal the
  // stale link (clear both sides) and fall back to the unlinked state.
  const fetchCopyPreview = useCallback(async (id: string) => {
    if (!row) return;
    setCopyLoading(true);
    try {
      const res = await fetch(`/api/planner/copy?id=${encodeURIComponent(id)}`);
      if (res.status === 404) {
        setCopyId(undefined); setCopyStatus(undefined); setCopyPreview(null);
        await fetch(`/api/planner/link?row_id=${encodeURIComponent(row.id)}`, { method: "DELETE" }).catch(() => {});
        onLinkChanged();
        return;
      }
      const j = await res.json();
      if (res.ok) setCopyPreview(j as CopyPreview);
    } catch { /* keep whatever we have */ } finally { setCopyLoading(false); }
  }, [row, onLinkChanged]);

  useEffect(() => {
    if (row && copyId) fetchCopyPreview(copyId);   // both channels resolve via /api/planner/copy
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const attachCopy = async (copyCampaignId: string, cs: "draft" | "final") => {
    if (!row) return;
    try {
      const res = await fetch("/api/planner/link", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row_id: row.id, copy_campaign_id: copyCampaignId, copy_status: cs }),
      });
      if (!res.ok) throw new Error();
      setCopyId(copyCampaignId); setCopyStatus(cs); setCopyPreview(null);
      setPickerOpen(false);
      toast.success("Copy attached");
      onLinkChanged();
      fetchCopyPreview(copyCampaignId);
    } catch { toast.error("Couldn't attach copy."); }
  };

  const unlinkCopy = async () => {
    if (!row) return;
    setUnlinkConfirm(false);
    try {
      const res = await fetch(`/api/planner/link?row_id=${encodeURIComponent(row.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setCopyId(undefined); setCopyStatus(undefined); setCopyPreview(null);
      toast.success("Copy unlinked");
      onLinkChanged();
    } catch { toast.error("Couldn't unlink copy."); }
  };

  const build = (overrides: Record<string, unknown> = {}) => ({
    id: row?.id, name: name.trim(), channel, status, planned_send_at: localInputToIso(plannedSendAt),
    offer_type: offerType, offer: offerType === "evergreen" ? EVERGREEN_OFFER : offer,
    promo_code: offerType === "promo" ? (promoCode || undefined) : undefined,
    audience_included: included, audience_excluded: excluded,
    klaviyo_campaign_id: channel === "email" ? (klaviyoId.trim() || undefined) : undefined,
    klaviyo_send_time: channel === "email" ? klaviyoSendTime : undefined,
    // deprecated postscript_campaign_id is intentionally NOT sent — the upsert
    // preserves whatever a legacy row already carries.
    // SMS: "" clears the join key; email rows keep theirs untouched (undefined
    // keys are dropped by JSON.stringify, so the upsert preserves them).
    northbeam_campaign_name: channel === "sms" ? nbName.trim() : undefined,
    notes, ...overrides,
  });

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/planner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Save failed");
  };
  // Manual-metric strings → a PATCH containing only the touched fields.
  // Returns "invalid" (with the offending field) rather than silently coercing.
  const buildManualPatch = (): Record<string, number | null> | { invalid: string } => {
    const patch: Record<string, number | null> = {};
    for (const f of ["recipients", "click_rate", "revenue", "revenue_per_recipient"] as const) {
      if (manual[f].trim() === manualInitial.current[f].trim()) continue; // untouched
      const parsed = parseManual(f, manual[f]);
      if (parsed === "invalid") return { invalid: f };
      patch[f] = parsed;
    }
    return patch;
  };

  const save = async () => {
    if (!name.trim()) { setErr("Name is required"); return; }
    // Validate manual metrics BEFORE saving the row so a bad entry never half-saves.
    let manualPatch: Record<string, number | null> = {};
    if (row && channel === "sms") {
      const p = buildManualPatch();
      if ("invalid" in p && typeof p.invalid === "string") {
        setErr(`Invalid ${String(p.invalid).replace(/_/g, " ")} — numbers only (e.g. 41,250 · 2.4% · $1,842.50).`);
        return;
      }
      manualPatch = p as Record<string, number | null>;
    }
    setSaving(true); setErr(null);
    try {
      await post(build());
      if (row && channel === "sms" && Object.keys(manualPatch).length > 0) {
        const res = await fetch("/api/planner/manual-metrics", {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: row.id, ...manualPatch }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Metrics save failed");
      }
      toast.success(row ? "Campaign updated" : "Campaign created");
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : "Save failed"); setSaving(false); }
  };
  // Design handoff: mark the row "ready for design" (persisted immediately, like
  // the copy link) and copy a Slack-ready message — title, planned send, and a
  // deep link that opens the full copy — to the clipboard in one click.
  const copyDesignHandoff = async () => {
    if (!row || !copyId) return;
    setHandoffBusy(true);
    try {
      if (status !== "ready_for_design") {
        await post(build({ status: "ready_for_design" }));
        setStatus("ready_for_design");
        onLinkChanged();
      }
      const link = `${window.location.origin}/planner?copy=${encodeURIComponent(copyId)}&as=${copyStatus ?? "draft"}`;
      const sendLabel = fmtDateTime(localInputToIso(plannedSendAt));
      const message = `Hi there 👋\n\nThis campaign, "${name.trim()}", is ready for design.\nPlanned send: ${sendLabel}\n\nView the copy: ${link}`;
      await navigator.clipboard.writeText(message);
      toast.success("Handoff copied — paste into Slack");
    } catch {
      toast.error("Couldn't copy the handoff message");
    } finally {
      setHandoffBusy(false);
    }
  };

  const duplicate = async () => {
    setSaving(true); setErr(null);
    try {
      // Clone plan fields; clear links + metrics so the copy is a fresh plan
      // (the NB join name belongs to the ORIGINAL send, so it clears too).
      await post(build({ id: undefined, name: `${name.trim()} (copy)`, status: "writing_brief", klaviyo_campaign_id: undefined, klaviyo_send_time: null, northbeam_campaign_name: undefined }));
      toast.success("Campaign duplicated");
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : "Duplicate failed"); setSaving(false); }
  };
  const del = async () => {
    if (!row) return; setSaving(true);
    try { await fetch(`/api/planner?id=${encodeURIComponent(row.id)}`, { method: "DELETE" }); toast.success("Campaign deleted"); onSaved(); } catch { setSaving(false); }
  };

  const campMatches = campaigns.filter((c) => c.name.toLowerCase().includes(campQ.toLowerCase())).slice(0, 8);
  const linkedName = campaigns.find((c) => c.id === klaviyoId)?.name || klaviyoId;
  const pickCampaign = (c: CampaignItem) => {
    setKlaviyoId(c.id); setKlaviyoSendTime(c.send_time); setKlaviyoStatus(c.status || null);
    setCampQ(""); setCampOpen(false);
    fetchAudiences(c.id);
  };
  const unlink = () => {
    setKlaviyoId(""); setKlaviyoSendTime(null); setKlaviyoStatus(null);
    setAudFromKlaviyo(false); setIncluded([]); setExcluded([]); setCampQ("");
  };

  // Audience section render state.
  const hasAud = included.length > 0 || excluded.length > 0;
  const isDraftLink = channel === "email" && !!klaviyoId && !!klaviyoStatus && /draft/i.test(klaviyoStatus);
  const audChips = (
    <div className="flex flex-wrap gap-1.5">
      {included.map((a) => (
        <span key={`i-${a.id || a.name}`} className="inline-flex items-center gap-1 text-[11px] bg-chrome border border-line rounded-sm px-1.5 py-0.5 text-ink-secondary">
          <span className="text-success-600" aria-hidden>+</span>{a.name}
        </span>
      ))}
      {excluded.map((a) => (
        <span key={`e-${a.id || a.name}`} className="inline-flex items-center gap-1 text-[11px] bg-chrome border border-line rounded-sm px-1.5 py-0.5 text-ink-muted">
          <span className="text-danger-600" aria-hidden>−</span>{a.name}
        </span>
      ))}
    </div>
  );
  const audBlocked = (text: string) => <div className="text-sm text-ink-muted">{text}</div>;
  const audMicro = (text: string) => <div className="mt-1.5 t-label">{text}</div>;
  const renderAudiences = () => {
    if (audLoading) return <SkeletonBlock className="h-6 w-2/3" />;
    if (channel === "sms") return hasAud ? <>{audChips}{audMicro("manual")}</> : audBlocked("Audiences sync from linked Klaviyo email campaigns.");
    if (!klaviyoId) return hasAud ? <>{audChips}{audMicro("manual")}</> : audBlocked("Link a Klaviyo campaign to pull audiences.");
    if (isDraftLink) return audBlocked("Audiences appear when the campaign is scheduled in Klaviyo.");
    if (hasAud) return <>{audChips}{audMicro(audFromKlaviyo ? "from Klaviyo" : "manual")}</>;
    return audBlocked("No audiences set on this campaign yet.");
  };

  return (
    <>
    <Drawer
      open
      onClose={onClose}
      title={row ? "Edit campaign" : "New campaign"}
      footer={
        <>
          {row && (confirmDel
            ? <Button variant="dangerSolid" size="sm" disabled={saving} onClick={del}>Confirm delete</Button>
            : <Button variant="ghost" size="sm" disabled={saving} onClick={() => setConfirmDel(true)}
                className="text-danger-600 hover:bg-danger-50 hover:text-danger-600">Delete</Button>)}
          <span className="mr-auto" />
          {row && <Button variant="ghost" size="sm" disabled={saving} onClick={duplicate}>Duplicate</Button>}
          <Button variant="primary" size="sm" loading={saving} onClick={save}>Save</Button>
        </>
      }
    >
      {/* 1. Name (title) + channel */}
      <div className="flex items-start gap-3">
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Campaign name"
          className="flex-1 min-w-0 bg-transparent text-xl font-medium tracking-tight text-ink placeholder:text-ink-muted/50 border-b border-transparent hover:border-line focus:border-accent focus:outline-none transition-colors pb-1" />
        <div className="inline-flex rounded-md border border-line p-0.5 shrink-0 mt-0.5">
          {PLANNER_CHANNELS.map((c) => (
            <button key={c} type="button" onClick={() => setChannel(c)}
              className={`px-2.5 py-1 text-[11px] font-medium capitalize rounded-[5px] transition-colors ${channel === c ? "bg-ink text-white" : "text-ink-muted hover:bg-chrome"}`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Status segmented control */}
      <div className={section}>
        <label className={label}>Status</label>
        <div className="flex flex-wrap gap-1.5">
          {PLANNER_STATUSES.map((s) => {
            const active = status === s;
            const st = STATUS_STYLE[s];
            return (
              <button key={s} type="button" onClick={() => setStatus(s)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-sm border text-[11px] font-medium capitalize transition-colors ${
                  active ? `${st.pill} font-semibold` : "border-line text-ink-muted hover:bg-chrome"
                }`}>
                {st.check && active && <span aria-hidden>✓</span>}
                {statusLabel(s, channel)}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Planned send */}
      <div className={section}>
        <label className={label}>Planned send</label>
        <input type="datetime-local" className={`${input} w-auto`} value={plannedSendAt} onChange={(e) => setPlannedSendAt(e.target.value)} />
      </div>

      {/* 4. Offer */}
      <div className={section}>
        <label className={label}>Offer</label>
        <div className="inline-flex rounded-md border border-line p-0.5 mb-2">
          {(["evergreen", "promo"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setOfferType(t)}
              className={`px-3 py-1 text-xs rounded-[6px] font-medium transition-colors ${offerType === t ? "bg-ink text-white" : "text-ink-secondary hover:bg-chrome"}`}>
              {t === "evergreen" ? `Evergreen (${EVERGREEN_OFFER})` : "Custom promo"}
            </button>
          ))}
        </div>
        {offerType === "promo" && (
          <div className="grid grid-cols-2 gap-3">
            <input className={input} value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="20% off sitewide" />
            <input className={input} value={promoCode} onChange={(e) => setPromoCode(e.target.value)} placeholder="Promo code (PRIME)" />
          </div>
        )}
      </div>

      {/* 5. Klaviyo campaign link (email) / Postscript id (sms) */}
      <div className={section}>
        {channel === "email" ? (
          <>
            <label className={label}>Klaviyo campaign</label>
            {klaviyoId ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-ink truncate">{linkedName}</span>
                {klaviyoStatus && <span className="t-label">{klaviyoStatus}</span>}
                <a href={`https://www.klaviyo.com/campaign/${klaviyoId}`} target="_blank" rel="noreferrer" className="text-[11px] text-accent hover:underline shrink-0">Open in Klaviyo ↗</a>
                <Button variant="ghost" size="sm" onClick={unlink} className="ml-auto">Unlink</Button>
              </div>
            ) : (
              <div className="relative">
                <input className={input} value={campQ} onFocus={() => setCampOpen(true)} onBlur={() => setTimeout(() => setCampOpen(false), 150)}
                  onChange={(e) => { setCampQ(e.target.value); setCampOpen(true); }}
                  placeholder="Search Klaviyo campaigns…" />
                {campOpen && campMatches.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-surface border border-line rounded-md shadow-pop max-h-56 overflow-y-auto">
                    {campMatches.map((c) => (
                      <button key={c.id} type="button" onMouseDown={(e) => { e.preventDefault(); pickCampaign(c); }}
                        className="w-full text-left px-2 py-1.5 text-sm hover:bg-chrome transition-colors">
                        <div className="text-ink truncate">{c.name}</div>
                        <div className="text-[10px] text-ink-muted">{c.status}{c.send_time ? ` · ${fmtDate(c.send_time)}` : ""}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            {/* Postscript's public API has no campaign endpoints — SMS revenue is
                matched through Northbeam by the send's utm_campaign name. Picking
                from the reported names makes the join key typo-proof; free text
                stays available as the fallback. */}
            <label className={label}>Northbeam campaign (SMS revenue match)</label>
            <div className="relative">
              <input className={input} value={nbName}
                onFocus={() => { setNbOpen(true); loadNbCandidates(); }}
                onBlur={() => setTimeout(() => setNbOpen(false), 150)}
                onChange={(e) => { setNbName(e.target.value); setNbOpen(true); }}
                placeholder="Search Northbeam campaign names… (or type the utm_campaign)" />
              {nbOpen && (nbLoading || nbCandidates.length > 0) && (
                <div className="absolute z-10 mt-1 w-full bg-surface border border-line rounded-md shadow-pop max-h-56 overflow-y-auto">
                  {nbLoading && <div className="px-2 py-1.5 text-xs text-ink-muted">Loading Northbeam campaign names…</div>}
                  {nbCandidates
                    .filter((c) => !nbName.trim() || c.name.toLowerCase().includes(nbName.trim().toLowerCase()))
                    .slice(0, 12)
                    .map((c) => (
                      <button key={c.name} type="button" onMouseDown={(e) => { e.preventDefault(); setNbName(c.name); setNbOpen(false); }}
                        className="w-full text-left px-2 py-1.5 text-sm hover:bg-chrome transition-colors">
                        <div className="text-ink truncate">{c.name}</div>
                        <div className="text-[10px] text-ink-muted">{money(c.revenue)} · last 30 days</div>
                      </button>
                    ))}
                </div>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-ink-muted leading-relaxed">
              Names come from Northbeam&apos;s Postscript-platform rows (last 30 days, cached ~1h). NB rev syncs by this name.
            </p>
          </>
        )}
      </div>

      {/* 5b. Manual platform metrics (SMS, saved rows) — Postscript's API has no
          analytics, so these four come from the Postscript dashboard. Same
          fields as the table's click-to-edit cells; parsed on Save. */}
      {row && channel === "sms" && (
        <div className={section}>
          <label className={label}>Metrics (manual — from Postscript dashboard)</label>
          <div className="grid grid-cols-2 gap-3">
            {([
              ["recipients", "Recipients", "41,250"],
              ["click_rate", "Click rate", "2.4%"],
              ["revenue", "Revenue", "$1,842.50"],
              ["revenue_per_recipient", "Revenue / recipient", "$0.04"],
            ] as const).map(([f, lbl, ph]) => (
              <label key={f} className="flex flex-col gap-1">
                <span className="t-label">{lbl}{f === "revenue_per_recipient" && !row.rpr_override ? " (auto)" : ""}</span>
                <input className={`${input} font-mono tabular-nums`} inputMode="decimal" value={manual[f]}
                  onChange={(e) => setManual((m) => ({ ...m, [f]: e.target.value }))} placeholder={ph} />
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-ink-muted leading-relaxed">
            Revenue / recipient derives from revenue ÷ recipients; typing a value overrides it, clearing re-derives. The sync never overwrites these.
          </p>
        </div>
      )}

      {/* 6. Audiences — auto-fetched from the linked campaign, read-only */}
      <div className={section}>
        <label className={label}>Audiences</label>
        {renderAudiences()}
      </div>

      {/* 6b. Copy — embedded preview + attach/unlink (saved row only, both channels) */}
      {row && (
        <div className={section}>
          <div className="flex items-center gap-2 mb-2">
            <span className="t-label">Copy</span>
            {copyId && copyStatus && <Chip tone={copyStatus === "final" ? "success" : "warning"}>{copyStatus}</Chip>}
            {copyId && (
              <button type="button" onClick={() => setUnlinkConfirm(true)} className="ml-auto text-[11px] text-ink-muted hover:text-ink transition-colors">Unlink</button>
            )}
          </div>
          {copyId ? (
            copyLoading ? (
              <SkeletonBlock className="h-4 w-2/3" />
            ) : (
              <>
                {/* one-line summary — the full copy lives in the viewer modal */}
                <div className="text-sm text-ink-secondary truncate mb-3">
                  {copyPreview?.subject_lines?.[0] || copyPreview?.campaign_name
                    || (copyPreview ? `${copyPreview.sections.length} section${copyPreview.sections.length === 1 ? "" : "s"}` : "Linked copy")}
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <Button variant="secondary" size="sm" onClick={() => onViewCopy(copyId, copyStatus ?? "draft")}>View copy</Button>
                  <Button variant="secondary" size="sm" loading={handoffBusy} onClick={copyDesignHandoff}
                    title="Mark ready for design and copy a Slack message with a link to the copy">
                    📋 Copy design handoff
                  </Button>
                  <Link href={`/copy-builder?campaign=${copyId}`} className="text-[11px] text-accent hover:underline">Open in Copy Builder ↗</Link>
                </div>
              </>
            )
          ) : (
            <div className="flex items-center gap-2">
              <Link href={channel === "sms" ? `/copy-builder?planner=${row.id}&channel=sms` : `/copy-builder?planner=${row.id}`}
                className="inline-flex items-center h-8 px-3 rounded-md text-xs font-medium bg-ink text-white hover:opacity-90 transition-opacity">Write copy</Link>
              <Button variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>Attach existing copy</Button>
            </div>
          )}
        </div>
      )}

      {/* 7. Notes */}
      <div className={section}>
        <label className={label}>Notes / learnings</label>
        <textarea className={`${input} resize-y min-h-[70px]`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What we learned…" />
      </div>

      {err && <div className="mt-4 text-sm text-danger-600">{err}</div>}

      {/* Read-only synced metrics — quiet line under everything. */}
      {row && (row.recipients != null || row.revenue != null) && (
        <div className="border-t border-line pt-4 mt-5 text-[11px] text-ink-muted">
          Synced: {int(row.recipients)} recipients · open {channel === "sms" ? "—" : pct(row.open_rate)} · click {pct(row.click_rate)} · {money(row.revenue)}
          {row.metrics_synced_at ? ` · ${fmtDateTime(row.metrics_synced_at)}` : ""}
        </div>
      )}
    </Drawer>

    <ConfirmModal open={unlinkConfirm} onClose={() => setUnlinkConfirm(false)} onConfirm={unlinkCopy}
      title="Unlink copy?" body="This detaches the copy from this campaign. The copy itself is not deleted."
      confirmLabel="Unlink" />

    {pickerOpen && row && (
      <AttachCopyPicker rowId={row.id} allRows={allRows} channel={channel}
        onPick={attachCopy} onClose={() => setPickerOpen(false)} />
    )}
    </>
  );
}

// ---------- attach-existing-copy picker ----------
interface CopyListEntry { id: string; name: string; date: string; type: string; status: string; planner_row_id?: string }

function AttachCopyPicker({ rowId, allRows, channel, onPick, onClose }: {
  rowId: string; allRows: PlannerRow[]; channel: PlannerChannel;
  onPick: (copyId: string, status: "draft" | "final") => void | Promise<void>; onClose: () => void;
}) {
  const isSms = channel === "sms";
  const [tab, setTab] = useState<"drafts" | "library">("drafts");
  const [q, setQ] = useState("");
  const [drafts, setDrafts] = useState<CopyListEntry[]>([]);
  const [library, setLibrary] = useState<CopyListEntry[]>([]);
  const [sms, setSms] = useState<CopyListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [move, setMove] = useState<{ copyId: string; status: "draft" | "final"; otherRow: string } | null>(null);
  // Id of the copy currently being attached — drives the row's "Attaching…"
  // spinner and disables the list so the click doesn't feel like a hang.
  const [attachingId, setAttachingId] = useState<string | null>(null);

  useEffect(() => {
    // SMS rows attach SMS campaigns; email rows attach email drafts/library.
    if (isSms) {
      fetch("/api/sms").then((r) => r.json()).catch(() => ({})).then((j) => {
        if (Array.isArray(j.campaigns)) {
          setSms(j.campaigns.map((c: { id: string; name: string; updated_at: string; status: string; planner_row_id?: string }) => ({
            id: c.id, name: c.name, date: (c.updated_at || "").slice(0, 10), type: "sms", status: c.status, planner_row_id: c.planner_row_id,
          })));
        }
      }).finally(() => setLoading(false));
      return;
    }
    Promise.all([
      fetch("/api/campaigns").then((r) => r.json()).catch(() => ({})),
      fetch("/api/library").then((r) => r.json()).catch(() => ({})),
    ]).then(([saved, lib]) => {
      if (Array.isArray(saved.campaigns)) {
        setDrafts(saved.campaigns.map((c: { id: string; campaign_name: string; updated_at: string; campaign_type: string; status: string; planner_row_id?: string }) => ({
          id: c.id, name: c.campaign_name, date: (c.updated_at || "").slice(0, 10), type: c.campaign_type, status: c.status, planner_row_id: c.planner_row_id,
        })));
      }
      if (Array.isArray(lib.campaigns)) {
        setLibrary(lib.campaigns.map((c: { id: string; title: string; date: string; campaign_type: string; planner_row_id?: string }) => ({
          id: c.id, name: c.title, date: c.date, type: c.campaign_type, status: "final", planner_row_id: c.planner_row_id,
        })));
      }
    }).finally(() => setLoading(false));
  }, [isSms]);

  const rowNameById = (id: string) => allRows.find((r) => r.id === id)?.name;
  const entries = isSms ? sms : tab === "drafts" ? drafts : library;
  const filtered = entries.filter((e) => e.name.toLowerCase().includes(q.toLowerCase()));
  const choose = async (e: CopyListEntry) => {
    if (attachingId) return;
    const status: "draft" | "final" = isSms
      ? (e.status === "final" ? "final" : "draft")
      : (tab === "drafts" ? "draft" : "final");
    if (e.planner_row_id && e.planner_row_id !== rowId) {
      setMove({ copyId: e.id, status, otherRow: rowNameById(e.planner_row_id) ?? "another campaign" });
    } else {
      setAttachingId(e.id);
      // onPick resolves once the attach + refetch settle (it closes the picker on
      // success). Clear either way so a failure re-enables the list.
      try { await onPick(e.id, status); } finally { setAttachingId(null); }
    }
  };

  return (
    <>
      <Modal open onClose={onClose} title="Attach existing copy" size="lg">
        <div className="flex items-center gap-2 mb-3">
          {!isSms && (
            <div className="inline-flex rounded-md border border-line p-0.5">
              {(["drafts", "library"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)}
                  className={`px-3 py-1 text-xs font-medium rounded-[6px] capitalize transition-colors ${tab === t ? "bg-ink text-white" : "text-ink-secondary hover:bg-chrome"}`}>{t}</button>
              ))}
            </div>
          )}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name…"
            className="flex-1 border border-line rounded-sm px-2 py-1.5 text-sm bg-surface focus:outline-none focus:border-accent transition-colors" />
        </div>
        <div className="max-h-80 overflow-y-auto divide-y divide-line border-t border-line">
          {loading ? (
            <div className="py-6"><SkeletonBlock className="h-5 w-full" /></div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-ink-muted">No {isSms ? "SMS campaigns" : tab} found.</div>
          ) : filtered.map((e) => {
            const linkedElsewhere = e.planner_row_id && e.planner_row_id !== rowId;
            const isAttaching = attachingId === e.id;
            return (
              <button key={e.id} type="button" disabled={!!attachingId} onClick={() => choose(e)}
                className={`w-full text-left px-1 py-2.5 flex items-center gap-3 transition-colors ${
                  attachingId ? "opacity-60 cursor-default" : "hover:bg-chrome"
                }`}>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink truncate">{e.name}</div>
                  <div className="t-label">{e.type}{e.date ? ` · ${e.date}` : ""}</div>
                </div>
                {isAttaching ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-accent shrink-0">
                    <span className="animate-spin inline-block">↻</span> Attaching…
                  </span>
                ) : (
                  <>
                    {linkedElsewhere && <span className="text-[10px] text-ink-muted italic shrink-0">linked to {rowNameById(e.planner_row_id!) ?? "another"}</span>}
                    <Chip tone={e.status === "final" ? "success" : "warning"}>{e.status}</Chip>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </Modal>

      <ConfirmModal open={!!move} onClose={() => setMove(null)}
        onConfirm={async () => {
          if (!move) return;
          const m = move;
          setMove(null);
          setAttachingId(m.copyId);
          try { await onPick(m.copyId, m.status); } finally { setAttachingId(null); }
        }}
        title="Move this copy?" body={move ? `This copy is linked to ${move.otherRow}. Move it here instead?` : ""}
        confirmLabel="Move it here" />
    </>
  );
}
