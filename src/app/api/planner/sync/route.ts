import { NextResponse } from "next/server";
import { listPlannerRows, writeSyncedMetrics } from "@/lib/planner";
import type { PlannerRow, SyncedMetrics, SyncResult } from "@/lib/planner-types";
import { campaignValuesReport, dayRangeISO, resolvePlacedOrderMetric } from "@/lib/klaviyo";
import { isPostscriptConfigured, getPostscriptCampaignMetrics } from "@/lib/postscript";

// Per-window cache for the Klaviyo campaign values report so repeated syncs of
// the same window are cheap. In-process only — see klaviyo/overview/route.ts.
const REPORT_TTL_MS = 10 * 60 * 1000;
interface CampaignStat { recipients: number; opens_unique: number; clicks_unique: number; conversion_value: number }
const reportCache = new Map<string, { ts: number; byId: Map<string, CampaignStat> }>();

function ymd(iso: string): string {
  return (iso || "").slice(0, 10);
}
function addDaysYMD(ymdStr: string, delta: number): string {
  const d = new Date(`${ymdStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// The metrics window basis is the REAL platform send time captured at link time,
// falling back to planned_send_at only for manually-entered ids. This fixes the
// old bug where a future/wrong planned date made the window miss the real send.
function emailSendBasis(r: PlannerRow): string | null {
  return r.klaviyo_send_time || r.planned_send_at || null;
}
function smsSendBasis(r: PlannerRow): string | null {
  return r.postscript_send_time || r.planned_send_at || null;
}
function isPast(iso: string | null): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !isNaN(t) && t <= Date.now();
}

export async function POST() {
  try {
    const rows = await listPlannerRows();
    const warnings: string[] = [];
    const results: SyncResult[] = [];
    let syncedCount = 0;
    const now = new Date().toISOString();

    // A row is a sync candidate if it is LINKED — regardless of local status.
    // Syncability then hinges on the real send time being in the past.
    const emailRows = rows.filter((r) => r.channel === "email" && r.klaviyo_campaign_id);
    const smsRows = rows.filter((r) => r.channel === "sms" && r.postscript_campaign_id);

    // ---- Email → Klaviyo ----
    if (emailRows.length > 0) {
      const eligible = emailRows.filter((r) => isPast(emailSendBasis(r)));
      let byId = new Map<string, CampaignStat>();

      if (eligible.length > 0) {
        // Window: (earliest real send date − 1 day) → today, so post-send
        // conversion accrual is captured and the window can't miss the send.
        const startYMD = addDaysYMD(eligible.map((r) => ymd(emailSendBasis(r)!)).sort()[0], -1);
        const endYMD = ymd(now);
        const cacheKey = `${startYMD}_${endYMD}`;
        const cached = reportCache.get(cacheKey);
        if (cached && Date.now() - cached.ts < REPORT_TTL_MS) {
          byId = cached.byId;
        } else {
          const metric = await resolvePlacedOrderMetric();
          const { start, end } = dayRangeISO(startYMD, endYMD);
          const report = await campaignValuesReport({ start, end, conversionMetricId: metric.id });
          if (report.truncated) warnings.push("Klaviyo campaign report was truncated — some campaigns may be missing.");
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
      }

      for (const row of emailRows) {
        if (!isPast(emailSendBasis(row))) {
          results.push({ id: row.id, name: row.name, matched: false, reason: "not_sent_yet" });
          continue;
        }
        const s = byId.get(row.klaviyo_campaign_id!);
        if (!s) {
          results.push({ id: row.id, name: row.name, matched: false, reason: "no_activity_in_window" });
          continue;
        }
        const recipients = s.recipients || 0;
        const metrics: SyncedMetrics = {
          recipients,
          open_rate: recipients > 0 ? s.opens_unique / recipients : null,
          click_rate: recipients > 0 ? s.clicks_unique / recipients : null,
          revenue: s.conversion_value,
          revenue_per_recipient: recipients > 0 ? s.conversion_value / recipients : null,
          metrics_synced_at: now,
        };
        await writeSyncedMetrics(row.id, metrics);
        syncedCount++;
        results.push({ id: row.id, name: row.name, matched: true, reason: "matched" });
      }
    }

    // ---- SMS → Postscript (sequential; no opens on SMS) ----
    const postscriptConnected = isPostscriptConfigured();
    for (const row of smsRows) {
      if (!postscriptConnected) {
        results.push({ id: row.id, name: row.name, matched: false, reason: "postscript_not_connected" });
        continue;
      }
      if (!isPast(smsSendBasis(row))) {
        results.push({ id: row.id, name: row.name, matched: false, reason: "not_sent_yet" });
        continue;
      }
      const m = await getPostscriptCampaignMetrics(row.postscript_campaign_id!);
      if (!m || m.recipients === null) {
        results.push({ id: row.id, name: row.name, matched: false, reason: "no_activity_in_window" });
        continue;
      }
      const metrics: SyncedMetrics = {
        recipients: m.recipients,
        open_rate: null, // SMS has no opens — never fabricate
        click_rate: m.click_rate,
        revenue: m.revenue,
        revenue_per_recipient: m.revenue_per_recipient,
        metrics_synced_at: now,
      };
      await writeSyncedMetrics(row.id, metrics);
      syncedCount++;
      results.push({ id: row.id, name: row.name, matched: true, reason: "matched" });
    }
    if (smsRows.length > 0 && !postscriptConnected) {
      warnings.push("Postscript not connected — set POSTSCRIPT_API_KEY to sync SMS metrics.");
    }

    // NOTE: to run this on a schedule later, wire a scheduled task to POST here.
    return NextResponse.json({
      ok: true,
      synced: syncedCount,
      postscript_connected: postscriptConnected,
      results,
      warnings,
      rows: await listPlannerRows(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    console.error("[planner/sync]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
