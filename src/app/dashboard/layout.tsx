"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DashboardDataProvider } from "./dashboard-context";
import type { OverviewData } from "./types";
import { ymd, formatMoney, formatInt, formatPct } from "./format";
import Button from "@/components/ui/Button";
import Skeleton from "@/components/ui/Skeleton";

type Preset = "7d" | "30d" | "90d" | "custom";

// Range presets set the window and load immediately; "Custom" reveals the two
// date inputs instead. Default is 30d, which also drives the mount auto-load.
const PRESETS: { key: Preset; label: string; days: number | null }[] = [
  { key: "7d", label: "7d", days: 7 },
  { key: "30d", label: "30d", days: 30 },
  { key: "90d", label: "90d", days: 90 },
  { key: "custom", label: "Custom", days: null },
];

function daysAgo(n: number): string {
  const t = new Date();
  t.setDate(t.getDate() - n);
  return ymd(t);
}

function RefreshIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
    </svg>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [start, setStart] = useState(() => daysAgo(30));
  const [end, setEnd] = useState(() => ymd(new Date()));
  const [preset, setPreset] = useState<Preset>("30d");
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [servedFromCache, setServedFromCache] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false); // background stale-while-revalidate in flight

  const pathname = usePathname();

  // Load accepts explicit start/end so presets can fetch the new range in the
  // same tick without waiting for the setState to flush.
  const load = useCallback(async (forceFresh = false, s = start, e = end) => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/klaviyo/overview?start=${s}&end=${e}${forceFresh ? "&nocache=1" : ""}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Klaviyo fetch failed");
      setData(json as OverviewData);
      setLoadedAt(new Date().toLocaleTimeString());
      setServedFromCache(json.served_from_cache ? new Date(json.served_from_cache).toLocaleTimeString() : null);
      // Stale-while-revalidate: an expired cache hit paints immediately, then we
      // pull fresh data in the background (no spinner) and swap it in.
      if (!forceFresh && json.stale) {
        setRefreshing(true);
        fetch(`/api/klaviyo/overview?start=${s}&end=${e}&nocache=1`)
          .then((r) => r.json())
          .then((fresh) => {
            if (fresh && !fresh.error) {
              setData(fresh as OverviewData);
              setLoadedAt(new Date().toLocaleTimeString());
              setServedFromCache(null);
            }
          })
          .catch(() => { /* keep the stale copy on failure */ })
          .finally(() => setRefreshing(false));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  // Auto-load once on mount with the default 30-day range — no empty "click
  // Load" state. Intentionally runs a single time.
  useEffect(() => { load(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const applyPreset = (p: Preset, days: number | null) => {
    setPreset(p);
    if (days === null) return; // Custom just reveals the inputs
    const s = daysAgo(days);
    const e = ymd(new Date());
    setStart(s);
    setEnd(e);
    load(false, s, e);
  };

  const hasData = data !== null;
  const revenue = data?.revenue ?? null;
  const warnings = data?.warnings ?? [];
  const firstLoad = loading && !hasData;

  const tabs = [
    { href: "/dashboard/flows", label: "Flows" },
    { href: "/dashboard/campaigns", label: "Campaigns" },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-8 py-8">
        {/* Header: title + range presets / custom inputs + refresh controls */}
        <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
          <div>
            <div className="font-mono text-xs text-ink-muted uppercase tracking-wide mb-1">Dashboard</div>
            <h1 className="text-2xl font-semibold text-ink">Performance overview</h1>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
              {PRESETS.map((p) => (
                <button key={p.key} onClick={() => applyPreset(p.key, p.days)}
                  className={`px-3 py-1.5 text-sm rounded-[6px] font-medium transition-colors duration-150 ease-out-soft ${
                    preset === p.key ? "bg-ink text-white" : "text-ink-secondary hover:bg-chrome"
                  }`}>
                  {p.label}
                </button>
              ))}
            </div>
            {preset === "custom" && (
              <>
                <div>
                  <label className="block font-mono text-[10px] text-ink-muted uppercase tracking-wide mb-1">Start</label>
                  <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
                    className="border border-line rounded-sm px-2 py-1.5 text-sm bg-surface focus:outline-none focus:border-accent transition-colors" />
                </div>
                <div>
                  <label className="block font-mono text-[10px] text-ink-muted uppercase tracking-wide mb-1">End</label>
                  <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
                    className="border border-line rounded-sm px-2 py-1.5 text-sm bg-surface focus:outline-none focus:border-accent transition-colors" />
                </div>
                <Button variant="secondary" size="sm" loading={loading} onClick={() => load(false)}>Load</Button>
              </>
            )}
            {preset !== "custom" && (
              <Button variant="secondary" size="sm" loading={loading} onClick={() => load(false)}>Refresh</Button>
            )}
            <Button variant="ghost" size="sm" disabled={loading} onClick={() => load(true)}
              title="Bypass cache and re-fetch from Klaviyo" aria-label="Force refresh from Klaviyo">
              <RefreshIcon />
            </Button>
          </div>
        </div>

        {error && (
          <div className="bg-danger-50 border border-danger-200 rounded-md p-4 mb-6">
            <div className="font-mono text-xs text-danger-600 uppercase tracking-wide mb-1">Klaviyo error</div>
            <div className="text-sm text-danger-600 font-mono whitespace-pre-wrap break-words">{error}</div>
          </div>
        )}

        {hasData && warnings.length > 0 && (
          <div className="bg-warning-50 border border-warning-200 rounded-md p-4 mb-6">
            <div className="font-mono text-xs text-warning-600 uppercase tracking-wide mb-1">Sync warnings</div>
            <ul className="text-sm text-ink-secondary list-disc pl-5 space-y-0.5">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}

        {/* Revenue tiles — skeletons on first load, real values once fetched */}
        {firstLoad ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {[0, 1].map((i) => (
              <div key={i} className="bg-surface border border-line rounded-md shadow-card p-6">
                <Skeleton className="h-3 w-40 mb-3" />
                <Skeleton className="h-9 w-32 mb-3" />
                <Skeleton className="h-3 w-48" />
              </div>
            ))}
          </div>
        ) : hasData && revenue ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
              <div className="bg-surface border border-line rounded-md shadow-card p-6">
                <div className="font-mono text-xs text-ink-muted uppercase tracking-wide mb-2">Placed-order revenue (Klaviyo)</div>
                <div className="text-3xl font-semibold text-ink">{formatMoney(revenue.total)}</div>
                <div className="text-sm text-ink-secondary mt-2">
                  {formatInt(revenue.order_count)} orders · source: Klaviyo &ldquo;Placed Order&rdquo; (Shopify)
                </div>
              </div>
              <div className="bg-surface border border-line rounded-md shadow-card p-6">
                <div className="font-mono text-xs text-ink-muted uppercase tracking-wide mb-2">Klaviyo-attributed revenue</div>
                <div className="text-3xl font-semibold text-ink">{formatMoney(revenue.attributed)}</div>
                <div className="text-sm text-ink-secondary mt-2">
                  {formatPct(revenue.attributed, revenue.total)} of placed-order revenue
                </div>
              </div>
            </div>
            <div className="text-xs text-ink-muted font-mono mb-6 px-1">
              Attributed = {formatMoney(revenue.attributed_from_flows)} flows + {formatMoney(revenue.attributed_from_campaigns)} campaigns
              {" = "}{formatMoney(revenue.attributed_from_flows + revenue.attributed_from_campaigns)}
              {" · "}{formatPct(revenue.attributed, revenue.total)} of total
              {" · email-only, account timezone"}
            </div>
          </>
        ) : null}

        {/* Tabs (underline) + loaded-at line */}
        <div className="flex items-end justify-between border-b border-line mb-6">
          <div className="flex items-center gap-6">
            {tabs.map((t) => {
              const active = pathname === t.href;
              return (
                <Link key={t.href} href={t.href}
                  className={`relative pb-2.5 text-sm font-medium transition-colors ${
                    active ? "text-ink" : "text-ink-muted hover:text-ink-secondary"
                  }`}>
                  {t.label}
                  {active && <span aria-hidden className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-accent" />}
                </Link>
              );
            })}
          </div>
          {loadedAt && (
            <div className="pb-2.5 text-xs text-ink-muted font-mono flex items-center gap-1.5">
              <RefreshIcon className={`opacity-60 ${refreshing ? "animate-spin" : ""}`} />
              Loaded {loadedAt}
              {servedFromCache && <span>· cached {servedFromCache}</span>}
              {refreshing && <span className="text-accent">· refreshing…</span>}
            </div>
          )}
        </div>

        {/* Content: skeleton table on first load, otherwise the active tab */}
        {firstLoad ? (
          <div className="bg-surface border border-line rounded-md shadow-card overflow-hidden">
            <div className="px-6 py-4 border-b border-line">
              <Skeleton className="h-3 w-24 mb-2" />
              <Skeleton className="h-3 w-48" />
            </div>
            <div className="divide-y divide-line">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="px-6 py-3 flex items-center justify-between gap-6">
                  <Skeleton className="h-4 w-1/3" />
                  <div className="flex gap-6">
                    <Skeleton className="h-4 w-12" /><Skeleton className="h-4 w-12" />
                    <Skeleton className="h-4 w-16" /><Skeleton className="h-4 w-16" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : hasData ? (
          <DashboardDataProvider value={{ data, loading, error }}>
            {children}
          </DashboardDataProvider>
        ) : null}
      </div>
    </div>
  );
}
