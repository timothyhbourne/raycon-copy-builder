"use client";
import React from "react";

// The horizontal control row under a page header. `FilterBar` lays controls out
// in a wrapping row with a right-aligned actions slot; `FilterField` gives any
// control the quiet sentence-case label above it; `SegmentedToggle` is the pill-group
// control for small enumerated choices (NEW/RETURNING, 30D/60D/90D…).

export function FilterBar({
  children,
  actions,
  className = "",
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-end gap-4 flex-wrap ${className}`}>
      {children}
      {actions != null && <div className="ml-auto flex items-end gap-3 flex-wrap">{actions}</div>}
    </div>
  );
}

export function FilterField({
  label,
  children,
  className = "",
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="t-label">{label}</span>
      {children}
    </label>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: React.ReactNode;
}

// Segmented pill toggle. Controlled: pass `value` + `onChange`. Keyboard-operable
// (each segment is a real button); the active segment takes the ink fill so it
// reads like the dashboard's existing preset toggle.
export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = "",
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    /* §4.1c — the ACTIVE tab is an outlined white pill on the panel and inactive
       tabs are plain text with no chrome. Deliberately not the accent: switching
       a view creates nothing, and green has to keep meaning "creates something". */
    <div role="group" aria-label={ariaLabel} className={`inline-flex rounded-md bg-sunken p-0.5 ${className}`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-[6px] transition-colors duration-150 ease-out-soft ${
              active
                ? "bg-surface text-ink border border-line-strong shadow-card"
                : "text-ink-tertiary border border-transparent hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
