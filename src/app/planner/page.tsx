"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import type { PlannerRow, PlannerChannel, PlannerStatus, OfferType, AudienceRef, SyncResult } from "@/lib/planner-types";
import { PLANNER_STATUSES, PLANNER_CHANNELS, PLANNER_STATUS_LABELS, statusLabel, EVERGREEN_OFFER, isEffectivelySent } from "@/lib/planner-types";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Chip, { type ChipTone } from "@/components/ui/Chip";
import Drawer from "@/components/ui/Drawer";
import Modal, { ConfirmModal } from "@/components/ui/Modal";
import SkeletonBlock from "@/components/ui/Skeleton";
import PlatformBadge from "@/components/ui/PlatformBadge";
import DateRangePicker from "@/components/ui/DateRangePicker";
import CopyDocModal from "@/components/CopyDocModal";
import { toast } from "@/components/ui/Toast";
import { holidayName } from "@/lib/holidays";

// Copy Builder link state for a row, resolved against the set of saved copy ids.
type CopyEntry = "sms" | "unlinked" | "draft" | "final";

// Normalized copy preview from /api/planner/copy.
interface CopyPreview {
  id: string;
  source: "draft" | "library";
  campaign_name: string;
  updated_at: string;
  subject_lines: string[];
  preview_texts: string[];
  sections: { type: string; fields: Record<string, string> }[];
}

