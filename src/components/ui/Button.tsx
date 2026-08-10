"use client";
import React from "react";

type Variant = "primary" | "secondary" | "action" | "ghost" | "danger" | "dangerSolid";
type Size = "sm" | "md";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

/**
 * ACTION SEMANTICS (§4.1). The variant carries meaning, not just weight:
 *
 *   primary   — CREATES something (Generate, New campaign, Save to library).
 *               Solid green. Aim for exactly ONE per view; if a button doesn't
 *               create anything, it should be `secondary`.
 *   secondary — Non-creating actions (Save draft, Apply, Refresh, Sync).
 *   action    — Text-style action that creates a record inline ("+ New task").
 *               Violet, no fill.
 *   ghost     — Tertiary / dismissive (Cancel, Close, inline controls).
 *   danger    — Destructive TRIGGER. Tinted, so it doesn't shout from a toolbar.
 *   dangerSolid — The destructive CONFIRM step only (ConfirmModal, an inline
 *               "Confirm delete"). §4.1 reserves solid red for exactly this.
 */
const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-white border border-transparent hover:bg-accent-700",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-sunken",
  action: "bg-transparent text-action-600 border border-transparent hover:bg-action-50",
  ghost: "bg-transparent text-ink-secondary border border-transparent hover:bg-sunken hover:text-ink",
  danger: "bg-danger-50 text-danger-600 border border-transparent hover:bg-danger-200/60",
  dangerSolid: "bg-danger-600 text-white border border-transparent hover:opacity-90",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
};

// One button, one radius (rounded-md). `loading` swaps the label for a centered
// spinner while preserving width (label stays in flow but invisible) so buttons
// never jump. Outcomes go to toasts, not the label — buttons show loading only.
export default function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  disabled,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`relative inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,opacity] duration-150 ease-out-soft disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT[variant]} ${SIZE[size]} ${className}`}
    >
      <span className={`inline-flex items-center gap-2 ${loading ? "opacity-0" : ""}`}>{children}</span>
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span aria-hidden className="inline-block w-3.5 h-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
        </span>
      )}
    </button>
  );
}
