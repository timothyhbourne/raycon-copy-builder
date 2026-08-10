"use client";
import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Skeleton from "@/components/ui/Skeleton";
import { StatCell } from "@/components/ui/Stat";
import { SegmentedToggle } from "@/components/ui/FilterBar";
import { toast } from "@/components/ui/Toast";
import type { LifecycleSnapshot, LifecycleCohort } from "@/lib/lifecycle/snapshot";

// The lifecycle screen (see lifecycle_inapp_build_brief.md). Reads a precomputed
// snapshot instantly (/api/lifecycle/snapshot, seed-backed) and shows two tabs:
// "Send Today" (ranked cohorts, each with a one-click activation) and "Overview"
// (audience distribution + key segments + next-best-product). "Sync now" recomputes
// the snapshot from the per-customer store, mirroring the dashboard's sync pattern.

type Tab = "send" | "overview";

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const int = (n: number) => n.toLocaleString();

function RefreshIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
    </svg>
  );
}

// Relative freshness from generated_at; stale (amber) once older than a day
// (the snapshot refreshes daily).
function relSync(iso?: string | null): { label: string; stale: boolean } {
  if (!iso) return { label: "never", stale: true };
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  const stale = mins > 1440;
  const label = mins < 1 ? "just now"
    : mins < 60 ? `${mins}m ago`
    : mins < 1440 ? `${Math.floor(mins / 60)}h ago`
    : `${Math.floor(mins / 1440)}d ago`;
  return { label, stale };
}

