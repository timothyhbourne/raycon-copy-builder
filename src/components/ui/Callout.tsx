import React from "react";

// Best/worst-style callout card: a quiet sentence-case label, a bold headline value,
// an optional signed delta (vs. a median/prior), and an optional secondary stat.
// `tone` tints the label + left accent bar green (good) or red (weak); neutral
// by default. Pairs with DeltaPill for the delta slot.
export type CalloutTone = "neutral" | "good" | "weak";

const BAR: Record<CalloutTone, string> = {
  neutral: "border-l-line-strong",
  good: "border-l-success-600",
  weak: "border-l-danger-600",
};
const LABEL: Record<CalloutTone, string> = {
  neutral: "text-ink-muted",
  good: "text-success-600",
  weak: "text-danger-600",
};

export default function Callout({
  label,
  value,
  delta,
  secondary,
  tone = "neutral",
  className = "",
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  delta?: React.ReactNode;
  secondary?: React.ReactNode;
  tone?: CalloutTone;
  className?: string;
}) {
  return (
    <div className={`bg-surface border border-line ${BAR[tone]} border-l-[3px] rounded-md shadow-card px-4 py-3.5 ${className}`}>
      <div className={`t-label ${LABEL[tone]}`}>{label}</div>
      <div className="flex items-baseline gap-2 mt-1.5 flex-wrap">
        <span className="text-xl font-semibold text-ink tabular-nums leading-none">{value}</span>
        {delta != null && delta}
      </div>
      {secondary != null && <div className="text-xs text-ink-secondary mt-1.5">{secondary}</div>}
    </div>
  );
}
