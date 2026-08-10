"use client";
import { useState } from "react";
import type { SectionSpec, SectionType, BundleMode, UspSlot, UspSource } from "@/lib/schemas";
import {
  OPTIONAL_ELEMENTS, REMOVABLE_ELEMENTS, isProductCardType, BUNDLE_TEMPLATES,
  uspSlotsOf, USP_SLOT_MIN, USP_SLOT_MAX,
} from "@/lib/schemas";
import { PRODUCT_CATEGORIES, getProductName } from "@/lib/products";
import { hasUspBank } from "@/lib/usps-coverage";
import { RAYCON_BUNDLES, getBundle, bundleContentsLabel } from "@/lib/bundles";
import { nanoid } from "@/lib/nanoid";

const ALL_CATALOGUE_PRODUCTS = PRODUCT_CATEGORIES.flatMap((c) => c.products);

const SECTION_TYPES: SectionType[] = [
  "header", "body", "free_form", "usps", "product_card", "product_card_review", "product_grid", "reviews", "cta_bridge", "footer_cta",
];

interface Props {
  sections: SectionSpec[];
  onChange: (sections: SectionSpec[]) => void;
  /** Number of products currently selected — used to validate grid dimensions */
  productsCount?: number;
  /** The featured products (id + name) — used for the per-card product picker. */
  selectedProducts?: { id: string; name: string }[];
}

