import type { PlannerChannel } from "@/lib/planner-types";

// Scheduling-source badge: names WHERE a campaign is scheduled and color-codes it
// so Klaviyo (email) and Postscript (SMS) are never confused at a glance — and
// neither is mistaken for the status-green "scheduled" pill.
//   Klaviyo   → accent / indigo family
//   Postscript → info / teal family (a clearly different hue)
// Shared across the planner table and calendar so styling never drifts.
const PLATFORM: Record<PlannerChannel, { name: string; cls: string }> = {
  email: { name: "Klaviyo", cls: "bg-accent-50 text-accent border-accent-200" },
  sms: { name: "Postscript", cls: "bg-info-50 text-info-600 border-info-200" },
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
        className={`inline-block w-1.5 h-1.5 rounded-full border ${p.cls} ${className}`}
      />
    );
  }
  return (
    <span
      title={`Scheduled in ${p.name}`}
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide leading-none ${p.cls} ${className}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" aria-hidden />
      {p.name}
    </span>
  );
}
