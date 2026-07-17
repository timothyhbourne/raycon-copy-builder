"use client";
import { useDashboardData } from "../dashboard-context";
import { formatMoney, formatInt } from "../format";

export default function FlowsPage() {
  const { data } = useDashboardData();
  if (!data) return null;
  const flows = data.flows;

  return (
    <div className="bg-surface border border-line rounded-md shadow-card overflow-hidden">
      <div className="px-6 py-4 border-b border-line flex items-center justify-between">
        <div>
          <div className="t-label">Flows</div>
          <div className="text-sm text-ink-secondary mt-0.5">Active flows over the selected range</div>
        </div>
        <div className="text-xs text-ink-muted">{flows.length} flow{flows.length === 1 ? "" : "s"}</div>
      </div>
      {/* Own scroll region so the sticky header engages relative to this box */}
      <div className="overflow-auto max-h-[calc(100vh-24rem)]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-chrome">
            <tr className="text-left t-label border-b border-line">
              <th className="px-4 py-2.5 font-medium">Flow</th>
              <th className="px-4 py-2.5 font-medium text-right">Recipients</th>
              <th className="px-4 py-2.5 font-medium text-right">Opens</th>
              <th className="px-4 py-2.5 font-medium text-right">Clicks</th>
              <th className="px-4 py-2.5 font-medium text-right">Revenue</th>
              <th className="px-4 py-2.5 font-medium text-right">Rev / recipient</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {flows.length > 0 ? (
              flows.map((f) => (
                <tr key={f.flow_id} className="hover:bg-chrome transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="text-ink">{f.name}</div>
                    {f.status && <div className="text-[10px] text-ink-muted uppercase">{f.status}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-ink-secondary font-mono tabular-nums">{formatInt(f.recipients)}</td>
                  <td className="px-4 py-2.5 text-right text-ink-secondary font-mono tabular-nums">{formatInt(f.opens)}</td>
                  <td className="px-4 py-2.5 text-right text-ink-secondary font-mono tabular-nums">{formatInt(f.clicks)}</td>
                  <td className="px-4 py-2.5 text-right text-ink font-mono tabular-nums font-medium">{formatMoney(f.revenue)}</td>
                  <td className="px-4 py-2.5 text-right text-ink-secondary font-mono tabular-nums">
                    {f.recipients > 0 ? `$${f.revenue_per_recipient.toFixed(2)}` : "—"}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-ink-muted text-sm">
                  No flow activity in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
