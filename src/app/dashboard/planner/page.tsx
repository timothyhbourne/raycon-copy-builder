"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlannerRow, PlannerChannel, PlannerStatus } from "@/lib/planner-types";
import { PLANNER_STATUSES, PLANNER_CHANNELS } from "@/lib/planner-types";
import { formatMoney, formatInt } from "../format";

const CHANNEL_STYLE: Record<PlannerChannel, { dot: string; chip: string; label: string }> = {
  email: { dot: "bg-indigo-500", chip: "bg-indigo-50 text-indigo-700 border-indigo-200", label: "Email" },
  sms: { dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "SMS" },
};

function pct(frac: number | null | undefined): string {
  if (frac === null || frac === undefined) return "—";
  return `${(frac * 100).toFixed(1)}%`;
}
function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return formatMoney(n);
}
function rpr(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${n.toFixed(2)}`;
}
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}
function localInputToIso(v: string): string {
  const d = new Date(v);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function PlannerPage() {
  const [rows, setRows] = useState<PlannerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"calendar" | "table">("calendar");
  const [editing, setEditing] = useState<PlannerRow | "new" | null>(null);
  const [newDate, setNewDate] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  // calendar month cursor
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });

  // table filters
  const [fChannel, setFChannel] = useState<"all" | PlannerChannel>("all");
  const [fStatus, setFStatus] = useState<"all" | PlannerStatus>("all");
  const [fStart, setFStart] = useState("");
  const [fEnd, setFEnd] = useState("");

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

  const sync = async () => {
    setSyncing(true);
    setSyncNote(null);
    try {
      const res = await fetch("/api/planner/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Sync failed");
      setRows(json.rows as PlannerRow[]);
      const parts = [`Synced ${json.synced} campaign${json.synced === 1 ? "" : "s"}.`];
      if (!json.postscript_connected) parts.push("Postscript not connected (SMS metrics skipped).");
      if (json.warnings?.length) parts.push(...json.warnings);
      setSyncNote(parts.join(" "));
    } catch (e) {
      setSyncNote(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (fChannel !== "all" && r.channel !== fChannel) return false;
      if (fStatus !== "all" && r.status !== fStatus) return false;
      const day = (r.planned_send_at || "").slice(0, 10);
      if (fStart && day < fStart) return false;
      if (fEnd && day > fEnd) return false;
      return true;
    });
  }, [rows, fChannel, fStatus, fStart, fEnd]);

  return (
    <div>
      {/* Sub-view toggle + actions */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
          {(["calendar", "table"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors capitalize ${
                view === v ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
              }`}>
              {v}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={sync} disabled={syncing}
            className="px-3 py-1.5 border border-slate-300 text-slate-700 text-sm rounded hover:bg-slate-50 disabled:opacity-50">
            {syncing ? "Syncing…" : "Sync metrics"}
          </button>
          <button onClick={() => { setNewDate(null); setEditing("new"); }}
            className="px-4 py-1.5 bg-slate-900 text-white text-sm rounded hover:bg-slate-700">
            + New campaign
          </button>
        </div>
      </div>

      {syncNote && (
        <div className="text-xs text-slate-500 font-mono mb-4 bg-slate-50 border border-slate-200 rounded px-3 py-2">{syncNote}</div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 text-sm text-red-900">{error}</div>
      )}

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-400 text-sm">Loading…</div>
      ) : view === "calendar" ? (
        <CalendarView
          rows={rows}
          cursor={cursor}
          setCursor={setCursor}
          onEntry={(r) => setEditing(r)}
          onDay={(dayIso) => { setNewDate(dayIso); setEditing("new"); }}
        />
      ) : (
        <TableView
          rows={filtered}
          onEdit={(r) => setEditing(r)}
          fChannel={fChannel} setFChannel={setFChannel}
          fStatus={fStatus} setFStatus={setFStatus}
          fStart={fStart} setFStart={setFStart}
          fEnd={fEnd} setFEnd={setFEnd}
        />
      )}

      {editing && (
        <RowEditor
          row={editing === "new" ? null : editing}
          defaultDateIso={newDate}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await fetchRows(); }}
          onDeleted={async () => { setEditing(null); await fetchRows(); }}
        />
      )}
    </div>
  );
}

