// Recipient capture for the weekly report. Reuses the existing Klaviyo /
// Postscript clients unchanged — we only sum delivered recipients over the same
// week window handed to Northbeam.
//
// We capture BOTH campaign and flow email recipients so the report can run in
// either RPR mode (see src/lib/reports/run.ts):
//   - program mode (default): denominator = campaigns + flows, matching the
//     channel-level Northbeam revenue numerator (flows + campaigns). Populations
//     agree — the honest fallback the prompt specifies.
//   - campaign mode: denominator = campaigns only (use once Northbeam is
//     confirmed to break revenue out campaign-vs-flow for this account).

import { campaignValuesReport, flowValuesReport, dayRangeISO, resolvePlacedOrderMetric } from "@/lib/klaviyo";
import { isPostscriptConfigured, listPostscriptCampaigns, getPostscriptCampaignMetrics } from "@/lib/postscript";

export interface EmailRecipients {
  campaignRecipients: number; // delivered recipients of campaigns that sent in-week
  flowRecipients: number; // delivered recipients of flow/automation sends in-week
  campaignCount: number;
  truncated: boolean;
}

// A campaign's / flow's recipients are counted at send, so rows with
// recipients > 0 are exactly the sends that happened in the window.
export async function captureEmailRecipients(weekStartYMD: string, weekEndYMD: string): Promise<EmailRecipients> {
  const metric = await resolvePlacedOrderMetric();
  const { start, end } = dayRangeISO(weekStartYMD, weekEndYMD);

  const campaignReport = await campaignValuesReport({ start, end, conversionMetricId: metric.id });
  const byCampaign = new Map<string, number>();
  for (const r of campaignReport.results) {
    const id = r.groupings.campaign_id;
    if (!id) continue;
    byCampaign.set(id, (byCampaign.get(id) ?? 0) + (r.statistics.recipients ?? 0));
  }
  let campaignRecipients = 0;
  let campaignCount = 0;
  for (const [, n] of byCampaign) {
    if (n > 0) { campaignRecipients += n; campaignCount++; }
  }

  const flowReport = await flowValuesReport({ start, end, conversionMetricId: metric.id });
  let flowRecipients = 0;
  for (const r of flowReport.results) flowRecipients += r.statistics.recipients ?? 0;

  return {
    campaignRecipients,
    flowRecipients,
    campaignCount,
    truncated: campaignReport.truncated || flowReport.truncated,
  };
}

export interface SmsRecipients {
  recipients: number | null; // null when Postscript isn't connected OR errored
  campaignCount: number;
  connected: boolean;
  error?: string; // set when configured but the API call failed
}

function withinWeek(sendTime: string | null, weekStartYMD: string, weekEndYMD: string): boolean {
  if (!sendTime) return false;
  const ymd = sendTime.slice(0, 10);
  return ymd >= weekStartYMD && ymd <= weekEndYMD;
}

// SMS campaign recipients: campaigns sent within the week, summed. Degrades to
// null (not an error) when Postscript isn't configured. SMS has no flow-level
// recipient source here, so SMS is inherently campaign-only.
export async function captureSmsRecipients(weekStartYMD: string, weekEndYMD: string): Promise<SmsRecipients> {
  if (!isPostscriptConfigured()) return { recipients: null, campaignCount: 0, connected: false };
  try {
    const campaigns = await listPostscriptCampaigns();
    const inWeek = campaigns.filter((c) => withinWeek(c.send_time, weekStartYMD, weekEndYMD));
    let recipients = 0;
    let campaignCount = 0;
    for (const c of inWeek) {
      const m = await getPostscriptCampaignMetrics(c.id);
      if (m && m.recipients != null) { recipients += m.recipients; campaignCount++; }
    }
    return { recipients, campaignCount, connected: true };
  } catch (e) {
    // Configured but the API call failed (endpoint/plan/permissions). SMS
    // revenue still comes from Northbeam; degrade recipients/RPR to "—" rather
    // than failing the whole run.
    return { recipients: null, campaignCount: 0, connected: false, error: e instanceof Error ? e.message : "Postscript error" };
  }
}
