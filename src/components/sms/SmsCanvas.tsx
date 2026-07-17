"use client";
import { useRef, useEffect } from "react";
import type { SmsCampaign } from "@/lib/schemas";
import { SMS_VARIANT_LABELS } from "@/lib/schemas";
import { smsLength, TARGET_CHARS } from "@/lib/sms-format";

// Human-readable name for the character that forced Unicode encoding, for the
// counter hint. Falls back to the literal character in quotes.
function describeChar(ch: string): string {
  const named: Record<string, string> = {
    "—": "an em dash (—)",
    "–": "an en dash (–)",
    "‘": "a curly quote (')",
    "’": "a curly quote (')",
    "“": "a curly quote (“)",
    "”": "a curly quote (”)",
    "…": "an ellipsis (…)",
  };
  if (named[ch]) return named[ch];
  // Emoji and other symbols: show the character itself.
  return `"${ch}"`;
}

// Live segment/encoding counter. Neutral within budget, amber past the target,
// red past the hard ceiling or the moment encoding flips to Unicode.
function Counter({ text }: { text: string }) {
  const { chars, encoding, segments, offendingChar } = smsLength(text);
  const isUnicode = encoding === "Unicode";
  const over = chars > 160 || isUnicode;
  const warn = !over && chars > TARGET_CHARS;
  const tone = over ? "text-danger-600" : warn ? "text-warning-600" : "text-ink-muted";
  const seg = `${segments} segment${segments === 1 ? "" : "s"}`;
  return (
    <div className={`font-mono text-[11px] tabular-nums ${tone}`} aria-live="polite">
      {chars} · {encoding} · {seg}
      {isUnicode && offendingChar && (
        <span className="ml-1 normal-case">— contains {describeChar(offendingChar)}, which drops the budget to 70</span>
      )}
    </div>
  );
}

// Auto-growing plain textarea, styled to match EditableField.
function VariantText({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={2}
      className="w-full resize-none text-sm text-slate-900 leading-relaxed bg-transparent focus:outline-none"
      style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
    />
  );
}

interface Props {
  campaign: SmsCampaign;
  isGenerating?: boolean;
  onSelect: (index: number) => void;
  onChangeVariant: (index: number, text: string) => void;
}

export default function SmsCanvas({ campaign, isGenerating, onSelect, onChangeVariant }: Props) {
  return (
    <div className="space-y-3">
      <div className="t-label">
        {isGenerating ? "Writing SMS variants…" : "Pick the variant that ships"}
      </div>
      {campaign.variants.map((v, i) => {
        const selected = campaign.selected_variant === i;
        return (
          <div
            key={i}
            onClick={() => onSelect(i)}
            className={`rounded-md border p-4 cursor-pointer transition-[background-color,border-color] duration-150 ${
              selected
                ? "border-accent-200 border-l-2 border-l-accent bg-accent-50"
                : "border-line hover:border-line-strong bg-surface"
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span
                className={`flex items-center justify-center w-3.5 h-3.5 rounded-full border ${
                  selected ? "border-accent" : "border-line-strong"
                }`}
                aria-hidden
              >
                {selected && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
              </span>
              <span className="t-label text-ink-secondary">
                {SMS_VARIANT_LABELS[i] ?? `Variant ${i + 1}`}
              </span>
            </div>
            {/* Stop clicks inside the editor from re-triggering selection. */}
            <div onClick={(e) => e.stopPropagation()}>
              <VariantText value={v.text} onChange={(text) => onChangeVariant(i, text)} />
            </div>
            <div className="mt-2 pt-2 border-t border-line">
              <Counter text={v.text} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
