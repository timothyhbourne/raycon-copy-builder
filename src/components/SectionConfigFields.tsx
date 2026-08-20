"use client";
import type { SectionSpec, BundleMode } from "@/lib/schemas";
import { BUNDLE_TEMPLATES, isProductCardType } from "@/lib/schemas";
import { PRODUCT_CATEGORIES, getProductName } from "@/lib/products";
import { RAYCON_BUNDLES, getBundle, bundleContentsLabel } from "@/lib/bundles";

// The per-type configuration a section needs: grid dimensions, bundle
// source/products/layout, and a product-card binding.
//
// Extracted so the pre-generation SectionBuilder and the on-canvas section picker
// render the SAME controls (spec §3.3). They were previously only in
// SectionBuilder, which is why product_grid and bundle could not be inserted onto
// a canvas at all — the configuration had nowhere to be collected.
//
// Pure and controlled: it renders from a spec and reports patches. It never owns
// state, so both callers keep their own update paths.

const ALL_CATALOGUE_PRODUCTS = PRODUCT_CATEGORIES.flatMap((c) => c.products);

const SELECT = "text-xs border border-line rounded px-1.5 py-0.5 bg-white focus:outline-none focus:border-line-strong";
const LABEL = "text-xs text-ink-tertiary shrink-0";

export interface SectionConfigFieldsProps {
  spec: SectionSpec;
  onPatch: (patch: Partial<SectionSpec>) => void;
  /** Featured products for the product-card binding dropdown. Empty = the picker
   * offers the whole catalogue instead (a scratch canvas has no brief yet). */
  selectedProducts?: { id: string; name: string }[];
  /** How many products the brief selected — drives the grid cell-count warning.
   * Undefined on a canvas insert, where there is no brief to disagree with. */
  productsCount?: number;
  /** Show the product-card binding row. The section picker collects it; the
   * pre-generation builder renders its own version with different copy. */
  includeProductCardBinding?: boolean;
}

export default function SectionConfigFields({
  spec,
  onPatch,
  selectedProducts = [],
  productsCount,
  includeProductCardBinding = false,
}: SectionConfigFieldsProps) {
  const setBundleMode = (mode: BundleMode) => {
    // Switching source clears the previous selection so the two modes don't leave
    // stale ids/products behind.
    onPatch({ bundle_mode: mode, bundle_id: undefined, bundle_products: [] });
  };
  const pickExistingBundle = (bundleId: string) => {
    const b = getBundle(bundleId);
    onPatch({ bundle_id: bundleId || undefined, bundle_products: b?.products ?? [] });
  };
  const toggleBundleProduct = (slug: string) => {
    const cur = spec.bundle_products ?? [];
    onPatch({ bundle_products: cur.includes(slug) ? cur.filter((p) => p !== slug) : [...cur, slug] });
  };

  if (spec.type === "product_grid") {
    const cols = spec.grid_cols ?? 2;
    const rows = spec.grid_rows ?? 2;
    const cellCount = cols * rows;
    const mismatch = productsCount !== undefined && productsCount > 0 && cellCount !== productsCount;
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={LABEL}>Grid</span>
          <select value={cols} onChange={(e) => onPatch({ grid_cols: Number(e.target.value) })} className={SELECT}>
            {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className={LABEL}>cols ×</span>
          <select value={rows} onChange={(e) => onPatch({ grid_rows: Number(e.target.value) })} className={SELECT}>
            {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className={LABEL}>rows = {cellCount} products</span>
        </div>
        {mismatch && (
          <div className="text-xs text-warning-600 bg-warning-50 border border-warning-200 rounded px-2 py-1">
            Grid has {cellCount} cells but {productsCount} product{productsCount === 1 ? "" : "s"} selected. Adjust the grid or the product selection to match.
          </div>
        )}
      </div>
    );
  }

  if (spec.type === "bundle") {
    const mode = spec.bundle_mode ?? "custom";
    const template = spec.bundle_template ?? "unified";
    const chosen = spec.bundle_products ?? [];
    const tmplHint = BUNDLE_TEMPLATES.find((t) => t.id === template)?.hint;
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className={`${LABEL} w-16`}>Source</span>
          <select value={mode} onChange={(e) => setBundleMode(e.target.value as BundleMode)} className={SELECT}>
            <option value="custom">Custom bundle</option>
            <option value="existing">Existing Raycon bundle</option>
          </select>
        </div>

        {mode === "existing" ? (
          <div className="flex items-center gap-2">
            <span className={`${LABEL} w-16`}>Bundle</span>
            <select
              value={spec.bundle_id ?? ""}
              onChange={(e) => pickExistingBundle(e.target.value)}
              className={`${SELECT} max-w-full`}
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
            <span className={`${LABEL} w-16 mt-1`}>Products</span>
            <div className="flex-1 min-w-0">
              {chosen.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1">
                  {chosen.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleBundleProduct(id)}
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
                onChange={(e) => { if (e.target.value) toggleBundleProduct(e.target.value); }}
                className={SELECT}
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
          <span className={`${LABEL} w-16`}>Layout</span>
          <select
            value={template}
            onChange={(e) => onPatch({ bundle_template: e.target.value as SectionSpec["bundle_template"] })}
            className={SELECT}
          >
            {BUNDLE_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
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
  }

  if (includeProductCardBinding && isProductCardType(spec.type)) {
    // On a canvas insert there may be no brief, so fall back to the full
    // catalogue rather than showing "select featured products first" on a surface
    // where there is nothing to select them in.
    const options = selectedProducts.length ? selectedProducts : ALL_CATALOGUE_PRODUCTS;
    return (
      <div className="flex items-center gap-2">
        <span className={LABEL}>Product</span>
        <select
          value={spec.product_slug ?? ""}
          onChange={(e) => onPatch({ product_slug: e.target.value || undefined })}
          className={SELECT}
        >
          <option value="">Auto (assign in order)</option>
          {options.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
    );
  }

  return null;
}

/** Whether a spec still needs input before it can be inserted. Keeps the picker's
 * "Insert" button honest: a bundle with one product would render a broken card. */
export function isSectionConfigComplete(spec: SectionSpec): boolean {
  if (spec.type === "bundle") return (spec.bundle_products ?? []).length >= 2;
  if (spec.type === "product_grid") return (spec.grid_cols ?? 2) * (spec.grid_rows ?? 2) >= 1;
  return true;
}
