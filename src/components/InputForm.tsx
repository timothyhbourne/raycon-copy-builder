"use client";
import { useState, useEffect, useRef } from "react";
import type { BriefInput, CampaignType, AudienceType, SectionSpec } from "@/lib/schemas";
import { DEFAULT_SECTION_STRUCTURE } from "@/lib/schemas";
import { PRODUCT_CATEGORIES, VALID_PRODUCT_IDS } from "@/lib/products";
import SectionBuilder from "./SectionBuilder";
import Button from "./ui/Button";
import Chip from "./ui/Chip";

const LABEL = "block font-mono text-xs text-ink-secondary uppercase tracking-wide mb-1";
const INPUT = "w-full border border-line rounded-sm px-3 py-2 text-sm bg-surface focus:outline-none focus:border-accent transition-colors";

function ChevronSelect({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <svg aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}

interface Props {
  onSubmit: (input: BriefInput) => void;
  loading: boolean;
  seed?: Partial<BriefInput> | null;      // from a planner handoff
  seedLabel?: string | null;              // e.g. planner row name, for the banner
  onClearSeed?: () => void;
}

const LS_KEY = "raycon_brief_draft";

const DEFAULT_FORM: BriefInput = {
  campaign_name: "",
  campaign_type: "promo" as CampaignType,
  offer: "",
  promo_code: "",
  audience: "all" as AudienceType,
  hero_angle: "",
  products_featured: [],
  section_structure: DEFAULT_SECTION_STRUCTURE,
  campaign_specific_rules: "",
  tone_dial: 1,
};

const TONE_LABELS: Record<number, string> = {
  1: "By the book",
  2: "Mostly safe",
  3: "Balanced",
  4: "Creative",
  5: "Experimental",
};

// Build a full form from a planner seed. Strips invalid product ids the same
// way the localStorage hydration does.
function applySeed(seed: Partial<BriefInput>): BriefInput {
  const products = Array.isArray(seed.products_featured)
    ? seed.products_featured.filter((id) => VALID_PRODUCT_IDS.has(id))
    : [];
  return { ...DEFAULT_FORM, ...seed, products_featured: products };
}

export default function InputForm({ onSubmit, loading, seed, seedLabel, onClearSeed }: Props) {
  const [form, setForm] = useState<BriefInput>(DEFAULT_FORM);
  const [hydrated, setHydrated] = useState(false);
  const [productFilter, setProductFilter] = useState("");
  // Which product categories the user has manually opened (first is open by default).
  const [openCats, setOpenCats] = useState<Set<string>>(new Set([PRODUCT_CATEGORIES[0]?.label]));
  // Last seed CONTENT we applied. The planner handoff seeds twice for one row —
  // the deterministic map instantly, then the AI-enriched merge a moment later —
  // so we key on content, not planner_row_id (which is identical across both and
  // would drop the AI pass). Deduping by content also makes a parent re-passing
  // an equal object a no-op, so it can't loop.
  const lastSeedJson = useRef<string | null>(null);

  // Initial hydration. A planner seed present at mount takes precedence over the
  // localStorage draft; the [seed] effect below applies its contents.
  useEffect(() => {
    if (!(seed && seed.planner_row_id)) {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          // Strip any product IDs that no longer exist in the current catalogue
          // (avoids phantom counts from old/renamed SKUs stored in localStorage)
          if (Array.isArray(parsed.products_featured)) {
            parsed.products_featured = parsed.products_featured.filter((id: string) => VALID_PRODUCT_IDS.has(id));
          }
          setForm(parsed);
        } catch { /* */ }
      }
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply a planner seed whenever its content changes — the deterministic seed
  // first, then the AI-enriched merge the deep-link fetch lands asynchronously.
  useEffect(() => {
    if (!seed || !seed.planner_row_id) return;
    const json = JSON.stringify(seed);
    if (lastSeedJson.current === json) return;
    lastSeedJson.current = json;
    setForm(applySeed(seed));
  }, [seed]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(LS_KEY, JSON.stringify(form));
  }, [form, hydrated]);

  const handleClearSeed = () => {
    lastSeedJson.current = null;
    setForm(DEFAULT_FORM);
    onClearSeed?.();
  };

  const set = (field: keyof BriefInput, value: unknown) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const toggleProduct = (slug: string) => {
    const cur = form.products_featured;
    set("products_featured", cur.includes(slug) ? cur.filter((p) => p !== slug) : [...cur, slug]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  const pf = productFilter.trim().toLowerCase();
  const tone = form.tone_dial ?? 1;

  return (
    <form
      onSubmit={handleSubmit}
      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit(form); } }}
      className="flex flex-col gap-4 text-sm"
    >
      {seedLabel && (
        <div className="rounded-md border border-line bg-surface px-3 py-2.5 space-y-1.5 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Chip tone="accent">Planner</Chip>
              <span className="text-sm text-ink truncate" title={seedLabel}>{seedLabel}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={handleClearSeed}>Clear</Button>
          </div>
          <p className="text-[11px] leading-relaxed text-ink-secondary">
            Products and hero angle were AI-suggested. Review before generating.
          </p>
        </div>
      )}

      <div>
        <label className={LABEL}>Campaign Name *</label>
        <input required value={form.campaign_name} onChange={(e) => set("campaign_name", e.target.value)}
          className={INPUT} placeholder="e.g. Summer Flash Sale" />
      </div>

      <div>
        <label className={LABEL}>Campaign Type</label>
        <ChevronSelect>
          <select value={form.campaign_type} onChange={(e) => set("campaign_type", e.target.value)}
            className={`${INPUT} appearance-none pr-8`}>
            {["promo", "launch", "restock", "story", "seasonal", "winback", "newsletter"].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </ChevronSelect>
      </div>

      <div>
        <label className={LABEL}>Offer *</label>
        <textarea required value={form.offer} onChange={(e) => set("offer", e.target.value)} rows={2}
          className={`${INPUT} resize-none`} placeholder="e.g. 40% sitewide, June 12 to June 15" />
      </div>

      <div>
        <label className={LABEL}>Promo Code</label>
        <input value={form.promo_code || ""} onChange={(e) => set("promo_code", e.target.value)}
          className={INPUT} placeholder="e.g. SUMMER40" />
      </div>

      <div>
        <label className={LABEL}>Audience</label>
        <ChevronSelect>
          <select value={form.audience} onChange={(e) => set("audience", e.target.value)}
            className={`${INPUT} appearance-none pr-8`}>
            {["all", "engaged", "lapsed", "post_purchase", "vip"].map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </ChevronSelect>
      </div>

      <div>
        <label className={LABEL}>Hero Angle / Hook *</label>
        <p className="text-xs text-ink-muted mb-1.5 leading-relaxed">
          Describe the <span className="text-ink-secondary">intent</span>, not the wording. Strongest briefs name: the core idea/tension, the one feeling to leave, how this send differs from the last, and any must-use facts (codes, quotes). Write goals like &ldquo;real urgency, not panicked&rdquo; — the app translates intent and avoids clichés, so you don&rsquo;t need to write the lines yourself.
        </p>
        <textarea required value={form.hero_angle} onChange={(e) => set("hero_angle", e.target.value)} rows={4}
          className={`${INPUT} resize-y min-h-[60px]`}
          placeholder="e.g. Last-call Prime Day send. Pure urgency: sale ends today, last shot at 30% off with code PRIME. Lead with the deadline, offer up top. Back it with the fan-favorite best-sellers for a quick, safe pick. Confident and warm, urgency felt throughout but never panicked." />
      </div>

      <div>
        <label className={LABEL}>Featured Products</label>
        <input value={productFilter} onChange={(e) => setProductFilter(e.target.value)}
          className={`${INPUT} mb-2`} placeholder="Filter products…" />
        <div className="space-y-1.5">
          {PRODUCT_CATEGORIES.map((cat, ci) => {
            const matches = cat.products.filter((p) => !pf || p.name.toLowerCase().includes(pf) || p.id.toLowerCase().includes(pf));
            if (matches.length === 0) return null;
            const selCount = cat.products.filter((p) => form.products_featured.includes(p.id)).length;
            const open = !!pf || selCount > 0 || openCats.has(cat.label) || (ci === 0 && openCats.size === 0);
            return (
              <details
                key={cat.label}
                open={open}
                onToggle={(e) => {
                  const isOpen = (e.currentTarget as HTMLDetailsElement).open;
                  setOpenCats((prev) => {
                    const n = new Set(prev);
                    if (isOpen) n.add(cat.label); else n.delete(cat.label);
                    return n;
                  });
                }}
              >
                <summary className="cursor-pointer list-none flex items-center justify-between font-mono text-xs text-ink-muted uppercase tracking-wide py-1 select-none">
                  <span>{cat.label}{selCount > 0 && <span className="text-accent"> · {selCount}</span>}</span>
                  <svg aria-hidden className="rc-chevron w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                </summary>
                <div className="space-y-0.5 pt-1">
                  {matches.map(({ id, name }) => {
                    const active = form.products_featured.includes(id);
                    return (
                      <button type="button" key={id} onClick={() => toggleProduct(id)}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-sm text-left border transition-colors duration-150 ${
                          active
                            ? "bg-accent-50 text-accent border-accent-200"
                            : "bg-surface text-ink-secondary border-line hover:border-line-strong hover:bg-chrome"
                        }`}>
                        <span className={`font-mono text-xs shrink-0 w-16 ${active ? "text-accent" : "text-ink-muted"}`}>{id}</span>
                        <span className="text-sm">{name}</span>
                      </button>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="font-mono text-xs text-ink-secondary uppercase tracking-wide">Tone</label>
          <Chip tone={tone >= 4 ? "warning" : tone === 3 ? "neutral" : "muted"}>{TONE_LABELS[tone]}</Chip>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-ink-muted shrink-0">Safe</span>
          <input type="range" min={1} max={5} step={1} value={tone}
            onChange={(e) => set("tone_dial", Number(e.target.value))}
            className="flex-1 accent-accent" />
          <span className="font-mono text-[10px] text-ink-muted shrink-0">Bold</span>
        </div>
        <div className="flex justify-between px-8 mt-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className={`font-mono text-[10px] ${tone === n ? "text-accent font-medium" : "text-ink-muted"}`}>{n}</span>
          ))}
        </div>
      </div>

      <div>
        <label className={LABEL}>Section Structure</label>
        <SectionBuilder
          sections={form.section_structure}
          onChange={(s: SectionSpec[]) => set("section_structure", s)}
          productsCount={form.products_featured.length}
        />
      </div>

      <div>
        <label className={LABEL}>Anything to Avoid (this campaign)</label>
        <textarea value={form.campaign_specific_rules || ""} onChange={(e) => set("campaign_specific_rules", e.target.value)} rows={2}
          className={`${INPUT} resize-none`} placeholder="e.g. Don't reference price until after the headline" />
      </div>

      <Button type="submit" variant="primary" loading={loading} className="w-full">
        Generate Brief
      </Button>
    </form>
  );
}
