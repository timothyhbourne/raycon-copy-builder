"use client";
import { useState } from "react";

interface Props {
  sectionType: string;
  defaultTone: number;
  onConfirm: (steering: string, toneDial: number) => void;
  onClose: () => void;
}

const TONE_LABELS: Record<number, string> = {
  1: "By the book",
  2: "Mostly safe",
  3: "Balanced",
  4: "Creative",
  5: "Experimental",
};

export default function RegenerateModal({ sectionType, defaultTone, onConfirm, onClose }: Props) {
  const [steering, setSteering] = useState("");
  const [tone, setTone] = useState(defaultTone);

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-mono text-xs text-slate-500 uppercase tracking-wide mb-1">Regenerate</div>
        <h3 className="font-semibold text-slate-900 mb-4">{sectionType} section</h3>

        <label className="block text-sm text-slate-600 mb-2">
          Steering (optional)
        </label>
        <textarea
          value={steering}
          onChange={(e) => setSteering(e.target.value)}
          rows={3}
          className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-slate-400 resize-none"
          placeholder="e.g. Make it punchier and benefit-led so it's easier to decide to buy"
          autoFocus
        />

        <div className="mt-4">
          <div className="flex items-center justify-between mb-1">
            <label className="font-mono text-xs text-slate-500 uppercase tracking-wide">Tone</label>
            <span className={`font-mono text-xs px-2 py-0.5 rounded ${
              tone >= 4 ? "bg-amber-50 text-amber-600" :
              tone === 3 ? "bg-slate-100 text-slate-600" :
              "bg-slate-50 text-slate-400"
            }`}>
              {TONE_LABELS[tone]}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-slate-400 shrink-0">Conservative</span>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={tone}
              onChange={(e) => setTone(Number(e.target.value))}
              className="flex-1 accent-slate-900"
            />
            <span className="font-mono text-xs text-slate-400 shrink-0">Experimental</span>
          </div>
          {tone !== defaultTone && (
            <div className="font-mono text-[11px] text-slate-400 mt-1">
              Campaign default is {TONE_LABELS[defaultTone]}. This regeneration only affects this section.
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-5">
          <button
            onClick={() => onConfirm(steering, tone)}
            className="flex-1 bg-slate-900 text-white py-2 rounded-md text-sm font-medium hover:bg-slate-700 transition-colors"
          >
            Regenerate
          </button>
          <button
            onClick={onClose}
            className="flex-1 border border-slate-200 text-slate-600 py-2 rounded-md text-sm hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
