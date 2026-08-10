// Planner is its own top-level feature (out of the dashboard). A wide workspace
// so the Table view fills the available width instead of a narrow centered
// strip; the Calendar view caps its own width internally (see CalendarView) so
// it isn't over-stretched at this width.
//
// The workspace is an INSET WHITE PANEL on the app's grey ground (§4.0 of
// DESIGN_SYSTEM_SPEC): the Table view is one continuous white surface, so the
// ground must not show through in day-group gutters or around rows — it shows
// only in the margin around the panel. Structure comes from hairlines and
// whitespace inside it.
export default function PlannerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rc-content-panel flex-1 overflow-y-auto">
      <div className="max-w-[110rem] mx-auto px-6 py-8">{children}</div>
    </div>
  );
}