// ---------- formatting ----------
// Channel signal = an emoji glyph shown before the campaign name (the user asked
// for emoji). Carries the channel on its own; there are no channel color dots.
const CHANNEL_GLYPH: Record<PlannerChannel, { emoji: string; label: string }> = {
  email: { emoji: "✉️", label: "Email" },
  sms: { emoji: "📱", label: "SMS" },
};
function ChannelGlyph({ channel, className = "" }: { channel: PlannerChannel; className?: string }) {
  const g = CHANNEL_GLYPH[channel];
  return <span role="img" aria-label={g.label} className={`text-[11px] leading-none ${className}`}>{g.emoji}</span>;
}
// Status-driven pill styling. Explicit palette classes so the exact colors render
// regardless of the token layer. `check` prefixes a ✓ glyph; `strike` strikes the
// name. The scheduled label is channel-dependent — see statusLabel().
const STATUS_STYLE: Record<PlannerStatus, { pill: string; check?: boolean; strike?: boolean }> = {
  writing_brief: { pill: "bg-slate-100 text-slate-600 border-slate-200" },
  planned: { pill: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  scheduled: { pill: "bg-emerald-50/70 text-emerald-700 border-emerald-300", check: true },
  cancelled: { pill: "bg-slate-50 text-slate-400 border-slate-200", strike: true },
};

// Small status pill, shape-matched to the Chip primitive. Scheduled names the
// platform for the row's channel, so pass the channel.
function StatusPill({ status, channel, className = "" }: { status: PlannerStatus; channel: PlannerChannel; className?: string }) {
  const st = STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide leading-none ${st.pill} ${className}`}>
      {st.check && <span aria-hidden>✓</span>}
      <span className={st.strike ? "line-through" : ""}>{statusLabel(status, channel)}</span>
    </span>
  );
}
const COPY_TONE: Record<"draft" | "final", ChipTone> = { draft: "warning", final: "success" };

// Inline copy affordance for a table row's Name cell. stopPropagation so the
// links don't also open the row editor (the row onClick opens edit). Works for
// both channels; SMS rows deep-link into the copy builder's SMS mode.
function CopyLink({ entry, rowId, copyId, channel }: { entry: CopyEntry; rowId: string; copyId?: string; channel: PlannerChannel }) {
  if (entry === "sms") return null;
  const writeHref = channel === "sms" ? `/copy-builder?planner=${rowId}&channel=sms` : `/copy-builder?planner=${rowId}`;
  if (entry === "unlinked") {
    return (
      <Link href={writeHref} onClick={(e) => e.stopPropagation()}
        className="mt-0.5 w-fit text-[10px] font-medium uppercase tracking-wide text-accent hover:underline">
        Write copy
      </Link>
    );
  }
  return (
    <span className="mt-0.5 flex items-center gap-1.5 w-fit" onClick={(e) => e.stopPropagation()}>
      <Chip tone={COPY_TONE[entry]}>Copy: {entry}</Chip>
      <Link href={`/copy-builder?campaign=${copyId}`} onClick={(e) => e.stopPropagation()}
        className="text-[10px] font-medium uppercase tracking-wide text-accent hover:underline">
        Open copy
      </Link>
    </span>
  );
}
const money = (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n));
const int = (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("en-US").format(Math.round(n)));
const pct = (f: number | null | undefined) => (f == null ? "—" : `${(f * 100).toFixed(1)}%`);
const rpr = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);
const fmtDate = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); };
const fmtDateTime = (iso: string | null) => { if (!iso) return "—"; const d = new Date(iso); return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };
function isoToLocalInput(iso: string): string { const d = new Date(iso); if (isNaN(d.getTime())) return ""; return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function localInputToIso(v: string): string { const d = new Date(v); return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(); }
function ymdOf(iso: string): string { return (iso || "").slice(0, 10); }
// Table renders offer value and discount code as two separate columns.
// Offer value = the human offer description; evergreen rows show the standing
// offer. Discount code = the promo code, or null for evergreen (rendered as —).
function offerValue(r: PlannerRow): string {
  return r.offer_type === "evergreen" ? EVERGREEN_OFFER : (r.offer || "—");
}
function discountCode(r: PlannerRow): string | null {
  return r.promo_code || null;
}
// Re-date an ISO to a new YMD, preserving time-of-day.
function reDate(iso: string, newYmd: string): string {
  const old = new Date(iso);
  const [y, m, d] = newYmd.split("-").map(Number);
  const nd = isNaN(old.getTime()) ? new Date() : new Date(old);
  nd.setFullYear(y, m - 1, d);
  return nd.toISOString();
}

// Small chevron for styled native <select>s (kept native under the hood for a11y).
function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden
      className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
// Small document glyph shown on calendar pills that have linked copy. Color/
// position come from the wrapping element.
function CopyGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
    </svg>
  );
}
const microLabel = "t-label";
const selectCls = "appearance-none text-sm border border-line rounded-sm pl-2.5 pr-7 py-1.5 bg-surface focus:outline-none focus:border-accent transition-colors";

interface CampaignItem { id: string; name: string; status: string; send_time: string | null }

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
      const failed = (json.results ?? []).filter((r: SyncResult) => !r.matched).length;
      const parts = [`Synced ${json.synced} campaign${json.synced === 1 ? "" : "s"}`];
      if (failed > 0) parts.push(`${failed} unmatched`);
      if (!json.postscript_connected) parts.push("Postscript not connected");
      const msg = parts.join(" · ");
      // No dedicated warning tone in the toast manager — info carries the caveats.
      if (json.postscript_connected && failed === 0) toast.success(msg);
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
      <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
        <div>
          <div className="t-label mb-1">Campaign Planner</div>
          <h1 className="t-display text-ink">Plan &amp; learnings</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" loading={syncing} onClick={sync}>Sync metrics</Button>
          <Button variant="primary" size="sm" onClick={() => { setNewDate(null); setEditing("new"); }}>+ New campaign</Button>
        </div>
      </div>

      <div className="inline-flex rounded-md border border-line bg-surface p-0.5 mb-4">
        {(["calendar", "table"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)}
            className={`px-4 py-1.5 text-sm rounded-[6px] font-medium capitalize transition-colors duration-150 ease-out-soft ${
              view === v ? "bg-ink text-white" : "text-ink-secondary hover:bg-chrome"
            }`}>{v}</button>
        ))}
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
            action={<Button variant="primary" size="sm" onClick={() => { setNewDate(null); setEditing("new"); }}>+ New campaign</Button>}
          />
        </div>
      ) : view === "calendar" ? (
        <CalendarView rows={rows} cursor={cursor} setCursor={setCursor}
          onEntry={(r) => setEditing(r)} onDay={(d) => { setNewDate(`${d}T09:00`); setEditing("new"); }}
          onReschedule={reschedule} copyEntry={copyEntry} onViewCopy={openCopyDoc} />
      ) : (
        <TableView rows={filtered} onEdit={(r) => setEditing(r)} onReschedule={reschedule}
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
          onClose={() => setCopyDoc(null)} onStale={fetchRows} />
      )}
    </div>
  );
}

// ---------- calendar ----------
function CalendarView({ rows, cursor, setCursor, onEntry, onDay, onReschedule, copyEntry, onViewCopy }: {
  rows: PlannerRow[]; cursor: { y: number; m: number }; setCursor: (c: { y: number; m: number }) => void;
  onEntry: (r: PlannerRow) => void; onDay: (dayYmd: string) => void; onReschedule: (id: string, ymd: string) => void;
  copyEntry: (r: PlannerRow) => CopyEntry;
  onViewCopy: (id: string, status?: "draft" | "final") => void;
}) {
  const { y, m } = cursor;
  const first = new Date(y, m, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayYmd = new Date().toISOString().slice(0, 10);
  const byDay = useMemo(() => {
    const map = new Map<string, PlannerRow[]>();
    for (const r of rows) { const k = ymdOf(r.planned_send_at); if (!k) continue; (map.get(k) ?? map.set(k, []).get(k)!).push(r); }
    return map;
  }, [rows]);
  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const dayKey = (d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const goPrev = () => setCursor(m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 });
  const goNext = () => setCursor(m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 });
  const goToday = () => { const t = new Date(); setCursor({ y: t.getFullYear(), m: t.getMonth() }); };
  const navBtn = "w-7 h-7 inline-flex items-center justify-center rounded-sm border border-line text-ink-secondary hover:bg-chrome transition-colors";

  const onDragEnd = (res: DropResult) => {
    if (!res.destination) return;
    const dest = res.destination.droppableId.replace("cal:", "");
    const src = res.source.droppableId.replace("cal:", "");
    if (dest && dest !== src) onReschedule(res.draggableId, dest);
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="bg-surface border border-line rounded-md shadow-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <div className="flex items-center gap-2">
            <button onClick={goPrev} aria-label="Previous month" title="Previous month" className={navBtn}>←</button>
            <div className="text-sm font-medium text-ink min-w-[9rem] text-center">{first.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</div>
            <button onClick={goNext} aria-label="Next month" title="Next month" className={navBtn}>→</button>
            <Button variant="ghost" size="sm" onClick={goToday}>Today</Button>
          </div>
          <div className="flex items-center gap-3 t-label">
            <span className="flex items-center gap-1"><span aria-hidden>✉️</span> Email</span>
            <span className="flex items-center gap-1"><span aria-hidden>📱</span> SMS</span>
          </div>
        </div>
        <div key={`${y}-${m}`} className="rc-animate-fade">
          <div className="grid grid-cols-7 t-label border-b border-line">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="px-2 py-1.5 text-center">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d, i) => {
              const weekend = i % 7 === 0 || i % 7 === 6;
              if (!d) return <div key={`e-${i}`} className={`min-h-[96px] border-b border-r border-line ${weekend ? "bg-chrome/60" : "bg-canvas"}`} />;
              const key = dayKey(d);
              const entries = byDay.get(key) ?? [];
              const isToday = key === todayYmd;
              const holiday = holidayName(key);
              return (
                <Droppable droppableId={`cal:${key}`} key={key}>
                  {(provided, snapshot) => (
                    <div ref={provided.innerRef} {...provided.droppableProps}
                      onClick={() => onDay(key)}
                      className={`relative min-h-[96px] border-b border-r border-line p-1.5 cursor-pointer transition-colors ${
                        snapshot.isDraggingOver ? "bg-accent-50" : weekend ? "bg-chrome/60 hover:bg-chrome" : "hover:bg-chrome"
                      } ${isToday ? "ring-1 ring-inset ring-accent" : ""}`}>
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className={`text-[11px] font-mono tabular-nums ${isToday ? "text-accent font-semibold" : "text-ink-muted"}`}>{d}</span>
                        {isToday ? (
                          <span className="text-[9px] font-medium uppercase tracking-wide text-accent">Today</span>
                        ) : holiday ? (
                          // Quiet holiday hint — a muted dot + truncated name, full
                          // name on hover. Informational only; it sits above the
                          // cell's click-to-create and drop target, never blocking them.
                          <span title={holiday} className="pointer-events-none flex items-center gap-1 min-w-0 text-ink-muted/80">
                            <span aria-hidden className="w-1 h-1 rounded-full bg-current shrink-0" />
                            <span className="truncate text-[9px] leading-none tracking-wide">{holiday}</span>
                          </span>
                        ) : null}
                      </div>
                      <div className="space-y-1">
                        {entries.map((r, idx) => (
                          <Draggable draggableId={r.id} index={idx} key={r.id}>
                            {(dp, snap) => {
                              const ce = copyEntry(r);
                              const st = STATUS_STYLE[r.status];
                              // dnd owns the inline transform while dragging; append the tilt
                              // rather than overwrite it so the drag position is preserved.
                              const style = snap.isDragging
                                ? { ...dp.draggableProps.style, transform: `${dp.draggableProps.style?.transform ?? ""} rotate(1deg)` }
                                : dp.draggableProps.style;
                              return (
                                <div ref={dp.innerRef} {...dp.draggableProps} {...dp.dragHandleProps} style={style}
                                  onClick={(e) => { e.stopPropagation(); onEntry(r); }}
                                  title={`${r.name} · ${statusLabel(r.status, r.channel)}`}
                                  className={`flex items-center gap-1 rounded-sm px-1.5 py-1 border transition-[box-shadow] duration-150 ease-out-soft ${st.pill} ${
                                    snap.isDragging ? "shadow-pop" : "hover:shadow-card"
                                  }`}>
                                  <ChannelGlyph channel={r.channel} className="shrink-0" />
                                  {r.status === "scheduled" && <PlatformBadge channel={r.channel} compact className="shrink-0" />}
                                  {st.check && <span className="text-[9px] leading-none shrink-0" aria-hidden>✓</span>}
                                  <span className={`text-[11px] truncate ${st.strike ? "line-through" : ""}`}>{r.name}</span>
                                  {(ce === "draft" || ce === "final") && r.copy_campaign_id && (
                                    <button type="button"
                                      onClick={(e) => { e.stopPropagation(); onViewCopy(r.copy_campaign_id!, ce); }}
                                      title="View copy" aria-label="View copy"
                                      className="ml-auto shrink-0 text-ink-muted hover:text-ink transition-colors">
                                      <CopyGlyph />
                                    </button>
                                  )}
                                </div>
                              );
                            }}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    </div>
                  )}
                </Droppable>
              );
            })}
          </div>
        </div>
        <div className="px-4 py-2 text-[11px] text-ink-muted border-t border-line">Drag an entry to another day to reschedule · click to edit</div>
      </div>
    </DragDropContext>
  );
}

// ---------- table ----------
// One template drives the header, every body row, and the summary. Layout:
// plan columns (Campaign · Status · Planned · Offer value · Discount code) |
// a hairline divider | the quieter performance cluster (Recipients · Open ·
// Click · Rev/recip) | Revenue as the bold right-hand anchor. Sized to fit the
// planner's ~1088px content column without a horizontal scrollbar — no hard
// minWidth. Status is wide enough to stack the scheduling-source platform badge
// under the status pill.
const GRID = "minmax(200px,1.6fr) 128px 104px minmax(120px,1fr) 96px 84px 60px 60px 80px 104px";

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
      className="shrink-0 -ml-1 mr-0.5 w-5 h-5 inline-flex items-center justify-center rounded-sm text-ink-muted hover:bg-chrome hover:text-ink-secondary transition-colors">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden
        className={`transition-transform duration-150 ease-out-soft ${open ? "rotate-90" : ""}`}>
        <path d="m9 18 6-6-6-6" />
      </svg>
    </button>
  );
}

function TableView({ rows, onEdit, onReschedule, fChannel, setFChannel, fStatus, setFStatus, fStart, setFStart, fEnd, setFEnd, sortBy, setSortBy, copyEntry }: {
  rows: PlannerRow[]; onEdit: (r: PlannerRow) => void; onReschedule: (id: string, ymd: string) => void;
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
    const opens = rows.filter((r) => r.open_rate != null);
    const clicks = rows.filter((r) => r.click_rate != null);
    return {
      count: rows.length, recipients: recip, revenue: rev,
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

  // Comfortable row rhythm; hairline separators do the dividing, not boxes.
  const cell = "px-3 py-3 text-sm flex items-center min-w-0";
  const numCell = `${cell} justify-end font-mono tabular-nums`;
  // Header cell for a right-aligned metric column.
  const numHead = "px-3 py-2 text-right";
  // A flat, ever-incrementing row counter drives the subtle zebra so alternate
  // rows read gently even across day groups.
  let rowIndex = 0;

  return (
    <div>
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
        <div className="grid bg-chrome border-b border-line t-label" style={{ gridTemplateColumns: GRID }}>
          <div className="px-3 py-2">Campaign</div>
          <div className="px-3 py-2">Status</div>
          <div className="px-3 py-2">Planned</div>
          <div className="px-3 py-2">Offer value</div>
          <div className="px-3 py-2">Discount code</div>
          <div className={`${numHead} border-l border-line`}>Recipients</div>
          <div className={numHead}>Open</div>
          <div className={numHead}>Click</div>
          <div className={numHead}>Rev/recip</div>
          <div className={numHead}>Revenue</div>
        </div>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        {groups.map((g, gi) => (
          <div key={g.day || "flat"}>
            {sortBy === "date" && (
              <div className={`px-3 ${gi === 0 ? "pt-3" : "pt-6"} pb-1.5 border-b border-line t-label`}>
                {g.day ? fmtDate(g.day + "T00:00:00") : ""}
              </div>
            )}
            <Droppable droppableId={`tbl:${g.day}`} isDropDisabled={sortBy !== "date"}>
              {(provided, snap) => (
                <div ref={provided.innerRef} {...provided.droppableProps} className={snap.isDraggingOver ? "bg-accent-50/50" : ""}>
                  {g.rows.map((r, idx) => {
                    const zebra = rowIndex++ % 2 === 1;
                    const isOpen = expanded.has(r.id);
                    return (
                      <div key={r.id}>
                        <Draggable draggableId={r.id} index={idx} isDragDisabled={sortBy !== "date"}>
                          {(dp, snap2) => (
                            <div ref={dp.innerRef} {...dp.draggableProps} {...dp.dragHandleProps}
                              onClick={() => onEdit(r)}
                              className={`grid border-b border-line hover:bg-chrome cursor-pointer transition-colors ${zebra ? "bg-canvas" : "bg-surface"} ${snap2.isDragging ? "shadow-pop" : ""}`}
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
                                <div className="flex flex-col items-start gap-1 min-w-0">
                                  <StatusPill status={r.status} channel={r.channel} />
                                  {r.status === "scheduled" && <PlatformBadge channel={r.channel} />}
                                </div>
                              </div>
                              <div className={`${cell} text-ink-secondary whitespace-nowrap`}>{fmtDate(r.planned_send_at)}</div>
                              <div className={`${cell} text-ink-secondary`}><span className="truncate">{offerValue(r)}</span></div>
                              <div className={`${cell} text-ink-muted`}>
                                {discountCode(r)
                                  ? <span className="font-mono text-[11px] tracking-tight truncate">{discountCode(r)}</span>
                                  : <span className="text-ink-muted/50">—</span>}
                              </div>
                              <div className={`${numCell} text-ink-muted border-l border-line`}>{int(r.recipients)}</div>
                              <div className={`${numCell} text-ink-muted`}>{r.channel === "sms" ? "—" : pct(r.open_rate)}</div>
                              <div className={`${numCell} text-ink-muted`}>{pct(r.click_rate)}</div>
                              <div className={`${numCell} text-ink-muted`}>{rpr(r.revenue_per_recipient)}</div>
                              <div className={`${numCell} text-ink font-semibold`}>{money(r.revenue)}</div>
                            </div>
                          )}
                        </Draggable>
                        {isOpen && (
                          <div className="border-b border-line bg-canvas/60 pl-10 pr-4 py-3 grid gap-1.5 text-[11px] text-ink-secondary rc-animate-fade">
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

      {/* summary — aligned to GRID */}
      <div className="grid border-t-2 border-line bg-chrome text-sm font-medium" style={{ gridTemplateColumns: GRID }}>
        <div className="px-3 py-3 text-ink-secondary">{summary.count} total</div>
        <div /><div /><div /><div />
        <div className="px-3 py-3 text-right font-mono tabular-nums text-ink-secondary border-l border-line">{int(summary.recipients)}</div>
        <div className="px-3 py-3 text-right font-mono tabular-nums text-ink-muted">{pct(summary.avgOpen)}</div>
        <div className="px-3 py-3 text-right font-mono tabular-nums text-ink-muted">{pct(summary.avgClick)}</div>
        <div />
        <div className="px-3 py-3 text-right font-mono tabular-nums text-ink">{money(summary.revenue)}</div>
      </div>

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
  const [postscriptId, setPostscriptId] = useState(row?.postscript_campaign_id ?? "");
  const [notes, setNotes] = useState(row?.notes ?? "");
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
    postscript_campaign_id: channel === "sms" ? (postscriptId.trim() || undefined) : undefined,
    notes, ...overrides,
  });

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/planner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Save failed");
  };
  const save = async () => {
    if (!name.trim()) { setErr("Name is required"); return; }
    setSaving(true); setErr(null);
    try { await post(build()); toast.success(row ? "Campaign updated" : "Campaign created"); onSaved(); } catch (e) { setErr(e instanceof Error ? e.message : "Save failed"); setSaving(false); }
  };
  const duplicate = async () => {
    setSaving(true); setErr(null);
    try {
      // Clone plan fields; clear link + metrics so the copy is a fresh plan.
      await post(build({ id: undefined, name: `${name.trim()} (copy)`, status: "writing_brief", klaviyo_campaign_id: undefined, klaviyo_send_time: null, postscript_campaign_id: undefined }));
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
          <span className="text-emerald-600" aria-hidden>+</span>{a.name}
        </span>
      ))}
      {excluded.map((a) => (
        <span key={`e-${a.id || a.name}`} className="inline-flex items-center gap-1 text-[11px] bg-chrome border border-line rounded-sm px-1.5 py-0.5 text-ink-muted">
          <span className="text-rose-500" aria-hidden>−</span>{a.name}
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
            ? <Button variant="danger" size="sm" disabled={saving} onClick={del}>Confirm delete</Button>
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
              className={`px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide rounded-[5px] transition-colors ${channel === c ? "bg-ink text-white" : "text-ink-muted hover:bg-chrome"}`}>
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
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-sm border text-[11px] font-medium uppercase tracking-wide transition-colors ${
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
            <label className={label}>Postscript campaign id</label>
            <input className={input} value={postscriptId} onChange={(e) => setPostscriptId(e.target.value)} placeholder="Postscript campaign id" />
          </>
        )}
      </div>

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
                <div className="flex items-center gap-3">
                  <Button variant="secondary" size="sm" onClick={() => onViewCopy(copyId, copyStatus ?? "draft")}>View copy</Button>
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
  onPick: (copyId: string, status: "draft" | "final") => void; onClose: () => void;
}) {
  const isSms = channel === "sms";
  const [tab, setTab] = useState<"drafts" | "library">("drafts");
  const [q, setQ] = useState("");
  const [drafts, setDrafts] = useState<CopyListEntry[]>([]);
  const [library, setLibrary] = useState<CopyListEntry[]>([]);
  const [sms, setSms] = useState<CopyListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [move, setMove] = useState<{ copyId: string; status: "draft" | "final"; otherRow: string } | null>(null);

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
  const choose = (e: CopyListEntry) => {
    const status: "draft" | "final" = isSms
      ? (e.status === "final" ? "final" : "draft")
      : (tab === "drafts" ? "draft" : "final");
    if (e.planner_row_id && e.planner_row_id !== rowId) {
      setMove({ copyId: e.id, status, otherRow: rowNameById(e.planner_row_id) ?? "another campaign" });
    } else {
      onPick(e.id, status);
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
            return (
              <button key={e.id} type="button" onClick={() => choose(e)}
                className="w-full text-left px-1 py-2.5 flex items-center gap-3 hover:bg-chrome transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink truncate">{e.name}</div>
                  <div className="t-label">{e.type}{e.date ? ` · ${e.date}` : ""}</div>
                </div>
                {linkedElsewhere && <span className="text-[10px] text-ink-muted italic shrink-0">linked to {rowNameById(e.planner_row_id!) ?? "another"}</span>}
                <Chip tone={e.status === "final" ? "success" : "warning"}>{e.status}</Chip>
              </button>
            );
          })}
        </div>
      </Modal>

      <ConfirmModal open={!!move} onClose={() => setMove(null)}
        onConfirm={() => { if (move) { onPick(move.copyId, move.status); setMove(null); } }}
        title="Move this copy?" body={move ? `This copy is linked to ${move.otherRow}. Move it here instead?` : ""}
        confirmLabel="Move it here" />
    </>
  );
}
