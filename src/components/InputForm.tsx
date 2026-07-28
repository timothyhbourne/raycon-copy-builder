"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { nanoid } from "nanoid";
import type { BriefInput, CampaignType, AudienceType, SectionSpec, Angle, SendStage } from "@/lib/schemas";
import { DEFAULT_SECTION_STRUCTURE } from "@/lib/schemas";
import { PRODUCT_CATEGORIES, VALID_PRODUCT_IDS, PRODUCT_NAME_BY_ID, getProductSlugByName } from "@/lib/products";
import type { Promotion } from "@/lib/promo/consolidate";
import { deriveSendStage, deadlineLanguage } from "@/lib/brief/compile";
import { PLAYBOOKS, type PlaybookSection } from "@/lib/prompts/playbooks";
import SectionBuilder from "./SectionBuilder";
import Button from "./ui/Button";
import Chip from "./ui/Chip";

// Structural signature (ignores nanoid ids) — used to tell an untouched default
// structure from a user-customized one.
function structSig(sections: { type: string; focus?: string; grid_cols?: number; grid_rows?: number }[]): string {
  return sections.map((s) => `${s.type}:${s.focus ?? ""}:${s.grid_cols ?? ""}:${s.grid_rows ?? ""}`).join("|");
}
function instantiateStructure(tpl: PlaybookSection[]): SectionSpec[] {
  return tpl.map((t) => ({
    id: nanoid(),
    type: t.type,
    ...(t.focus ? { focus: t.focus } : {}),
    ...(t.grid_cols ? { grid_cols: t.grid_cols } : {}),
    ...(t.grid_rows ? { grid_rows: t.grid_rows } : {}),
  }));
}
// Signatures the user hasn't customized: the base default + every playbook default.
const UNTOUCHED_SIGS = new Set<string>([
  structSig(DEFAULT_SECTION_STRUCTURE),
  ...Object.values(PLAYBOOKS).map((p) => structSig(p.default_structure)),
]);
function isUntouchedStructure(sections: SectionSpec[]): boolean {
  return UNTOUCHED_SIGS.has(structSig(sections));
}

const LABEL = "block t-label text-ink-secondary mb-1";
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
  angle: "offer_led" as Angle,
  products_featured: [],
  section_structure: DEFAULT_SECTION_STRUCTURE,
  campaign_specific_rules: "",
  tone_dial: 1,
};

