"use client";
import type { ReviewProvenance } from "@/lib/schemas";

// The provenance line under a Review element: where this review came from, who
// said it, its rating, and how old the fetch is. Spec §5.3.
//
// The point is that a writer should never have to WONDER whether a review on
// screen is real — the answer is visible without clicking anything. An unverified
// review (model-written, or a record that says so) gets a warning treatment and the
// one action that fixes it, because it also blocks Save Final.

const ORIGIN_LABEL: Record<ReviewProvenance["origin"], string> = {
  fetched: "Fetched from the storefront",
  curated: "From the curated review file",
  manual: "Entered by hand",
  unverified: "No source on record",
};

/** "3 days ago" / "today" — staleness made visible, which is the alternative to a
 * TTL that silently re-fetches (spec §2.3). */
function age(iso: string | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months <= 1 ? "a month ago" : `${months} months ago`;
}

export default function ReviewProvenanceLine({
  provenance,
  hasText,
  busy,
  onFetch,
  onRefresh,
}: {
  provenance?: ReviewProvenance;
  /** An empty slot is honest — it gets a quiet note, not a warning. */
  hasText: boolean;
  busy?: boolean;
  /** Fetch a real review for this slot. Absent when no product is bound. */
  onFetch?: () => void;
  /** Re-pull from the storefront, bypassing the cache (?refresh=1). */
  onRefresh?: () => void;
}) {
  const origin = provenance?.origin;
  const unverified = hasText && (!origin || origin === "unverified");

  if (!hasText) {
    return (
      <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-muted">
        <span>Empty — no real review placed yet.</span>
        {onFetch && (
          <button type="button" onClick={onFetch} disabled={busy}
            className="text-action-600 hover:underline disabled:opacity-40">
            {busy ? "Fetching…" : "Fetch a real one"}
          </button>
        )}
      </div>
    );
  }

  if (unverified) {
    return (
      <div className="mt-1 flex items-start gap-2 text-[11px] text-warning-600 bg-warning-50 border border-warning-200 rounded px-2 py-1">
        <span aria-hidden>⚠</span>
        <span className="flex-1">
          This review has no source on record, so nothing verified a customer said it. It has to be replaced or cleared before this campaign can be finalised.
        </span>
        {onFetch && (
          <button type="button" onClick={onFetch} disabled={busy}
            className="shrink-0 font-medium hover:underline disabled:opacity-40">
            {busy ? "Fetching…" : "Fetch a real one"}
          </button>
        )}
      </div>
    );
  }

  const bits = [
    ORIGIN_LABEL[origin as ReviewProvenance["origin"]],
    provenance?.author,
    provenance?.rating != null ? `${provenance.rating}★` : null,
    age(provenance?.fetched_at),
  ].filter(Boolean);

  return (
    <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px] text-ink-muted">
      <span aria-hidden className="text-success-600">✓</span>
      <span>{bits.join(" · ")}</span>
      {provenance?.source_url && (
        <a href={provenance.source_url} target="_blank" rel="noreferrer noopener"
          className="text-action-600 hover:underline">source</a>
      )}
      {onRefresh && (
        <button type="button" onClick={onRefresh} disabled={busy}
          title="Re-pull from the storefront, ignoring the cached copy"
          className="text-ink-tertiary hover:text-ink-secondary disabled:opacity-40">
          {busy ? "…" : "refresh"}
        </button>
      )}
    </div>
  );
}
