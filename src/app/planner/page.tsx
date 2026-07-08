"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import type { PlannerRow, PlannerChannel, PlannerStatus, OfferType, AudienceRef, SyncResult } from "@/lib/planner-types";
import { PLANNER_STATUSES, PLANNER_CHANNELS, EVERGREEN_OFFER } from "@/lib/planner-types";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";

// Copy Builder link state for a row, resolved against the set of saved copy ids.
type CopyEntry = "sms" | "unlinked" | "draft" | "final";

// ---------- formatting ----------
const CHANNEL_STYLE: Record<PlannerChannel, { dot: string; chip: string; label: string }> = {
  email: { dot: "bg-indigo-500", chip: "bg-indigo-50 text-indigo-700 border-indigo-200", label: "Email" },
  sms: { dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "SMS" },
};
const STATUS_PILL: Record<PlannerStatus, string> = {
  idea: "bg-slate-100 text-slate-600 border-slate-200",
  draft: "bg-amber-50 text-amber-700 border-amber-200",
  scheduled: "bg-indigo-50 text-indigo-700 border-indigo-200",
  sent: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-rose-50 text-rose-700 border-rose-200",
};
function StatusPill({ status }: { status: PlannerStatus }) {
  return <span className={`inline-block text-[10px] font-mono uppercase border rounded px-1.5 py-0.5 ${STATUS_PILL[status]}`}>{status}</span>;
}
const COPY_CHIP: Record<"draft" | "final", string> = {
  draft: "bg-amber-50 text-amber-700 border-amber-200",
  final: "bg-emerald-50 text-emerald-700 border-emerald-200",
};
// Inline copy affordance for a table row's Name cell. stopPropagation so the
// links don't also open the row editor (the row onClick opens edit). Email only;
// SMS renders nothing.
function CopyLink({ entry, rowId, copyId }: { entry: CopyEntry; rowId: string; copyId?: string }) {
  if (entry === "sms") return null;
  if (entry === "unlinked") {
    return (
      <Link href={`/copy-builder?planner=${rowId}`} onClick={(e) => e.stopPropagation()}
        className="mt-0.5 w-fit text-[10px] font-mono uppercase tracking-wide text-indigo-600 hover:underline">
        Write copy
      </Link>
    );
  }
  return (
    <span className="mt-0.5 flex items-center gap-1.5 w-fit" onClick={(e) => e.stopPropagation()}>
      <span className={`text-[10px] font-mono uppercase border rounded px-1 py-0.5 ${COPY_CHIP[entry]}`}>Copy: {entry}</span>
      <Link href={`/copy-builder?campaign=${copyId}`} onClick={(e) => e.stopPropagation()}
        className="text-[10px] font-mono uppercase tracking-wide text-indigo-600 hover:underline">
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
function offerLabel(r: PlannerRow): string {
  if (r.offer_type === "evergreen") return `Evergreen · ${EVERGREEN_OFFER}`;
  return `${r.promo_code ? r.promo_code + " · " : ""}${r.offer || "—"}`;
}
// Re-date an ISO to a new YMD, preserving time-of-day.
function reDate(iso: string, newYmd: string): string {
  const old = new Date(iso);
  const [y, m, d] = newYmd.split("-").map(Number);
  const nd = isNaN(old.getTime()) ? new Date() : new Date(old);
  nd.setFullYear(y, m - 1, d);
  return nd.toISOString();
}

interface AudienceItem { id: string; name: string; type: "segment" | "list" }
interface CampaignItem { id: string; name: string; status: string; send_time: string | null }

export default function PlannerPage() {
  const [rows, setRows] = useState<PlannerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"calendar" | "table">("calendar");
  const [editing, setEditing] = useState<PlannerRow | "new" | null>(null);
  const [newDate, setNewDate] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState<{ synced: number; postscript_connected: boolean; results: SyncResult[]; warnings: string[] } | null>(null);
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });

  // audiences + campaigns for the editor pickers (fetched once)
  const [audiences, setAudiences] = useState<AudienceItem[]>([]);
  const [audiencesFailed, setAudiencesFailed] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);

  // Set of saved copy ids (drafts + finalized) so we can detect a stale link
  // (the saved campaign was deleted) and render/heal the row as unlinked.
  const [copyIds, setCopyIds] = useState<Set<string>>(new Set());
  const [copyIdsLoaded, setCopyIdsLoaded] = useState(false);
  const healedRef = useRef<Set<string>>(new Set());

  // table filters + sort
  const [fChannel, setFChannel] = useState<"all" | PlannerChannel>("all");
  const [fStatus, setFStatus] = useState<"all" | PlannerStatus>("all");
  const [fStart, setFStart] = useState("");
  const [fEnd, setFEnd] = useState("");
  const [sortBy, setSortBy] = useState<"date" | "revenue">("date");

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/planner");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load planner");
      setRows(json.rows as PlannerRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);
  useEffect(() => {
    fetch("/api/klaviyo/audiences").then((r) => r.json()).then((j) => {
      if (j.audiences) setAudiences(j.audiences); else setAudiencesFailed(true);
    }).catch(() => setAudiencesFailed(true));
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
    if (row.channel !== "email") return "sms";
    const linked = !!row.copy_campaign_id && (!copyIdsLoaded || copyIds.has(row.copy_campaign_id));
    if (!linked) return "unlinked";
    return row.copy_status === "final" ? "final" : "draft";
  }, [copyIds, copyIdsLoaded]);

  const sync = async () => {
    setSyncing(true);
    setSyncResults(null);
    try {
      const res = await fetch("/api/planner/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Sync failed");
      setRows(json.rows as PlannerRow[]);
      setSyncResults({ synced: json.synced, postscript_connected: json.postscript_connected, results: json.results ?? [], warnings: json.warnings ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
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
      setError("Could not save the new date. Reverted.");
    }
  };

  const filtered = useMemo(() => rows.filter((r) => {
    if (fChannel !== "all" && r.channel !== fChannel) return false;
    if (fStatus !== "all" && r.status !== fStatus) return false;
    const day = ymdOf(r.planned_send_at);
    if (fStart && day < fStart) return false;
    if (fEnd && day > fEnd) return false;
    return true;
  }), [rows, fChannel, fStatus, fStart, fEnd]);

  return (
    <div>
      <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
        <div>
          <div className="font-mono text-xs text-slate-500 uppercase tracking-wide mb-1">Campaign Planner</div>
          <h1 className="text-2xl font-semibold text-slate-900">Plan &amp; learnings</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" loading={syncing} onClick={sync}>Sync metrics</Button>
          <Button variant="primary" size="sm" onClick={() => { setNewDate(null); setEditing("new"); }}>+ New campaign</Button>
        </div>
      </div>

      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 mb-4">
        {(["calendar", "table"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)}
            className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors capitalize ${view === v ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{v}</button>
        ))}
      </div>

      {syncResults && <SyncSummary res={syncResults} onClose={() => setSyncResults(null)} />}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-900 flex items-center justify-between"><span>{error}</span><button onClick={() => setError(null)} className="text-red-500">✕</button></div>}

      {loading ? (
        <Skeleton />
      ) : rows.length === 0 ? (
        <div className="bg-white border border-line rounded-md shadow-card">
          <EmptyState
            icon={
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
            }
            title="No campaigns yet"
            description="Plan your first email or SMS campaign — start at the idea stage, fill in details later."
            action={<Button variant="primary" size="sm" onClick={() => { setNewDate(null); setEditing("new"); }}>+ New campaign</Button>}
          />
        </div>
      ) : view === "calendar" ? (
        <CalendarView rows={rows} cursor={cursor} setCursor={setCursor}
          onEntry={(r) => setEditing(r)} onDay={(d) => { setNewDate(`${d}T09:00`); setEditing("new"); }}
          onReschedule={reschedule} copyEntry={copyEntry} />
      ) : (
        <TableView rows={filtered} onEdit={(r) => setEditing(r)} onReschedule={reschedule}
          fChannel={fChannel} setFChannel={setFChannel} fStatus={fStatus} setFStatus={setFStatus}
          fStart={fStart} setFStart={setFStart} fEnd={fEnd} setFEnd={setFEnd}
          sortBy={sortBy} setSortBy={setSortBy} copyEntry={copyEntry} />
      )}

      {editing && (
        <RowEditor row={editing === "new" ? null : editing} defaultDateIso={newDate}
          audiences={audiences} audiencesFailed={audiencesFailed} campaigns={campaigns}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await fetchRows(); }} />
      )}
    </div>
  );
}

