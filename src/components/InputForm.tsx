"use client";
import { useState, useEffect } from "react";
import type { BriefInput, SectionSpec, CampaignType, AudienceType } from "@/lib/schemas";
import { DEFAULT_SECTION_STRUCTURE } from "@/lib/schemas";
import SectionBuilder from "./SectionBuilder";

const PRODUCT_CATEGORIES: { label: string; products: { id: string; name: string }[] }[] = [
  {
    label: "Everyday Earbuds",
    products: [
      { id: "E25",     name: "Everyday Earbuds Classic" },
      { id: "E25-LE",  name: "Everyday Earbuds (Limited)" },
      { id: "E25-MLB", name: "Everyday Earbuds (MLB)" },
      { id: "E26",     name: "Everyday Earbuds Plus" },
      { id: "E95",     name: "Everyday Earbuds Pro" },
    ],
  },
  {
    label: "Fitness & Sport",
    products: [
      { id: "E45", name: "Fitness Earbuds" },
      { id: "H41", name: "Fitness Headphones" },
    ],
  },
  {
    label: "Sleep & Impact",
    products: [
      { id: "E60", name: "Everyday Sleep Earbuds" },
      { id: "E75", name: "The Impact Earbuds" },
    ],
  },
  {
    label: "Open Earbuds",
    products: [
      { id: "O15", name: "Essential Open" },
      { id: "O25", name: "Open Earbuds Plus" },
      { id: "O55", name: "Everyday Clip Earbuds" },
      { id: "O41", name: "Open Headphones" },
    ],
  },
  {
    label: "Headphones",
    products: [
      { id: "H10", name: "Essential Headphones" },
      { id: "H20", name: "Everyday Headphones Plus" },
      { id: "H90", name: "Everyday Headphones Pro" },
      { id: "B42", name: "Bone Conduction Headphones" },
    ],
  },
  {
    label: "Accessories",
    products: [
      { id: "RACSPN3",  name: "Spin Cables (3 ft)" },
      { id: "RACSPN6",  name: "Spin Cables (6 ft)" },
      { id: "RACSPN10", name: "Spin Cables (10 ft)" },
    ],
  },
];

