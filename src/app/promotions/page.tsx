"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Promotion, PromoProduct } from "@/lib/promo/consolidate";
import { MONTHS } from "@/lib/promo/consolidate";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Chip from "@/components/ui/Chip";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { SegmentedToggle } from "@/components/ui/FilterBar";
import { toast } from "@/components/ui/Toast";

interface PromoApi { promotions: Promotion[]; years: number[]; synced_at: string | null }

const money = (n?: number) => (n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n));

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

// --- Discount + status derivation ----------------------------------------
// The sheet is inconsistent about WHERE the discount lives: sometimes a per-
// product "% off" column, sometimes only MSRP + sale price, sometimes only prose
// in the Promotion cell ("20% off sitewide"). These resolve all three into one
// headline, so the discount is the first thing the card says instead of being
// buried in a collapsed table.

/** Per-product % off — the column if present, else derived from MSRP → sale. */
function productPct(pr: PromoProduct): number | undefined {
  if (pr.pctOff != null && pr.pctOff > 0) return Math.round(pr.pctOff);
  const base = pr.msrp ?? pr.listPrice;
  if (base && pr.salePrice != null && base > 0 && pr.salePrice < base) {
    return Math.round((1 - pr.salePrice / base) * 100);
  }
  if (base && base > 0 && pr.dollarOff != null && pr.dollarOff > 0) return Math.round((pr.dollarOff / base) * 100);
  return undefined;
}
/** Per-product $ off — the column if present, else MSRP − sale. */
function productDollars(pr: PromoProduct): number | undefined {
  if (pr.dollarOff != null && pr.dollarOff > 0) return pr.dollarOff;
  const base = pr.msrp ?? pr.listPrice;
  if (base && pr.salePrice != null && pr.salePrice < base) return Math.round((base - pr.salePrice) * 100) / 100;
  return undefined;
}

interface Discount { headline: string; unit: string; note?: string }

function discountOf(p: Promotion): Discount | null {
  const pcts = p.products.map(productPct).filter((n): n is number => n != null && n > 0);
  if (pcts.length) {
    const min = Math.min(...pcts);
    const max = Math.max(...pcts);
    return min === max
      ? { headline: `${max}%`, unit: "off" }
      : { headline: `Up to ${max}%`, unit: "off", note: `${min}–${max}% off across ${pcts.length} products` };
  }
  const dollars = p.products.map(productDollars).filter((n): n is number => n != null && n > 0);
  if (dollars.length) {
    const min = Math.min(...dollars);
    const max = Math.max(...dollars);
    return min === max
      ? { headline: money(max), unit: "off" }
      : { headline: `Up to ${money(max)}`, unit: "off", note: `${money(min)}–${money(max)} off across ${dollars.length} products` };
  }
  // Nothing structured — read the discount out of the prose.
  const text = `${p.promotion} ${p.sale}`;
  if (/\bbogo\b|buy one/i.test(text)) return { headline: "BOGO", unit: "" };

  const pctMatches = Array.from(text.matchAll(/(\d{1,2}(?:\.\d+)?)\s*%/g)).map((m) => Number(m[1]));
  if (pctMatches.length) {
    const max = Math.max(...pctMatches);
    const min = Math.min(...pctMatches);
    return min === max ? { headline: `${max}%`, unit: "off" } : { headline: `Up to ${max}%`, unit: "off", note: `${min}–${max}% off` };
  }
  // A dollar amount only counts when it's explicitly framed as the discount.
  // A bare "$79" is usually a THRESHOLD ("free gift on orders over $79"), and
  // reading that as "$79 off" prints a confidently wrong headline.
  const dollarOff = [
    ...Array.from(text.matchAll(/\$\s?(\d{1,4}(?:\.\d{2})?)\s*(?:off|discount)/gi)),
    ...Array.from(text.matchAll(/save\s*\$\s?(\d{1,4}(?:\.\d{2})?)/gi)),
  ].map((m) => Number(m[1])).filter((n) => Number.isFinite(n));
  if (dollarOff.length) return { headline: `$${Math.max(...dollarOff)}`, unit: "off" };

  if (/free\s+shipping/i.test(text)) return { headline: "Free", unit: "shipping" };
  if (/\bfree\b/i.test(text)) return { headline: "Free", unit: "gift" };
  return null;
}

type Status = "live" | "upcoming" | "ended" | "undated";
const STATUS_META: Record<Status, { label: string; tone: "success" | "accent" | "muted" | "neutral"; dot: boolean }> = {
  live: { label: "Live", tone: "success", dot: true },
  upcoming: { label: "Upcoming", tone: "accent", dot: true },
  ended: { label: "Ended", tone: "muted", dot: false },
  undated: { label: "No dates", tone: "neutral", dot: false },
};
function statusOf(p: Promotion, today: string): Status {
  const start = p.startDate ?? p.endDate;
  const end = p.endDate ?? p.startDate;
  if (!start || !end) return "undated";
  if (today < start) return "upcoming";
  if (today > end) return "ended";
  return "live";
}

function RefreshIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  );
}

const PRODUCTS_PREVIEW = 6;

