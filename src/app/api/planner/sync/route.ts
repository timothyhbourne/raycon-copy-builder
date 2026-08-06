import { NextResponse } from "next/server";
import { listPlannerRows, writeSyncedMetrics } from "@/lib/planner";
import type { PlannerRow, SyncedMetrics, SyncResult } from "@/lib/planner-types";
import { dayRangeISO, resolvePlacedOrderMetric, fetchCampaignsByIds } from "@/lib/klaviyo";
import { getCampaignValuesCached } from "@/lib/klaviyo-cache";
import { isNorthbeamConfigured, getCampaignRevenue, normalizeCampaignName, northbeamPlatformLabels } from "@/lib/northbeam";

// Campaign report stats folded per campaign id. The window fetch goes through
// the SHARED Redis report cache (klaviyo-cache.ts) — replacing the old in-process
// 10-min cache that was ineffective on serverless (reset every cold start) and
// duplicated reporting calls the dashboard already made (ANALYTICS_RATE_LIMIT_SPEC §2.5).
interface CampaignStat { recipients: number; opens_unique: number; clicks_unique: number; conversion_value: number }

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

    // An email row is a sync candidate if it is LINKED — regardless of local
    // status; syncability then hinges on the real send time being in the past.
    // SMS platform metrics are MANUAL entry (Postscript's public API has no
    // campaign/analytics endpoints — see recipients.ts / the SMS spec); SMS rows
    // only participate in the Northbeam pass, joined by northbeam_campaign_name.
    const emailRows = rows.filter((r) => r.channel === "email" && r.klaviyo_campaign_id);
    const smsRows = rows.filter((r) => r.channel === "sms");

    // ---- Email → Klaviyo ----
    if (emailRows.length > 0) {
      const eligible = emailRows.filter((r) => isPast(emailSendBasis(r)));
      const byId = new Map<string, CampaignStat>();

      if (eligible.length > 0) {
        // Window: (earliest real send date − 1 day) → today, so post-send
        // conversion accrual is captured and the window can't miss the send.
        const startYMD = addDaysYMD(eligible.map((r) => ymd(emailSendBasis(r)!)).sort()[0], -1);
        const endYMD = ymd(now);
        const metric = await resolvePlacedOrderMetric();
        const { start, end } = dayRangeISO(startYMD, endYMD);
        const report = await getCampaignValuesCached(start, end, metric.id);
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
      }

      for (const row of emailRows) {
        if (!isPast(emailSendBasis(row))) {
          results.push({ id: row.id, name: row.name, matched: false, reason: "not_sent_yet" });
          continue;
        }
        // Structural guard: the sync NEVER overwrites manually-entered platform
        // metrics (today that's SMS-only, but the guard is channel-agnostic).
        if (row.metrics_source === "manual" || row.metrics_source === "postscript_csv") {
          results.push({ id: row.id, name: row.name, matched: false, reason: "sms_manual" });
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

    // ---- SMS platform metrics: MANUAL, by design ----
    // Postscript's public API has no campaign/flow/analytics endpoints
    // (confirmed 2026-07-23), so recipients/click/revenue for SMS rows are
    // typed in from the Postscript dashboard and the sync never touches them.
    // Surfaced as informational (never an error); NB rev still syncs below.
    for (const row of smsRows) {
      results.push({ id: row.id, name: row.name, matched: false, reason: "sms_manual" });
    }

    // ---- Northbeam campaign revenue (1-day click / clicks-only / cash) ----
    // Additive + fully isolated: matched to each row by its LINKED platform
    // campaign name (Northbeam's campaign dimension = utm_campaign, which
    // defaults to the Klaviyo/Postscript campaign name — NOT row.name). Any
    // failure here only pushes a warning; it must never take down the
    // Klaviyo/Postscript sync above (unlike the report path, which fails whole).
    const northbeamConfigured = isNorthbeamConfigured();
    const northbeamResults: SyncResult[] = [];
    if (!northbeamConfigured) {
      if (emailRows.length > 0 || smsRows.length > 0) {
        warnings.push("Northbeam not configured — NB revenue skipped. Set NORTHBEAM_API_KEY / NORTHBEAM_CLIENT_ID.");
      }
    } else {
      try {
        const eligibleEmail = emailRows.filter((r) => isPast(emailSendBasis(r)));
        // SMS rows join Northbeam by their picked northbeam_campaign_name (the
        // utm_campaign) — no platform link needed, but the send must be past.
        const eligibleSms = smsRows.filter((r) => isPast(smsSendBasis(r)) && (r.northbeam_campaign_name || "").trim());
        const eligible = [...eligibleEmail, ...eligibleSms];
        if (eligible.length > 0) {
          // Window start mirrors the K/PS passes (earliest real send − 1 day),
          // but the END is pinned to YESTERDAY — Northbeam's last fully
          // processed day (its own MTD reporting stops there). Including today
          // would return systematically low numbers for recent sends; a
          // campaign sent today simply stays unmatched ("—") until tomorrow.
          const bases = eligible
            .map((r) => (r.channel === "email" ? emailSendBasis(r) : smsSendBasis(r)))
            .filter((b): b is string => !!b)
            .map(ymd)
            .sort();
          const endYMD = addDaysYMD(ymd(now), -1);
          const startYMD = addDaysYMD(bases[0], -1);

          const cr = await getCampaignRevenue(`${startYMD}T00:00:00`, `${endYMD}T23:59:59`);
          // Sum by (platform, normalized name): DAILY granularity returns one
          // row per campaign per day it earned revenue.
          const labels = northbeamPlatformLabels();
          const keyOf = (platform: string, name: string) => `${platform.trim().toLowerCase()}||${normalizeCampaignName(name)}`;
          const revByKey = new Map<string, number>();
          for (const cRow of cr) {
            const k = keyOf(cRow.platform, cRow.campaignName);
            revByKey.set(k, (revByKey.get(k) ?? 0) + cRow.revenue);
          }

          // Resolve each row's join name (never assume row.name). One
          // mechanism, both channels: an explicit northbeam_campaign_name wins;
          // email rows without one default to the linked Klaviyo campaign name.
          const emailNameById = new Map<string, string>();
          const emailIds = eligibleEmail
            .filter((r) => !(r.northbeam_campaign_name || "").trim())
            .map((r) => r.klaviyo_campaign_id!)
            .filter(Boolean);
          if (emailIds.length > 0) {
            for (const c of await fetchCampaignsByIds(emailIds)) emailNameById.set(c.id, c.name);
          }

          for (const row of eligible) {
            const label = row.channel === "email" ? labels.email : labels.sms;
            const linkedName = (row.northbeam_campaign_name || "").trim()
              || (row.channel === "email" ? emailNameById.get(row.klaviyo_campaign_id!) : undefined);
            const rev = linkedName ? revByKey.get(keyOf(label, linkedName)) : undefined;
            if (rev == null) {
              // Explicit null (never silently 0) + a visible unmatched result.
              await writeSyncedMetrics(row.id, { northbeam_revenue: null, northbeam_synced_at: now });
              northbeamResults.push({ id: row.id, name: row.name, matched: false, reason: "northbeam_unmatched" });
            } else {
              await writeSyncedMetrics(row.id, { northbeam_revenue: rev, northbeam_synced_at: now });
              northbeamResults.push({ id: row.id, name: row.name, matched: true, reason: "matched" });
            }
          }
          const unmatched = northbeamResults.filter((r) => !r.matched);
          if (unmatched.length > 0) {
            warnings.push(`Northbeam: ${unmatched.length} campaign${unmatched.length === 1 ? "" : "s"} had no name match (${unmatched.map((r) => r.name).join(", ")}).`);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Northbeam revenue sync failed";
        console.error("[planner/sync northbeam]", msg);
        warnings.push(`Northbeam revenue sync failed (Klaviyo/Postscript metrics still synced): ${msg}`);
      }
    }

    // NOTE: to run this on a schedule later, wire a scheduled task to POST here.
    return NextResponse.json({
      ok: true,
      synced: syncedCount,
      northbeam_configured: northbeamConfigured,
      results,
      northbeam_results: northbeamResults,
      warnings,
      rows: await listPlannerRows(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    console.error("[planner/sync]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
