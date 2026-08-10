import React from "react";

export type ChipTone = "neutral" | "accent" | "success" | "warning" | "danger" | "muted";

const TONE: Record<ChipTone, string> = {
  neutral: "bg-sunken text-ink-secondary",
  muted: "bg-sunken text-ink-tertiary",
  accent: "bg-accent-50 text-accent-700",
  success: "bg-success-50 text-success-600",
  warning: "bg-warning-50 text-warning-600",
  danger: "bg-danger-50 text-danger-600",
};

// The one status/channel pill used across planner + copy builder.
//
// §4.4 — chips are INFORMATIONAL and must never compete with buttons: a tinted
// -50 fill with -600 text, NO border, radius-sm. They're also sentence case now
// (`capitalize`), because an all-caps chip on every row was part of the
// utilitarian drumbeat; all-caps survives only on .t-micro structural labels.
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
      className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium capitalize leading-none ${TONE[tone]} ${className}`}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" aria-hidden />}
      {children}
    </span>
  );
}
