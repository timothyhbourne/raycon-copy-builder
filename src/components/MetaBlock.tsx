"use client";
import type { CampaignMeta } from "@/lib/schemas";
import RepetitionChip from "./RepetitionChip";
import { metaKey, type RepetitionFlag } from "@/lib/repetition-client";

interface Props {
  meta: CampaignMeta;
  onChange: (meta: CampaignMeta) => void;
  onRegenerate: () => void;
  regenerating: boolean;
  flags?: Record<string, RepetitionFlag>;
  onDismissFlag?: (key: string) => void;
}

// The generator writes the three variants in a fixed slot order, each with its
// own identity. These labels mirror that order so the user can see why each
// line exists. See subject-line craft rules in prompts/generate.ts.
const LANE_LABELS = ["Advertorial", "Experimental", "Conversational"];

export default function MetaBlock({ meta, onChange, onRegenerate, regenerating, flags, onDismissFlag }: Props) {
  const updateLine = (field: "subject_lines" | "preview_texts", index: number, value: string) => {
    const updated = [...meta[field]];
    updated[index] = value;
    onChange({ ...meta, [field]: updated });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg" style={{ padding: "32px 40px" }}>
      <div className="flex items-center justify-between mb-5">
        <span className="t-label">Subject Lines + Preview Text</span>
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
          <div className="t-label mb-2">Subject Lines</div>
          <div className="space-y-2">
            {meta.subject_lines.map((line, i) => {
              const flag = flags?.[metaKey("subject", i)];
              return (
              <div key={i}>
                {LANE_LABELS[i] && (
                  <div className="t-label text-indigo-400 mb-0.5 ml-6 flex items-center gap-2">
                    {LANE_LABELS[i]}
                    {flag && <RepetitionChip flag={flag} onDismiss={() => onDismissFlag?.(metaKey("subject", i))} />}
                  </div>
                )}
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-slate-300 w-4 shrink-0">{i + 1}</span>
                  <input
                    value={line}
                    onChange={(e) => updateLine("subject_lines", i, e.target.value)}
                    className="flex-1 text-slate-900 text-sm border-b border-transparent focus:border-slate-200 focus:outline-none py-0.5 bg-transparent"
                  />
                  <span className={`font-mono text-xs shrink-0 tabular-nums ${line.length > 50 ? "text-red-400" : "text-slate-300"}`}>
                    {line.length}/50
                  </span>
                </div>
              </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="t-label mb-2">Preview Text</div>
          <div className="space-y-2">
            {meta.preview_texts.map((text, i) => {
              const flag = flags?.[metaKey("preview", i)];
              return (
              <div key={i}>
                {LANE_LABELS[i] && (
                  <div className="t-label text-indigo-400 mb-0.5 ml-6 flex items-center gap-2">
                    {LANE_LABELS[i]}
                    {flag && <RepetitionChip flag={flag} onDismiss={() => onDismissFlag?.(metaKey("preview", i))} />}
                  </div>
                )}
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-slate-300 w-4 shrink-0">{i + 1}</span>
                  <input
                    value={text}
                    onChange={(e) => updateLine("preview_texts", i, e.target.value)}
                    className="flex-1 text-slate-900 text-sm border-b border-transparent focus:border-slate-200 focus:outline-none py-0.5 bg-transparent"
                  />
                  <span className={`font-mono text-xs shrink-0 tabular-nums ${text.length > 90 ? "text-red-400" : "text-slate-300"}`}>
                    {text.length}/90
                  </span>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
