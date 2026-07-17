import React from "react";

export type ChipTone = "neutral" | "accent" | "success" | "warning" | "danger" | "muted";

const TONE: Record<ChipTone, string> = {
  neutral: "bg-chrome text-ink-secondary border-line",
  muted: "bg-chrome text-ink-muted border-line",
  accent: "bg-accent-50 text-accent border-accent-200",
  success: "bg-success-50 text-success-600 border-success-200",
  warning: "bg-warning-50 text-warning-600 border-warning-200",
  danger: "bg-danger-50 text-danger-600 border-danger-200",
};

// The one status/channel pill used across planner + copy builder. Sans, quiet
// uppercase, consistent padding/radius. Optional leading dot.
export default function Chip({
  tone = "neutral",
  dot = false,
  className = "",
  children,
}: {
  tone?: ChipTone;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide leading-none ${TONE[tone]} ${className}`}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" aria-hidden />}
      {children}
    </span>
  );
}
