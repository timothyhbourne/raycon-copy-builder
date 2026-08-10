import type { PlannerChannel } from "@/lib/planner-types";

// Scheduling-source badge: names WHERE a campaign is scheduled and color-codes it
// so Klaviyo (email) and Postscript (SMS) are never confused at a glance.
//   Klaviyo    → info / blue
//   Postscript → action / violet (a clearly different hue)
// Deliberately NOT the accent: green now means "creates something" and must never
// mark data. These pair with the categorical data palette (blue = campaigns,
// violet = sms). Shared across the planner table and calendar.
const PLATFORM: Record<PlannerChannel, { name: string; cls: string }> = {
  email: { name: "Klaviyo", cls: "bg-info-50 text-info-600" },
  sms: { name: "Postscript", cls: "bg-action-50 text-action-600" },
};

export default function PlatformBadge({
  channel,
  compact = false,
  className = "",
}: {
  channel: PlannerChannel;
  // compact = glyph-only dot + tooltip (calendar pills); default shows the name.
  compact?: boolean;
  className?: string;
}) {
  const p = PLATFORM[channel];
  if (compact) {
    return (
      <span
        title={`Scheduled in ${p.name}`}
        aria-label={`Scheduled in ${p.name}`}
        className={`inline-block w-1.5 h-1.5 rounded-full ${p.cls} ${className}`}
      />
    );
  }
  return (
    <span
      title={`Scheduled in ${p.name}`}
      className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium leading-none ${p.cls} ${className}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" aria-hidden />
      {p.name}
    </span>
  );
}
