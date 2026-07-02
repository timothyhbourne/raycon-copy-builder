import { NextResponse } from "next/server";
import { listPlannerRows, writeSyncedMetrics } from "@/lib/planner";
import type { SyncedMetrics } from "@/lib/planner-types";
import { campaignValuesReport, dayRangeISO, resolvePlacedOrderMetric } from "@/lib/klaviyo";
import { isPostscriptConfigured, getPostscriptCampaignMetrics } from "@/lib/postscript";

// Small per-window cache for the Klaviyo campaign values report so repeated
// syncs of the same date window are cheap (mirrors the overview route's cache).
// In-process only — see the note in klaviyo/overview/route.ts.
const REPORT_TTL_MS = 10 * 60 * 1000;
interface CampaignStat { recipients: number; opens_unique: number; clicks_unique: number; conversion_value: number }
const reportCache = new Map<string, { ts: number; byId: Map<string, CampaignStat> }>();

function ymd(iso: string): string {
  return (iso || "").slice(0, 10);
}

// A row is eligible for a metrics pull once it has actually gone out.
function isSyncable(status: string, plannedSendAt: string): boolean {
  if (status === "sent") return true;
  const t = new Date(plannedSendAt).getTime();
  return !isNaN(t) && t <= Date.now();
}

export async function POST() {
  try {
    const rows = listPlannerRows();
    const warnings: string[] = [];

    const emailRows = rows.filter(
      (r) => r.channel === "email" && r.klaviyo_campaign_id && isSyncable(r.status, r.planned_send_at)
    );
    const smsRows = rows.filter(
      (r) => r.channel === "sms" && r.postscript_campaign_id && isSyncable(r.status, r.planned_send_at)
    );

    let syncedCount = 0;

    // ---- Email → Klaviyo. One report call covers all email rows in the window
    // (send-date min → today, to capture post-send conversion accrual). ----
    if (emailRows.length > 0) {
      const dates = emailRows.map((r) => ymd(r.planned_send_at)).filter(Boolean).sort();
      const startYMD = dates[0];
      const endYMD = ymd(new Date().toISOString());
      const cacheKey = `${startYMD}_${endYMD}`;

      let byId: Map<string, CampaignStat>;
      const cached = reportCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < REPORT_TTL_MS) {
        byId = cached.byId;
      } else {
        const metric = await resolvePlacedOrderMetric();
        const { start, end } = dayRangeISO(startYMD, endYMD);
        const report = await campaignValuesReport({ start, end, conversionMetricId: metric.id });
        if (report.truncated) warnings.push("Klaviyo campaign report was truncated — some campaigns may be missing.");
        byId = new Map();
        for (const r of report.results) {
          const id = r.groupings.campaign_id;
          if (!id) continue;
          const cur = byId.get(id) ?? { recipients: 0, opens_unique: 0, clicks_unique: 0, conversion_value: 0 };
          cur.recipients += r.statistics.recipients ?? 0;
          cur.opens_unique += r.statistics.opens_unique ?? 0;
          cur.clicks_unique += r.statistics.clicks_unique ?? 0;
          cur.conversion_value += r.statistics.conversion_value ?? 0;
          byId.set(id, cur);
        }
        reportCache.set(cacheKey, { ts: Date.now(), byId });
      }

      const now = new Date().toISOString();
      for (const row of emailRows) {
        const s = byId.get(row.klaviyo_campaign_id!);
        if (!s) continue; // no activity for this campaign in the window
        const recipients = s.recipients || 0;
        const metrics: SyncedMetrics = {
          recipients,
          open_rate: recipients > 0 ? s.opens_unique / recipients : null,
          click_rate: recipients > 0 ? s.clicks_unique / recipients : null,
          revenue: s.conversion_value,
          revenue_per_recipient: recipients > 0 ? s.conversion_value / recipients : null,
          metrics_synced_at: now,
        };
        writeSyncedMetrics(row.id, metrics);
        syncedCount++;
      }
    }

    // ---- SMS → Postscript (sequential; no opens on SMS). ----
    const postscriptConnected = isPostscriptConfigured();
    if (smsRows.length > 0) {
      if (!postscriptConnected) {
        warnings.push("Postscript not connected — set POSTSCRIPT_API_KEY to sync SMS metrics.");
      } else {
        const now = new Date().toISOString();
        for (const row of smsRows) {
          const m = await getPostscriptCampaignMetrics(row.postscript_campaign_id!);
          if (!m) continue;
          const metrics: SyncedMetrics = {
            recipients: m.recipients,
            open_rate: null, // SMS has no opens — never fabricate
            click_rate: m.click_rate,
            revenue: m.revenue,
            revenue_per_recipient: m.revenue_per_recipient,
            metrics_synced_at: now,
          };
          writeSyncedMetrics(row.id, metrics);
          syncedCount++;
        }
      }
    }

    // NOTE: to run this on a schedule later, wire a scheduled task to POST here.
    // The app supports scheduling; we intentionally leave that unbuilt for now.
    return NextResponse.json({
      ok: true,
      synced: syncedCount,
      postscript_connected: postscriptConnected,
      warnings,
      rows: listPlannerRows(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    console.error("[planner/sync]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
