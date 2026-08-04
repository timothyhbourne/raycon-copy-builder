import Link from "next/link";
import type { PlannerChannel, PlannerStatus } from "@/lib/planner-types";
import { PLANNER_STATUS_LABELS } from "@/lib/planner-types";
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
    <span className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide leading-none whitespace-nowrap ${st.pill} ${className}`}>
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
        className="mt-0.5 w-fit text-[10px] font-medium uppercase tracking-wide text-accent hover:underline">
        Write copy
      </Link>
    );
  }
  return (
    <span className="mt-0.5 flex items-center gap-1.5 w-fit" onClick={(e) => e.stopPropagation()}>
      <Chip tone={COPY_TONE[entry]}>Copy: {entry}</Chip>
      <Link href={`/copy-builder?campaign=${copyId}`} onClick={(e) => e.stopPropagation()}
        className="text-[10px] font-medium uppercase tracking-wide text-accent hover:underline">
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
