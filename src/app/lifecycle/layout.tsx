// Lifecycle Kanban shell. Unlike the centered reports/planner containers this
// is full-width — the board scrolls horizontally across its columns.
export default function LifecycleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rc-content-panel flex-1 overflow-y-auto">
      <div className="px-8 py-8">{children}</div>
    </div>
  );
}
