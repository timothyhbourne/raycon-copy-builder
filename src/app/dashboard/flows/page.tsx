"use client";
import { useDashboardData } from "../dashboard-context";
import { formatMoney, formatInt, formatPct, formatRate } from "../format";
import Card from "@/components/ui/Card";
import { KPIRow, StatCell } from "@/components/ui/Stat";

export default function FlowsPage() {
  const { data } = useDashboardData();
  if (!data) return null;
  const flows = data.flows;
  const revenue = data.revenue;
  const flowRecipients = flows.reduce((a, f) => a + (f.recipients ?? 0), 0);

  return (
    <>
      {/* Channel-scoped revenue — flows only, over the selected range. */}
      <Card className="mb-4" bodyClassName="p-6">
        <KPIRow cols={2}>
          <StatCell
            label="Flow revenue (Klaviyo-attributed)"
            value={formatMoney(revenue.attributed_from_flows)}
            description={<>{formatPct(revenue.attributed_from_flows, revenue.total)} of placed-order revenue</>}
          />
          <StatCell
            label="Flow recipients"
            value={formatInt(flowRecipients)}
            description={<>{flows.length} active flow{flows.length === 1 ? "" : "s"} in range</>}
          />
        </KPIRow>
      </Card>

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
              <th className="px-4 py-2.5 font-medium text-right" title="Delivered / recipients">Delivered</th>
              <th className="px-4 py-2.5 font-medium text-right" title="Unique opens / delivered">Open</th>
              <th className="px-4 py-2.5 font-medium text-right" title="Unique clicks / delivered">Click</th>
              {/* List health. These came back in the report we already made — we
                  simply weren't asking (KLAVIYO_RATE_LIMIT_SPEC §3.5). */}
              <th className="px-4 py-2.5 font-medium text-right" title="Unsubscribes / delivered">Unsub</th>
              <th className="px-4 py-2.5 font-medium text-right" title="Spam complaints / delivered">Spam</th>
              <th className="px-4 py-2.5 font-medium text-right" title="Bounces / recipients">Bounce</th>
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
                    {f.status && <div className="text-[10px] text-ink-tertiary capitalize">{f.status}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-ink-secondary font-mono tabular-nums">{formatInt(f.recipients)}</td>
                  <td className="px-4 py-2.5 text-right text-ink-secondary font-mono tabular-nums" title={`${formatInt(f.delivered)} delivered`}>{formatRate(f.recipients > 0 ? f.delivered / f.recipients : 0)}</td>
                  <td className="px-4 py-2.5 text-right text-ink-secondary font-mono tabular-nums" title={`${formatInt(f.opens)} unique opens`}>{formatRate(f.open_rate)}</td>
                  <td className="px-4 py-2.5 text-right text-ink-secondary font-mono tabular-nums" title={`${formatInt(f.clicks)} unique clicks`}>{formatRate(f.click_rate)}</td>
                  <td className="px-4 py-2.5 text-right text-ink-secondary font-mono tabular-nums" title={`${formatInt(f.unsubscribes)} unsubscribes`}>{formatRate(f.unsubscribe_rate, 2)}</td>
                  <td className="px-4 py-2.5 text-right text-ink-secondary font-mono tabular-nums" title={`${formatInt(f.spam_complaints)} spam complaints`}>{formatRate(f.spam_rate, 3)}</td>
                  <td className="px-4 py-2.5 text-right text-ink-secondary font-mono tabular-nums" title={`${formatInt(f.bounced)} bounces`}>{formatRate(f.bounce_rate, 2)}</td>
                  <td className="px-4 py-2.5 text-right text-ink font-mono tabular-nums font-medium">{formatMoney(f.revenue)}</td>
                  <td className="px-4 py-2.5 text-right text-ink-secondary font-mono tabular-nums">
                    {f.recipients > 0 ? `$${f.revenue_per_recipient.toFixed(2)}` : "—"}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-ink-muted text-sm">
                  No flow activity in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
    </>
  );
}
