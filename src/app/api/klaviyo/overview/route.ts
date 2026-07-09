import { NextRequest, NextResponse } from "next/server";
import { eachDay, readDimensions, readRange, type CampaignDim } from "@/lib/metrics/store";
import { syncMetrics } from "@/lib/metrics/sync";

// Overview read path — sync-then-read. This handler makes ZERO Klaviyo calls: it
// sums the local daily metrics store (written by the background sync) into the
// dashboard's response shape. Reads are O(days-in-range file I/O), so a 30-day
// range returns in a few ms instead of the old 20–60s live-recompute.
//
// The old in-memory Map and the Step 1 on-disk response cache are gone — the
// store is the cache now. ?nocache=1 (Force refresh) triggers a synchronous sync
// of the range's unfrozen days and then re-reads; it may be slow, by design.

interface FlowRow {
  flow_id: string; name: string; status?: string;
  recipients: number; opens: number; clicks: number; revenue: number; revenue_per_recipient: number;
}
interface CampaignRow {
  campaign_id: string; name: string; status?: string; send_time: string | null;
  recipients: number; opens: number; clicks: number; revenue: number; revenue_per_recipient: number;
}
interface CampaignMeta {
  campaign_id: string; name: string; status: string; send_time: string | null; audience_count: number;
}
interface Totals { recipients: number; opens: number; clicks: number; revenue: number }

// Guard so concurrent reads with missing days don't stampede the background sync.
let bgSyncInFlight = false;
function triggerBackgroundSync(backfillDays: number): void {
  if (bgSyncInFlight) return;
  bgSyncInFlight = true;
  // Fire-and-forget: fill the gap for a later read; never blocks this response.
  syncMetrics({ backfillDays })
    .catch((e) => console.error("[klaviyo/overview] background sync failed", e))
    .finally(() => { bgSyncInFlight = false; });
}

// Whole days from `ymd` (UTC) to now — used to size a backfill that reaches a
// given day.
function daysAgo(ymd: string): number {
  const then = new Date(`${ymd}T00:00:00Z`).getTime();
  const now = Date.now();
  return Math.max(0, Math.ceil((now - then) / 86_400_000));
}

