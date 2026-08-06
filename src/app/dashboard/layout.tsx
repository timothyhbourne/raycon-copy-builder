"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { DashboardDataProvider } from "./dashboard-context";
import type { OverviewData } from "./types";
import { ymd, formatMoney, formatInt } from "./format";
import Button from "@/components/ui/Button";
import Skeleton from "@/components/ui/Skeleton";
import Card from "@/components/ui/Card";
import PageHeader from "@/components/ui/PageHeader";
import { StatCell } from "@/components/ui/Stat";
import DateRangePicker from "@/components/ui/DateRangePicker";
import DashboardBriefing from "@/components/DashboardBriefing";

// Live-on-demand measurement (spec: MEASUREMENT_LIVE_FETCH_SPEC.md). The layout
// owns the range + a per-SESSION cache and fetches each range live from
// /api/klaviyo/measure. No background sync, no polling, no coverage/partial data:
// a range shows either complete live data, the loading state, or a clear error.
// The session cache makes repeat views of a range instant; a never-seen range is
// the only slow path, and the loading UX sets that expectation.

const CACHE_KEY = "rc-measure-cache-v1";
const MAX_CACHED_RANGES = 20;

function monthToDateStart(): string {
  const d = new Date();
  return ymd(new Date(d.getFullYear(), d.getMonth(), 1));
}
function rangeKey(s: string, e: string): string {
  return `${s}..${e}`;
}
function fetchedLabel(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
  const [start, setStart] = useState<string>(monthToDateStart());
  const [end, setEnd] = useState<string>(() => ymd(new Date()));
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-session cache: range key → fully-fetched OverviewData (with fetched_at).
  // Client-side only, NOT a server store and NOT localStorage.
  const cacheRef = useRef<Map<string, OverviewData>>(new Map());

  const persistCache = useCallback(() => {
    const map = cacheRef.current;
    while (map.size > MAX_CACHED_RANGES) {
      const oldest = map.keys().next().value; // Map preserves insertion order
      if (oldest === undefined) break;
      map.delete(oldest);
    }
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(map)));
    } catch {
      /* sessionStorage unavailable / full — the in-memory cache still works */
    }
  }, []);

  const loadRange = useCallback(async (s: string, e: string, opts?: { force?: boolean }) => {
    const key = rangeKey(s, e);
    if (!opts?.force && cacheRef.current.has(key)) {
      // Cache hit → render instantly, no loading state, no network call.
      setData(cacheRef.current.get(key)!);
      setError(null);
      setLoading(false);
      return;
    }
    // Miss (or forced): clear the screen so we never show stale rows, then fetch.
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/klaviyo/measure?start=${s}&end=${e}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load this range");
      // Prefer the SERVER's fetched_at (the shared cache's real fetch time) so
      // staleness is honest; only stamp client time if the server omitted it.
      const j = json as OverviewData;
      const stamped: OverviewData = { ...j, fetched_at: j.fetched_at ?? new Date().toISOString() };
      cacheRef.current.set(key, stamped);
      persistCache();
      setData(stamped);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [persistCache]);

  // On mount: hydrate any warm ranges from this session, then load month-to-date.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, OverviewData>;
        for (const [k, v] of Object.entries(obj)) cacheRef.current.set(k, v);
      }
    } catch { /* ignore malformed / unavailable cache */ }
    void loadRange(start, end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Picker commit: DateRangePicker emits (start, "") mid-selection and (start,end)
  // when complete — only fetch once a full range is committed.
  const onRangeChange = useCallback((s: string, e: string) => {
    setStart(s);
    setEnd(e);
    if (s && e) void loadRange(s, e);
  }, [loadRange]);

  const refresh = () => void loadRange(start, end, { force: true });

  const hasData = data !== null;
  const revenue = data?.revenue ?? null;
  const warnings = data?.warnings ?? [];
  const showLoading = loading && !hasData;

  return (
    <div className="flex-1 overflow-y-auto bg-surface">
      <div className="max-w-6xl mx-auto px-8 py-8">
        <PageHeader
          className="mb-6"
          eyebrow="Dashboard"
          title="Performance"
          accent="overview"
          description="Placed-order and Klaviyo-attributed email revenue, fetched live for the selected range."
          meta={
            <>
              {hasData && (
                <div className={`self-end pb-1.5 text-xs flex items-center gap-1.5 ${data?.stale ? "text-warning-600" : "text-ink-muted"}`}
                  title={data?.fetched_at ? `Fetched ${new Date(data.fetched_at).toLocaleString()}` : undefined}>
                  <span className={`w-1.5 h-1.5 rounded-full ${data?.stale ? "bg-warning-600" : "bg-success-600"}`} aria-hidden />
                  {data?.stale
                    ? <>Last known figures · as of {fetchedLabel(data?.fetched_at)} (Klaviyo rate-limited)</>
                    : <>Live data · fetched {fetchedLabel(data?.fetched_at)}</>}
                </div>
              )}
              <DateRangePicker start={start} end={end} onChange={onRangeChange} />
              <Button variant="secondary" size="sm" loading={loading} onClick={refresh}
                title="Re-fetch this range live from Klaviyo">
                <RefreshIcon className={`mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </>
          }
        />

        {error && (
          <div className="bg-danger-50 border border-danger-200 rounded-md p-4 mb-6 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="t-label text-danger-600 mb-1">Couldn&apos;t load this range</div>
              <div className="text-sm text-danger-600 whitespace-pre-wrap break-words">{error}</div>
            </div>
            <Button variant="secondary" size="sm" loading={loading} onClick={refresh}>Retry</Button>
          </div>
        )}

        {hasData && warnings.length > 0 && (
          <div className="bg-warning-50 border border-warning-200 rounded-md p-4 mb-6">
            <div className="t-label text-warning-600 mb-1">Notes</div>
            <ul className="text-sm text-ink-secondary list-disc pl-5 space-y-0.5">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}

        {/* Loading state: clear the content and show an engaging, explicit
            live-fetch panel over skeletons (a fresh range can take a few seconds). */}
        {showLoading ? (
          <>
            <MeasureLoading />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {[0, 1].map((i) => (
                <div key={i} className="bg-surface border border-line rounded-md shadow-card p-6">
                  <Skeleton className="h-3 w-40 mb-3" />
                  <Skeleton className="h-9 w-32 mb-3" />
                  <Skeleton className="h-3 w-48" />
                </div>
              ))}
            </div>
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
          </>
        ) : hasData && revenue ? (
          <>
            {/* On-demand plain-English readout of the range on screen. */}
            {data && <DashboardBriefing current={data} range={{ start, end }} />}

            {/* Placed-order revenue is NOT channel-split in the Klaviyo payload, so
                it lives here as ONE channel-neutral figure (all email, flows +
                campaigns). The channel-specific attributed revenue is rendered per
                page so the two tabs never show the same number. */}
            <Card className="mb-6" bodyClassName="p-6">
              <StatCell
                label="Placed-order revenue · all email (both channels)"
                value={formatMoney(revenue.total)}
                description={<>{formatInt(revenue.order_count)} orders · Klaviyo &ldquo;Placed Order&rdquo; (Shopify) · flows + campaigns combined, account timezone</>}
              />
            </Card>
            <DashboardDataProvider value={{ data, loading, error }}>
              {children}
            </DashboardDataProvider>
          </>
        ) : null}
      </div>
    </div>
  );
}

// Engaging, explicit loading panel for a genuine cache miss. Cycles a few status
// lines and runs an indeterminate bar so a multi-second live pull reads as
// "working", not "stuck", and states plainly that a fresh range takes a moment.
const LOADING_MESSAGES = [
  "Pulling this range live from Klaviyo…",
  "Adding up every campaign and flow…",
  "Fetching complete numbers — not partial ones…",
  "Almost there — caching this so it's instant next time…",
];
function MeasureLoading() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % LOADING_MESSAGES.length), 2200);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="mb-6 rounded-md border border-accent-200 bg-accent-50/50 p-5">
      <div className="flex items-center gap-3">
        <span className="relative flex h-6 w-6 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full rounded-full bg-accent-200 opacity-60 animate-ping" />
          <span className="relative inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface text-accent">
            <RefreshIcon className="animate-spin" />
          </span>
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink transition-opacity" aria-live="polite">{LOADING_MESSAGES[i]}</div>
          <div className="text-xs text-ink-secondary mt-0.5">
            A range you haven&apos;t viewed can take <strong>a few seconds</strong> — Klaviyo rate-limits analytics, so we pull it once and cache it for everyone. Hang tight.
          </div>
        </div>
      </div>
      <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-accent-200/50">
        <div className="h-full w-1/3 rounded-full bg-accent rc-indeterminate" />
      </div>
    </div>
  );
}
