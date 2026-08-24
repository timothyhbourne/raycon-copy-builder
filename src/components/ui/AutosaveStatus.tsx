"use client";

// The autosave indicator: a spinner while saving, a checkmark that fades to a
// bare tick, and an explicit Retry when a save failed. Shared by the Copy Builder
// (library autosave) and the Flow Builder — both replaced a manual Save button
// with debounced autosave, and the whole point of that trade is that the user can
// still see, at a glance, that their work is safe.
export type AutosaveState = "idle" | "saving" | "saved" | "check" | "error";

export default function AutosaveStatus({ status, onRetry }: {
  status: AutosaveState;
  onRetry: () => void;
}) {
  if (status === "idle") return null;
  if (status === "error") {
    return (
      <div className="flex items-center gap-2 text-[11px] text-danger-600">
        <span>Autosave failed</span>
        <button
          type="button"
          onClick={onRetry}
          className="px-1.5 py-0.5 rounded-sm border border-danger-200 text-danger-600 hover:bg-danger-50 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }
  if (status === "saving") {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
        <span className="w-3 h-3 rounded-full border-2 border-line border-t-ink-muted animate-spin" aria-hidden />
        Saving…
      </div>
    );
  }
  // "saved" (with label) and "check" (label faded out) share the checkmark.
  return (
    <div className="flex items-center gap-1 text-[11px] text-ink-muted" aria-live="polite">
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
      {status === "saved" && <span>Saved</span>}
    </div>
  );
}