export default function SectionBuilder({ sections, onChange, productsCount, selectedProducts = [] }: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  // Per-slot focus inputs are collapsed by default so the slot list stays compact.
  const [openFocus, setOpenFocus] = useState<Set<string>>(new Set());
  const focusKey = (id: string, idx: number) => `${id}:${idx}`;
  const toggleFocusOpen = (id: string, idx: number) => {
    setOpenFocus((prev) => {
      const next = new Set(prev);
      const k = focusKey(id, idx);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const updateFocus = (id: string, focus: string) => {
    onChange(sections.map((s) => (s.id === id ? { ...s, focus } : s)));
  };

  const remove = (id: string) => {
    onChange(sections.filter((s) => s.id !== id));
  };

  const updateGridCols = (id: string, cols: number) => {
    onChange(sections.map((s) => (s.id === id ? { ...s, grid_cols: cols } : s)));
  };
  const updateGridRows = (id: string, rows: number) => {
    onChange(sections.map((s) => (s.id === id ? { ...s, grid_rows: rows } : s)));
  };
  // "" = Auto (assign in featured-products order at expansion time).
  const updateProductSlug = (id: string, slug: string) => {
    onChange(sections.map((s) => (s.id === id ? { ...s, product_slug: slug || undefined } : s)));
  };

  const patchSection = (id: string, patch: Partial<SectionSpec>) => {
    onChange(sections.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };
  const setBundleMode = (id: string, mode: BundleMode) => {
    // Switching source clears the previous selection so the two modes don't
    // leave stale ids/products behind.
    patchSection(id, { bundle_mode: mode, bundle_id: undefined, bundle_products: [] });
  };
  const pickExistingBundle = (id: string, bundleId: string) => {
    const b = getBundle(bundleId);
    patchSection(id, { bundle_id: bundleId || undefined, bundle_products: b?.products ?? [] });
  };
  const toggleBundleProduct = (id: string, slug: string) => {
    const s = sections.find((x) => x.id === id);
    const cur = s?.bundle_products ?? [];
    patchSection(id, {
      bundle_products: cur.includes(slug) ? cur.filter((p) => p !== slug) : [...cur, slug],
    });
  };

  // ---- USP slots ----------------------------------------------------------
  // Editing always writes an EXPLICIT usp_slots array (uspSlotsOf materialises
  // the legacy 3-slot default first), so a touched section stops depending on
  // the fallback and round-trips exactly as configured.
  const setSlots = (id: string, next: UspSlot[]) => patchSection(id, { usp_slots: next });
  const updateSlot = (id: string, idx: number, patch: Partial<UspSlot>) => {
    const s = sections.find((x) => x.id === id);
    if (!s) return;
    setSlots(id, uspSlotsOf(s).map((slot, i) => (i === idx ? { ...slot, ...patch } : slot)));
  };
  const setSlotSource = (id: string, idx: number, source: UspSource) => {
    // Switching to Company drops the product binding rather than leaving it stale.
    updateSlot(id, idx, source === "company" ? { source, product_slug: undefined } : { source });
  };
  const addSlot = (id: string) => {
    const s = sections.find((x) => x.id === id);
    if (!s) return;
    const cur = uspSlotsOf(s);
    if (cur.length >= USP_SLOT_MAX) return;
    setSlots(id, [...cur, { source: "product" }]);
  };
  const removeSlot = (id: string, idx: number) => {
    const s = sections.find((x) => x.id === id);
    if (!s) return;
    const cur = uspSlotsOf(s);
    if (cur.length <= USP_SLOT_MIN) return; // a usps section keeps at least 2
    setSlots(id, cur.filter((_, i) => i !== idx));
  };

  // Removable elements are the inverse of optional ones: active by default,
  // clicked OFF. That is what lets a USPs section sit under a product card with
  // no subheader of its own.
  const toggleRemovedElement = (id: string, element: string) => {
    onChange(sections.map((s) => {
      if (s.id !== id) return s;
      const current = s.removed_elements ?? [];
      const updated = current.includes(element)
        ? current.filter((e) => e !== element)
        : [...current, element];
      return { ...s, removed_elements: updated.length ? updated : undefined };
    }));
  };

  const toggleOptionalElement = (id: string, element: string) => {
    onChange(sections.map((s) => {
      if (s.id !== id) return s;
      const current = s.optional_elements ?? [];
      const updated = current.includes(element)
        ? current.filter((e) => e !== element)
        : [...current, element];
      return { ...s, optional_elements: updated };
    }));
  };

  const addSection = (type: SectionType) => {
    onChange([...sections, { id: nanoid(), type }]);
    setShowAddMenu(false);
  };

  const onDragStart = (id: string) => setDragging(id);
  const onDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    // Don't draw a drop-line on the row being dragged itself.
    if (id !== dragging) setDragOver(id);
  };
  // Drop places the dragged section AFTER the hovered one — matching the purple
  // drop-line drawn under that row, so the landing spot is unambiguous.
  const onDrop = (targetId: string) => {
    if (!dragging || dragging === targetId) return;
    const updated = [...sections];
    const from = updated.findIndex((s) => s.id === dragging);
    const [item] = updated.splice(from, 1);
    const targetIdx = updated.findIndex((s) => s.id === targetId);
    updated.splice(targetIdx + 1, 0, item);
    onChange(updated);
    setDragging(null);
    setDragOver(null);
  };

  return (
    <div className="space-y-1">
      {sections.map((s) => {
        const optionalAvailable = OPTIONAL_ELEMENTS[s.type] ?? [];
        const optionalActive = s.optional_elements ?? [];
        const removableAvailable = REMOVABLE_ELEMENTS[s.type] ?? [];
        const removedActive = s.removed_elements ?? [];
        return (
          <div
            key={s.id}
            draggable
            onDragStart={() => onDragStart(s.id)}
            onDragOver={(e) => onDragOver(e, s.id)}
            onDrop={() => onDrop(s.id)}
            onDragEnd={() => { setDragging(null); setDragOver(null); }}
            className={`flex items-start gap-2 p-2 rounded border border-line bg-white text-sm transition-all ${
              dragging === s.id ? "opacity-40" : ""
            } ${
              // Purple drop-line under the hovered row = "the section lands here".
              dragOver === s.id ? "shadow-[inset_0_-3px_0_0_var(--color-accent)]" : ""
            }`}
          >
            <span className="cursor-grab text-ink-tertiary mt-0.5 select-none">⠿</span>
            <div className="flex-1 min-w-0">
              <div className="t-label text-ink-tertiary mb-1">{s.type}</div>
              <input
                type="text"
                value={s.focus || ""}
                onChange={(e) => updateFocus(s.id, e.target.value)}
                placeholder="Focus for this section (optional)"
                className="w-full text-xs border border-line rounded px-2 py-1 focus:outline-none focus:border-line-strong bg-sunken"
              />
              {(optionalAvailable.length > 0 || removableAvailable.length > 0) && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {optionalAvailable.map((el) => {
                    const active = optionalActive.includes(el);
                    return (
                      <button
                        key={el}
                        type="button"
                        onClick={() => toggleOptionalElement(s.id, el)}
                        className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                          active
                            ? "bg-ink-secondary text-white border-ink-secondary"
                            : "bg-white text-ink-tertiary border-line hover:border-line-strong hover:text-ink-secondary"
                        }`}
                      >
                        {active ? "✓ " : "+ "}{el}
                      </button>
                    );
                  })}
                  {/* Inverse chips: ON by default, click to switch the element off. */}
                  {removableAvailable.map((el) => {
                    const on = !removedActive.includes(el);
                    return (
                      <button
                        key={`rm-${el}`}
                        type="button"
                        onClick={() => toggleRemovedElement(s.id, el)}
                        title={on ? `Remove ${el} from this section` : `Add ${el} back`}
                        className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                          on
                            ? "bg-ink-secondary text-white border-ink-secondary"
                            : "bg-white text-ink-muted border-line line-through hover:border-line-strong hover:text-ink-tertiary"
                        }`}
                      >
                        {on ? "✓ " : "✕ "}{el}
                      </button>
                    );
                  })}
                </div>
              )}
              {s.type === "usps" && (() => {
                const slots = uspSlotsOf(s);
                return (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-ink-tertiary">USPs</span>
                      <span className="text-xs text-ink-muted">{slots.length} of {USP_SLOT_MAX}</span>
                    </div>
                    {slots.map((slot, idx) => {
                      const showFocus = openFocus.has(focusKey(s.id, idx)) || !!slot.focus;
                      const noBank = slot.source === "product" && !!slot.product_slug && !hasUspBank(slot.product_slug);
                      return (
                        <div key={idx} className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-ink-tertiary w-3 shrink-0">{idx + 1}</span>
                            <select
                              value={slot.source}
                              onChange={(e) => setSlotSource(s.id, idx, e.target.value as UspSource)}
                              className="text-xs border border-line rounded px-1.5 py-0.5 bg-white focus:outline-none focus:border-line-strong"
                            >
                              <option value="product">Product</option>
                              <option value="company">Company</option>
                            </select>
                            {slot.source === "product" && (
                              <select
                                value={slot.product_slug ?? ""}
                                onChange={(e) => updateSlot(s.id, idx, { product_slug: e.target.value || undefined })}
                                className="text-xs border border-line rounded px-1.5 py-0.5 bg-white focus:outline-none focus:border-line-strong min-w-0 flex-1"
                              >
                                <option value="">Auto (hero product)</option>
                                {selectedProducts.map((p) => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                              </select>
                            )}
                            <button
                              type="button"
                              onClick={() => toggleFocusOpen(s.id, idx)}
                              title="Steer this one USP"
                              className={`text-xs px-1.5 py-0.5 rounded border transition-colors ml-auto ${
                                slot.focus
                                  ? "border-line-strong text-ink-secondary"
                                  : "border-transparent text-ink-muted hover:text-ink-tertiary"
                              }`}
                            >
                              focus
                            </button>
                            <button
                              type="button"
                              onClick={() => removeSlot(s.id, idx)}
                              disabled={slots.length <= USP_SLOT_MIN}
                              title={slots.length <= USP_SLOT_MIN ? `A USPs section keeps at least ${USP_SLOT_MIN}` : "Remove this USP"}
                              className="text-xs text-ink-muted hover:text-danger-600 disabled:opacity-30 disabled:hover:text-ink-muted transition-colors"
                            >
                              ✕
                            </button>
                          </div>
                          {showFocus && (
                            <input
                              type="text"
                              value={slot.focus ?? ""}
                              onChange={(e) => updateSlot(s.id, idx, { focus: e.target.value || undefined })}
                              placeholder="Steer this USP (e.g. lead on battery)"
                              className="w-full text-xs border border-line rounded px-2 py-1 ml-4 focus:outline-none focus:border-line-strong bg-sunken"
                            />
                          )}
                          {noBank && (
                            <div className="text-xs text-warning-600 bg-warning-50 border border-warning-200 rounded px-2 py-1 ml-4">
                              No USPs recorded for {getProductName(slot.product_slug as string)} — add them in data/product-usps.md.
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => addSlot(s.id)}
                      disabled={slots.length >= USP_SLOT_MAX}
                      className="text-xs text-ink-tertiary hover:text-ink-secondary disabled:opacity-40 disabled:hover:text-ink-tertiary transition-colors"
                    >
                      + Add USP
                    </button>
                    {slots.some((x) => x.source === "product") && selectedProducts.length === 0 && (
                      <div className="text-xs text-warning-600 bg-warning-50 border border-warning-200 rounded px-2 py-1">
                        Select featured products first — a product USP needs a product to draw from.
                      </div>
                    )}
                  </div>
                );
              })()}
              {s.type === "product_grid" && (() => {
                const cols = s.grid_cols ?? 2;
                const rows = s.grid_rows ?? 2;
                const cellCount = cols * rows;
                const mismatch = productsCount !== undefined && productsCount > 0 && cellCount !== productsCount;
                return (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-ink-tertiary shrink-0">Grid</span>
                      <select
                        value={cols}
                        onChange={(e) => updateGridCols(s.id, Number(e.target.value))}
                        className="text-xs border border-line rounded px-1.5 py-0.5 bg-white focus:outline-none focus:border-line-strong"
                      >
                        {[1,2,3,4,5,6].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <span className="text-xs text-ink-tertiary">cols ×</span>
                      <select
                        value={rows}
                        onChange={(e) => updateGridRows(s.id, Number(e.target.value))}
                        className="text-xs border border-line rounded px-1.5 py-0.5 bg-white focus:outline-none focus:border-line-strong"
                      >
                        {[1,2,3,4,5,6].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <span className="text-xs text-ink-tertiary">rows = {cellCount} products</span>
                    </div>
                    {mismatch && (
                      <div className="text-xs text-warning-600 bg-warning-50 border border-warning-200 rounded px-2 py-1">
                        Grid has {cellCount} cells but {productsCount} product{productsCount === 1 ? "" : "s"} selected. Adjust the grid or the product selection to match.
                      </div>
                    )}
                  </div>
                );
              })()}
              {isProductCardType(s.type) && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-ink-tertiary shrink-0">Product</span>
                  {selectedProducts.length === 0 ? (
                    <span className="text-xs text-warning-600">Select featured products first</span>
                  ) : (
                    <select
                      value={s.product_slug ?? ""}
                      onChange={(e) => updateProductSlug(s.id, e.target.value)}
                      className="text-xs border border-line rounded px-1.5 py-0.5 bg-white focus:outline-none focus:border-line-strong"
                    >
                      <option value="">Auto (assign in order)</option>
                      {selectedProducts.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              {s.type === "bundle" && (() => {
                const mode = s.bundle_mode ?? "custom";
                const template = s.bundle_template ?? "unified";
                const chosen = s.bundle_products ?? [];
                const tmplHint = BUNDLE_TEMPLATES.find((t) => t.id === template)?.hint;
                return (
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-ink-tertiary shrink-0 w-16">Source</span>
                      <select
                        value={mode}
                        onChange={(e) => setBundleMode(s.id, e.target.value as BundleMode)}
                        className="text-xs border border-line rounded px-1.5 py-0.5 bg-white focus:outline-none focus:border-line-strong"
                      >
                        <option value="custom">Custom bundle</option>
                        <option value="existing">Existing Raycon bundle</option>
                      </select>
                    </div>

                    {mode === "existing" ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-ink-tertiary shrink-0 w-16">Bundle</span>
                        <select
                          value={s.bundle_id ?? ""}
                          onChange={(e) => pickExistingBundle(s.id, e.target.value)}
                          className="text-xs border border-line rounded px-1.5 py-0.5 bg-white focus:outline-none focus:border-line-strong max-w-full"
                        >
                          <option value="">Choose a bundle…</option>
                          {RAYCON_BUNDLES.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name} — {bundleContentsLabel(b)}{b.verified === false ? " (unverified)" : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2">
                        <span className="text-xs text-ink-tertiary shrink-0 w-16 mt-1">Products</span>
                        <div className="flex-1 min-w-0">
                          {chosen.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-1">
                              {chosen.map((id) => (
                                <button
                                  key={id}
                                  type="button"
                                  onClick={() => toggleBundleProduct(s.id, id)}
                                  className="text-xs px-2 py-0.5 rounded-full border border-line-strong bg-sunken text-ink-secondary hover:border-danger-200 hover:text-danger-600 transition-colors"
                                  title="Remove from bundle"
                                >
                                  {getProductName(id)} ✕
                                </button>
                              ))}
                            </div>
                          )}
                          <select
                            value=""
                            onChange={(e) => { if (e.target.value) toggleBundleProduct(s.id, e.target.value); }}
                            className="text-xs border border-line rounded px-1.5 py-0.5 bg-white focus:outline-none focus:border-line-strong"
                          >
                            <option value="">+ Add product…</option>
                            {ALL_CATALOGUE_PRODUCTS.filter((p) => !chosen.includes(p.id)).map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-ink-tertiary shrink-0 w-16">Layout</span>
                      <select
                        value={template}
                        onChange={(e) => patchSection(s.id, { bundle_template: e.target.value as SectionSpec["bundle_template"] })}
                        className="text-xs border border-line rounded px-1.5 py-0.5 bg-white focus:outline-none focus:border-line-strong"
                      >
                        {BUNDLE_TEMPLATES.map((t) => (
                          <option key={t.id} value={t.id}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                    {tmplHint && <div className="text-xs text-ink-tertiary pl-[4.5rem] leading-relaxed">{tmplHint}</div>}
                    {chosen.length < 2 && (
                      <div className="text-xs text-warning-600 bg-warning-50 border border-warning-200 rounded px-2 py-1">
                        A bundle needs at least 2 products. {mode === "existing" ? "Pick a bundle above." : "Add another product."}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            <button
              type="button"
              onClick={() => remove(s.id)}
              className="text-ink-muted hover:text-danger-600 transition-colors mt-0.5 text-xs"
            >
              ✕
            </button>
          </div>
        );
      })}

      <div className="relative">
        <button
          type="button"
          onClick={() => setShowAddMenu(!showAddMenu)}
          className="w-full text-xs text-ink-tertiary hover:text-ink-secondary border border-dashed border-line-strong rounded py-1.5 transition-colors"
        >
          + Add section
        </button>
        {showAddMenu && (
          <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white border border-line rounded shadow-lg py-1">
            {SECTION_TYPES.map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => addSection(t)}
                className="w-full text-left px-3 py-1.5 text-xs text-ink-secondary hover:bg-sunken transition-colors"
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
