"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CopyPerformanceResult, PerformanceRecord, DimensionAgg, RevenueBasis, ChannelFilter,
} from "@/lib/copy-performance";
import { PANEL_DIMENSIONS, MIN_N } from "@/lib/copy-performance";
import { ymd, formatMoney, formatInt, formatDate } from "@/app/dashboard/format";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Skeleton from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import DateRangePicker from "@/components/ui/DateRangePicker";
import { SegmentedToggle } from "@/components/ui/FilterBar";
import { toast } from "@/components/ui/Toast";

// Copy Performance — "What actually works" (spec: COPY_PERFORMANCE_SPEC.md §8).
// A read-only analytics view: RPR-by-copy-dimension panels + a sortable record
// table, over the live /api/copy-performance read. Own range/channel/basis
// controls; mounted top-level (not under the /dashboard measurement layout) so
// it stays fast and makes zero Klaviyo calls on the default path.

function monthToDateStart(): string {
  const d = new Date();
  return ymd(new Date(d.getFullYear(), d.getMonth(), 1));
}
const money2 = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

function RefreshIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
    </svg>
  );
}

// Per-record measure on the chosen basis.
const recRpr = (r: PerformanceRecord, basis: RevenueBasis) => (basis === "platform" ? r.rpr : r.northbeam_rpr);
const recRevenue = (r: PerformanceRecord, basis: RevenueBasis) => (basis === "platform" ? r.revenue : r.northbeam_revenue);

type SortKey = "rpr" | "revenue" | "recipients" | "send_date" | "name";