interface Props {
  onSubmit: (input: BriefInput) => void;
  loading: boolean;
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

// Flat set of every valid product ID in the current catalogue
const VALID_PRODUCT_IDS = new Set(PRODUCT_CATEGORIES.flatMap((cat) => cat.products.map((p) => p.id)));

export default function InputForm({ onSubmit, loading }: Props) {
  const [form, setForm] = useState<BriefInput>(DEFAULT_FORM);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
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
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(LS_KEY, JSON.stringify(form));
  }, [form, hydrated]);

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

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-sm">
      <div>
        <label className="block font-mono text-xs text-slate-500 uppercase tracking-wide mb-1">Campaign Name *</label>
        <input
          required
          value={form.campaign_name}
          onChange={(e) => set("campaign_name", e.target.value)}
          className="w-full border border-slate-200 rounded px-3 py-2 focus:outline-none focus:border-slate-400 bg-white"
          placeholder="e.g. Summer Flash Sale"
        />
      </div>

      <div>
        <label className="block font-mono text-xs text-slate-500 uppercase tracking-wide mb-1">Campaign Type</label>
        <select
          value={form.campaign_type}
          onChange={(e) => set("campaign_type", e.target.value)}
          className="w-full border border-slate-200 rounded px-3 py-2 focus:outline-none focus:border-slate-400 bg-white"
        >
          {["promo","launch","restock","story","seasonal","winback","newsletter"].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block font-mono text-xs text-slate-500 uppercase tracking-wide mb-1">Offer *</label>
        <textarea
          required
          value={form.offer}
          onChange={(e) => set("offer", e.target.value)}
          rows={2}
          className="w-full border border-slate-200 rounded px-3 py-2 focus:outline-none focus:border-slate-400 bg-white resize-none"
          placeholder="e.g. 40% sitewide, June 12 to June 15"
        />
      </div>

      <div>
        <label className="block font-mono text-xs text-slate-500 uppercase tracking-wide mb-1">Promo Code</label>
        <input
          value={form.promo_code || ""}
          onChange={(e) => set("promo_code", e.target.value)}
          className="w-full border border-slate-200 rounded px-3 py-2 focus:outline-none focus:border-slate-400 bg-white"
          placeholder="e.g. SUMMER40"
        />
      </div>

      <div>
        <label className="block font-mono text-xs text-slate-500 uppercase tracking-wide mb-1">Audience</label>
        <select
          value={form.audience}
          onChange={(e) => set("audience", e.target.value)}
          className="w-full border border-slate-200 rounded px-3 py-2 focus:outline-none focus:border-slate-400 bg-white"
        >
          {["all","engaged","lapsed","post_purchase","vip"].map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block font-mono text-xs text-slate-500 uppercase tracking-wide mb-1">Hero Angle / Hook *</label>
        <textarea
          required
          value={form.hero_angle}
          onChange={(e) => set("hero_angle", e.target.value)}
          rows={3}
          className="w-full border border-slate-200 rounded px-3 py-2 focus:outline-none focus:border-slate-400 bg-white resize-y min-h-[60px]"
          placeholder="e.g. Make Mother's Day the main hook"
        />
      </div>

      <div>
        <label className="block font-mono text-xs text-slate-500 uppercase tracking-wide mb-2">Featured Products</label>
        <div className="space-y-3">
          {PRODUCT_CATEGORIES.map((cat) => (
            <div key={cat.label}>
              <div className="font-mono text-xs text-slate-400 uppercase tracking-wide mb-1">{cat.label}</div>
              <div className="space-y-0.5">
                {cat.products.map(({ id, name }) => {
                  const active = form.products_featured.includes(id);
                  return (
                    <button
                      type="button"
                      key={id}
                      onClick={() => toggleProduct(id)}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded text-left transition-colors border ${
                        active
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white text-slate-600 border-slate-100 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <span className={`font-mono text-xs shrink-0 w-16 ${active ? "text-slate-300" : "text-slate-400"}`}>{id}</span>
                      <span className="text-xs">{name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="font-mono text-xs text-slate-500 uppercase tracking-wide">Tone</label>
          <span className={`font-mono text-xs px-2 py-0.5 rounded ${
            (form.tone_dial ?? 1) >= 4 ? "bg-amber-50 text-amber-600" :
            (form.tone_dial ?? 1) === 3 ? "bg-slate-100 text-slate-600" :
            "bg-slate-50 text-slate-400"
          }`}>
            {TONE_LABELS[form.tone_dial ?? 1]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-slate-400 shrink-0">Conservative</span>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={form.tone_dial ?? 1}
            onChange={(e) => set("tone_dial", Number(e.target.value))}
            className="flex-1 accent-slate-900"
          />
          <span className="font-mono text-xs text-slate-400 shrink-0">Experimental</span>
        </div>
      </div>

      <div>
        <label className="block font-mono text-xs text-slate-500 uppercase tracking-wide mb-1">Section Structure</label>
        <SectionBuilder
          sections={form.section_structure}
          onChange={(s: SectionSpec[]) => set("section_structure", s)}
          productsCount={form.products_featured.length}
        />
      </div>

      <div>
        <label className="block font-mono text-xs text-slate-500 uppercase tracking-wide mb-1">Anything to Avoid (this campaign)</label>
        <textarea
          value={form.campaign_specific_rules || ""}
          onChange={(e) => set("campaign_specific_rules", e.target.value)}
          rows={2}
          className="w-full border border-slate-200 rounded px-3 py-2 focus:outline-none focus:border-slate-400 bg-white resize-none"
          placeholder="e.g. Don't reference price until after the headline"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-slate-900 text-white py-3 rounded-md font-medium hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Generating Brief..." : "Generate Brief"}
      </button>
    </form>
  );
}
