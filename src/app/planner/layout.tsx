// Planner is its own top-level feature (out of the dashboard). A wide workspace
// so the Table view fills the available width instead of a narrow centered
// strip; the Calendar view caps its own width internally (see CalendarView) so
// it isn't over-stretched at this width.
//
// The workspace is white (not the app's warm-gray `chrome` body background):
// the Table view is one continuous white surface, so the gray page must not
// show through in the day-group gutters or around rows. Structure comes from
// hairlines, whitespace, and the accent instead.
export default function PlannerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto bg-surface">
      <div className="max-w-[110rem] mx-auto px-6 py-8">{children}</div>
    </div>
  );
}
