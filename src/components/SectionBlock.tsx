"use client";
import { useState } from "react";
import type { GeneratedSection, ProductInGrid, SectionType } from "@/lib/schemas";
import { SECTION_CATALOGUE } from "@/lib/schemas";
import type { ProductReview } from "@/lib/reviews/fetch";
import EditableField from "./EditableField";
import RepetitionChip from "./RepetitionChip";
import { elementKey, gridProductKey, type RepetitionFlag } from "@/lib/repetition-client";

// Section types offered in the "insert section" dropdown. product_grid and
// bundle are omitted on purpose: they need dimensions / product+template config
// that is only chosen in the pre-generation Section Structure builder, so a
// blank one inserted here would have nothing meaningful to show.
const INSERTABLE_TYPES: SectionType[] = [
  "header", "body", "free_form", "usps", "product_card", "product_card_review", "reviews", "cta_bridge", "footer_cta",
];

interface Props {
  section: GeneratedSection;
  index: number;
  total: number;
  /** Number of columns for product_grid sections */
  gridCols?: number;
  /** Similarity flags keyed by element key (see repetition-client). */
  flags?: Record<string, RepetitionFlag>;
  onDismissFlag?: (key: string) => void;
  onChange: (s: GeneratedSection) => void;
  onRegenerate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onInsertAfter: (type: SectionType) => void;
  /** Design feature — only wired up for header sections */
  onDesign?: () => void;
  /** Product SKU this section's Review is about — drives the Review refresh
   * control (product_card_review: the card's product; reviews: the campaign's
   * featured product). Absent → no refresh control. */
  productSlug?: string;
}