// ---------------- Calendar ----------------
function CalendarView({
  rows, cursor, setCursor, onEntry, onDay,
}: {
  rows: PlannerRow[];
  cursor: { y: number; m: number };
  setCursor: (c: { y: number; m: number }) => void;
  onEntry: (r: PlannerRow) => void;
  onDay: (dayIso: string) => void;
}) {
  const { y, m } = cursor;
  const first = new Date(y, m, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayYmd = new Date().toISOString().slice(0, 10);

  const byDay = useMemo(() => {
    const map = new Map<string, PlannerRow[]>();
    for (const r of rows) {
      const key = (r.planned_send_at || "").slice(0, 10);
      if (!key) continue;
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return map;
  }, [rows]);

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = first.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const dayKey = (d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
        <div className="font-mono text-xs text-slate-500 uppercase tracking-wide">{monthLabel}</div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 text-[10px] font-mono text-slate-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500" /> Email</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> SMS</span>
          </div>
          <div className="flex gap-1">
            <button onClick={() => setCursor(m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 })}
              className="px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50">←</button>
            <button onClick={() => setCursor({ y: now0().getFullYear(), m: now0().getMonth() })}
              className="px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50">Today</button>
            <button onClick={() => setCursor(m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 })}
              className="px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50">→</button>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-7 text-[10px] font-mono uppercase tracking-wide text-slate-400 border-b border-slate-100">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="px-2 py-1.5 text-center">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          const key = d ? dayKey(d) : `empty-${i}`;
          const entries = d ? byDay.get(dayKey(d)) ?? [] : [];
          const isToday = d && dayKey(d) === todayYmd;
          return (
            <div key={key}
              className={`min-h-[92px] border-b border-r border-slate-100 p-1.5 ${d ? "cursor-pointer hover:bg-slate-50" : "bg-slate-50/40"}`}
              onClick={() => d && onDay(`${dayKey(d)}T09:00`)}>
              {d && (
                <div className={`text-[11px] font-mono mb-1 ${isToday ? "text-slate-900 font-semibold" : "text-slate-400"}`}>{d}</div>
              )}
              <div className="space-y-1">
                {entries.map((r) => (
                  <button key={r.id}
                    onClick={(e) => { e.stopPropagation(); onEntry(r); }}
                    className="w-full text-left flex items-center gap-1 rounded px-1 py-0.5 hover:bg-white border border-transparent hover:border-slate-200">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${CHANNEL_STYLE[r.channel].dot}`} />
                    <span className="text-[11px] text-slate-700 truncate">{r.name}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function now0() { return new Date(); }

// ---------------- Table ----------------
function TableView({
  rows, onEdit, fChannel, setFChannel, fStatus, setFStatus, fStart, setFStart, fEnd, setFEnd,
}: {
  rows: PlannerRow[];
  onEdit: (r: PlannerRow) => void;
  fChannel: "all" | PlannerChannel; setFChannel: (v: "all" | PlannerChannel) => void;
  fStatus: "all" | PlannerStatus; setFStatus: (v: "all" | PlannerStatus) => void;
  fStart: string; setFStart: (v: string) => void;
  fEnd: string; setFEnd: (v: string) => void;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 flex-wrap">
        <select value={fChannel} onChange={(e) => setFChannel(e.target.value as "all" | PlannerChannel)}
          className="text-xs border border-slate-200 rounded px-2 py-1 bg-white">
          <option value="all">All channels</option>
          {PLANNER_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value as "all" | PlannerStatus)}
          className="text-xs border border-slate-200 rounded px-2 py-1 bg-white">
          <option value="all">All statuses</option>
          {PLANNER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="date" value={fStart} onChange={(e) => setFStart(e.target.value)}
          className="text-xs border border-slate-200 rounded px-2 py-1 bg-white" title="From" />
        <input type="date" value={fEnd} onChange={(e) => setFEnd(e.target.value)}
          className="text-xs border border-slate-200 rounded px-2 py-1 bg-white" title="To" />
        <div className="ml-auto text-xs text-slate-500">{rows.length} campaign{rows.length === 1 ? "" : "s"}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left text-slate-500 font-mono text-[10px] uppercase tracking-wide">
              <th className="px-3 py-2.5 font-medium">Name</th>
              <th className="px-3 py-2.5 font-medium">Channel</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium">Planned send</th>
              <th className="px-3 py-2.5 font-medium">Offer</th>
              <th className="px-3 py-2.5 font-medium">Audience</th>
              <th className="px-3 py-2.5 font-medium text-right">Recipients</th>
              <th className="px-3 py-2.5 font-medium text-right">Open rate</th>
              <th className="px-3 py-2.5 font-medium text-right">Click rate</th>
              <th className="px-3 py-2.5 font-medium text-right">Revenue</th>
              <th className="px-3 py-2.5 font-medium text-right">Rev/recip</th>
              <th className="px-3 py-2.5 font-medium">Notes / learnings</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length > 0 ? rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50 cursor-pointer align-top" onClick={() => onEdit(r)}>
                <td className="px-3 py-2.5 text-slate-900">{r.name}</td>
                <td className="px-3 py-2.5">
                  <span className={`text-[10px] font-mono uppercase border rounded px-1.5 py-0.5 ${CHANNEL_STYLE[r.channel].chip}`}>{CHANNEL_STYLE[r.channel].label}</span>
                </td>
                <td className="px-3 py-2.5 text-[11px] font-mono uppercase text-slate-500">{r.status}</td>
                <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{fmtDate(r.planned_send_at)}</td>
                <td className="px-3 py-2.5 text-slate-700">{r.offer || "—"}{r.promo_code ? ` · ${r.promo_code}` : ""}</td>
                <td className="px-3 py-2.5 text-[11px] text-slate-500 max-w-[160px]">
                  {r.audience_included.length > 0 && <div>+ {r.audience_included.join(", ")}</div>}
                  {r.audience_excluded.length > 0 && <div className="text-slate-400">− {r.audience_excluded.join(", ")}</div>}
                  {r.audience_included.length === 0 && r.audience_excluded.length === 0 && "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{r.recipients != null ? formatInt(r.recipients) : "—"}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{r.channel === "sms" ? "—" : pct(r.open_rate)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{pct(r.click_rate)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-900 font-medium">{money(r.revenue)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{rpr(r.revenue_per_recipient)}</td>
                <td className="px-3 py-2.5 text-[11px] text-slate-500 max-w-[220px] truncate">{r.notes || "—"}</td>
              </tr>
            )) : (
              <tr><td colSpan={12} className="px-4 py-10 text-center text-slate-400 text-sm">No campaigns match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------- Row editor ----------------
function RowEditor({
  row, defaultDateIso, onClose, onSaved, onDeleted,
}: {
  row: PlannerRow | null;
  defaultDateIso: string | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(row?.name ?? "");
  const [channel, setChannel] = useState<PlannerChannel>(row?.channel ?? "email");
  const [status, setStatus] = useState<PlannerStatus>(row?.status ?? "idea");
  const [plannedSendAt, setPlannedSendAt] = useState(
    row ? isoToLocalInput(row.planned_send_at) : defaultDateIso ? isoToLocalInput(localInputToIso(defaultDateIso)) : isoToLocalInput(new Date().toISOString())
  );
  const [offer, setOffer] = useState(row?.offer ?? "");
  const [promoCode, setPromoCode] = useState(row?.promo_code ?? "");
  const [included, setIncluded] = useState((row?.audience_included ?? []).join(", "));
  const [excluded, setExcluded] = useState((row?.audience_excluded ?? []).join(", "));
  const [klaviyoId, setKlaviyoId] = useState(row?.klaviyo_campaign_id ?? "");
  const [postscriptId, setPostscriptId] = useState(row?.postscript_campaign_id ?? "");
  const [notes, setNotes] = useState(row?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) { setErr("Name is required"); return; }
    setSaving(true);
    setErr(null);
    const toList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
    const body: Record<string, unknown> = {
      id: row?.id,
      name: name.trim(),
      channel,
      status,
      planned_send_at: localInputToIso(plannedSendAt),
      offer,
      promo_code: promoCode || undefined,
      audience_included: toList(included),
      audience_excluded: toList(excluded),
      klaviyo_campaign_id: channel === "email" ? (klaviyoId.trim() || undefined) : undefined,
      postscript_campaign_id: channel === "sms" ? (postscriptId.trim() || undefined) : undefined,
      notes,
    };
    try {
      const res = await fetch("/api/planner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
      setSaving(false);
    }
  };

  const del = async () => {
    if (!row) return;
    setSaving(true);
    try {
      await fetch(`/api/planner?id=${encodeURIComponent(row.id)}`, { method: "DELETE" });
      onDeleted();
    } catch {
      setSaving(false);
    }
  };

  const label = "block font-mono text-[10px] text-slate-500 uppercase tracking-wide mb-1";
  const input = "w-full border border-slate-200 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-slate-400";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 sticky top-0 bg-white">
          <span className="font-mono text-xs text-slate-500 uppercase tracking-wide">{row ? "Edit campaign" : "New campaign"}</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-sm">✕</button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className={label}>Name</label>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Prime Day last call" autoFocus />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={label}>Channel</label>
              <select className={input} value={channel} onChange={(e) => setChannel(e.target.value as PlannerChannel)}>
                {PLANNER_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Status</label>
              <select className={input} value={status} onChange={(e) => setStatus(e.target.value as PlannerStatus)}>
                {PLANNER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Planned send</label>
              <input type="datetime-local" className={input} value={plannedSendAt} onChange={(e) => setPlannedSendAt(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Offer</label>
              <input className={input} value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="20% off sitewide" />
            </div>
            <div>
              <label className={label}>Promo code</label>
              <input className={input} value={promoCode} onChange={(e) => setPromoCode(e.target.value)} placeholder="PRIME" />
            </div>
          </div>
          <div>
            <label className={label}>Audience included (comma-separated)</label>
            <input className={input} value={included} onChange={(e) => setIncluded(e.target.value)} placeholder="Engaged 90d, VIP" />
          </div>
          <div>
            <label className={label}>Audience excluded (comma-separated)</label>
            <input className={input} value={excluded} onChange={(e) => setExcluded(e.target.value)} placeholder="Recent purchasers" />
          </div>
          {channel === "email" ? (
            <div>
              <label className={label}>Klaviyo campaign id (to sync metrics)</label>
              <input className={input} value={klaviyoId} onChange={(e) => setKlaviyoId(e.target.value)} placeholder="01K…" />
            </div>
          ) : (
            <div>
              <label className={label}>Postscript campaign id (to sync metrics)</label>
              <input className={input} value={postscriptId} onChange={(e) => setPostscriptId(e.target.value)} placeholder="Postscript campaign id" />
            </div>
          )}
          <div>
            <label className={label}>Notes / learnings</label>
            <textarea className={`${input} resize-y min-h-[70px]`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What we learned…" />
          </div>

          {row && (row.recipients != null || row.revenue != null) && (
            <div className="text-[11px] text-slate-500 font-mono bg-slate-50 border border-slate-200 rounded px-3 py-2">
              Synced: {row.recipients != null ? `${formatInt(row.recipients)} recipients` : "—"}
              {" · "}open {channel === "sms" ? "—" : pct(row.open_rate)}
              {" · "}click {pct(row.click_rate)}
              {" · "}{money(row.revenue)}
              {row.metrics_synced_at ? ` · ${new Date(row.metrics_synced_at).toLocaleString()}` : ""}
            </div>
          )}

          {err && <div className="text-sm text-red-600">{err}</div>}

          <div className="flex items-center gap-2 pt-1">
            <button onClick={save} disabled={saving}
              className="flex-1 bg-slate-900 text-white py-2 rounded-md text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
            {row && (
              <button onClick={del} disabled={saving}
                className="px-3 py-2 border border-red-200 text-red-600 rounded-md text-sm hover:bg-red-50 disabled:opacity-50">
                Delete
              </button>
            )}
            <button onClick={onClose} className="px-3 py-2 border border-slate-200 text-slate-600 rounded-md text-sm hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
