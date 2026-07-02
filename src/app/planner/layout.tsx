// Planner is its own top-level feature (out of the dashboard). This shell
// matches the dashboard's container so the two features feel consistent.
export default function PlannerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-8 py-8">{children}</div>
    </div>
  );
}
