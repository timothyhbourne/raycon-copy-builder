"use client";
import type { Conceit } from "@/lib/schemas";

interface Props {
  conceits: Conceit[];
  chosen: Conceit | null;
  onPick: (c: Conceit) => void;
}

export default function ConceitPicker({ conceits, chosen, onPick }: Props) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-mono text-slate-500 uppercase tracking-wide">Choose a conceit</p>
      {conceits.map((c) => (
        <button
          key={c.id}
          onClick={() => onPick(c)}
          className={`w-full text-left p-4 rounded-lg border transition-all ${
            chosen?.id === c.id
              ? "border-slate-900 bg-slate-50 shadow-sm"
              : "border-slate-200 bg-white hover:border-slate-400"
          }`}
        >
          <div className="font-semibold text-slate-900 mb-1">{c.name}</div>
          <div className="text-sm text-slate-600 leading-relaxed">{c.description}</div>
        </button>
      ))}
    </div>
  );
}
