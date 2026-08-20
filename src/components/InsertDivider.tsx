"use client";

// The inline "insert a section here" affordance: a hairline with a centred ⊕.
//
// It is VISIBLE AT REST (opacity .35 via .insert-divider in globals.css) and
// names itself on hover. The old version was opacity 0 on a ~10px strip, so the
// only way to find it was to already know it was there — and it only existed
// *after* a section, which meant nothing could be added above the first one.
// Spec §3.1.

export default function InsertDivider({
  onClick,
  label = "Insert section",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <div className="insert-divider group/insert relative flex items-center gap-2 py-1">
      <div className="flex-1 h-px bg-line" />
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={label}
        className="flex items-center gap-1.5 text-xs text-ink-tertiary hover:text-ink-secondary px-2 py-0.5 rounded hover:bg-sunken transition-colors whitespace-nowrap"
      >
        <span aria-hidden className="text-sm leading-none">⊕</span>
        {/* The label stays out of the way until the divider is engaged, so a
            column of dividers doesn't compete with the copy for attention. */}
        <span className="hidden group-hover/insert:inline group-focus-within/insert:inline">{label}</span>
      </button>
      <div className="flex-1 h-px bg-line" />
    </div>
  );
}
