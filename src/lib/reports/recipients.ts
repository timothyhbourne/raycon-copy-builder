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

import { readSnapshot, sliceRange } from "@/lib/klaviyo-snapshot";

export interface EmailRecipients {
  campaignRecipients: number; // delivered recipients of campaigns that sent in-week
  flowRecipients: number; // delivered recipients of flow/automation sends in-week
  campaignCount: number;
  truncated: boolean;
}

// A campaign's / flow's recipients are counted at send, so rows with
// recipients > 0 are exactly the sends that happened in the window.
//
// Reads the nightly snapshot rather than making its own reporting calls: the
// weekly report used to duplicate the two calls the dashboard had already made,
// which against a 2/min quota is how one cron run could throttle the app for
// everyone (docs/KLAVIYO_RATE_LIMIT_SPEC.md §3.1).
export async function captureEmailRecipients(weekStartYMD: string, weekEndYMD: string): Promise<EmailRecipients> {
  const snap = await readSnapshot();
  if (!snap) return { campaignRecipients: 0, flowRecipients: 0, campaignCount: 0, truncated: true };

  const slice = sliceRange(snap, weekStartYMD, weekEndYMD);
  let campaignRecipients = 0;
  let campaignCount = 0;
  for (const c of slice.campaigns) {
    if (c.stats.recipients > 0) { campaignRecipients += c.stats.recipients; campaignCount++; }
  }
  const flowRecipients = slice.flows.reduce((n, f) => n + f.stats.recipients, 0);

  return {
    campaignRecipients,
    flowRecipients,
    campaignCount,
    // `truncated` now means "the week isn't fully covered by the snapshot", which
    // is the same signal the report needs: the denominator would be understated.
    truncated: !slice.covered,
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
