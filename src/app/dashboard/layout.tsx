"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { DashboardDataProvider } from "./dashboard-context";
import type { OverviewData } from "./types";
import { overviewFromSnapshot } from "@/lib/overview-from-snapshot";
import type { KlaviyoSnapshot } from "@/lib/klaviyo-slice";
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
/** Matches lib/measure-cache.ts: a snapshot older than a missed daily sync. */
const STALE_AFTER_MS = 36 * 60 * 60_000;

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

  // THE SNAPSHOT, fetched once. Every range is then computed from it in the
  // browser — so changing the date range costs no Klaviyo call, no call to us,
  // and no round trip at all (docs/KLAVIYO_RATE_LIMIT_SPEC.md §3.1, §4). The old
  // code fetched per range, which against Klaviyo's 2-reporting-calls-per-minute
  // quota meant dragging the picker twice was a guaranteed 429.
  const snapshotRef = useRef<KlaviyoSnapshot | null>(null);
  // Set when the chosen range reaches back past what the snapshot holds. The
  // dashboard cannot fetch it itself — that per-range fetching is exactly what
  // caused the throttling — so it offers to extend the snapshot instead.
  const [uncovered, setUncovered] = useState<{ start: string; end: string; days: number } | null>(null);
  const [extending, setExtending] = useState(false);
  const [extendNote, setExtendNote] = useState<string | null>(null);

  /** Slice a range out of the loaded snapshot. Pure, instant, no I/O. */
  const sliceLocal = useCallback((s: string, e: string): OverviewData | null => {
    const snap = snapshotRef.current;
    if (!snap) return null;
    const age = Date.now() - Date.parse(snap.synced_at || "");
    return {
      ...overviewFromSnapshot(snap, s, e),
      fetched_at: snap.synced_at,
      stale: !Number.isFinite(age) || age > STALE_AFTER_MS,
    };
  }, []);

  const showRange = useCallback((s: string, e: string) => {
    const sliced = sliceLocal(s, e);
    if (!sliced) return;
    cacheRef.current.set(rangeKey(s, e), sliced);
    persistCache();
    setData(sliced);
    setError(null);
    setLoading(false);

    // Is the range actually inside the snapshot? If not, say so with an action
    // rather than only a warning: "no data" with no way forward is a dead end.
    const snap = snapshotRef.current;
    const start = snap?.window.start ?? "";
    if (snap && start && s < start) {
      // Depth needed from today back to the requested start, plus a week of
      // margin. Capped at a year: campaign-values rejects a longer timeframe.
      const days = Math.min(365, Math.ceil((Date.parse(`${snap.window.end}T00:00:00Z`) - Date.parse(`${s}T00:00:00Z`)) / 86_400_000) + 7);
      setUncovered({ start: s, end: e, days });
    } else {
      setUncovered(null);
    }
  }, [sliceLocal, persistCache]);

  const loadSnapshot = useCallback(async (s: string, e: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/klaviyo/snapshot");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load Klaviyo data");
      snapshotRef.current = json as KlaviyoSnapshot;
      showRange(s, e);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [showRange]);

  // On mount: one snapshot fetch, then render month-to-date from it.
  useEffect(() => {
    void loadSnapshot(start, end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Picker commit: DateRangePicker emits (start, "") mid-selection and (start,end)
  // when complete — only render once a full range is committed. Local slice: no
  // network, no loading state, no flash of empty rows.
  const onRangeChange = useCallback((s: string, e: string) => {
    setStart(s);
    setEnd(e);
    if (s && e) showRange(s, e);
  }, [showRange]);

  // Refresh re-reads the snapshot. It does NOT force a Klaviyo pull — that is the
  // sync's job, on its own schedule, and doing it from a page load is exactly the
  // pattern that caused the throttling.
  const refresh = () => void loadSnapshot(start, end);

  /**
   * Extend the snapshot back far enough to cover the chosen range.
   *
   * Kicks off the sync and polls until the range is covered. The sync paces its
   * Klaviyo calls 31 seconds apart to stay inside the 2-per-minute reporting
   * quota, so this takes minutes for a deep window — which is why it reports
   * progress instead of pretending to be instant.
   */
  const extendSnapshot = useCallback(async () => {
    if (!uncovered) return;
    setExtending(true);
    setExtendNote("Starting — Klaviyo's reporting quota is 2 calls a minute, so this takes a few minutes.");
    try {
      const res = await fetch(`/api/klaviyo/sync?mode=full&days=${uncovered.days}`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Sync failed (HTTP ${res.status})`);

      // Poll for coverage. The sync chains itself across invocations, so the
      // snapshot grows in steps; stop as soon as the range the user asked for is in.
      const deadline = Date.now() + 15 * 60_000;
      for (let tick = 1; Date.now() < deadline; tick++) {
        await new Promise((r) => setTimeout(r, 15_000));
        const snapRes = await fetch("/api/klaviyo/snapshot");
        if (!snapRes.ok) continue;
        const snap = (await snapRes.json()) as KlaviyoSnapshot;
        snapshotRef.current = snap;
        cacheRef.current.clear();          // every cached range predates the new data
        if (snap.window.start <= uncovered.start) {
          setExtendNote(null);
          setUncovered(null);
          showRange(uncovered.start, uncovered.end);
          return;
        }
        setExtendNote(`Loading… the snapshot now reaches back to ${snap.window.start}; need ${uncovered.start}. (${tick * 15}s)`);
      }
      setExtendNote("Still loading in the background. Give it another minute and hit Refresh.");
    } catch (err) {
      setExtendNote(err instanceof Error ? err.message : "Could not extend the loaded window.");
    } finally {
      setExtending(false);
    }
  }, [uncovered, showRange]);

  const hasData = data !== null;
  const revenue = data?.revenue ?? null;
  const warnings = data?.warnings ?? [];
  const showLoading = loading && !hasData;

  return (
    <div className="rc-content-panel flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-8 py-8">
        <PageHeader
          className="mb-6"
          eyebrow="Dashboard"
          title="Performance"
          accent="overview"
          description="Placed-order and Klaviyo-attributed email revenue. Synced on a schedule; every range is computed from the same stored data."
          meta={
            <>
              {hasData && (
                <div className={`self-end pb-1.5 text-xs flex items-center gap-1.5 ${data?.stale ? "text-warning-600" : "text-ink-muted"}`}
                  title={data?.fetched_at ? `Fetched ${new Date(data.fetched_at).toLocaleString()}` : undefined}>
                  <span className={`w-1.5 h-1.5 rounded-full ${data?.stale ? "bg-warning-600" : "bg-success-600"}`} aria-hidden />
                  {data?.stale
                    ? <>Last sync {fetchedLabel(data?.fetched_at)} — overdue, figures may be behind</>
                    : <>Synced {fetchedLabel(data?.fetched_at)}</>}
                </div>
              )}
              <DateRangePicker start={start} end={end} onChange={onRangeChange} />
              <Button variant="secondary" size="sm" loading={loading} onClick={refresh}
                title="Re-read the latest synced Klaviyo data. The sync itself runs on a schedule — this doesn't call Klaviyo.">
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

        {/* An uncovered range is an ACTION, not just a note. The dashboard reads a
            stored snapshot rather than calling Klaviyo per range (that was the
            cause of the 429s), so reaching further back means extending the
            snapshot — and the user needs a button for that, not an explanation. */}
        {uncovered && (
          <div className="bg-accent-50 border border-accent-200 rounded-md p-4 mb-6 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="t-label text-accent mb-1">This range reaches further back than the loaded data</div>
              <div className="text-sm text-ink-secondary">
                Klaviyo data is loaded up to {snapshotRef.current?.window.start ?? "—"}; you asked for {uncovered.start}.
                {extendNote ? <> {extendNote}</> : <> Loading it pulls roughly {Math.ceil(uncovered.days / 60) * 4 + 1} Klaviyo calls, paced to stay under the rate limit.</>}
              </div>
            </div>
            <Button variant="primary" size="sm" loading={extending} onClick={() => void extendSnapshot()}>
              {extending ? "Loading…" : "Load this range"}
            </Button>
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