const toMetaFromDim = (c: CampaignDim): CampaignMeta => ({
  campaign_id: c.campaign_id, name: c.name, status: c.status, send_time: c.send_time, audience_count: c.audience_count,
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const startYMD = searchParams.get("start");
    const endYMD = searchParams.get("end");
    const debug = searchParams.get("debug") === "1";
    const nocache = searchParams.get("nocache") === "1";
    if (!startYMD || !endYMD) {
      return NextResponse.json({ error: "start and end query params required (YYYY-MM-DD)" }, { status: 400 });
    }

    const timings: Record<string, number> = {};
    const t0 = Date.now();
    const warnings: string[] = [];

    // Force refresh: synchronously sync the range's unfrozen days, then read.
    // syncMetrics always re-fetches the trailing window and backfills missing
    // days within the horizon, so a backfill that reaches `start` covers the
    // requested range's unfrozen days. Slow but explicit — this is the button.
    if (nocache) {
      const s = Date.now();
      try {
        const summary = await syncMetrics({ backfillDays: Math.max(daysAgo(startYMD), 1) });
        if (summary.days_failed > 0) warnings.push(`Force refresh: ${summary.days_failed} day(s) could not sync (Klaviyo rate limit) — try again shortly.`);
      } catch (e) {
        warnings.push(`Force refresh sync failed: ${e instanceof Error ? e.message : e}`);
      }
      timings.sync = Date.now() - s;
    }

    // ---- Read + aggregate (zero external calls) ----
    const readStart = Date.now();
    const { days, missing } = readRange(startYMD, endYMD);
    const dims = readDimensions();
    timings.store_read = Date.now() - readStart;

    // Headline totals straight from the per-day revenue buckets.
    let total = 0;
    let orderCount = 0;
    for (const d of days) { total += d.revenue.total; orderCount += d.revenue.order_count; }

    // Flows: sum each flow across the days, join names from dimensions, keep only
    // rows with activity. Attributed-from-flows is the full flow revenue sum.
    const byFlow = new Map<string, Totals>();
    for (const d of days) {
      for (const f of d.flows) {
        const cur = byFlow.get(f.flow_id) ?? { recipients: 0, opens: 0, clicks: 0, revenue: 0 };
        cur.recipients += f.recipients; cur.opens += f.opens; cur.clicks += f.clicks; cur.revenue += f.revenue;
        byFlow.set(f.flow_id, cur);
      }
    }
    let attributedFromFlows = 0;
    const flowMeta = new Map(dims.flows.map((f) => [f.flow_id, f]));
    const flowRows: FlowRow[] = [];
    for (const [id, t] of byFlow) {
      attributedFromFlows += t.revenue;
      if (t.recipients <= 0 && t.revenue <= 0) continue;
      const meta = flowMeta.get(id);
      flowRows.push({
        flow_id: id, name: meta?.name ?? `(unknown flow ${id})`, status: meta?.status,
        recipients: t.recipients, opens: t.opens, clicks: t.clicks, revenue: t.revenue,
        revenue_per_recipient: t.recipients > 0 ? t.revenue / t.recipients : 0,
      });
    }
    flowRows.sort((a, b) => b.revenue - a.revenue);

    // Campaigns: same shape; join metadata from dimensions.
    const byCampaign = new Map<string, Totals>();
    for (const d of days) {
      for (const c of d.campaigns) {
        const cur = byCampaign.get(c.campaign_id) ?? { recipients: 0, opens: 0, clicks: 0, revenue: 0 };
        cur.recipients += c.recipients; cur.opens += c.opens; cur.clicks += c.clicks; cur.revenue += c.revenue;
        byCampaign.set(c.campaign_id, cur);
      }
    }
    let attributedFromCampaigns = 0;
    const campaignMeta = new Map(dims.campaigns.map((c) => [c.campaign_id, c]));
    const campaignRows: CampaignRow[] = [];
    for (const [id, t] of byCampaign) {
      attributedFromCampaigns += t.revenue;
      if (t.recipients <= 0 && t.revenue <= 0) continue;
      const meta = campaignMeta.get(id);
      campaignRows.push({
        campaign_id: id, name: meta?.name ?? `(unknown campaign ${id})`, status: meta?.status,
        send_time: meta?.send_time ?? null,
        recipients: t.recipients, opens: t.opens, clicks: t.clicks, revenue: t.revenue,
        revenue_per_recipient: t.recipients > 0 ? t.revenue / t.recipients : 0,
      });
    }
    campaignRows.sort((a, b) => b.revenue - a.revenue);

    const attributed = attributedFromFlows + attributedFromCampaigns;

    // Status subsections. Draft / Scheduled come straight from dimensions. Sent =
    // the campaigns with activity in-range (lines up with the performance table).
    const draft = dims.draft.map(toMetaFromDim);
    const scheduled = [...dims.scheduled].map(toMetaFromDim).sort((a, b) => (a.send_time || "").localeCompare(b.send_time || ""));
    const sent: CampaignMeta[] = campaignRows.map((c) => {
      const meta = campaignMeta.get(c.campaign_id);
      return { campaign_id: c.campaign_id, name: c.name, status: meta?.status ?? c.status ?? "", send_time: c.send_time, audience_count: meta?.audience_count ?? 0 };
    }).sort((a, b) => (b.send_time || "").localeCompare(a.send_time || ""));

    // Freshness: OLDEST synced_at across returned days (never overstate). Falls
    // back to the dimensions timestamp when the range has no days yet.
    const syncedAts = days.map((d) => d.synced_at).filter(Boolean);
    const lastSyncedAt = syncedAts.length ? syncedAts.reduce((m, s) => (s < m ? s : m)) : dims.synced_at;

    const requestedDays = eachDay(startYMD, endYMD).length;
    if (missing.length) {
      warnings.push(`${missing.length} of ${requestedDays} day(s) in this range aren't synced yet — totals may be incomplete. Syncing in background…`);
      // Fire-and-forget fill for the gap (oldest missing day sets the horizon).
      if (!nocache) triggerBackgroundSync(Math.max(daysAgo(missing[0]), 1));
    }

    timings.total = Date.now() - t0;
    console.log(`[klaviyo/overview] ${startYMD}..${endYMD} total ${timings.total}ms coverage ${days.length}/${requestedDays}`);

    const response: Record<string, unknown> = {
      revenue: {
        total, attributed,
        attributed_from_flows: attributedFromFlows,
        attributed_from_campaigns: attributedFromCampaigns,
        order_count: orderCount,
      },
      flows: flowRows,
      campaigns: campaignRows,
      campaign_status: { draft, scheduled, sent },
      warnings,
      range: { start: startYMD, end: endYMD },
      last_synced_at: lastSyncedAt,
      missing_days: missing,
      coverage: { requested_days: requestedDays, found_days: days.length },
    };

    if (debug) {
      response.debug = {
        timings_ms: timings,
        note: "store-backed read — zero Klaviyo calls on this path (timings.sync only set when nocache=1 forced a sync)",
        account_timezone: dims.timezone,
        dimensions_synced_at: dims.synced_at,
        coverage: {
          requested_days: requestedDays,
          found_days: days.length,
          missing_days: missing,
          found_dates: days.map((d) => d.date),
          frozen_days: days.filter((d) => d.frozen).length,
        },
        flow_rows_with_activity: flowRows.length,
        campaign_rows_with_activity: campaignRows.length,
        draft_count: draft.length,
        scheduled_count: scheduled.length,
        attributed_reconciliation: {
          from_flows: attributedFromFlows,
          from_campaigns: attributedFromCampaigns,
          sum: attributedFromFlows + attributedFromCampaigns,
          attributed,
          matches: Math.abs(attributedFromFlows + attributedFromCampaigns - attributed) < 0.01,
        },
      };
    }
    return NextResponse.json(response);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[klaviyo/overview]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
