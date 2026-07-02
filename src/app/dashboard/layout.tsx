"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DashboardDataProvider } from "./dashboard-context";
import type { OverviewData } from "./types";
import { ymd, formatMoney, formatInt, formatPct } from "./format";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);

  const [start, setStart] = useState(ymd(thirtyDaysAgo));
  const [end, setEnd] = useState(ymd(today));
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [servedFromCache, setServedFromCache] = useState<string | null>(null);

  const pathname = usePathname();
  const isPlanner = pathname === "/dashboard/planner";

  const load = useCallback(async (forceFresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/klaviyo/overview?start=${start}&end=${end}${forceFresh ? "&nocache=1" : ""}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Klaviyo fetch failed");
      setData(json as OverviewData);
      setLoadedAt(new Date().toLocaleTimeString());
      setServedFromCache(json.served_from_cache ? new Date(json.served_from_cache).toLocaleTimeString() : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  const hasData = data !== null;
  const revenue = data?.revenue ?? null;
  const warnings = data?.warnings ?? [];

  const tabs = [
    { href: "/dashboard/flows", label: "Flows" },
    { href: "/dashboard/campaigns", label: "Campaigns" },
    { href: "/dashboard/planner", label: "Planner" },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-8 py-8">
        {/* Header: title + (Klaviyo controls only on the performance tabs) */}
        <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
          <div>
            <div className="font-mono text-xs text-slate-500 uppercase tracking-wide mb-1">Dashboard</div>
            <h1 className="text-2xl font-semibold text-slate-900">
              {isPlanner ? "Campaign planner" : "Performance overview"}
            </h1>
          </div>
          {!isPlanner && (
            <div className="flex items-end gap-3">
              <div>
                <label className="block font-mono text-[10px] text-slate-500 uppercase tracking-wide mb-1">Start</label>
                <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm bg-white" />
              </div>
              <div>
                <label className="block font-mono text-[10px] text-slate-500 uppercase tracking-wide mb-1">End</label>
                <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm bg-white" />
              </div>
              <button onClick={() => load(false)} disabled={loading}
                className="px-4 py-1.5 bg-slate-900 text-white text-sm rounded hover:bg-slate-700 disabled:opacity-50">
                {loading ? "Loading..." : hasData ? "Refresh" : "Load"}
              </button>
              {hasData && (
                <button onClick={() => load(true)} disabled={loading}
                  title="Bypass cache and re-fetch from Klaviyo"
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 text-sm rounded hover:bg-slate-50 disabled:opacity-50">
                  Force refresh
                </button>
              )}
            </div>
          )}
        </div>

        {/* Tab toggle — always visible so the Planner is reachable without a Klaviyo load */}
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 mb-6">
          {tabs.map((t) => {
            const active = pathname === t.href;
            return (
              <Link key={t.href} href={t.href}
                className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors ${
                  active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
                }`}>
                {t.label}
              </Link>
            );
          })}
        </div>

        {isPlanner ? (
          // Planner is self-contained (its own data + controls).
          children
        ) : (
          <>
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

            {hasData && warnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
                <div className="font-mono text-xs text-amber-700 uppercase tracking-wide mb-1">Sync warnings</div>
                <ul className="text-sm text-amber-900 list-disc pl-5 space-y-0.5">
                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}

            {hasData && revenue && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                  <div className="bg-white border border-slate-200 rounded-lg p-6">
                    <div className="font-mono text-xs text-slate-500 uppercase tracking-wide mb-2">Placed-order revenue (Klaviyo)</div>
                    <div className="text-3xl font-semibold text-slate-900">{formatMoney(revenue.total)}</div>
                    <div className="text-xs text-slate-500 mt-2">
                      {formatInt(revenue.order_count)} orders · source: Klaviyo &ldquo;Placed Order&rdquo; (Shopify)
                    </div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-lg p-6">
                    <div className="font-mono text-xs text-slate-500 uppercase tracking-wide mb-2">Klaviyo-attributed revenue</div>
                    <div className="text-3xl font-semibold text-slate-900">{formatMoney(revenue.attributed)}</div>
                    <div className="text-xs text-slate-500 mt-2">
                      {formatPct(revenue.attributed, revenue.total)} of placed-order revenue
                    </div>
                  </div>
                </div>
                <div className="text-xs text-slate-500 font-mono mb-6 px-1">
                  Attributed = {formatMoney(revenue.attributed_from_flows)} flows + {formatMoney(revenue.attributed_from_campaigns)} campaigns
                  {" = "}{formatMoney(revenue.attributed_from_flows + revenue.attributed_from_campaigns)}
                  {" · "}{formatPct(revenue.attributed, revenue.total)} of total
                  {" · email-only, account timezone"}
                </div>
              </>
            )}

            {!hasData && !loading && !error && (
              <div className="bg-white border border-slate-200 rounded-lg p-10 text-center">
                <div className="font-mono text-xs text-slate-400 uppercase tracking-wide mb-2">No data yet</div>
                <p className="text-slate-600 text-sm">Pick a date range above and click <span className="font-medium">Load</span>.</p>
              </div>
            )}

            {hasData && (
              <DashboardDataProvider value={{ data, loading, error }}>
                {children}
              </DashboardDataProvider>
            )}
          </>
        )}
      </div>
    </div>
  );
}
