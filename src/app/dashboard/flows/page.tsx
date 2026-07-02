"use client";
import { useDashboardData } from "../dashboard-context";
import { formatMoney, formatInt } from "../format";

export default function FlowsPage() {
  const { data } = useDashboardData();
  if (!data) return null;
  const flows = data.flows;

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <div>
          <div className="font-mono text-xs text-slate-500 uppercase tracking-wide">Flows</div>
          <div className="text-sm text-slate-600 mt-0.5">Active flows over the selected range</div>
        </div>
        <div className="text-xs text-slate-500">{flows.length} flow{flows.length === 1 ? "" : "s"}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left text-slate-500 font-mono text-[10px] uppercase tracking-wide">
              <th className="px-4 py-2.5 font-medium">Flow</th>
              <th className="px-4 py-2.5 font-medium text-right">Recipients</th>
              <th className="px-4 py-2.5 font-medium text-right">Opens</th>
              <th className="px-4 py-2.5 font-medium text-right">Clicks</th>
              <th className="px-4 py-2.5 font-medium text-right">Revenue</th>
              <th className="px-4 py-2.5 font-medium text-right">Rev / recipient</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {flows.length > 0 ? (
              flows.map((f) => (
                <tr key={f.flow_id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <div className="text-slate-900">{f.name}</div>
                    {f.status && <div className="text-[10px] text-slate-400 font-mono uppercase">{f.status}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">{formatInt(f.recipients)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">{formatInt(f.opens)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">{formatInt(f.clicks)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-900 tabular-nums font-medium">{formatMoney(f.revenue)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">
                    {f.recipients > 0 ? `$${f.revenue_per_recipient.toFixed(2)}` : "—"}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-sm">
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
