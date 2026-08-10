import React from "react";

// Signed delta pill: ↑ green for positive, ↓ red for negative, muted dash for
// zero/absent. `unit` is appended to the magnitude (e.g. "pp", "%"). Pass
// `goodDirection="down"` for metrics where a decrease is good (e.g. unsub rate)
// so the color reflects meaning, not just sign.
export function DeltaPill({
  value,
  unit = "",
  goodDirection = "up",
  className = "",
}: {
  value: number | null | undefined;
  unit?: string;
  goodDirection?: "up" | "down";
  className?: string;
}) {
  if (value == null || Number.isNaN(value)) {
    return <span className={`text-xs text-ink-muted ${className}`}>—</span>;
  }
  const up = value > 0;
  const flat = value === 0;
  const good = flat ? null : (up ? goodDirection === "up" : goodDirection === "down");
  const tone = good == null ? "text-ink-muted" : good ? "text-success-600" : "text-danger-600";
  const arrow = flat ? "→" : up ? "↑" : "↓";
  const mag = Math.abs(value);
  const num = Number.isInteger(mag) ? String(mag) : mag.toFixed(1);
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums ${tone} ${className}`}>
      <span aria-hidden>{arrow}</span>{num}{unit}
    </span>
  );
}

// One KPI cell: a quiet sentence-case label, a large bold number, an optional delta
// pill, an optional "WAS X PRIOR" caption, and an optional description. A thin
// accent left-border makes the run of cells read as one measured group.
export function StatCell({
  label,
  value,
  delta,
  prior,
  description,
  className = "",
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  delta?: React.ReactNode;
  prior?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`pl-4 border-l-2 border-accent-200 ${className}`}>
      <div className="t-label mb-1.5">{label}</div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-3xl font-semibold text-ink tabular-nums leading-none">{value}</span>
        {delta != null && delta}
      </div>
      {prior != null && <div className="t-label mt-2 text-ink-muted">Was {prior} prior</div>}
      {description != null && <div className="text-xs text-ink-secondary mt-1.5">{description}</div>}
    </div>
  );
}

// A KPI stat card: a standalone rounded box (white surface, hairline, shadow) —
// quiet sentence-case label over a large bold tabular number. Unlike StatCell
// (a bare divider cell for use inside a Card), this is self-boxed for a run of
// "singular rounded boxes" above a table. Reusable on Dashboard/Reports too.
export function StatCard({
  label,
  value,
  className = "",
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-surface border border-line rounded-md shadow-card px-4 py-3.5 ${className}`}>
      <div className="t-label">{label}</div>
      <div className="text-2xl font-semibold text-ink tabular-nums leading-none mt-1.5">{value}</div>
    </div>
  );
}

// A responsive run of StatCells. Defaults to a fluid auto-fit grid so cells wrap
// cleanly; pass `cols` to pin a column count.
export function KPIRow({
  children,
  cols,
  className = "",
}: {
  children: React.ReactNode;
  cols?: 2 | 3 | 4;
  className?: string;
}) {
  const grid = cols
    ? { 2: "grid-cols-1 sm:grid-cols-2", 3: "grid-cols-1 sm:grid-cols-3", 4: "grid-cols-2 lg:grid-cols-4" }[cols]
    : "grid-cols-[repeat(auto-fit,minmax(180px,1fr))]";
  return <div className={`grid gap-x-6 gap-y-5 ${grid} ${className}`}>{children}</div>;
}