const STAGE_LABELS: Record<SendStage, string> = {
  launch: "Launch",
  reminder: "Reminder",
  last_call: "Last call",
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
  // Promotional Calendar options for the occasion picker. ?active=1 filters
  // server-side to current/upcoming dated promotions only (soonest first, ≤15)
  // — the picker offers occasions you can write for, never the archive.
  // Degrades gracefully: if the calendar is empty/unavailable, "Custom /
  // evergreen" still works and stage/urgency fall back to launch.
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/promotions?active=1")
      .then((r) => r.json())
      .then((d) => { if (!cancelled && Array.isArray(d.promotions)) setPromotions(d.promotions); })
      .catch(() => { /* calendar unavailable — manual occasion still works */ });
    return () => { cancelled = true; };
  }, []);
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

  // --- Occasion / promotion picker -------------------------------------------
  // The server (?active=1) already filters to current/upcoming dated
  // promotions, sorted soonest-first and capped; render as-is.
  const todayYmd = new Date().toISOString().slice(0, 10);
  const promoOptions = promotions;
  const selectedPromotion = useMemo(
    () => promotions.find((p) => p.id === form.promotion_id),
    [promotions, form.promotion_id],
  );
  // Flash sales are ad hoc and never live on the Promotional Calendar. The
  // picker pins a permanent "Flash Sale" option; its typed dates feed the SAME
  // deriveSendStage path via a synthetic promotion (mirrors the compiler).
  const isFlashSale = form.occasion_kind === "flash_sale";
  const effectivePromotion = useMemo<Promotion | undefined>(() => {
    if (!isFlashSale) return selectedPromotion;
    return {
      id: "flash_sale", year: 0, month: "", sale: "Flash Sale", promotion: form.offer,
      startDate: form.flash_sale_start || undefined, endDate: form.flash_sale_end || undefined, products: [],
    };
  }, [isFlashSale, selectedPromotion, form.offer, form.flash_sale_start, form.flash_sale_end]);

  // Stage/urgency are auto-derived from the promotion window (same pure function
  // the compiler uses), with an optional manual override. The deadline-derived
  // urgency CAPS the stage urgency (a last-call sent 48h early steps down to 2).
  const autoStage = deriveSendStage(effectivePromotion);
  const stage: SendStage = form.send_stage ?? autoStage;
  const sendYmd = (form.send_date || "").trim() || todayYmd;
  const endYmd = effectivePromotion?.endDate;
  const dl = endYmd ? deadlineLanguage(sendYmd, endYmd) : undefined;
  const stageUrgency = stage === "last_call" ? 3 : stage === "reminder" ? 2 : 1;
  const urgency = form.urgency ?? (dl ? Math.min(stageUrgency, dl.urgency) : stageUrgency);
  const daysToEnd = endYmd
    ? Math.round((Date.parse(endYmd + "T00:00:00Z") - Date.parse(sendYmd + "T00:00:00Z")) / 86_400_000)
    : undefined;

  // Flash-sale date validation — block generate with an inline message, never
  // silently clamp. End date is required; start ≤ end; send ≤ end.
  const flashDateError = isFlashSale
    ? (!(form.flash_sale_end || "").trim()
        ? "Flash sale end date is required to generate."
        : form.flash_sale_start && form.flash_sale_start > form.flash_sale_end!
          ? "Flash sale start must be on or before the end date."
          : form.send_date && form.send_date > form.flash_sale_end!
            ? "Send date must be on or before the end date."
            : null)
    : null;

  const FLASH_SALE_OPTION = "__flash_sale__";
  // Selecting a promotion fills BLANKS only — a user-typed offer always wins.
  const handlePickPromotion = (id: string) => {
    if (id === FLASH_SALE_OPTION) {
      setForm((f) => ({
        ...f,
        occasion_kind: "flash_sale" as const,
        occasion: "Flash Sale",
        promotion_id: undefined,
        send_date: f.send_date || todayYmd,
        send_stage: undefined,
        urgency: undefined,
      }));
      return;
    }
    if (!id) {
      setForm((f) => ({
        ...f, promotion_id: undefined, occasion: undefined, send_stage: undefined, urgency: undefined,
        occasion_kind: undefined, flash_sale_start: undefined, flash_sale_end: undefined, send_date: undefined,
      }));
      return;
    }
    const p = promotions.find((x) => x.id === id);
    if (!p) return;
    setForm((f) => {
      // Map the promotion's free-text product names onto catalogue slugs; never
      // invent a product (unmapped names are dropped).
      const mapped = Array.from(new Set(
        p.products.map((pr) => getProductSlugByName(pr.product)).filter((s): s is string => !!s)
      ));
      return {
        ...f,
        occasion_kind: undefined,
        flash_sale_start: undefined,
        flash_sale_end: undefined,
        send_date: undefined,
        promotion_id: p.id,
        occasion: p.sale,
        offer: f.offer.trim() ? f.offer : (p.promotion || ""),
        products_featured: f.products_featured.length ? f.products_featured : mapped,
        send_stage: undefined, // re-derive from the new window
        urgency: undefined,
      };
    });
  };

  // Changing the type swaps in that playbook's default structure ONLY if the
  // current structure is still an untouched default — never clobber a customized
  // structure (the hint button below lets the user opt in instead).
  const handleTypeChange = (type: CampaignType) => {
    setForm((prev) => isUntouchedStructure(prev.section_structure)
      ? { ...prev, campaign_type: type, section_structure: instantiateStructure(PLAYBOOKS[type].default_structure) }
      : { ...prev, campaign_type: type });
  };
  const applyPlaybookStructure = () => set("section_structure", instantiateStructure(PLAYBOOKS[form.campaign_type].default_structure));
  // Offer the playbook structure when the user has customized away from any
  // default and it no longer matches the current type's playbook.
  const showStructureHint = !isUntouchedStructure(form.section_structure)
    && structSig(form.section_structure) !== structSig(PLAYBOOKS[form.campaign_type].default_structure);

  const toggleProduct = (slug: string) => {
    const cur = form.products_featured;
    set("products_featured", cur.includes(slug) ? cur.filter((p) => p !== slug) : [...cur, slug]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (flashDateError) return; // inline message shown at the date inputs
    onSubmit(form);
  };

  const pf = productFilter.trim().toLowerCase();
  const tone = form.tone_dial ?? 1;

  return (
    <form
      onSubmit={handleSubmit}
      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!flashDateError) onSubmit(form); } }}
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
          <select value={form.campaign_type} onChange={(e) => handleTypeChange(e.target.value as CampaignType)}
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
        <label className={LABEL}>Angle</label>
        <ChevronSelect>
          <select value={form.angle} onChange={(e) => set("angle", e.target.value as Angle)}
            className={`${INPUT} appearance-none pr-8`}>
            <option value="offer_led">Offer-led — the deal is the through-line</option>
            <option value="product_led">Product-led — one product truth anchors it</option>
            <option value="story_led">Story-led — hold the offer until the idea lands</option>
            <option value="occasion_led">Occasion-led — the moment leads</option>
          </select>
        </ChevronSelect>
      </div>

      <div>
        <label className={LABEL}>Occasion / Promotion</label>
        <ChevronSelect>
          <select value={isFlashSale ? FLASH_SALE_OPTION : (form.promotion_id || "")} onChange={(e) => handlePickPromotion(e.target.value)}
            className={`${INPUT} appearance-none pr-8`}>
            <option value="">Custom / evergreen (no calendar promotion)</option>
            <option value={FLASH_SALE_OPTION}>⚡ Flash Sale (ad hoc)</option>
            {promoOptions.length > 0 && (
              <optgroup label="Current & upcoming">
                {promoOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sale}{p.startDate ? ` · ${p.startDate}` : ""}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </ChevronSelect>
        <p className="text-xs text-ink-muted mt-1 leading-relaxed">
          {isFlashSale
            ? "Ad-hoc sale, decoupled from the calendar. The dates below drive stage, urgency, and deadline language."
            : selectedPromotion
              ? "Auto-filled from the calendar. Offer and products stay editable; what you type wins."
              : promoOptions.length === 0
                ? "No calendar promotions available — enter the offer manually."
                : "Pick a promotion to auto-fill the offer, products, and dates."}
        </p>
        {isFlashSale && (
          <div className="mt-2 space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={LABEL}>Start</label>
                <input type="date" value={form.flash_sale_start || ""}
                  onChange={(e) => set("flash_sale_start", e.target.value || undefined)}
                  className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>End *</label>
                <input type="date" required value={form.flash_sale_end || ""}
                  onChange={(e) => set("flash_sale_end", e.target.value || undefined)}
                  className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>Send date</label>
                <input type="date" value={form.send_date || ""}
                  onChange={(e) => set("send_date", e.target.value || undefined)}
                  className={INPUT} />
              </div>
            </div>
            {flashDateError && (
              <p className="text-xs text-danger-600 leading-relaxed" role="alert">{flashDateError}</p>
            )}
          </div>
        )}
      </div>

      <div>
        <label className={LABEL}>Send stage</label>
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <Chip tone="accent">{STAGE_LABELS[stage]}</Chip>
          <Chip tone={urgency >= 3 ? "warning" : "muted"}>Urgency {urgency}</Chip>
          {dl && <Chip tone="muted">Deadline language: &ldquo;{dl.phrase}&rdquo;</Chip>}
          <span className="text-[11px] text-ink-muted">{form.send_stage ? "manual override" : "auto from promotion dates"}</span>
        </div>
        {form.send_stage === "last_call" && daysToEnd !== undefined && daysToEnd >= 3 && (
          <p className="text-[11px] text-ink-muted mb-1.5 leading-relaxed">
            {daysToEnd} days to end date — consider Reminder.
          </p>
        )}
        <ChevronSelect>
          <select value={form.send_stage ?? ""}
            onChange={(e) => set("send_stage", e.target.value ? (e.target.value as SendStage) : undefined)}
            className={`${INPUT} appearance-none pr-8`}>
            <option value="">Auto ({STAGE_LABELS[autoStage]})</option>
            <option value="launch">Launch</option>
            <option value="reminder">Reminder</option>
            <option value="last_call">Last call</option>
          </select>
        </ChevronSelect>
      </div>

      <div>
        <label className={LABEL}>Hero product (leads above the fold)</label>
        <ChevronSelect>
          <select value={form.hero_product_slug || ""}
            onChange={(e) => set("hero_product_slug", e.target.value || undefined)}
            disabled={form.products_featured.length === 0}
            className={`${INPUT} appearance-none pr-8 disabled:opacity-60`}>
            <option value="">
              {form.products_featured.length ? "Auto (first featured product)" : "Select featured products first"}
            </option>
            {form.products_featured.map((id) => (
              <option key={id} value={id}>{PRODUCT_NAME_BY_ID[id] ?? id}</option>
            ))}
          </select>
        </ChevronSelect>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="t-label text-ink-secondary flex items-center gap-2">
            Featured Products
            {form.products_featured.length > 0 && <Chip tone="accent">{form.products_featured.length}</Chip>}
          </label>
          {form.products_featured.length > 0 && (
            <button type="button"
              onClick={() => setForm((f) => ({ ...f, products_featured: [], hero_product_slug: undefined }))}
              className="text-xs px-2 py-0.5 rounded-sm border border-line text-ink-secondary hover:border-line-strong hover:bg-chrome transition-colors">
              Clear all
            </button>
          )}
        </div>
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
                <summary className="cursor-pointer list-none flex items-center justify-between t-label py-1 select-none">
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
                        <span className={`text-xs shrink-0 w-16 ${active ? "text-accent" : "text-ink-muted"}`}>{id}</span>
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
          <label className="t-label text-ink-secondary">Tone</label>
          <Chip tone={tone >= 4 ? "warning" : tone === 3 ? "neutral" : "muted"}>{TONE_LABELS[tone]}</Chip>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-ink-muted shrink-0">Safe</span>
          <input type="range" min={1} max={5} step={1} value={tone}
            onChange={(e) => set("tone_dial", Number(e.target.value))}
            className="flex-1 accent-accent" />
          <span className="text-[10px] text-ink-muted shrink-0">Bold</span>
        </div>
        <div className="flex justify-between px-8 mt-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className={`text-[10px] ${tone === n ? "text-accent font-medium" : "text-ink-muted"}`}>{n}</span>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="t-label text-ink-secondary">Section Structure</label>
          {showStructureHint && (
            <Button type="button" variant="ghost" size="sm" onClick={applyPlaybookStructure}>
              Use the {form.campaign_type} structure
            </Button>
          )}
        </div>
        <SectionBuilder
          sections={form.section_structure}
          onChange={(s: SectionSpec[]) => set("section_structure", s)}
          productsCount={form.products_featured.length}
          selectedProducts={form.products_featured.map((id) => ({ id, name: PRODUCT_NAME_BY_ID[id] ?? id }))}
        />
      </div>

      <div>
        <label className={LABEL}>Anything special about this send? (optional)</label>
        <p className="text-xs text-ink-muted mb-1.5 leading-relaxed">
          The only free text. Use it sparingly for must-use facts or steering; it outranks everything else.
        </p>
        <textarea value={form.campaign_specific_rules || ""} onChange={(e) => set("campaign_specific_rules", e.target.value)} rows={2}
          className={`${INPUT} resize-none`} placeholder="e.g. Don't reference price until after the headline" />
      </div>

      <Button type="submit" variant="primary" loading={loading} className="w-full">
        Generate Brief
      </Button>
    </form>
  );
}
