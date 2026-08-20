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
  /** Why "regenerate all" cannot run yet (a scratch canvas with no brief). The
   * button renders disabled with this as its tooltip rather than silently doing
   * nothing (spec 2.3). */
  disabledReason?: string;
}

// The generator writes the three variants in a fixed slot order, each with its
// own identity. These labels mirror that order so the user can see why each
// line exists. See subject-line craft rules in prompts/generate.ts.
const LANE_LABELS = ["Advertorial", "Experimental", "Conversational"];

export default function MetaBlock({ meta, onChange, onRegenerate, regenerating, flags, onDismissFlag, disabledReason }: Props) {
  const updateLine = (field: "subject_lines" | "preview_texts", index: number, value: string) => {
    const updated = [...meta[field]];
    updated[index] = value;
    onChange({ ...meta, [field]: updated });
  };

  // WHICH ONE SHIPS. Three subject lines are written and one is sent, and until
  // now nothing recorded which — so all three entered the learning corpus equally
  // weighted when only one was ever seen by a customer
  // (docs/RECURSIVE_LEARNING_FRAMEWORK_SPEC.md §2.7). Defaults to the first, which
  // is what the team was implicitly doing anyway.
  const subjectSelected = meta.subject_selected ?? 0;
  const previewSelected = meta.preview_selected ?? 0;
  const select = (field: "subject_selected" | "preview_selected", index: number) => {
    onChange({ ...meta, [field]: index });
  };
  const radio = (isSelected: boolean, onSelect: () => void, label: string) => (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      aria-pressed={isSelected}
      title={isSelected ? "This is the one that ships" : "Mark this as the one that ships"}
      className={`mt-1 w-3 h-3 shrink-0 rounded-full border transition-colors ${
        isSelected ? "border-ink-secondary bg-ink-secondary" : "border-line-strong bg-white hover:border-ink-tertiary"
      }`}
    />
  );

  return (
    <div className="bg-white border border-line rounded-lg" style={{ padding: "32px 40px" }}>
      <div className="flex items-center justify-between mb-5">
        <span className="t-label">
          Subject Lines + Preview Text
          <span className="text-ink-muted normal-case tracking-normal ml-2">· mark the one that ships</span>
        </span>
        <button
          onClick={onRegenerate}
          disabled={regenerating || !!disabledReason}
          title={disabledReason || "Rewrite all three subject lines and preview texts"}
          className="text-xs text-ink-tertiary hover:text-ink px-2 py-0.5 rounded hover:bg-sunken transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                  <div className="t-label text-action-600 mb-0.5 ml-6 flex items-center gap-2">
                    {LANE_LABELS[i]}
                    {flag && <RepetitionChip flag={flag} onDismiss={() => onDismissFlag?.(metaKey("subject", i))} />}
                  </div>
                )}
                <div className="flex items-baseline gap-2">
                  {radio(i === subjectSelected, () => select("subject_selected", i), `Send subject line ${i + 1}`)}
                  <input
                    value={line}
                    onChange={(e) => updateLine("subject_lines", i, e.target.value)}
                    className={`flex-1 text-sm border-b border-transparent focus:border-line focus:outline-none py-0.5 bg-transparent ${
                      i === subjectSelected ? "text-ink" : "text-ink-tertiary"
                    }`}
                  />
                  <span className={`font-mono text-xs shrink-0 tabular-nums ${line.length > 50 ? "text-danger-600" : "text-ink-muted"}`}>
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
                  <div className="t-label text-action-600 mb-0.5 ml-6 flex items-center gap-2">
                    {LANE_LABELS[i]}
                    {flag && <RepetitionChip flag={flag} onDismiss={() => onDismissFlag?.(metaKey("preview", i))} />}
                  </div>
                )}
                <div className="flex items-baseline gap-2">
                  {radio(i === previewSelected, () => select("preview_selected", i), `Send preview text ${i + 1}`)}
                  <input
                    value={text}
                    onChange={(e) => updateLine("preview_texts", i, e.target.value)}
                    className={`flex-1 text-sm border-b border-transparent focus:border-line focus:outline-none py-0.5 bg-transparent ${
                      i === previewSelected ? "text-ink" : "text-ink-tertiary"
                    }`}
                  />
                  <span className={`font-mono text-xs shrink-0 tabular-nums ${text.length > 90 ? "text-danger-600" : "text-ink-muted"}`}>
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