function CohortCard({ cohort, membersReady }: { cohort: LifecycleCohort; membersReady: boolean }) {
  const [busy, setBusy] = useState(false);
  const disabledHint = membersReady ? undefined : "Available after the daily sync populates members";

  const exportCsv = () => {
    if (!membersReady) return;
    window.location.href = `/api/lifecycle/cohort/${cohort.id}/export`;
  };
  const createList = async () => {
    if (!membersReady) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/lifecycle/cohort/${cohort.id}/create-list`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Create-list failed");
      toast.success(j.note || `Created list “${j.list_name}”`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create-list failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card bodyClassName="p-0">
      <div className="flex flex-col md:flex-row md:items-stretch">
        <div className="flex-1 min-w-0 p-5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cohort.color }} aria-hidden />
            <span className="t-heading text-ink" style={{ color: cohort.color }}>{cohort.title}</span>
          </div>
          <p className="text-sm text-ink-secondary mt-1.5 max-w-2xl">{cohort.why}</p>

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {cohort.pills.map((p) => (
              <span key={p} className="inline-flex items-center rounded-sm bg-sunken px-1.5 py-0.5 text-[11px] font-medium capitalize text-ink-secondary">{p}</span>
            ))}
          </div>

          <div className="mt-3 rounded-md border border-dashed border-line-strong bg-chrome/30 px-3.5 py-3 text-sm">
            <div className="text-ink">{cohort.recommendation.message}</div>
            <div className="text-ink-secondary mt-1"><span className="t-label text-ink-muted">Suggested offer:</span> {cohort.recommendation.offer}</div>
          </div>

          <div className="mt-3 flex items-center gap-2" title={disabledHint}>
            <Button size="sm" variant="primary" loading={busy} disabled={!membersReady} onClick={createList}>Create Klaviyo list</Button>
            <Button size="sm" variant="secondary" disabled={!membersReady} onClick={exportCsv}>Export CSV</Button>
            {!membersReady && <span className="text-[11px] text-ink-muted">available after sync populates members</span>}
          </div>
        </div>

        <div className="md:w-60 shrink-0 border-t md:border-t-0 md:border-l border-line bg-chrome/30 p-5 flex flex-row md:flex-col gap-5 justify-between">
          <StatCell label="Modeled monthly opportunity" value={money(cohort.modeled_revenue)} description={`${(cohort.assumed_response * 100).toFixed(1)}% assumed response · $${cohort.aov} AOV`} />
          <StatCell label="Customers" value={int(cohort.size)} />
        </div>
      </div>
    </Card>
  );
}

function DistributionBar({ snapshot }: { snapshot: LifecycleSnapshot }) {
  const bands = snapshot.overview.bands;
  return (
    <Card title="Audience by purchase recency" subtitle={`${int(snapshot.total_audience)} customers · 24 months of Shopify orders`}>
      <div className="flex w-full h-8 rounded-md overflow-hidden border border-line" role="img" aria-label="Audience distribution by recency band">
        {bands.map((b) => (
          <div key={b.key} style={{ width: `${b.pct}%`, background: b.color }} title={`${b.label}: ${int(b.count)} (${b.pct}%)`} className="min-w-[2px]" />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {bands.map((b) => (
          <div key={b.key} className="flex items-start gap-2">
            <span className="w-2.5 h-2.5 rounded-sm mt-1 shrink-0" style={{ background: b.color }} aria-hidden />
            <div className="min-w-0">
              <div className="text-sm font-medium text-ink tabular-nums">{int(b.count)} <span className="text-ink-muted font-normal">· {b.pct}%</span></div>
              <div className="text-[11px] text-ink-secondary leading-tight">{b.label}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function NextBestProduct({ snapshot }: { snapshot: LifecycleSnapshot }) {
  const insight = snapshot.insight_next_best_product;
  const max = Math.max(...insight.items.map((i) => i.pct), 1);
  return (
    <Card
      title="Next best product"
      subtitle={`${insight.return_rate_pct}% of buyers return — and this is what they buy next`}
    >
      <div className="flex flex-col gap-2">
        {insight.items.map((it, i) => {
          const isTop = i === 0;
          return (
            <div key={it.label} className="flex items-center gap-3">
              <div className={`w-32 shrink-0 text-sm ${isTop ? "font-semibold text-ink" : "text-ink-secondary"}`}>{it.label}</div>
              <div className="flex-1 h-5 rounded-sm bg-chrome overflow-hidden">
                <div className="h-full rounded-sm" style={{ width: `${(it.pct / max) * 100}%`, background: isTop ? "#16a34a" : "#c7cdd6" }} />
              </div>
              <div className="w-12 text-right text-sm tabular-nums text-ink-secondary">{it.pct}%</div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-ink-muted mt-4">
        Earbuds-first buyers overwhelmingly rebuy earbuds — the reason the engine is <span className="text-ink-secondary font-medium">replenishment-first</span>, cross-sell second.
      </p>
    </Card>
  );
}

export default function LifecyclePage() {
  const [snapshot, setSnapshot] = useState<LifecycleSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>("send");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/lifecycle/snapshot");
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Load failed");
      setSnapshot(j as LifecycleSnapshot);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const syncNow = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/lifecycle/sync", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Sync failed");
      if (j.recomputed) toast.success(`Recomputed ${int(j.total_audience)} customers`);
      else toast.info(j.note || "Nothing to recompute yet — showing seed figures");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
      await load();
    }
  };

  const freshness = relSync(snapshot?.generated_at);
  const membersReady = snapshot?.source === "worker";

  return (
    <div>
      <PageHeader
        className="mb-6"
        eyebrow="Lifecycle"
        title="Send"
        accent="Today"
        description={snapshot
          ? <>{int(snapshot.total_audience)} customers · {membersReady ? "computed from order data" : "seed figures (real sizes, pre-worker)"} · ranked by modeled opportunity</>
          : "The whole audience by lifecycle stage, and today's ranked cohorts to send."}
        meta={
          <>
            {snapshot && (
              <div className={`self-end pb-1.5 text-xs flex items-center gap-1.5 ${freshness.stale ? "text-warning-600" : "text-ink-muted"}`}
                title={snapshot.generated_at ? `Generated ${new Date(snapshot.generated_at).toLocaleString()}` : undefined}>
                <RefreshIcon className={`opacity-70 ${syncing ? "animate-spin" : ""}`} />
                Synced {freshness.label}
              </div>
            )}
            <SegmentedToggle
              ariaLabel="View"
              options={[{ value: "send", label: "Send Today" }, { value: "overview", label: "Overview" }]}
              value={tab}
              onChange={(t) => setTab(t)}
            />
            <Button variant="secondary" size="sm" loading={syncing} onClick={syncNow}
              title="Recompute the snapshot from the latest order data">
              <RefreshIcon className="mr-1.5" /> Sync now
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-600">{error}</div>
      )}

      {loading && !snapshot ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : snapshot ? (
        tab === "send" ? (
          <div className="flex flex-col gap-3">
            {snapshot.cohorts.map((c) => <CohortCard key={c.id} cohort={c} membersReady={membersReady} />)}
            <p className="text-xs text-ink-muted mt-1">{snapshot.assumptions}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <DistributionBar snapshot={snapshot} />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {snapshot.overview.tiles.map((t) => (
                <Card key={t.label} bodyClassName="p-5">
                  <StatCell label={t.label} value={int(t.count)} description={t.sub} className="!border-l-0 !pl-0" />
                  <div className="mt-2 h-0.5 rounded-full" style={{ background: t.color }} aria-hidden />
                </Card>
              ))}
            </div>
            <NextBestProduct snapshot={snapshot} />
            <p className="text-xs text-ink-muted">
              Sizes are real (24 months of Shopify orders). Recency bands and cohort rules are computed per customer; response rates are placeholders until measured. Cohorts overlap — do not sum.
            </p>
          </div>
        )
      ) : null}
    </div>
  );
}