export default function CopyPerformancePage() {
  const [start, setStart] = useState(monthToDateStart());
  const [end, setEnd] = useState(() => ymd(new Date()));
  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [basis, setBasis] = useState<RevenueBasis>("platform");
  const [data, setData] = useState<CopyPerformanceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "rpr", dir: "desc" });

  const load = useCallback(async (s: string, e: string, ch: ChannelFilter, b: RevenueBasis) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/copy-performance?start=${s}&end=${e}&channel=${ch}&basis=${b}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json as CopyPerformanceResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(start, end, channel, basis); }, [start, end, channel, basis, load]);

  const onRangeChange = (s: string, e: string) => { if (s && e) { setStart(s); setEnd(e); } };

  const refreshMetrics = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/planner/sync", { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Sync failed");
      toast.success("Metrics refreshed from Klaviyo + Northbeam");
      await load(start, end, channel, basis);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const toggleSort = (key: SortKey) => {
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "name" ? "asc" : "desc" }));
  };

  // Attributed rows sorted by the active column; unattributed pinned to the bottom.
  const { attributed, unattributed } = useMemo(() => {
    const records = data?.records ?? [];
    const cmp = (a: PerformanceRecord, z: PerformanceRecord): number => {
      let av: number | string | null;
      let zv: number | string | null;
      switch (sort.key) {
        case "rpr": av = recRpr(a, basis); zv = recRpr(z, basis); break;
        case "revenue": av = recRevenue(a, basis); zv = recRevenue(z, basis); break;
        case "recipients": av = a.recipients; zv = z.recipients; break;
        case "send_date": av = a.send_date; zv = z.send_date; break;
        case "name": av = a.name.toLowerCase(); zv = z.name.toLowerCase(); break;
      }
      // Nulls always sort last regardless of direction.
      if (av == null && zv == null) return 0;
      if (av == null) return 1;
      if (zv == null) return -1;
      const base = av < zv ? -1 : av > zv ? 1 : 0;
      return sort.dir === "desc" ? -base : base;
    };
    return {
      attributed: records.filter((r) => r.attribution_source !== "unattributed").sort(cmp),
      unattributed: records.filter((r) => r.attribution_source === "unattributed").sort(cmp),
    };
  }, [data, sort, basis]);

  const coverage = data?.coverage;
  const lowCoverage = coverage != null && coverage.sent_count > 0 && coverage.attributed_coverage < 0.8;
  const panels = useMemo(
    () => (data?.aggregates ?? []).filter((a) => PANEL_DIMENSIONS.includes(a.dimension)),
    [data],
  );

  return (
    <div className="rc-content-panel flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-8 py-8">
        <PageHeader
          className="mb-6"
          eyebrow="Measure"
          title="Copy"
          accent="Performance"
          description="Which creative choices actually drive revenue — copy attributes correlated with revenue-per-recipient. Associations, not proof of cause."
          meta={
            <>
              <DateRangePicker start={start} end={end} onChange={onRangeChange} />
              <SegmentedToggle
                ariaLabel="Channel"
                options={[{ value: "all", label: "All" }, { value: "email", label: "Email" }, { value: "sms", label: "SMS" }]}
                value={channel}
                onChange={(v) => setChannel(v as ChannelFilter)}
              />
              <SegmentedToggle
                ariaLabel="Revenue basis"
                options={[{ value: "platform", label: "Klaviyo" }, { value: "northbeam", label: "Northbeam" }]}
                value={basis}
                onChange={(v) => setBasis(v as RevenueBasis)}
              />
              <Button variant="secondary" size="sm" loading={refreshing} onClick={refreshMetrics}
                title="Re-run the planner metrics sync (Klaviyo + Northbeam), then reload">
                <RefreshIcon className={`mr-1.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh metrics
              </Button>
            </>
          }
        />

        {error && (
          <div className="bg-danger-50 border border-danger-200 rounded-md p-4 mb-6">
            <div className="t-label text-danger-600 mb-1">Error</div>
            <div className="text-sm text-danger-600 whitespace-pre-wrap break-words">{error}</div>
          </div>
        )}

        {/* Coverage transparency (spec §3/§8.1) */}
        {coverage && lowCoverage && (
          <div className="bg-warning-50 border border-warning-200 rounded-md p-4 mb-6 text-sm text-ink-secondary">
            Showing <strong>{coverage.attributed_count}</strong> of <strong>{coverage.sent_count}</strong> sent campaigns with app-written copy
            {coverage.unattributed_revenue > 0 && <> — {formatMoney(coverage.unattributed_revenue)} of revenue isn&apos;t attributed to copy we wrote</>}.
            Treat these as directional.
          </div>
        )}

        {loading && !data ? (
          <LoadingState />
        ) : !data || data.records.length === 0 ? (
          <EmptyState
            className="border border-dashed border-line rounded-lg mt-2"
            title="No sent campaigns in this range"
            description="Once campaigns are sent and linked to planner rows with synced metrics, their copy attributes and revenue-per-recipient show up here."
          />
        ) : (
          <>
            {/* Coverage line always visible (even when healthy) */}
            {coverage && !lowCoverage && (
              <div className="mb-6 text-xs text-ink-muted flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-success-600" aria-hidden />
                {coverage.attributed_count} of {coverage.sent_count} sent campaigns attributed to app-written copy · {basis === "platform" ? "Klaviyo" : "Northbeam"} basis
              </div>
            )}

            {/* Insight panels */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
              {panels.map((agg) => <DimensionPanel key={agg.dimension} agg={agg} />)}
            </div>

            {/* Record table */}
            <Card title="Every sent campaign" subtitle={`Ranked by revenue-per-recipient · ${basis === "platform" ? "Klaviyo" : "Northbeam"} basis`} bodyClassName="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left">
                      <Th onClick={() => toggleSort("name")} active={sort.key === "name"} dir={sort.dir}>Campaign</Th>
                      <Th onClick={() => toggleSort("send_date")} active={sort.key === "send_date"} dir={sort.dir}>Sent</Th>
                      <Th onClick={() => toggleSort("recipients")} active={sort.key === "recipients"} dir={sort.dir} num>Recipients</Th>
                      <Th onClick={() => toggleSort("rpr")} active={sort.key === "rpr"} dir={sort.dir} num>RPR</Th>
                      <Th onClick={() => toggleSort("revenue")} active={sort.key === "revenue"} dir={sort.dir} num>Revenue</Th>
                      <th className="px-4 py-2.5 t-label font-medium">Copy attributes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attributed.map((r) => <RecordRow key={r.row_id} r={r} basis={basis} />)}
                    {unattributed.length > 0 && (
                      <tr><td colSpan={6} className="px-4 pt-4 pb-1 t-label text-ink-muted">Unattributed (no app-written copy — excluded from panels)</td></tr>
                    )}
                    {unattributed.map((r) => <RecordRow key={r.row_id} r={r} basis={basis} muted />)}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function DimensionPanel({ agg }: { agg: DimensionAgg }) {
  return (
    <Card title={`RPR by ${agg.label.toLowerCase()}`} bodyClassName="p-4">
      {agg.values.length === 0 ? (
        <div className="text-sm text-ink-muted py-2">No data in this range.</div>
      ) : (
        <ul className="space-y-2">
          {agg.values.map((v) => (
            <li key={v.value} className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm text-ink truncate">{v.value}</div>
                <div className="text-[11px] text-ink-muted">
                  n={v.n} · {formatMoney(v.total_revenue)}
                  {v.low_confidence && <span className="ml-1.5 text-warning-600">· low confidence (n&lt;{MIN_N})</span>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono tabular-nums text-sm text-ink">{money2(v.mean_rpr)}</div>
                {v.n > 1 && <div className="text-[11px] text-ink-muted">med {money2(v.median_rpr)}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecordRow({ r, basis, muted = false }: { r: PerformanceRecord; basis: RevenueBasis; muted?: boolean }) {
  const rpr = basis === "platform" ? r.rpr : r.northbeam_rpr;
  const revenue = basis === "platform" ? r.revenue : r.northbeam_revenue;
  // Attributed but no metrics yet → pending sync; missing chosen basis → no data.
  const pending = r.attribution_source !== "unattributed" && r.rpr == null && r.metrics_synced_at == null;
  const chips = [r.attributes.angle, r.attributes.conceit_architecture, r.attributes.campaign_type,
    r.attributes.includes_reviews ? "reviews" : undefined].filter(Boolean) as string[];
  return (
    <tr className={`border-b border-line last:border-0 ${muted ? "opacity-55" : ""}`}>
      <td className="px-4 py-2.5 text-ink font-medium max-w-[220px] truncate">{r.name}</td>
      <td className="px-4 py-2.5 text-ink-secondary whitespace-nowrap">{formatDate(r.send_date)}</td>
      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink-secondary">{r.recipients == null ? "—" : formatInt(r.recipients)}</td>
      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink">{pending ? <span className="text-ink-muted">pending sync</span> : rpr == null ? <span className="text-ink-muted">no data</span> : money2(rpr)}</td>
      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink-secondary">{revenue == null ? "—" : formatMoney(revenue)}</td>
      <td className="px-4 py-2.5">
        <div className="flex flex-wrap gap-1">
          {chips.length ? chips.map((c) => (
            <span key={c} className="text-[10px] font-medium text-ink-muted bg-chrome border border-line rounded-full px-1.5 py-0.5">{c}</span>
          )) : <span className="text-ink-muted text-xs">—</span>}
        </div>
      </td>
    </tr>
  );
}

function Th({ children, onClick, active, dir, num = false }: { children: React.ReactNode; onClick: () => void; active: boolean; dir: "asc" | "desc"; num?: boolean }) {
  return (
    <th className={`px-4 py-2.5 ${num ? "text-right" : "text-left"}`}>
      <button onClick={onClick} className={`t-label font-medium inline-flex items-center gap-1 hover:text-ink transition-colors ${active ? "text-ink" : ""}`}>
        {children}{active && <span aria-hidden>{dir === "desc" ? "↓" : "↑"}</span>}
      </button>
    </th>
  );
}

function LoadingState() {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-surface border border-line rounded-md shadow-card p-4">
            <Skeleton className="h-3 w-32 mb-3" />
            {Array.from({ length: 3 }).map((__, j) => <Skeleton key={j} className="h-4 w-full mb-2" />)}
          </div>
        ))}
      </div>
      <div className="bg-surface border border-line rounded-md shadow-card p-6 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
      </div>
    </>
  );
}
