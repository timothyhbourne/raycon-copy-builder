import { redirect } from "next/navigation";

// /dashboard has no content of its own — Flows is the default tab. The shared
// layout (date range, tiles, warnings, toggle) wraps the child routes.
export default function DashboardIndex() {
  redirect("/dashboard/flows");
}
