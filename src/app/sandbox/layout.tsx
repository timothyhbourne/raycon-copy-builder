import { notFound } from "next/navigation";
import { debugRoutesEnabled } from "@/lib/env";

// Sandbox is a scratch space for probing whether we can pull a specific piece
// of data from a platform. Shell matches the reports/planner/dashboard shells.
// It ships to prod but is a diagnostic surface, so it 404s there unless
// ENABLE_DEBUG_ROUTES is set (always available in dev). Gating in the server
// layout covers the page and anything nested under it.
export default function SandboxLayout({ children }: { children: React.ReactNode }) {
  if (!debugRoutesEnabled()) notFound();
  return (
    <div className="rc-content-panel flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8">{children}</div>
    </div>
  );
}
