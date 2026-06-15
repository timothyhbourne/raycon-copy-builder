"use client";
import { useState } from "react";
import type { GeneratedSection, ProductInGrid } from "@/lib/schemas";
import EditableField from "./EditableField";

interface Props {
  section: GeneratedSection;
  index: number;
  total: number;
  /** Number of columns for product_grid sections */
  gridCols?: number;
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

  const updateElement = (key: string, value: string | ProductInGrid[]) => {
    onChange({ ...section, elements: { ...section.elements, [key]: value } });
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
                <span className="font-mono text-xs text-slate-400 uppercase tracking-wide">name</span>
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
                <span className="font-mono text-xs text-slate-400 uppercase tracking-wide">image direction</span>
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
                <span className="font-mono text-xs text-slate-400 uppercase tracking-wide">one-liner</span>
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
                <span className="font-mono text-xs text-slate-400 uppercase tracking-wide">cta</span>
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
          <span className="font-mono text-xs text-slate-400 uppercase tracking-wide">{section.type}</span>
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
                {section.design_html ? "Regenerate design" : "Design this"}
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
          {elements.map(([key, value]) => (
            <div key={key}>
              <div className="font-mono text-xs text-slate-400 uppercase tracking-wide mb-1" style={{ fontSize: "11px" }}>
                {key}
              </div>
              {renderElement(key, value as string | ProductInGrid[])}
            </div>
          ))}
        </div>
      </div>

      {/* Insert after affordance */}
      <div
        className="insert-divider flex items-center gap-2 py-1 px-2 cursor-pointer group/insert"
        onClick={onInsertAfter}
      >
        <div className="flex-1 h-px bg-slate-200 group-hover/insert:bg-slate-400 transition-colors" />
        <span className="text-xs text-slate-400 group-hover/insert:text-slate-600 font-mono transition-colors">+ insert section</span>
        <div className="flex-1 h-px bg-slate-200 group-hover/insert:bg-slate-400 transition-colors" />
      </div>
    </div>
  );
}
