"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OverviewData } from "@/app/dashboard/types";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Skeleton from "@/components/ui/Skeleton";

// On-demand "Brief me on this range" (spec: DASHBOARD_BRIEFING_SPEC §7). An
// interpretation layer over the range already on screen: one click POSTs the
// current OverviewData to /api/dashboard/briefing, which computes a deterministic
// fact pack and has FAST_MODEL narrate it. Cached per range in this session so
// re-opening a range is instant and free. Never auto-fires.

interface BriefingResult {
  headline: string;
  summary: string;
  callouts: string[];
  comparison_available: boolean;
  low_data: boolean;
  warnings: string[];
  prior_range: { start: string; end: string } | null;
}
type Entry = { result: BriefingResult; fetched_at: string };

const CACHE_KEY = "rc-briefing-cache-v1";
const MAX_CACHED = 20;

function SparkIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2" />
    </svg>
  );
}
function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function DashboardBriefing({ current, range }: { current: OverviewData; range: { start: string; end: string } }) {
  const key = `${range.start}..${range.end}`;
  const cacheRef = useRef<Map<string, Entry>>(new Map());
  const [entry, setEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate this session's cached briefings once.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, Entry>;
        for (const [k, v] of Object.entries(obj)) cacheRef.current.set(k, v);
      }
    } catch { /* ignore */ }
    // Show a cached briefing for the initial range if present.
    setEntry(cacheRef.current.get(key) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On range change, show that range's cached briefing (or nothing — a new range
  // requires a fresh "Brief me").
  useEffect(() => {
    setEntry(cacheRef.current.get(key) ?? null);
    setError(null);
  }, [key]);

  const persist = useCallback(() => {
    const map = cacheRef.current;
    while (map.size > MAX_CACHED) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(map))); } catch { /* ignore */ }
  }, []);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ range, current, channel: "all" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Couldn't generate the briefing");
      const next: Entry = { result: json as BriefingResult, fetched_at: new Date().toISOString() };
      cacheRef.current.set(key, next);
      persist();
      setEntry(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate the briefing");
    } finally {
      setLoading(false);
    }
  }, [range, current, key, persist]);

  const result = entry?.result;

  return (
    <Card className="mb-4" bodyClassName="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-accent shrink-0"><SparkIcon /></span>
          <div className="t-label text-ink-secondary">Range briefing</div>
        </div>
        {result ? (
          <Button variant="ghost" size="sm" loading={loading} onClick={run} title="Generate a fresh briefing">Regenerate</Button>
        ) : !loading ? (
          <Button variant="secondary" size="sm" onClick={run}>
            <SparkIcon className="mr-1.5" /> Brief me on this range
          </Button>
        ) : null}
      </div>

      {loading && !result && (
        <div className="mt-4 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      )}

      {error && !loading && (
        <div className="mt-3 text-sm text-danger-600">{error} <button onClick={run} className="underline hover:no-underline">Retry</button></div>
      )}

      {result && (
        <div className="mt-4">
          <div className="text-base font-semibold text-ink leading-snug">{result.headline}</div>
          <p className="text-sm text-ink-secondary mt-1.5 leading-relaxed">{result.summary}</p>
          {result.callouts.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {result.callouts.map((c, i) => (
                <li key={i} className="text-sm text-ink-secondary flex gap-2">
                  <span aria-hidden className="text-accent mt-0.5 shrink-0">›</span><span>{c}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted">
            <span>Interpretation of live data · briefed {entry ? timeLabel(entry.fetched_at) : ""}</span>
            {!result.comparison_available && <span className="text-warning-600">prior-period comparison unavailable</span>}
            {result.low_data && <span className="text-warning-600">few sends — directional</span>}
            {result.warnings.length > 0 && <span className="text-warning-600">numbers may be slightly incomplete</span>}
          </div>
        </div>
      )}
    </Card>
  );
}
