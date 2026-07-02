"use client";
import { useDashboardData } from "../dashboard-context";
import type { CampaignMeta } from "../types";
import { formatMoney, formatInt, formatDate, formatDateTime } from "../format";

export default function CampaignsPage() {
  const { data } = useDashboardData();
  if (!data) return null;
  const campaigns = data.campaigns;
  const status = data.campaign_status;

  return (
    <>
      {/* Performance table — sent campaigns with activity in range */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden mb-4">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="font-mono text-xs text-slate-500 uppercase tracking-wide">Campaigns</div>
            <div className="text-sm text-slate-600 mt-0.5">Sent campaigns with activity over the selected range</div>
          </div>
          <div className="text-xs text-slate-500">{campaigns.length} sent</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500 font-mono text-[10px] uppercase tracking-wide">
                <th className="px-4 py-2.5 font-medium">Campaign</th>
                <th className="px-4 py-2.5 font-medium">Send date</th>
                <th className="px-4 py-2.5 font-medium text-right">Recipients</th>
                <th className="px-4 py-2.5 font-medium text-right">Opens</th>
                <th className="px-4 py-2.5 font-medium text-right">Clicks</th>
                <th className="px-4 py-2.5 font-medium text-right">Revenue</th>
                <th className="px-4 py-2.5 font-medium text-right">Rev / recipient</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {campaigns.length > 0 ? (
                campaigns.map((c) => (
                  <tr key={c.campaign_id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <div className="text-slate-900">{c.name}</div>
                      {c.status && <div className="text-[10px] text-slate-400 font-mono uppercase">{c.status}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{formatDate(c.send_time)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">{formatInt(c.recipients)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">{formatInt(c.opens)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">{formatInt(c.clicks)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-900 tabular-nums font-medium">{formatMoney(c.revenue)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">
                      {c.recipients > 0 ? `$${c.revenue_per_recipient.toFixed(2)}` : "—"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-400 text-sm">
                    No sent campaigns with activity in this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Status subsections */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatusColumn title="Draft / upcoming" hint="Not yet scheduled" items={status.draft} showTime={false} />
        <StatusColumn title="Scheduled" hint="Future send" items={status.scheduled} showTime={true} />
        <StatusColumn title="Sent" hint="In selected range" items={status.sent} showTime={true} />
      </div>
    </>
  );
}

function StatusColumn({
  title,
  hint,
  items,
  showTime,
}: {
  title: string;
  hint: string;
  items: CampaignMeta[];
  showTime: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <div>
          <div className="font-mono text-xs text-slate-500 uppercase tracking-wide">{title}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">{hint}</div>
        </div>
        <div className="text-xs text-slate-500">{items.length}</div>
      </div>
      <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
        {items.length > 0 ? (
          items.map((c) => (
            <div key={c.campaign_id} className="px-4 py-2.5">
              <div className="text-sm text-slate-900 leading-snug">{c.name}</div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-[10px] text-slate-400 font-mono uppercase">{c.status}</span>
                {c.audience_count > 0 && (
                  <span className="text-[10px] text-slate-400">· {c.audience_count} list{c.audience_count === 1 ? "" : "s"}</span>
                )}
                {showTime && c.send_time && (
                  <span className="text-[10px] text-slate-500 font-mono">· {formatDateTime(c.send_time)}</span>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="px-4 py-8 text-center text-slate-400 text-xs">None</div>
        )}
      </div>
    </div>
  );
}
