import React from "react";

// The shared three-part page header used at the top of every content page:
//   eyebrow (quiet sentence-case category)  →  large bold title (optional accent
//   word)  →  one-line muted description, with right-aligned meta (count chip,
//   period control, export button…) kept on the title's baseline.
//
// Pass `accent` to emphasise a trailing word of the title. It is set in
// ink-tertiary, NOT the brand accent: green now means "this action creates
// something" (§4.1), and a green word in a heading competed with the one green
// button on the page for exactly the attention that button needs. The emphasis
// now comes from the weight contrast against the bold title instead.
// `meta` is a free slot for chips/controls/actions.
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
          {accent != null && <> <span className="text-ink-tertiary font-normal">{accent}</span></>}
        </h1>
        {description && <p className="text-sm text-ink-secondary mt-1.5 max-w-2xl">{description}</p>}
      </div>
      {meta && <div className="flex items-end gap-3 flex-wrap shrink-0">{meta}</div>}
    </div>
  );
}
