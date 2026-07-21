import React from "react";

// The shared three-part page header used at the top of every content page:
//   eyebrow (tiny uppercase category)  →  large bold title (optional accent
//   word)  →  one-line muted description, with right-aligned meta (count chip,
//   period control, export button…) kept on the title's baseline.
//
// Pass `accent` to color a trailing word of the title in the brand accent
// (reference: "…per customer by product" with "by product" green). `meta` is a
// free slot for chips/controls/actions.
export default function PageHeader({
  eyebrow,
  title,
  accent,
  description,
  meta,
  className = "",
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  accent?: React.ReactNode;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-end justify-between gap-4 flex-wrap ${className}`}>
      <div className="min-w-0">
        {eyebrow && <div className="t-label mb-1.5">{eyebrow}</div>}
        <h1 className="t-display text-ink">
          {title}
          {accent != null && <> <span className="text-accent">{accent}</span></>}
        </h1>
        {description && <p className="text-sm text-ink-secondary mt-1.5 max-w-2xl">{description}</p>}
      </div>
      {meta && <div className="flex items-end gap-3 flex-wrap shrink-0">{meta}</div>}
    </div>
  );
}
