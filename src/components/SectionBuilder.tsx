"use client";
import { useState } from "react";
import type { SectionSpec, SectionType } from "@/lib/schemas";
import { OPTIONAL_ELEMENTS } from "@/lib/schemas";
import { nanoid } from "@/lib/nanoid";

const SECTION_TYPES: SectionType[] = [
  "header", "body", "usps", "product_card", "product_grid", "reviews", "cta_bridge", "footer_cta",
];

interface Props {
  sections: SectionSpec[];
  onChange: (sections: SectionSpec[]) => void;
  /** Number of products currently selected — used to validate grid dimensions */
  productsCount?: number;
}

export default function SectionBuilder({ sections, onChange, productsCount }: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);

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
    setDragOver(id);
  };
  const onDrop = (targetId: string) => {
    if (!dragging || dragging === targetId) return;
    const from = sections.findIndex((s) => s.id === dragging);
    const to = sections.findIndex((s) => s.id === targetId);
    const updated = [...sections];
    const [item] = updated.splice(from, 1);
    updated.splice(to, 0, item);
    onChange(updated);
    setDragging(null);
    setDragOver(null);
  };

  return (
    <div className="space-y-1">
      {sections.map((s) => {
        const optionalAvailable = OPTIONAL_ELEMENTS[s.type] ?? [];
        const optionalActive = s.optional_elements ?? [];
        return (
          <div
            key={s.id}
            draggable
            onDragStart={() => onDragStart(s.id)}
            onDragOver={(e) => onDragOver(e, s.id)}
            onDrop={() => onDrop(s.id)}
            onDragEnd={() => { setDragging(null); setDragOver(null); }}
            className={`flex items-start gap-2 p-2 rounded border text-sm transition-all ${
              dragOver === s.id ? "border-slate-400 bg-slate-50" : "border-slate-200 bg-white"
            }`}
          >
            <span className="cursor-grab text-slate-400 mt-0.5 select-none">⠿</span>
            <div className="flex-1 min-w-0">
              <div className="t-label text-slate-500 mb-1">{s.type}</div>
              <input
                type="text"
                value={s.focus || ""}
                onChange={(e) => updateFocus(s.id, e.target.value)}
                placeholder="Focus for this section (optional)"
                className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-slate-400 bg-slate-50"
              />
              {optionalAvailable.length > 0 && (
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
                            ? "bg-slate-700 text-white border-slate-700"
                            : "bg-white text-slate-400 border-slate-200 hover:border-slate-400 hover:text-slate-600"
                        }`}
                      >
                        {active ? "✓ " : "+ "}{el}
                      </button>
                    );
                  })}
                </div>
              )}
              {s.type === "product_grid" && (() => {
                const cols = s.grid_cols ?? 2;
                const rows = s.grid_rows ?? 2;
                const cellCount = cols * rows;
                const mismatch = productsCount !== undefined && productsCount > 0 && cellCount !== productsCount;
                return (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 shrink-0">Grid</span>
                      <select
                        value={cols}
                        onChange={(e) => updateGridCols(s.id, Number(e.target.value))}
                        className="text-xs border border-slate-200 rounded px-1.5 py-0.5 bg-white focus:outline-none focus:border-slate-400"
                      >
                        {[1,2,3,4,5,6].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <span className="text-xs text-slate-400">cols ×</span>
                      <select
                        value={rows}
                        onChange={(e) => updateGridRows(s.id, Number(e.target.value))}
                        className="text-xs border border-slate-200 rounded px-1.5 py-0.5 bg-white focus:outline-none focus:border-slate-400"
                      >
                        {[1,2,3,4,5,6].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <span className="text-xs text-slate-400">rows = {cellCount} products</span>
                    </div>
                    {mismatch && (
                      <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                        Grid has {cellCount} cells but {productsCount} product{productsCount === 1 ? "" : "s"} selected. Adjust the grid or the product selection to match.
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            <button
              type="button"
              onClick={() => remove(s.id)}
              className="text-slate-300 hover:text-red-400 transition-colors mt-0.5 text-xs"
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
          className="w-full text-xs text-slate-400 hover:text-slate-700 border border-dashed border-slate-300 rounded py-1.5 transition-colors"
        >
          + Add section
        </button>
        {showAddMenu && (
          <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white border border-slate-200 rounded shadow-lg py-1">
            {SECTION_TYPES.map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => addSection(t)}
                className="w-full text-left px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 transition-colors"
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