export default function SectionBlock({
  section,
  index,
  total,
  gridCols,
  flags,
  onDismissFlag,
  onChange,
  onRegenerate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onInsertAfter,
  onDesign,
  productSlug,
}: Props) {
  const [hovered, setHovered] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const [draggingProduct, setDraggingProduct] = useState<number | null>(null);
  const [dragOverProduct, setDragOverProduct] = useState<number | null>(null);

  const flagFor = (key: string): RepetitionFlag | undefined => flags?.[key];

  const updateElement = (key: string, value: string | ProductInGrid[]) => {
    onChange({ ...section, elements: { ...section.elements, [key]: value } });
  };

  // Review refresh: cycle through real fetched reviews for this product; on
  // exhausting the list, re-pull fresh from the storefront (refresh=1). Swaps
  // both the review text and the attributed reviewer name. Never fabricates.
  const [reviewList, setReviewList] = useState<ProductReview[] | null>(null);
  const [reviewIdx, setReviewIdx] = useState(0);
  const [reviewBusy, setReviewBusy] = useState(false);
  const fmtReview = (r: ProductReview) => (r.author ? `${r.text} — ${r.author}` : r.text);
  const cycleReview = async () => {
    if (!productSlug || reviewBusy) return;
    setReviewBusy(true);
    try {
      let list = reviewList;
      if (!list) {
        const res = await fetch(`/api/reviews?product=${encodeURIComponent(productSlug)}&limit=5`);
        list = ((await res.json())?.reviews ?? []) as ProductReview[];
        setReviewList(list);
      }
      if (!list.length) return;
      let idx = reviewIdx + 1;
      if (idx >= list.length) {
        const res = await fetch(`/api/reviews?product=${encodeURIComponent(productSlug)}&limit=5&refresh=1`);
        list = ((await res.json())?.reviews ?? []) as ProductReview[];
        setReviewList(list);
        idx = 0;
      }
      if (list.length) {
        setReviewIdx(idx % list.length);
        updateElement("Review", fmtReview(list[idx % list.length]));
      }
    } catch { /* network hiccup — leave the current review in place */ }
    finally { setReviewBusy(false); }
  };

  // Subheader variant picker: elements.Subheader always mirrors the selected variant.
  const selectVariant = (i: number) => {
    const variants = section.subheader_variants ?? [];
    onChange({
      ...section,
      subheader_selected: i,
      elements: { ...section.elements, Subheader: variants[i] ?? "" },
    });
  };
  const editSelectedVariant = (text: string) => {
    const selected = section.subheader_selected ?? 0;
    const variants = [...(section.subheader_variants ?? [])];
    variants[selected] = text;
    onChange({
      ...section,
      subheader_variants: variants,
      elements: { ...section.elements, Subheader: text },
    });
  };

  const renderSubheaderVariants = () => {
    const variants = section.subheader_variants ?? [];
    const selected = section.subheader_selected ?? 0;
    return (
      <div className="space-y-1">
        {variants.map((v, i) => {
          const isSelected = i === selected;
          return (
            <div
              key={i}
              onClick={() => { if (!isSelected) selectVariant(i); }}
              className={`flex items-start gap-2 rounded border transition-colors ${
                isSelected
                  ? "border-slate-300 bg-slate-50"
                  : "border-transparent hover:border-slate-200 hover:bg-slate-50/50 cursor-pointer"
              }`}
            >
              <span
                className={`mt-2.5 ml-2 w-3 h-3 shrink-0 rounded-full border ${
                  isSelected ? "border-slate-700 bg-slate-700" : "border-slate-300 bg-white"
                }`}
              />
              {isSelected ? (
                <div className="flex-1 min-w-0">
                  <EditableField value={v} onChange={editSelectedVariant} multiline={false} />
                </div>
              ) : (
                <div className="flex-1 min-w-0 text-sm text-slate-500 px-2 py-1.5 leading-relaxed">{v}</div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderElement = (key: string, value: string | ProductInGrid[], placeholder?: string) => {
    if (key === "Products" && Array.isArray(value)) {
      const cols = gridCols ?? 1;
      return (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {value.map((p, i) => (
            <div
              key={i}
              draggable
              onDragStart={() => setDraggingProduct(i)}
              onDragOver={(e) => { e.preventDefault(); setDragOverProduct(i); }}
              onDrop={() => {
                if (draggingProduct === null || draggingProduct === i) return;
                const updated = [...value];
                [updated[draggingProduct], updated[i]] = [updated[i], updated[draggingProduct]];
                updateElement(key, updated);
                setDraggingProduct(null);
                setDragOverProduct(null);
              }}
              onDragEnd={() => { setDraggingProduct(null); setDragOverProduct(null); }}
              className={`border rounded-lg p-3 space-y-1.5 transition-all ${
                dragOverProduct === i && draggingProduct !== i
                  ? "border-slate-400 bg-slate-50 scale-[1.02]"
                  : draggingProduct === i
                  ? "border-slate-300 opacity-40"
                  : "border-slate-100"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="cursor-grab text-slate-300 hover:text-slate-400 select-none text-sm">⠿</span>
              </div>
              <div>
                <span className="t-label">name</span>
                <EditableField
                  value={p.name}
                  onChange={(v) => {
                    const updated = [...value];
                    updated[i] = { ...p, name: v };
                    updateElement(key, updated);
                  }}
                  multiline={false}
                />
              </div>
              <div>
                <span className="t-label">image direction</span>
                <EditableField
                  value={p.image_direction}
                  onChange={(v) => {
                    const updated = [...value];
                    updated[i] = { ...p, image_direction: v };
                    updateElement(key, updated);
                  }}
                />
              </div>
              <div>
                <span className="t-label">one-liner</span>
                {(() => {
                  const flag = flagFor(gridProductKey(section.id, i));
                  return flag ? (
                    <span className="ml-2"><RepetitionChip flag={flag} onDismiss={() => onDismissFlag?.(gridProductKey(section.id, i))} /></span>
                  ) : null;
                })()}
                <EditableField
                  value={p.one_liner}
                  onChange={(v) => {
                    const updated = [...value];
                    updated[i] = { ...p, one_liner: v };
                    updateElement(key, updated);
                  }}
                  multiline={false}
                />
              </div>
              <div>
                <span className="t-label">cta</span>
                <EditableField
                  value={p.cta}
                  onChange={(v) => {
                    const updated = [...value];
                    updated[i] = { ...p, cta: v };
                    updateElement(key, updated);
                  }}
                  multiline={false}
                />
              </div>
            </div>
          ))}
        </div>
      );
    }
    if (Array.isArray(value)) return null;
    return (
      <EditableField
        value={value ?? ""}
        onChange={(v) => updateElement(key, v)}
        placeholder={placeholder}
        multiline={key !== "Headline" && key !== "Tagline" && key !== "CTA" && key !== "Subheader" && key !== "Closing Line"}
      />
    );
  };

  // Fields to show: the section's OWN element order first (so generated copy ,
  // e.g. a bundle's USPs before its CTA , keeps the order it was written in),
  // then any catalogue elements still missing. Appending the missing catalogue
  // keys , even when empty , is what lets a freshly INSERTED blank section be
  // filled in; otherwise it renders as an empty box with nothing to type into.
  const catalogue = SECTION_CATALOGUE[section.type] ?? [];
  const presentKeys = Object.keys(section.elements);
  const missingCatalogue = catalogue.filter((k) => !presentKeys.includes(k));
  const elementKeys = [...presentKeys, ...missingCatalogue];

  return (
    <div className="relative group section-block" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div className="py-9">
        {/* Section label + controls — float quietly, revealed on hover/focus. */}
        <div className={`flex items-center justify-between mb-4 transition-opacity ${hovered || insertOpen ? "opacity-100" : "opacity-0"}`}>
          <span className="t-label">{section.type.replace(/_/g, " ")}</span>
          <div className="flex items-center gap-1">
            {index > 0 && (
              <button onClick={onMoveUp} className="text-xs text-slate-400 hover:text-slate-700 px-1.5 py-0.5 rounded hover:bg-slate-100 transition-colors" title="Move up">↑</button>
            )}
            {index < total - 1 && (
              <button onClick={onMoveDown} className="text-xs text-slate-400 hover:text-slate-700 px-1.5 py-0.5 rounded hover:bg-slate-100 transition-colors" title="Move down">↓</button>
            )}
            <button
              onClick={onRegenerate}
              className="text-xs text-slate-500 hover:text-slate-900 px-2 py-0.5 rounded hover:bg-slate-100 transition-colors"
            >
              ↻ regenerate
            </button>
            {onDesign && (
              <button
                onClick={onDesign}
                className="text-xs text-indigo-500 hover:text-indigo-700 px-2 py-0.5 rounded hover:bg-indigo-50 transition-colors"
              >
                {section.design_image ? "Regenerate design" : "Design this"}
              </button>
            )}
            <button
              onClick={onDelete}
              className="text-xs text-slate-400 hover:text-red-500 px-1.5 py-0.5 rounded hover:bg-slate-100 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Elements */}
        <div className="space-y-4">
          {elementKeys.map((key) => {
            const value = section.elements[key] ?? "";
            const isSubheaderWithVariants = key === "Subheader" && (section.subheader_variants?.length ?? 0) > 1;
            const flag = flagFor(elementKey(section.id, key));
            return (
              <div key={key}>
                <div className="t-label mb-1 flex items-center gap-2">
                  {key}
                  {isSubheaderWithVariants && (
                    <span className="text-indigo-400 normal-case tracking-normal">· {section.subheader_variants!.length} options, pick one</span>
                  )}
                  {key === "Review" && productSlug && (
                    <button type="button" onClick={cycleReview} disabled={reviewBusy}
                      title="Show a different real review"
                      className="normal-case tracking-normal text-indigo-500 hover:text-indigo-700 disabled:opacity-50 transition-colors inline-flex items-center gap-1">
                      <span className={reviewBusy ? "animate-spin inline-block" : "inline-block"}>↻</span> another review
                    </button>
                  )}
                  {flag && <RepetitionChip flag={flag} onDismiss={() => onDismissFlag?.(elementKey(section.id, key))} />}
                </div>
                {isSubheaderWithVariants
                  ? renderSubheaderVariants()
                  : renderElement(key, value as string | ProductInGrid[], `Write the ${key.toLowerCase()}…`)}
              </div>
            );
          })}
        </div>
      </div>

      {/* Insert-after affordance: a hairline that appears on hover, with a
          dropdown to choose which kind of section to drop in. */}
      <div className="insert-divider relative flex items-center gap-2 py-1" style={insertOpen ? { opacity: 1 } : undefined}>
        <div className="flex-1 h-px bg-slate-200" />
        <div className="relative">
          <button
            type="button"
            onClick={() => setInsertOpen((o) => !o)}
            className="text-xs text-slate-400 hover:text-slate-700 px-2 py-0.5 rounded hover:bg-slate-100 transition-colors whitespace-nowrap"
          >
            + insert section
          </button>
          {insertOpen && (
            <>
              {/* click-away backdrop */}
              <div className="fixed inset-0 z-10" onClick={() => setInsertOpen(false)} />
              <div className="absolute z-20 left-1/2 -translate-x-1/2 mt-1 bg-white border border-slate-200 rounded-md shadow-lg py-1 min-w-[190px]">
                <div className="t-label px-3 py-1 text-slate-400">Insert…</div>
                {INSERTABLE_TYPES.map((t) => (
                  <button
                    type="button"
                    key={t}
                    onClick={() => { onInsertAfter(t); setInsertOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    {t.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="flex-1 h-px bg-slate-200" />
      </div>
    </div>
  );
}
