"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Promotion } from "@/lib/promo/consolidate";
import { MONTHS } from "@/lib/promo/consolidate";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Chip from "@/components/ui/Chip";
import Button from "@/components/ui/Button";
import { SegmentedToggle } from "@/components/ui/FilterBar";
import { toast } from "@/components/ui/Toast";

interface PromoApi { promotions: Promotion[]; years: number[]; synced_at: string | null }

const money = (n?: number) => (n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n));
const pct = (n?: number) => (n == null ? "—" : `${n}%`);

function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00Z");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function dateRange(p: Promotion): string {
  const start = [fmtDate(p.startDate), p.startTime].filter(Boolean).join(" ");
  const end = [fmtDate(p.endDate), p.endTime].filter(Boolean).join(" ");
  if (start && end) return `${start} → ${end}`;
  return start || end || "Dates TBD";
}
function relSync(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

function RefreshIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
    </svg>
  );
}

function PromoCard({ p }: { p: Promotion }) {
  const [open, setOpen] = useState(false);
  const hasProducts = p.products.length > 0;
  return (
    <Card bodyClassName="p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="t-heading text-ink">{p.sale || "(untitled promotion)"}</h3>
            {p.type && <Chip tone="muted">{p.type}</Chip>}
          </div>
          <div className="text-sm text-ink-secondary mt-1 font-mono tabular-nums">{dateRange(p)}</div>
        </div>
        {p.days != null && <Chip tone="accent">{p.days} day{p.days === 1 ? "" : "s"}</Chip>}
      </div>

      {p.promotion && <p className="text-sm text-ink mt-3">{p.promotion}</p>}

      {hasProducts && (
        <div className="mt-3">
          <button type="button" onClick={() => setOpen((o) => !o)}
            className="t-label text-ink-muted hover:text-ink-secondary transition-colors inline-flex items-center gap-1">
            <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
            {p.products.length} product{p.products.length === 1 ? "" : "s"}
          </button>
          {open && (
            <div className="mt-2 overflow-x-auto rc-animate-fade">
              <table className="w-full text-sm border-t border-line">
                <thead>
                  <tr className="t-label text-left">
                    <th className="py-1.5 pr-3 font-medium">Product</th>
                    <th className="py-1.5 px-3 font-medium text-right">MSRP</th>
                    <th className="py-1.5 px-3 font-medium text-right">Sale</th>
                    <th className="py-1.5 pl-3 font-medium text-right">% Off</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {p.products.map((pr, i) => (
                    <tr key={i}>
                      <td className="py-1.5 pr-3 text-ink">{pr.product || "—"}</td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums text-ink-muted">{money(pr.msrp)}</td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums text-ink">{money(pr.salePrice)}</td>
                      <td className="py-1.5 pl-3 text-right font-mono tabular-nums text-success-600">{pct(pr.pctOff)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {p.learnings && (
        <div className="mt-3 pt-3 border-t border-line">
          <span className="t-label">Learnings</span>
          <p className="text-xs text-ink-secondary mt-1 whitespace-pre-line">{p.learnings}</p>
        </div>
      )}
    </Card>
  );
}

export default function PromotionsPage() {
  const now = new Date();
  const [all, setAll] = useState<Promotion[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<string>(MONTHS[now.getMonth()]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/promotions");
      const json = (await res.json()) as PromoApi & { error?: string };
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setAll(json.promotions ?? []);
      setYears(json.years ?? []);
      setSyncedAt(json.synced_at ?? null);
      // Default the Year toggle to the current year if present, else the latest.
      const ys = json.years ?? [];
      if (ys.length && !ys.includes(now.getFullYear())) setYear(ys[ys.length - 1]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/promotions/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Sync failed");
      toast.success(`Synced ${json.count} promotion${json.count === 1 ? "" : "s"}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const filtered = useMemo(
    () => all.filter((p) => p.year === year && p.month.toLowerCase() === month.toLowerCase()),
    [all, year, month]
  );

  // Year options: the years the data actually has (plus the current year so the
  // default toggle always has a home even before any data lands).
  const yearOptions = useMemo(() => {
    const set = new Set<number>(years);
    set.add(now.getFullYear());
    return Array.from(set).sort((a, b) => a - b);
  }, [years]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHeader
        className="mb-6"
        eyebrow="Plan"
        title="Promotional"
        accent="calendar"
        description="The company promo calendar, consolidated from the shared Google Sheet."
        meta={
          <>
            <div className="self-end pb-1.5 text-xs text-ink-muted flex items-center gap-1.5">
              <RefreshIcon className={syncing ? "animate-spin" : ""} /> Synced {relSync(syncedAt)}
            </div>
            <Button variant="secondary" size="sm" loading={syncing} onClick={syncNow}>
              <RefreshIcon className="mr-1.5" /> Sync now
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3 mb-6">
        <div className="flex flex-col gap-1">
          <span className="t-label">Year</span>
          <SegmentedToggle
            ariaLabel="Year"
            options={yearOptions.map((y) => ({ value: String(y), label: String(y) }))}
            value={String(year)}
            onChange={(v) => setYear(Number(v))}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="t-label">Month</span>
          <SegmentedToggle
            ariaLabel="Month"
            options={MONTHS.map((m) => ({ value: m, label: m.slice(0, 3) }))}
            value={month}
            onChange={setMonth}
          />
        </div>
      </div>

      {error && (
        <div className="bg-danger-50 border border-danger-200 rounded-md p-3 mb-4 text-sm text-danger-600">{error}</div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-28 rc-skeleton rounded-md" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-surface border border-line rounded-md shadow-card p-12 text-center">
          <div className="t-label mb-2">No promotions</div>
          <p className="text-sm text-ink-secondary">Nothing scheduled for {month} {year}. Try another month or year.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="t-label">{filtered.length} promotion{filtered.length === 1 ? "" : "s"} · {month} {year}</div>
          {filtered.map((p) => <PromoCard key={p.id} p={p} />)}
        </div>
      )}
    </div>
  );
}
