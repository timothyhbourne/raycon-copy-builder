"use client";
import { useState } from "react";
import type { GeneratedSection, ProductInGrid } from "@/lib/schemas";
import EditableField from "./EditableField";
import RepetitionChip from "./RepetitionChip";
import { elementKey, gridProductKey, type RepetitionFlag } from "@/lib/repetition-client";

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
  onInsertAfter: () => void;
  /** Design feature — only wired up for header sections */
  onDesign?: () => void;
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
}: Props) {
  const [hovered, setHovered] = useState(false);
  const [draggingProduct, setDraggingProduct] = useState<number | null>(null);
  const [dragOverProduct, setDragOverProduct] = useState<number | null>(null);

  const flagFor = (key: string): RepetitionFlag | undefined => flags?.[key];

  const updateElement = (key: string, value: string | ProductInGrid[]) => {
    onChange({ ...section, elements: { ...section.elements, [key]: value } });
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

  const renderElement = (key: string, value: string | ProductInGrid[]) => {
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
    if (typeof value !== "string" || value === null || value === undefined) return null;
    return (
      <EditableField
        value={value}
        onChange={(v) => updateElement(key, v)}
        multiline={key !== "Headline" && key !== "Tagline" && key !== "CTA" && key !== "Subheader" && key !== "Closing Line"}
      />
    );
  };

  const elements = Object.entries(section.elements).filter(([, v]) => v !== null && v !== undefined && v !== "");

  return (
    <div className="relative group" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div className="bg-white border border-slate-200 rounded-lg section-block" style={{ padding: "32px 40px" }}>
        {/* Section label + controls */}
        <div className={`flex items-center justify-between mb-4 transition-opacity ${hovered ? "opacity-100" : "opacity-0"}`}>
          <span className="t-label">{section.type}</span>
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
          {elements.map(([key, value]) => {
            const isSubheaderWithVariants = key === "Subheader" && (section.subheader_variants?.length ?? 0) > 1;
            const flag = flagFor(elementKey(section.id, key));
            return (
              <div key={key}>
                <div className="t-label mb-1 flex items-center gap-2">
                  {key}
                  {isSubheaderWithVariants && (
                    <span className="text-indigo-400 normal-case tracking-normal">· {section.subheader_variants!.length} options, pick one</span>
                  )}
                  {flag && <RepetitionChip flag={flag} onDismiss={() => onDismissFlag?.(elementKey(section.id, key))} />}
                </div>
                {isSubheaderWithVariants
                  ? renderSubheaderVariants()
                  : renderElement(key, value as string | ProductInGrid[])}
              </div>
            );
          })}
        </div>
      </div>

      {/* Insert after affordance */}
      <div
        className="insert-divider flex items-center gap-2 py-1 px-2 cursor-pointer group/insert"
        onClick={onInsertAfter}
      >
        <div className="flex-1 h-px bg-slate-200 group-hover/insert:bg-slate-400 transition-colors" />
        <span className="text-xs text-slate-400 group-hover/insert:text-slate-600 transition-colors">+ insert section</span>
        <div className="flex-1 h-px bg-slate-200 group-hover/insert:bg-slate-400 transition-colors" />
      </div>
    </div>
  );
}
