// Recipient capture for the weekly report. Email reuses the Klaviyo client;
// SMS recipients have NO API source (see captureSmsRecipients below) and
// degrade to "—" in the report.
//
// We capture BOTH campaign and flow email recipients so the report can run in
// either RPR mode (see src/lib/reports/run.ts):
//   - program mode (default): denominator = campaigns + flows, matching the
//     channel-level Northbeam revenue numerator (flows + campaigns). Populations
//     agree — the honest fallback the prompt specifies.
//   - campaign mode: denominator = campaigns only (use once Northbeam is
//     confirmed to break revenue out campaign-vs-flow for this account).

import { dayRangeISO, resolvePlacedOrderMetric } from "@/lib/klaviyo";
import { getCampaignValuesCached, getFlowValuesCached } from "@/lib/klaviyo-cache";

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

  const campaignReport = await getCampaignValuesCached(start, end, metric.id);
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

  const flowReport = await getFlowValuesCached(start, end, metric.id);
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

// SMS recipients CANNOT be captured via API. Postscript's public partner API
// has no campaign, flow, or analytics endpoints AT ALL (confirmed 2026-07-23
// against the complete endpoint index — developers.postscript.io/llms.txt; the
// API is subscribers, custom events, webhooks, unsubscribe/redact). The old
// lib/postscript.ts client called GET /campaigns — an endpoint that does not
// exist — and was deleted; do NOT rebuild it against imaginary endpoints. See
// docs/SMS_PLANNER_NB_LINK_AND_MANUAL_METRICS_SPEC.md. SMS revenue comes from
// Northbeam; recipients/click-rate are manual entry in the Planner. If the
// Postscript CSM ever grants analytics access or CSV exports, replace this stub.
export async function captureSmsRecipients(_weekStartYMD: string, _weekEndYMD: string): Promise<SmsRecipients> {
  return {
    recipients: null,
    campaignCount: 0,
    connected: false,
    error: "Postscript's public API has no campaign/analytics endpoints — SMS recipients are manual entry in the Planner.",
  };
}
