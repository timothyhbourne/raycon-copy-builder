// Reports is its own top-level feature. This shell matches the planner /
// dashboard containers so the features feel consistent.
export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8">{children}</div>
    </div>
  );
}
