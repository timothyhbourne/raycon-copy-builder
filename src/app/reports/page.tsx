"use client";
import { useCallback, useEffect, useState } from "react";
import type { WeeklyReport, ChannelBlock, Deltas } from "@/lib/reports/weekly";

// --- formatters (consistent with planner/dashboard) ---
const money = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const int = (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("en-US").format(Math.round(n)));
const pct = (f: number | null | undefined) => (f == null ? "—" : `${(f * 100).toFixed(1)}%`);
const perSend = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);
const per1k = (n: number | null | undefined) => (n == null ? "—" : money(n));

function fmtWeek(w: WeeklyReport["week"]): string {
  const s = new Date(`${w.startYMD}T00:00:00Z`);
  const e = new Date(`${w.endYMD}T00:00:00Z`);
  const opt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  const yr = e.getUTCFullYear();
  return `${s.toLocaleDateString("en-US", opt)} – ${e.toLocaleDateString("en-US", opt)}, ${yr} · ${w.isoWeek}`;
}
const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

// A week-over-week badge. `kind` picks the formatting: fractional % change, or
// percentage-POINT change for pctOfStore. Green up / red down / neutral —.
function Delta({ value, kind }: { value: number | null; kind: "pct" | "pp" }) {
  if (value == null) return <span className="text-slate-300">—</span>;
  const up = value > 0;
  const down = value < 0;
  const cls = up ? "text-emerald-600" : down ? "text-rose-600" : "text-slate-400";
  const arrow = up ? "▲" : down ? "▼" : "•";
  const mag = kind === "pp" ? `${(value * 100).toFixed(1)} pp` : `${Math.abs(value * 100).toFixed(1)}%`;
  return <span className={`font-mono text-[11px] ${cls}`}>{arrow} {mag}</span>;
}

function Metric({ label, value, delta }: { label: string; value: string; delta?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between py-1.5 border-b border-slate-100 last:border-0">
      <span className="font-mono text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className="tabular-nums text-slate-900">{value}</span>
        {delta}
      </span>
    </div>
  );
}

function ChannelCard({ title, block, deltas, rprLabel }: { title: string; block: ChannelBlock; deltas?: Deltas; rprLabel: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-xs uppercase tracking-wide text-slate-500">{title}</div>
        <div className="text-2xl font-semibold text-slate-900 tabular-nums">{money(block.revenue)}</div>
      </div>
      <Metric label="% of store revenue" value={pct(block.pctOfStore)} delta={deltas ? <Delta value={deltas.pctOfStorePointChange} kind="pp" /> : undefined} />
      <Metric label="Revenue (WoW)" value={money(block.revenue)} delta={deltas ? <Delta value={deltas.revenuePctChange} kind="pct" /> : undefined} />
      <Metric label={rprLabel} value={perSend(block.revenuePerRecipient)} delta={deltas ? <Delta value={deltas.rprPctChange} kind="pct" /> : undefined} />
      <Metric label="Per 1,000 sends" value={per1k(block.revenuePer1kSends)} />
      <Metric label="Recipients (sends)" value={int(block.recipients)} />
    </div>
  );
}

export default function ReportsPage() {
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [weeks, setWeeks] = useState<string[]>([]);
  const [selWeek, setSelWeek] = useState<string>(""); // "" = latest
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (week?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(week ? `/api/reports/weekly?week=${encodeURIComponent(week)}` : "/api/reports/weekly");
      const j = await res.json();
      if (!res.ok && res.status !== 404) throw new Error(j.error || "Load failed");
      setReport(j.report ?? null);
      setWeeks(j.weeks ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runNow = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/weekly/run"); // cookie-authenticated
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Run failed");
      setSelWeek("");
      setReport(j.report);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  };

  const rprLabel = report?.rprMode === "program" ? "Rev / send (incl. flows)" : "Rev / send";

  return (
    <div>
      <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
        <div>
          <div className="font-mono text-xs text-slate-500 uppercase tracking-wide mb-1">Weekly Report</div>
          <h1 className="text-2xl font-semibold text-slate-900">Email &amp; SMS performance</h1>
          {report && (
            <div className="text-sm text-slate-500 mt-1">
              {fmtWeek(report.week)} · <span className="font-mono text-[11px] uppercase">1-day click</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {weeks.length > 0 && (
            <select
              value={selWeek}
              onChange={(e) => { setSelWeek(e.target.value); load(e.target.value || undefined); }}
              className="text-sm border border-slate-300 rounded px-2 py-1.5 bg-white"
              title="View a past week"
            >
              <option value="">Latest</option>
              {[...weeks].reverse().map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          )}
          <button
            onClick={runNow}
            disabled={running}
            className="px-4 py-1.5 bg-slate-900 text-white text-sm rounded hover:bg-slate-700 disabled:opacity-50"
          >
            {running ? "Running…" : "Run now"}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-900 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500">✕</button>
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-slate-100 rounded animate-pulse" />)}
        </div>
      ) : !report ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
          <div className="font-mono text-xs text-slate-400 uppercase tracking-wide mb-2">No report yet</div>
          <p className="text-slate-600 text-sm mb-4">Run the first weekly capture to see Northbeam-attributed email &amp; SMS performance.</p>
          <button onClick={runNow} disabled={running} className="px-4 py-1.5 bg-slate-900 text-white text-sm rounded hover:bg-slate-700 disabled:opacity-50">
            {running ? "Running…" : "Run now"}
          </button>
        </div>
      ) : (
        <>
          {report.warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-800 space-y-0.5">
              {report.warnings.map((w, i) => <div key={i}>· {w}</div>)}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChannelCard title="Email · Klaviyo" block={report.email} deltas={report.wow?.email} rprLabel={rprLabel} />
            <ChannelCard title="SMS · Postscript" block={report.sms} deltas={report.wow?.sms} rprLabel={rprLabel} />
          </div>

          <div className="mt-4 bg-white border border-slate-200 rounded-lg px-4 py-3 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-slate-500">
            <span>Total store revenue: <span className="text-slate-800 tabular-nums">{money(report.totalStoreRevenue)}</span></span>
            <span>Denominator: <span className="font-mono">{report.denominatorSource}</span></span>
            <span>RPR mode: <span className="font-mono">{report.rprMode}</span></span>
            <span>Generated: {fmtDateTime(report.generatedAt)}</span>
            {!report.wow && <span className="text-slate-400">no prior week — WoW omitted</span>}
          </div>
        </>
      )}
    </div>
  );
}
