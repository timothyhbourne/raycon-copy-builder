import React from "react";

// White surface card: hairline border, radius-md, soft shadow-card. Optional
// header row (title + muted subtitle on the left, an action slot on the right,
// e.g. a CSV button). `bodyClassName` controls the content padding so callers
// can go edge-to-edge for tables (pass "" and pad rows themselves).
export default function Card({
  title,
  subtitle,
  action,
  children,
  className = "",
  bodyClassName = "p-6",
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const hasHeader = title != null || subtitle != null || action != null;
  return (
    <section className={`bg-surface border border-line rounded-lg shadow-card overflow-hidden ${className}`}>
      {hasHeader && (
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-line">
          <div className="min-w-0">
            {title != null && <h2 className="t-heading text-ink truncate">{title}</h2>}
            {subtitle != null && <p className="text-sm text-ink-secondary mt-0.5">{subtitle}</p>}
          </div>
          {action != null && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
