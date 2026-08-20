"use client";
import { useState } from "react";
import { DEFAULT_TONE_DIAL } from "@/lib/schemas";

export interface VariationItem {
  label: string;
  preview: string;
  payload: unknown;
}

interface Props {
  title: string;
  /** One-tap feedback chips, e.g. "Warmer", "Punchier". */
  chips: string[];
  /** Show the tone slider (email sections); omit for SMS. */
  showTone?: boolean;
  defaultTone?: number;
  /**
   * Caller runs the request and returns a labeled spread. `prior` is every card
   * already shown across all previous sets, so the caller can tell the model
   * what not to repeat. Callers may return a bare array (no failure reporting)
   * or `{ items, failures }` to surface registers that dropped.
   */
  onFetch: (
    feedback: string,
    tone: number,
    prior: VariationItem[]
  ) => Promise<VariationItem[] | { items: VariationItem[]; failures: string[] }>;
  /** Caller applies the chosen payload in place. */
  onApply: (payload: unknown) => void;
  onClose: () => void;
}

const TONE_LABELS: Record<number, string> = {
  1: "By the book",
  2: "Mostly safe",
  3: "Balanced",
  4: "Creative",
  5: "Experimental",
};

export default function VariationsModal({
  title,
  chips,
  showTone = false,
  defaultTone = DEFAULT_TONE_DIAL,
  onFetch,
  onApply,
  onClose,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [freeText, setFreeText] = useState("");
  const [tone, setTone] = useState(defaultTone);
  const [sets, setSets] = useState<VariationItem[][]>([]);
  const [setIndex, setSetIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Register labels that failed on the latest run (empty when all came back). */
  const [failures, setFailures] = useState<string[]>([]);

  const toggleChip = (c: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const combinedFeedback = () => {
    const chipPart = Array.from(selected).join(". ");
    const parts = [chipPart, freeText.trim()].filter(Boolean);
    return parts.join(". ");
  };

  const run = async () => {
    setLoading(true);
    setError(null);
    setFailures([]);
    try {
      // Every card from every prior set, so the caller can ask for something new.
      const prior = sets.flat();
      const result = await onFetch(combinedFeedback(), tone, prior);
      const items = Array.isArray(result) ? result : result.items;
      setFailures(Array.isArray(result) ? [] : result.failures);
      if (!items.length) {
        setError("No alternatives came back. Try again or adjust the feedback.");
      } else {
        setSets((prev) => {
          const next = [...prev, items];
          setSetIndex(next.length - 1);
          return next;
        });
      }
    } catch {
      setError("Couldn't get alternatives. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const current = sets[setIndex] ?? [];
  const hasResults = current.length > 0;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="t-label text-ink-tertiary mb-1">Alternatives</div>
        <h3 className="font-semibold text-ink mb-4">{title}</h3>

        {/* Quick-pick feedback chips */}
        <div className="flex flex-wrap gap-2 mb-3">
          {chips.map((c) => {
            const on = selected.has(c);
            return (
              <button
                key={c}
                onClick={() => toggleChip(c)}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                  on
                    ? "bg-ink text-white border-ink"
                    : "bg-white text-ink-secondary border-line hover:border-line-strong"
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>

        <textarea
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          rows={2}
          className="w-full border border-line rounded px-3 py-2 text-sm focus:outline-none focus:border-line-strong resize-none"
          placeholder="Optional: what feels off? (e.g. too pushy, no personality)"
        />

        {showTone && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-1">
              <label className="t-label text-ink-tertiary">Tone</label>
              <span className="text-xs text-ink-tertiary">{TONE_LABELS[tone]}</span>
            </div>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={tone}
              onChange={(e) => setTone(Number(e.target.value))}
              className="w-full accent-slate-900"
            />
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button
            onClick={run}
            disabled={loading}
            className="flex-1 bg-ink text-white py-2 rounded-md text-sm font-medium hover:bg-ink-secondary transition-colors disabled:opacity-50"
          >
            {loading ? "Writing alternatives…" : hasResults ? "Regenerate a new set" : "Get 5 alternatives"}
          </button>
          <button
            onClick={onClose}
            className="border border-line text-ink-secondary px-4 py-2 rounded-md text-sm hover:bg-sunken transition-colors"
          >
            Close
          </button>
        </div>

        {error && <div className="text-xs text-danger-600 mt-3">{error}</div>}

        {failures.length > 0 && (
          <div className="text-xs text-warning-600 mt-3">
            Couldn&apos;t generate: {failures.join(", ")}. Try adjusting the feedback or regenerate.
          </div>
        )}

        {/* Results */}
        {hasResults && (
          <div className="mt-5">
            <div className="flex items-center justify-between mb-2">
              <div className="t-label text-ink-tertiary">Tap one to apply it</div>
              {sets.length > 1 && (
                <div className="flex items-center gap-2 text-xs text-ink-tertiary">
                  <button
                    onClick={() => setSetIndex((i) => Math.max(0, i - 1))}
                    disabled={setIndex === 0}
                    className="px-1.5 py-0.5 border border-line rounded disabled:opacity-40"
                  >
                    ‹
                  </button>
                  <span>Set {setIndex + 1}/{sets.length}</span>
                  <button
                    onClick={() => setSetIndex((i) => Math.min(sets.length - 1, i + 1))}
                    disabled={setIndex === sets.length - 1}
                    className="px-1.5 py-0.5 border border-line rounded disabled:opacity-40"
                  >
                    ›
                  </button>
                </div>
              )}
            </div>
            <div className="space-y-2">
              {current.map((item, i) => (
                <button
                  key={`${setIndex}-${i}`}
                  onClick={() => {
                    onApply(item.payload);
                    onClose();
                  }}
                  className="w-full text-left border border-line rounded-lg p-3 hover:border-ink hover:bg-sunken transition-colors"
                >
                  <div className="t-label text-ink-tertiary mb-1">{item.label}</div>
                  <div className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{item.preview}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