function PromoCard({ p, today, matchedProducts }: { p: Promotion; today: string; matchedProducts?: string[] }) {
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [showLearnings, setShowLearnings] = useState(false);
  const status = statusOf(p, today);
  const sm = STATUS_META[status];
  const discount = discountOf(p);
  const matched = new Set((matchedProducts ?? []).map((s) => s.toLowerCase()));

  const rows = showAllProducts ? p.products : p.products.slice(0, PRODUCTS_PREVIEW);
  const canToggleProducts = p.products.length > PRODUCTS_PREVIEW;

  return (
    <Card bodyClassName="p-0" className={status === "live" ? "border-success-200" : ""}>
      {/* Header — status, name, type, duration */}
      <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Chip tone={sm.tone} dot={sm.dot}>{sm.label}</Chip>
            <h3 className="t-heading text-ink">{p.sale || "(untitled promotion)"}</h3>
            {p.type && <Chip tone="muted">{p.type}</Chip>}
            {p.promotionType && p.promotionType !== p.type && <Chip tone="muted">{p.promotionType}</Chip>}
          </div>
          <div className="text-sm text-ink-secondary mt-1.5 font-mono tabular-nums">{dateRange(p)}</div>
        </div>
        {p.days != null && (
          <span className="t-label text-ink-muted shrink-0 pt-1">{p.days} day{p.days === 1 ? "" : "s"}</span>
        )}
      </div>

      {/* Discount — the headline, always visible */}
      <div className="px-5 pb-4 flex items-start gap-4">
        <div className={`shrink-0 rounded-md border px-3 py-2 text-center min-w-[96px] ${
          status === "ended" ? "border-line bg-sunken" : "border-success-200 bg-success-50"
        }`}>
          <div className={`text-lg font-semibold leading-tight tabular-nums ${status === "ended" ? "text-ink-secondary" : "text-success-600"}`}>
            {discount ? discount.headline : "—"}
          </div>
          <div className="t-label mt-0.5">{discount ? discount.unit || "offer" : "see details"}</div>
        </div>
        <div className="min-w-0 flex-1">
          {p.promotion && <p className="text-sm text-ink leading-relaxed">{p.promotion}</p>}
          {discount?.note && <p className="text-xs text-ink-muted mt-1 tabular-nums">{discount.note}</p>}
          {(p.targetRevenue || p.shopifyExecution) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              {p.targetRevenue && (
                <span className="text-xs text-ink-secondary"><span className="t-label">Target </span>{p.targetRevenue}</span>
              )}
              {p.shopifyExecution && (
                <span className="text-xs text-ink-secondary"><span className="t-label">Shopify </span>{p.shopifyExecution}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Products — expanded by default: the per-product discount is the point */}
      {p.products.length > 0 && (
        <div className="border-t border-line bg-sunken/40 px-5 py-3">
          <div className="t-label mb-2">Products ({p.products.length})</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="t-label text-left">
                  <th className="pb-1.5 pr-3 font-medium">Product</th>
                  <th className="pb-1.5 px-3 font-medium text-right">MSRP</th>
                  <th className="pb-1.5 px-3 font-medium text-right">Sale</th>
                  <th className="pb-1.5 pl-3 font-medium text-right">Off</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((pr, i) => {
                  const pct = productPct(pr);
                  const off = productDollars(pr);
                  const isMatch = matched.has((pr.product || "").toLowerCase());
                  return (
                    <tr key={i} className={isMatch ? "bg-accent-50" : ""}>
                      <td className="py-1.5 pr-3 text-ink">
                        {pr.product || "—"}
                        {isMatch && <span className="ml-2 text-[10px] font-medium text-accent-700 uppercase tracking-wide">match</span>}
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums text-ink-muted line-through">
                        {money(pr.msrp ?? pr.listPrice)}
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums text-ink font-medium">{money(pr.salePrice)}</td>
                      <td className="py-1.5 pl-3 text-right font-mono tabular-nums text-success-600">
                        {pct != null ? `−${pct}%` : off != null ? `−${money(off)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {canToggleProducts && (
            <button type="button" onClick={() => setShowAllProducts((v) => !v)}
              className="mt-2 t-label text-ink-muted hover:text-ink transition-colors">
              {showAllProducts ? "Show fewer" : `Show all ${p.products.length} products`}
            </button>
          )}
        </div>
      )}

      {p.learnings && (
        <div className="border-t border-line px-5 py-3">
          <button type="button" onClick={() => setShowLearnings((v) => !v)}
            className="t-label text-ink-muted hover:text-ink transition-colors inline-flex items-center gap-1.5">
            <span className={`inline-block transition-transform ${showLearnings ? "rotate-90" : ""}`}>▸</span>
            Learnings
          </button>
          {showLearnings && (
            <p className="text-xs text-ink-secondary mt-2 whitespace-pre-line leading-relaxed rc-animate-fade">{p.learnings}</p>
          )}
        </div>
      )}
    </Card>
  );
}

// --- Search --------------------------------------------------------------
// Deliberately searches EVERY year and month, ignoring the Year/Month toggles:
// the question typed into this box is "does this promo exist / what did we
// discount it to", and that answer must not depend on already knowing which
// month it lived in. Matches promo name, prose, type, month/year, and product
// names; all terms must match (AND), so "spin cable" narrows rather than widens.
interface Hit { promo: Promotion; matchedProducts: string[] }

function searchPromotions(all: Promotion[], raw: string): Hit[] {
  const terms = raw.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits: Hit[] = [];
  for (const p of all) {
    const productNames = p.products.map((pr) => pr.product || "");
    const haystack = [p.sale, p.promotion, p.type ?? "", p.promotionType ?? "", p.month, String(p.year), ...productNames]
      .join(" ")
      .toLowerCase();
    if (!terms.every((t) => haystack.includes(t))) continue;
    hits.push({
      promo: p,
      matchedProducts: productNames.filter((n) => n && terms.some((t) => n.toLowerCase().includes(t))),
    });
  }
  // Newest first — a search is usually "what did we do most recently".
  return hits.sort((a, b) => {
    const ka = a.promo.startDate ?? a.promo.endDate ?? `${a.promo.year}-99`;
    const kb = b.promo.startDate ?? b.promo.endDate ?? `${b.promo.year}-99`;
    return kb.localeCompare(ka);
  });
}

export default function PromotionsPage() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const [all, setAll] = useState<Promotion[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<string>(MONTHS[now.getMonth()]);
  const [query, setQuery] = useState("");

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

  const trimmed = query.trim();
  const searching = trimmed.length > 0;
  const hits = useMemo(() => (searching ? searchPromotions(all, trimmed) : []), [all, trimmed, searching]);

  // Search results are grouped by month, so each answer carries its own "when".
  const hitGroups = useMemo(() => {
    const groups: { key: string; hits: Hit[] }[] = [];
    for (const h of hits) {
      const key = `${h.promo.month || "Undated"} ${h.promo.year}`;
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.hits.push(h);
      else groups.push({ key, hits: [h] });
    }
    return groups;
  }, [hits]);

  const filtered = useMemo(
    () => all.filter((p) => p.year === year && p.month.toLowerCase() === month.toLowerCase()),
    [all, year, month]
  );

  const liveCount = useMemo(() => all.filter((p) => statusOf(p, today) === "live").length, [all, today]);

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
            {liveCount > 0 && (
              <div className="self-end pb-1.5"><Chip tone="success" dot>{liveCount} live now</Chip></div>
            )}
            <div className="self-end pb-1.5 text-xs text-ink-muted flex items-center gap-1.5">
              <RefreshIcon className={syncing ? "animate-spin" : ""} /> Synced {relSync(syncedAt)}
            </div>
            <Button variant="secondary" size="sm" loading={syncing} onClick={syncNow}>
              <RefreshIcon className="mr-1.5" /> Sync now
            </Button>
          </>
        }
      />

      {/* Search — spans every year/month, so it answers "does this exist?" */}
      <div className="mb-4">
        <div className="relative max-w-xl">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none"><SearchIcon /></span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search every promotion — name, offer, or product…"
            aria-label="Search all promotions"
            className="w-full text-sm bg-surface border border-line rounded-md pl-9 pr-20 py-2.5 shadow-card focus:outline-none focus:border-accent transition-colors"
          />
          {searching && (
            <button type="button" onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ink-muted hover:text-ink transition-colors px-1.5 py-1">
              Clear ✕
            </button>
          )}
        </div>
        {searching && (
          <div className="text-xs text-ink-muted mt-2">
            {hits.length} result{hits.length === 1 ? "" : "s"} across all years — Year and Month filters are ignored while searching.
          </div>
        )}
      </div>

      {!searching && (
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
      )}

      {error && (
        <div className="bg-danger-50 border border-danger-200 rounded-md p-3 mb-4 text-sm text-danger-600">{error}</div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-44 rc-skeleton rounded-lg" />)}
        </div>
      ) : searching ? (
        hits.length === 0 ? (
          <Card bodyClassName="p-0">
            <EmptyState
              title={`No promotion matches “${trimmed}”`}
              description="Nothing in the calendar mentions that name, offer, or product — in any year. Try a shorter term, or just the product name."
            />
          </Card>
        ) : (
          <div className="space-y-6">
            {hitGroups.map((g) => (
              <div key={g.key} className="space-y-3">
                <div className="t-label sticky top-0 z-10 bg-surface py-1.5">
                  {g.key} · {g.hits.length} promotion{g.hits.length === 1 ? "" : "s"}
                </div>
                {g.hits.map((h) => (
                  <PromoCard key={h.promo.id} p={h.promo} today={today} matchedProducts={h.matchedProducts} />
                ))}
              </div>
            ))}
          </div>
        )
      ) : filtered.length === 0 ? (
        <Card bodyClassName="p-0">
          <EmptyState
            title="No promotions"
            description={`Nothing scheduled for ${month} ${year}. Try another month or year — or search above to look across every year at once.`}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="t-label">{filtered.length} promotion{filtered.length === 1 ? "" : "s"} · {month} {year}</div>
          {filtered.map((p) => <PromoCard key={p.id} p={p} today={today} />)}
        </div>
      )}
    </div>
  );
}
