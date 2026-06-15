"use client";
import { useCallback, useState } from "react";

interface RevenueData {
  total: number;
  attributed: number;
  attributed_from_flows: number;
  attributed_from_campaigns: number;
  order_count: number;
}

interface FlowRow {
  flow_id: string;
  name: string;
  status?: string;
  recipients: number;
  opens: number;
  clicks: number;
  revenue: number;
  revenue_per_recipient: number;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function formatInt(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

function formatPct(num: number, denom: number): string {
  if (denom <= 0) return "—";
  return `${((num / denom) * 100).toFixed(1)}%`;
}

export default function DashboardPage() {
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);

  const [start, setStart] = useState(ymd(thirtyDaysAgo));
  const [end, setEnd] = useState(ymd(today));
  const [revenue, setRevenue] = useState<RevenueData | null>(null);
  const [flows, setFlows] = useState<FlowRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [servedFromCache, setServedFromCache] = useState<string | null>(null);

  const load = useCallback(async (forceFresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/klaviyo/overview?start=${start}&end=${end}${forceFresh ? "&nocache=1" : ""}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Klaviyo fetch failed");
      setRevenue(json.revenue);
      setFlows(json.flows);
      setLoadedAt(new Date().toLocaleTimeString());
      setServedFromCache(json.served_from_cache ? new Date(json.served_from_cache).toLocaleTimeString() : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
      setRevenue(null);
      setFlows(null);
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  const hasData = revenue !== null && flows !== null;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-8 py-8">
        <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
          <div>
            <div className="font-mono text-xs text-slate-500 uppercase tracking-wide mb-1">Klaviyo Dashboard</div>
            <h1 className="text-2xl font-semibold text-slate-900">Performance overview</h1>
          </div>
          <div className="flex items-end gap-3">
            <div>
              <label className="block font-mono text-[10px] text-slate-500 uppercase tracking-wide mb-1">Start</label>
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="border border-slate-300 rounded px-2 py-1.5 text-sm bg-white"
              />
            </div>
            <div>
              <label className="block font-mono text-[10px] text-slate-500 uppercase tracking-wide mb-1">End</label>
              <input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="border border-slate-300 rounded px-2 py-1.5 text-sm bg-white"
              />
            </div>
            <button
              onClick={() => load(false)}
              disabled={loading}
              className="px-4 py-1.5 bg-slate-900 text-white text-sm rounded hover:bg-slate-700 disabled:opacity-50"
            >
              {loading ? "Loading..." : hasData ? "Refresh" : "Load"}
            </button>
            {hasData && (
              <button
                onClick={() => load(true)}
                disabled={loading}
                title="Bypass cache and re-fetch from Klaviyo"
                className="px-3 py-1.5 border border-slate-300 text-slate-700 text-sm rounded hover:bg-slate-50 disabled:opacity-50"
              >
                Force refresh
              </button>
            )}
          </div>
        </div>
        {loadedAt && (
          <div className="text-xs text-slate-400 font-mono mb-4">
            Loaded at {loadedAt}
            {servedFromCache && <span className="ml-2">(cached at {servedFromCache})</span>}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="font-mono text-xs text-red-600 uppercase tracking-wide mb-1">Klaviyo error</div>
            <div className="text-sm text-red-900 font-mono whitespace-pre-wrap break-words">{error}</div>
          </div>
        )}

        {/* Empty state until first load */}
        {!hasData && !loading && !error && (
          <div className="bg-white border border-slate-200 rounded-lg p-10 text-center">
            <div className="font-mono text-xs text-slate-400 uppercase tracking-wide mb-2">No data yet</div>
            <p className="text-slate-600 text-sm">Pick a date range above and click <span className="font-medium">Load</span>.</p>
          </div>
        )}

        {/* Revenue tiles */}
        {hasData && (
          <>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div className="bg-white border border-slate-200 rounded-lg p-6">
            <div className="font-mono text-xs text-slate-500 uppercase tracking-wide mb-2">Total store revenue</div>
            <div className="text-3xl font-semibold text-slate-900">
              {revenue ? formatMoney(revenue.total) : loading ? "…" : "—"}
            </div>
            <div className="text-xs text-slate-500 mt-2">
              {revenue ? `${formatInt(revenue.order_count)} orders` : " "}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-6">
            <div className="font-mono text-xs text-slate-500 uppercase tracking-wide mb-2">Klaviyo-attributed revenue</div>
            <div className="text-3xl font-semibold text-slate-900">
              {revenue ? formatMoney(revenue.attributed) : loading ? "…" : "—"}
            </div>
            <div className="text-xs text-slate-500 mt-2">
              {revenue
                ? `${formatPct(revenue.attributed, revenue.total)} of total · ${formatMoney(revenue.attributed_from_flows)} flows + ${formatMoney(revenue.attributed_from_campaigns)} campaigns`
                : " "}
            </div>
          </div>
        </div>

        {/* Flows table */}
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <div className="font-mono text-xs text-slate-500 uppercase tracking-wide">Flows</div>
              <div className="text-sm text-slate-600 mt-0.5">Performance by flow over the selected range</div>
            </div>
            {flows && <div className="text-xs text-slate-500">{flows.length} flow{flows.length === 1 ? "" : "s"}</div>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-slate-500 font-mono text-[10px] uppercase tracking-wide">
                  <th className="px-4 py-2.5 font-medium">Flow</th>
                  <th className="px-4 py-2.5 font-medium text-right">Recipients</th>
                  <th className="px-4 py-2.5 font-medium text-right">Opens</th>
                  <th className="px-4 py-2.5 font-medium text-right">Clicks</th>
                  <th className="px-4 py-2.5 font-medium text-right">Revenue</th>
                  <th className="px-4 py-2.5 font-medium text-right">Rev / recipient</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {flows && flows.length > 0 ? (
                  flows.map((f) => (
                    <tr key={f.flow_id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <div className="text-slate-900">{f.name}</div>
                        {f.status && <div className="text-[10px] text-slate-400 font-mono uppercase">{f.status}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">{formatInt(f.recipients)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">{formatInt(f.opens)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">{formatInt(f.clicks)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-900 tabular-nums font-medium">{formatMoney(f.revenue)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">
                        {f.recipients > 0 ? `$${f.revenue_per_recipient.toFixed(2)}` : "—"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-sm">
                      {loading ? "Loading…" : flows && flows.length === 0 ? "No flow activity in this range." : "—"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
