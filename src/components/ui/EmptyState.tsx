import React from "react";

// Calm empty state: inline-SVG icon slot (not emoji), title, description, optional
// action. Replaces the ad-hoc empty states across the app.
export default function EmptyState({
  icon,
  title,
  description,
  action,
  className = "",
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-16 px-6 ${className}`}>
      {icon && <div className="text-ink-muted mb-3" aria-hidden>{icon}</div>}
      <div className="text-sm font-medium text-ink">{title}</div>
      {description && <p className="text-sm text-ink-secondary mt-1 max-w-sm leading-relaxed">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
