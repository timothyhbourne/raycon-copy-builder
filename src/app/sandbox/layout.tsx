// Sandbox is a scratch space for probing whether we can pull a specific piece
// of data from a platform. Shell matches the reports/planner/dashboard shells.
export default function SandboxLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8">{children}</div>
    </div>
  );
}