// ---------- sync summary ----------
const REASON_LABEL: Record<string, string> = {
  matched: "synced", not_linked: "not linked", not_sent_yet: "not sent yet",
  no_activity_in_window: "no activity found", postscript_not_connected: "Postscript not connected",
};
function SyncSummary({ res, onClose }: { res: { synced: number; postscript_connected: boolean; results: SyncResult[]; warnings: string[] }; onClose: () => void }) {
  const failed = res.results.filter((r) => !r.matched);
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-slate-700">Synced {res.synced} campaign{res.synced === 1 ? "" : "s"}.{!res.postscript_connected ? " Postscript not connected (SMS skipped)." : ""}</span>
        <button onClick={onClose} className="text-slate-400">✕</button>
      </div>
      {failed.length > 0 && (
        <ul className="mt-2 text-xs text-slate-500 space-y-0.5">
          {failed.map((r) => <li key={r.id}>· <span className="text-slate-700">{r.name}</span>: {REASON_LABEL[r.reason] ?? r.reason}</li>)}
        </ul>
      )}
      {res.warnings.map((w, i) => <div key={i} className="mt-1 text-xs text-amber-700">{w}</div>)}
    </div>
  );
}

// ---------- calendar ----------
function CalendarView({ rows, cursor, setCursor, onEntry, onDay, onReschedule, copyEntry }: {
  rows: PlannerRow[]; cursor: { y: number; m: number }; setCursor: (c: { y: number; m: number }) => void;
  onEntry: (r: PlannerRow) => void; onDay: (dayYmd: string) => void; onReschedule: (id: string, ymd: string) => void;
  copyEntry: (r: PlannerRow) => CopyEntry;
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

  const onDragEnd = (res: DropResult) => {
    if (!res.destination) return;
    const dest = res.destination.droppableId.replace("cal:", "");
    const src = res.source.droppableId.replace("cal:", "");
    if (dest && dest !== src) onReschedule(res.draggableId, dest);
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="font-mono text-xs text-slate-500 uppercase tracking-wide">{first.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 text-[10px] font-mono text-slate-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500" /> Email</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> SMS</span>
            </div>
            <div className="flex gap-1">
              <button onClick={() => setCursor(m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 })} className="px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50">←</button>
              <button onClick={() => { const t = new Date(); setCursor({ y: t.getFullYear(), m: t.getMonth() }); }} className="px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50">Today</button>
              <button onClick={() => setCursor(m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 })} className="px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50">→</button>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-7 text-[10px] font-mono uppercase tracking-wide text-slate-400 border-b border-slate-100">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="px-2 py-1.5 text-center">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            if (!d) return <div key={`e-${i}`} className="min-h-[96px] border-b border-r border-slate-100 bg-slate-50/40" />;
            const key = dayKey(d);
            const entries = byDay.get(key) ?? [];
            const isToday = key === todayYmd;
            return (
              <Droppable droppableId={`cal:${key}`} key={key}>
                {(provided, snapshot) => (
                  <div ref={provided.innerRef} {...provided.droppableProps}
                    onClick={() => onDay(key)}
                    className={`min-h-[96px] border-b border-r border-slate-100 p-1.5 cursor-pointer transition-colors ${snapshot.isDraggingOver ? "bg-indigo-50" : "hover:bg-slate-50"}`}>
                    <div className={`text-[11px] font-mono mb-1 ${isToday ? "text-slate-900 font-semibold" : "text-slate-400"}`}>{d}</div>
                    <div className="space-y-1">
                      {entries.map((r, idx) => (
                        <Draggable draggableId={r.id} index={idx} key={r.id}>
                          {(dp) => (
                            <div ref={dp.innerRef} {...dp.draggableProps} {...dp.dragHandleProps}
                              onClick={(e) => { e.stopPropagation(); onEntry(r); }}
                              className="flex items-center gap-1 rounded px-1 py-0.5 bg-white border border-slate-200 hover:border-slate-300 shadow-sm">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${CHANNEL_STYLE[r.channel].dot}`} />
                              <span className={`text-[11px] truncate ${r.status === "cancelled" ? "line-through text-slate-400" : "text-slate-700"}`}>{r.name}</span>
                              {(() => {
                                const ce = copyEntry(r);
                                return ce === "draft" || ce === "final"
                                  ? <span className={`ml-auto w-1.5 h-1.5 rounded-full shrink-0 ${ce === "final" ? "bg-emerald-500" : "bg-amber-500"}`} title={`Copy: ${ce}`} />
                                  : null;
                              })()}
                            </div>
                          )}
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
        <div className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-100">Drag an entry to another day to reschedule · click to edit</div>
      </div>
    </DragDropContext>
  );
}

// ---------- table ----------
const GRID = "minmax(160px,1.4fr) 74px 92px 108px 150px minmax(150px,1fr) 92px 68px 68px 96px 84px minmax(160px,1fr)";
function TableView({ rows, onEdit, onReschedule, fChannel, setFChannel, fStatus, setFStatus, fStart, setFStart, fEnd, setFEnd, sortBy, setSortBy, copyEntry }: {
  rows: PlannerRow[]; onEdit: (r: PlannerRow) => void; onReschedule: (id: string, ymd: string) => void;
  fChannel: "all" | PlannerChannel; setFChannel: (v: "all" | PlannerChannel) => void;
  fStatus: "all" | PlannerStatus; setFStatus: (v: "all" | PlannerStatus) => void;
  fStart: string; setFStart: (v: string) => void; fEnd: string; setFEnd: (v: string) => void;
  sortBy: "date" | "revenue"; setSortBy: (v: "date" | "revenue") => void;
  copyEntry: (r: PlannerRow) => CopyEntry;
}) {
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

  const cell = "px-3 py-2.5 text-sm flex items-center min-w-0";
  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 flex-wrap">
        <select value={fChannel} onChange={(e) => setFChannel(e.target.value as "all" | PlannerChannel)} className="text-xs border border-slate-200 rounded px-2 py-1 bg-white">
          <option value="all">All channels</option>{PLANNER_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value as "all" | PlannerStatus)} className="text-xs border border-slate-200 rounded px-2 py-1 bg-white">
          <option value="all">All statuses</option>{PLANNER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="date" value={fStart} onChange={(e) => setFStart(e.target.value)} className="text-xs border border-slate-200 rounded px-2 py-1 bg-white" title="From" />
        <input type="date" value={fEnd} onChange={(e) => setFEnd(e.target.value)} className="text-xs border border-slate-200 rounded px-2 py-1 bg-white" title="To" />
        <div className="flex items-center gap-1 ml-2">
          <span className="text-[10px] font-mono uppercase text-slate-400">Sort</span>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "date" | "revenue")} className="text-xs border border-slate-200 rounded px-2 py-1 bg-white">
            <option value="date">Planned send</option><option value="revenue">Revenue</option>
          </select>
        </div>
        <div className="ml-auto text-xs text-slate-500">{rows.length} campaign{rows.length === 1 ? "" : "s"}</div>
      </div>

      <div className="overflow-x-auto">
        <div style={{ minWidth: 1360 }}>
          {/* header */}
          <div className="grid bg-slate-50 border-b border-slate-200 text-slate-500 font-mono text-[10px] uppercase tracking-wide" style={{ gridTemplateColumns: GRID }}>
            <div className="px-3 py-2">Name</div><div className="px-3 py-2">Channel</div><div className="px-3 py-2">Status</div>
            <div className="px-3 py-2">Planned</div><div className="px-3 py-2">Offer</div><div className="px-3 py-2">Audience</div>
            <div className="px-3 py-2 border-l border-slate-200 bg-slate-100/60">Recipients</div><div className="px-3 py-2 bg-slate-100/60">Open</div>
            <div className="px-3 py-2 bg-slate-100/60">Click</div><div className="px-3 py-2 bg-slate-100/60">Revenue</div>
            <div className="px-3 py-2 bg-slate-100/60">Rev/recip</div><div className="px-3 py-2">Notes / learnings</div>
          </div>

          <DragDropContext onDragEnd={onDragEnd}>
            {groups.map((g) => (
              <div key={g.day || "flat"}>
                {sortBy === "date" && (
                  <div className="px-3 py-1.5 bg-slate-50/70 border-b border-slate-100 text-[11px] font-mono text-slate-500">{g.day ? fmtDate(g.day + "T00:00:00") : ""}</div>
                )}
                <Droppable droppableId={`tbl:${g.day}`} isDropDisabled={sortBy !== "date"}>
                  {(provided, snap) => (
                    <div ref={provided.innerRef} {...provided.droppableProps} className={snap.isDraggingOver ? "bg-indigo-50/50" : ""}>
                      {g.rows.map((r, idx) => (
                        <Draggable draggableId={r.id} index={idx} key={r.id} isDragDisabled={sortBy !== "date"}>
                          {(dp) => (
                            <div ref={dp.innerRef} {...dp.draggableProps} {...dp.dragHandleProps}
                              onClick={() => onEdit(r)}
                              className="grid border-b border-slate-100 hover:bg-slate-50 cursor-pointer bg-white" style={{ gridTemplateColumns: GRID }}>
                              <div className={cell}>
                                <div className="min-w-0 flex flex-col">
                                  <span className={`truncate ${r.status === "cancelled" ? "line-through text-slate-400" : "text-slate-900"}`}>{r.name}</span>
                                  <CopyLink entry={copyEntry(r)} rowId={r.id} copyId={r.copy_campaign_id} />
                                </div>
                              </div>
                              <div className={cell}><span className={`text-[10px] font-mono uppercase border rounded px-1.5 py-0.5 ${CHANNEL_STYLE[r.channel].chip}`}>{CHANNEL_STYLE[r.channel].label}</span></div>
                              <div className={cell}><StatusPill status={r.status} /></div>
                              <div className={`${cell} text-slate-600 whitespace-nowrap`}>{fmtDate(r.planned_send_at)}</div>
                              <div className={`${cell} text-slate-700`}><span className="truncate">{offerLabel(r)}</span></div>
                              <div className={`${cell} text-[11px] text-slate-500`}>
                                <span className="truncate">
                                  {r.audience_included.length > 0 && `+ ${r.audience_included.map((a) => a.name).join(", ")}`}
                                  {r.audience_excluded.length > 0 && ` − ${r.audience_excluded.map((a) => a.name).join(", ")}`}
                                  {r.audience_included.length === 0 && r.audience_excluded.length === 0 && "—"}
                                </span>
                              </div>
                              <div className={`${cell} justify-end tabular-nums text-slate-700 border-l border-slate-100 bg-slate-50/40`}>{int(r.recipients)}</div>
                              <div className={`${cell} justify-end tabular-nums text-slate-700 bg-slate-50/40`}>{r.channel === "sms" ? "—" : pct(r.open_rate)}</div>
                              <div className={`${cell} justify-end tabular-nums text-slate-700 bg-slate-50/40`}>{pct(r.click_rate)}</div>
                              <div className={`${cell} justify-end tabular-nums text-slate-900 font-medium bg-slate-50/40`}>{money(r.revenue)}</div>
                              <div className={`${cell} justify-end tabular-nums text-slate-700 bg-slate-50/40`}>{rpr(r.revenue_per_recipient)}</div>
                              <div className={`${cell} text-[11px] text-slate-500`}><span className="truncate">{r.notes || "—"}</span></div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            ))}
          </DragDropContext>

          {/* summary */}
          <div className="grid border-t-2 border-slate-200 bg-slate-50 text-sm font-medium" style={{ gridTemplateColumns: GRID }}>
            <div className="px-3 py-2.5 text-slate-700">{summary.count} total</div>
            <div /><div /><div /><div /><div />
            <div className="px-3 py-2.5 text-right tabular-nums text-slate-700 border-l border-slate-200">{int(summary.recipients)}</div>
            <div className="px-3 py-2.5 text-right tabular-nums text-slate-500">{pct(summary.avgOpen)}</div>
            <div className="px-3 py-2.5 text-right tabular-nums text-slate-500">{pct(summary.avgClick)}</div>
            <div className="px-3 py-2.5 text-right tabular-nums text-slate-900">{money(summary.revenue)}</div>
            <div /><div className="px-3 py-2.5 text-[10px] text-slate-400 font-mono self-center">avg open/click</div>
          </div>
        </div>
      </div>
      {sortBy === "revenue" && <div className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-100">Switch sort to “Planned send” to drag-reschedule.</div>}
    </div>
  );
}

// ---------- skeleton ----------
function Skeleton() {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-2">
      {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />)}
    </div>
  );
}

// ---------- audience picker ----------
function AudiencePicker({ label, selected, onChange, audiences, audiencesFailed }: {
  label: string; selected: AudienceRef[]; onChange: (v: AudienceRef[]) => void; audiences: AudienceItem[]; audiencesFailed: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const selectedIds = new Set(selected.map((s) => s.id || s.name));
  const matches = audiences.filter((a) => a.name.toLowerCase().includes(q.toLowerCase()) && !selectedIds.has(a.id)).slice(0, 8);
  const add = (a: AudienceRef) => { onChange([...selected, a]); setQ(""); };
  const remove = (key: string) => onChange(selected.filter((s) => (s.id || s.name) !== key));
  return (
    <div>
      <label className="block font-mono text-[10px] text-slate-500 uppercase tracking-wide mb-1">{label}</label>
      <div className="flex flex-wrap gap-1 mb-1">
        {selected.map((s) => (
          <span key={s.id || s.name} className="inline-flex items-center gap-1 text-[11px] bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5">
            {s.name}<button type="button" onClick={() => remove(s.id || s.name)} className="text-slate-400 hover:text-slate-700">✕</button>
          </span>
        ))}
      </div>
      <div className="relative">
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={audiencesFailed ? "Type a name, Enter to add" : "Search segments & lists…"}
          onKeyDown={(e) => { if (e.key === "Enter" && q.trim() && audiencesFailed) { e.preventDefault(); add({ id: "", name: q.trim(), type: "segment" }); } }}
          className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-slate-400" />
        {open && !audiencesFailed && matches.length > 0 && (
          <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
            {matches.map((a) => (
              <button key={a.id} type="button" onMouseDown={(e) => { e.preventDefault(); add({ id: a.id, name: a.name, type: a.type }); }}
                className="w-full text-left px-2 py-1.5 text-sm hover:bg-slate-50 flex items-center justify-between">
                <span>{a.name}</span><span className="text-[10px] font-mono uppercase text-slate-400">{a.type}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {audiencesFailed && <div className="text-[10px] text-amber-600 mt-1">Klaviyo audiences unavailable — free-type names for now.</div>}
    </div>
  );
}

// ---------- row editor ----------
function RowEditor({ row, defaultDateIso, audiences, audiencesFailed, campaigns, onClose, onSaved }: {
  row: PlannerRow | null; defaultDateIso: string | null;
  audiences: AudienceItem[]; audiencesFailed: boolean; campaigns: CampaignItem[];
  onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(row?.name ?? "");
  const [channel, setChannel] = useState<PlannerChannel>(row?.channel ?? "email");
  const [status, setStatus] = useState<PlannerStatus>(row?.status ?? "idea");
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

  const label = "block font-mono text-[10px] text-slate-500 uppercase tracking-wide mb-1";
  const input = "w-full border border-slate-200 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-slate-400";

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
    try { await post(build()); onSaved(); } catch (e) { setErr(e instanceof Error ? e.message : "Save failed"); setSaving(false); }
  };
  const duplicate = async () => {
    setSaving(true); setErr(null);
    try {
      // Clone plan fields; clear link + metrics so the copy is a fresh plan.
      await post(build({ id: undefined, name: `${name.trim()} (copy)`, status: "idea", klaviyo_campaign_id: undefined, klaviyo_send_time: null, postscript_campaign_id: undefined }));
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : "Duplicate failed"); setSaving(false); }
  };
  const del = async () => {
    if (!row) return; setSaving(true);
    try { await fetch(`/api/planner?id=${encodeURIComponent(row.id)}`, { method: "DELETE" }); onSaved(); } catch { setSaving(false); }
  };

  const campMatches = campaigns.filter((c) => c.name.toLowerCase().includes(campQ.toLowerCase())).slice(0, 8);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 sticky top-0 bg-white z-10">
          <span className="font-mono text-xs text-slate-500 uppercase tracking-wide">{row ? "Edit campaign" : "New campaign"}</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-sm">✕</button>
        </div>
        <div className="p-5 space-y-3">
          <div><label className={label}>Name</label><input className={input} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Prime Day last call" /></div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className={label}>Channel</label>
              <select className={input} value={channel} onChange={(e) => setChannel(e.target.value as PlannerChannel)}>{PLANNER_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
            <div><label className={label}>Status</label>
              <select className={input} value={status} onChange={(e) => setStatus(e.target.value as PlannerStatus)}>{PLANNER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
            <div><label className={label}>Planned send</label><input type="datetime-local" className={input} value={plannedSendAt} onChange={(e) => setPlannedSendAt(e.target.value)} /></div>
          </div>

          {/* offer toggle */}
          <div>
            <label className={label}>Offer</label>
            <div className="inline-flex rounded-md border border-slate-200 p-0.5 mb-2">
              {(["evergreen", "promo"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setOfferType(t)}
                  className={`px-3 py-1 text-xs rounded font-medium ${offerType === t ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
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

          <AudiencePicker label="Audience included" selected={included} onChange={setIncluded} audiences={audiences} audiencesFailed={audiencesFailed} />
          <AudiencePicker label="Audience excluded" selected={excluded} onChange={setExcluded} audiences={audiences} audiencesFailed={audiencesFailed} />

          {channel === "email" ? (
            <div>
              <label className={label}>Link Klaviyo campaign (to sync metrics)</label>
              <div className="relative">
                <input className={input} value={campQ || klaviyoId} onFocus={() => setCampOpen(true)} onBlur={() => setTimeout(() => setCampOpen(false), 150)}
                  onChange={(e) => { setCampQ(e.target.value); setKlaviyoId(e.target.value); setKlaviyoSendTime(null); setCampOpen(true); }}
                  placeholder="Search campaigns or paste id…" />
                {campOpen && campMatches.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-md shadow-lg max-h-56 overflow-y-auto">
                    {campMatches.map((c) => (
                      <button key={c.id} type="button" onMouseDown={(e) => { e.preventDefault(); setKlaviyoId(c.id); setKlaviyoSendTime(c.send_time); setCampQ(""); setCampOpen(false); }}
                        className="w-full text-left px-2 py-1.5 text-sm hover:bg-slate-50">
                        <div className="text-slate-800 truncate">{c.name}</div>
                        <div className="text-[10px] font-mono text-slate-400">{c.status}{c.send_time ? ` · ${fmtDate(c.send_time)}` : ""}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {klaviyoId && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] font-mono text-slate-400 truncate">linked: {klaviyoId}{klaviyoSendTime ? ` · sent ${fmtDate(klaviyoSendTime)}` : ""}</span>
                  <a href={`https://www.klaviyo.com/campaign/${klaviyoId}/reports`} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-600 hover:underline shrink-0">Open in Klaviyo ↗</a>
                </div>
              )}
            </div>
          ) : (
            <div><label className={label}>Postscript campaign id (to sync metrics)</label>
              <input className={input} value={postscriptId} onChange={(e) => setPostscriptId(e.target.value)} placeholder="Postscript campaign id" /></div>
          )}

          {channel === "email" && row && (
            <div className="border-t border-slate-100 pt-3">
              <label className={label}>Copy Builder</label>
              {row.copy_campaign_id ? (
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-mono uppercase border rounded px-1.5 py-0.5 ${COPY_CHIP[row.copy_status === "final" ? "final" : "draft"]}`}>Copy: {row.copy_status ?? "draft"}</span>
                  <Link href={`/copy-builder?campaign=${row.copy_campaign_id}`} className="text-[11px] text-indigo-600 hover:underline">Open copy ↗</Link>
                </div>
              ) : (
                <Link href={`/copy-builder?planner=${row.id}`} className="inline-block text-sm text-indigo-600 hover:underline">Write copy for this campaign →</Link>
              )}
            </div>
          )}

          <div><label className={label}>Notes / learnings</label><textarea className={`${input} resize-y min-h-[70px]`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What we learned…" /></div>

          {row && (row.recipients != null || row.revenue != null) && (
            <div className="text-[11px] text-slate-500 font-mono bg-slate-50 border border-slate-200 rounded px-3 py-2">
              Synced: {int(row.recipients)} recipients · open {channel === "sms" ? "—" : pct(row.open_rate)} · click {pct(row.click_rate)} · {money(row.revenue)}
              {row.metrics_synced_at ? ` · ${fmtDateTime(row.metrics_synced_at)}` : ""}
            </div>
          )}

          {err && <div className="text-sm text-red-600">{err}</div>}

          <div className="flex items-center gap-2 pt-1">
            <Button variant="primary" loading={saving} onClick={save} className="flex-1">Save</Button>
            {row && <Button variant="secondary" disabled={saving} onClick={duplicate}>Duplicate</Button>}
            {row && !confirmDel && (
              <Button variant="secondary" disabled={saving} onClick={() => setConfirmDel(true)}
                className="text-danger-600 border-danger-200 hover:bg-danger-50 hover:border-danger-200 hover:text-danger-600">
                Delete
              </Button>
            )}
            {row && confirmDel && <Button variant="danger" disabled={saving} onClick={del}>Confirm delete</Button>}
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
