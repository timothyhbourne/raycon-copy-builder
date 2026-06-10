"use client";
import type { CampaignMeta } from "@/lib/schemas";

interface Props {
  meta: CampaignMeta;
  onChange: (meta: CampaignMeta) => void;
  onRegenerate: () => void;
  regenerating: boolean;
}

export default function MetaBlock({ meta, onChange, onRegenerate, regenerating }: Props) {
  const updateLine = (field: "subject_lines" | "preview_texts", index: number, value: string) => {
    const updated = [...meta[field]];
    updated[index] = value;
    onChange({ ...meta, [field]: updated });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg" style={{ padding: "32px 40px" }}>
      <div className="flex items-center justify-between mb-5">
        <span className="font-mono text-xs text-slate-400 uppercase tracking-wide">Subject Lines + Preview Text</span>
        <button
          onClick={onRegenerate}
          disabled={regenerating}
          className="text-xs text-slate-500 hover:text-slate-900 px-2 py-0.5 rounded hover:bg-slate-100 transition-colors disabled:opacity-50"
        >
          {regenerating ? "Regenerating..." : "↻ regenerate all"}
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <div className="font-mono text-xs text-slate-400 uppercase tracking-wide mb-2" style={{ fontSize: "11px" }}>Subject Lines</div>
          <div className="space-y-2">
            {meta.subject_lines.map((line, i) => (
              <div key={i} className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-slate-300 w-4 shrink-0">{i + 1}</span>
                <input
                  value={line}
                  onChange={(e) => updateLine("subject_lines", i, e.target.value)}
                  className="flex-1 text-slate-900 text-sm border-b border-transparent focus:border-slate-200 focus:outline-none py-0.5 bg-transparent"
                />
                <span className={`font-mono text-xs shrink-0 ${line.length > 50 ? "text-red-400" : "text-slate-300"}`}>
                  {line.length}/50
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="font-mono text-xs text-slate-400 uppercase tracking-wide mb-2" style={{ fontSize: "11px" }}>Preview Text</div>
          <div className="space-y-2">
            {meta.preview_texts.map((text, i) => (
              <div key={i} className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-slate-300 w-4 shrink-0">{i + 1}</span>
                <input
                  value={text}
                  onChange={(e) => updateLine("preview_texts", i, e.target.value)}
                  className="flex-1 text-slate-900 text-sm border-b border-transparent focus:border-slate-200 focus:outline-none py-0.5 bg-transparent"
                />
                <span className={`font-mono text-xs shrink-0 ${text.length > 90 ? "text-red-400" : "text-slate-300"}`}>
                  {text.length}/90
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
