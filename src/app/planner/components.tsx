"use client";
import { useState } from "react";
import Link from "next/link";
import type { PlannerChannel, PlannerStatus, PlannerRow, AbTestKind } from "@/lib/planner-types";
import { PLANNER_STATUS_LABELS, AB_TEST_KIND_LABELS, isAbTest, abTestKind } from "@/lib/planner-types";
import Chip from "@/components/ui/Chip";
import { CHANNEL_GLYPH, STATUS_STYLE, COPY_TONE, type CopyEntry } from "./format";

// Small presentational pieces for the Planner page, split out of page.tsx. They
// take props / read the style maps in ./format — no page state.

export function ChannelGlyph({ channel, className = "" }: { channel: PlannerChannel; className?: string }) {
  const g = CHANNEL_GLYPH[channel];
  return <span role="img" aria-label={g.label} className={`text-[11px] leading-none ${className}`}>{g.emoji}</span>;
}

// Small status pill, shape-matched to the Chip primitive. Table-only; it shows
// the SHORT status label — the scheduling platform is carried by the compact
// PlatformBadge dot beside it, so the pill stays narrow.
export function StatusPill({ status, className = "" }: { status: PlannerStatus; className?: string }) {
  const st = STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium capitalize leading-none whitespace-nowrap ${st.pill} ${className}`}>
      {st.check && <span aria-hidden>✓</span>}
      <span className={st.strike ? "line-through" : ""}>{PLANNER_STATUS_LABELS[status]}</span>
    </span>
  );
}

// Inline copy affordance for a table row's Name cell. stopPropagation so the
// links don't also open the row editor. SMS rows deep-link into the copy
// builder's SMS mode.
export function CopyLink({ entry, rowId, copyId, channel }: { entry: CopyEntry; rowId: string; copyId?: string; channel: PlannerChannel }) {
  if (entry === "sms") return null;
  const writeHref = channel === "sms" ? `/copy-builder?planner=${rowId}&channel=sms` : `/copy-builder?planner=${rowId}`;
  if (entry === "unlinked") {
    return (
      <Link href={writeHref} onClick={(e) => e.stopPropagation()}
        className="mt-0.5 w-fit text-[11px] font-medium text-info-600 hover:underline">
        Write copy
      </Link>
    );
  }
  return (
    <span className="mt-0.5 flex items-center gap-1.5 w-fit" onClick={(e) => e.stopPropagation()}>
      <Chip tone={COPY_TONE[entry]}>Copy: {entry}</Chip>
      <Link href={`/copy-builder?campaign=${copyId}`} onClick={(e) => e.stopPropagation()}
        className="text-[11px] font-medium text-info-600 hover:underline">
        Open copy
      </Link>
    </span>
  );
}

// Small chevron for styled native <select>s (kept native under the hood for a11y).
export function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden
      className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

// Small document glyph shown on calendar pills that have linked copy.
export function CopyGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
    </svg>
  );
}

// Compact "this send is a test" marker. Small enough for a calendar pill, legible
// enough that the question "is this an A/B test?" never needs the drawer opened
// (docs/PLANNER_AB_TEST_AND_EDITOR_POLISH_SPEC.md §1.5).
export function AbBadge({ kind, className = "" }: { kind: AbTestKind; className?: string }) {
  return (
    <span
      title={`A/B test — ${AB_TEST_KIND_LABELS[kind].toLowerCase()}`}
      className={`shrink-0 rounded px-1 py-px text-[10px] font-semibold leading-none tracking-wide bg-info-50 text-info-600 border border-info-200 ${className}`}
    >
      A/B
    </span>
  );
}

/** The badge, or nothing, straight from a row — so callers don't each re-derive it. */
export function RowAbBadge({ row, className = "" }: { row: Pick<PlannerRow, "ab_test">; className?: string }) {
  const kind = abTestKind(row);
  if (!isAbTest(row) || !kind) return null;
  return <AbBadge kind={kind} className={className} />;
}

/**
 * A drawer section that can be folded away, with its content still summarised on the
 * header line.
 *
 * The audience picker is the reason this exists: it is the tallest thing in the
 * editor and, on a row whose brief is already written, it is also the least
 * interesting. Collapsing it must not hide the answer, though — so `summary` renders
 * beside the label while closed, which is why this takes a node and not a string.
 *
 * `defaultOpen` is read once, on mount. The drawer is remounted per row, so "open
 * when there's something to do" is decided fresh for each campaign rather than
 * inherited from the last one.
 */
export function CollapsibleSection({
  label, summary, defaultOpen = true, className = "", children,
}: {
  label: React.ReactNode;
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 text-left group"
      >
        <span className="t-label group-hover:text-ink-secondary transition-colors">{label}</span>
        {!open && summary && <span className="min-w-0 flex-1 flex items-center gap-1 overflow-hidden">{summary}</span>}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden
          className={`ml-auto shrink-0 text-ink-muted transition-transform duration-150 ease-out-soft ${open ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}
