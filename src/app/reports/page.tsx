"use client";
import { useCallback, useEffect, useState } from "react";
import type { WeeklyReport, ChannelBlock, Deltas } from "@/lib/reports/weekly";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { DeltaPill } from "@/components/ui/Stat";

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
// Week-over-week badge → the shared DeltaPill. `pp` = percentage-POINT change
// (pctOfStore), `pct` = fractional % change; both come in as fractions, so scale
// to display units. Green up / red down / muted flat, higher-is-good.
function Delta({ value, kind }: { value: number | null; kind: "pct" | "pp" }) {
  if (value == null) return <span className="text-ink-muted">—</span>;
  return <DeltaPill value={value * 100} unit={kind === "pp" ? "pp" : "%"} />;
}

function Metric({ label, value, delta }: { label: string; value: string; delta?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between py-1.5 border-b border-line last:border-0">
      <span className="t-label">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className="tabular-nums text-ink">{value}</span>
        {delta}
      </span>
    </div>
  );
}

function ChannelCard({ title, block, deltas, rprLabel }: { title: string; block: ChannelBlock; deltas?: Deltas; rprLabel: string }) {
  return (
    <Card bodyClassName="p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="t-label">{title}</div>
        <div className="text-2xl font-semibold text-ink tabular-nums">{money(block.revenue)}</div>
      </div>
      <Metric label="% of store revenue" value={pct(block.pctOfStore)} delta={deltas ? <Delta value={deltas.pctOfStorePointChange} kind="pp" /> : undefined} />
      <Metric label="Revenue (WoW)" value={money(block.revenue)} delta={deltas ? <Delta value={deltas.revenuePctChange} kind="pct" /> : undefined} />
      <Metric label={rprLabel} value={perSend(block.revenuePerRecipient)} delta={deltas ? <Delta value={deltas.rprPctChange} kind="pct" /> : undefined} />
      <Metric label="Per 1,000 sends" value={per1k(block.revenuePer1kSends)} />
      <Metric label="Recipients (sends)" value={int(block.recipients)} />
    </Card>
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
      <PageHeader
        className="mb-6"
        eyebrow="Weekly Report"
        title="Email & SMS"
        accent="performance"
        description={report
          ? <>{fmtWeek(report.week)} · <span className="t-label align-middle">1-day click</span></>
          : "Northbeam-attributed email & SMS revenue, week over week."}
        meta={
          <>
            {weeks.length > 0 && (
              <select
                value={selWeek}
                onChange={(e) => { setSelWeek(e.target.value); load(e.target.value || undefined); }}
                className="self-end text-sm border border-line rounded-sm px-2 py-1.5 bg-surface focus:outline-none focus:border-accent transition-colors"
                title="View a past week"
              >
                <option value="">Latest</option>
                {[...weeks].reverse().map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            )}
            <Button variant="primary" size="sm" loading={running} onClick={runNow}>Run now</Button>
          </>
        }
      />

      {error && (
        <div className="bg-danger-50 border border-danger-200 rounded-md p-3 mb-4 text-sm text-danger-600 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-danger-600 hover:opacity-70" aria-label="Dismiss error">✕</button>
        </div>
      )}

      {loading ? (
        <div className="bg-surface border border-line rounded-md shadow-card p-4 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 rc-skeleton rounded-md" />)}
        </div>
      ) : !report ? (
        <Card className="text-center" bodyClassName="p-12">
          <div className="t-label mb-2">No report yet</div>
          <p className="text-ink-secondary text-sm mb-4">Run the first weekly capture to see Northbeam-attributed email &amp; SMS performance.</p>
          <Button variant="primary" size="sm" loading={running} onClick={runNow}>Run now</Button>
        </Card>
      ) : (
        <>
          {report.warnings.length > 0 && (
            <div className="bg-warning-50 border border-warning-200 rounded-md p-3 mb-4 text-xs text-warning-600 space-y-0.5">
              {report.warnings.map((w, i) => <div key={i}>· {w}</div>)}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChannelCard title="Email · Klaviyo" block={report.email} deltas={report.wow?.email} rprLabel={rprLabel} />
            <ChannelCard title="SMS · Postscript" block={report.sms} deltas={report.wow?.sms} rprLabel={rprLabel} />
          </div>

          <div className="mt-4 bg-surface border border-line rounded-md shadow-card px-4 py-3 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-ink-muted">
            <span>Total store revenue: <span className="text-ink-secondary tabular-nums">{money(report.totalStoreRevenue)}</span></span>
            <span>Denominator: <span>{report.denominatorSource}</span></span>
            <span>RPR mode: <span>{report.rprMode}</span></span>
            <span>Generated: {fmtDateTime(report.generatedAt)}</span>
            {!report.wow && <span className="text-ink-muted">no prior week — WoW omitted</span>}
          </div>
        </>
      )}
    </div>
  );
}
