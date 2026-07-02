"use client";
import { createContext, useContext } from "react";
import type { OverviewData } from "./types";

// Context carrying the single dashboard fetch result down to the child pages
// (/dashboard/flows and /dashboard/campaigns). The layout owns the state and
// provides it; because an App Router layout preserves state and does not
// remount when navigating between its child routes, toggling tabs reuses this
// data with no refetch.
export interface DashboardDataValue {
  data: OverviewData | null;
  loading: boolean;
  error: string | null;
}

const DashboardDataContext = createContext<DashboardDataValue | null>(null);

export const DashboardDataProvider = DashboardDataContext.Provider;

export function useDashboardData(): DashboardDataValue {
  const ctx = useContext(DashboardDataContext);
  if (!ctx) throw new Error("useDashboardData must be used within the dashboard layout");
  return ctx;
}
