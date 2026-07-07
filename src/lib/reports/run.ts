// Orchestrates one weekly run: resolve the Mon–Sun window → capture Northbeam
// revenue + total store revenue + recipients → compute via the pure module →
// fill WoW from the prior snapshot → persist. Shared by the cron route and the
// in-app "Run now". Server-only (imports fs-backed store + network clients).

import { getWeeklyChannelRevenue, isNorthbeamConfigured } from "@/lib/northbeam";
import { captureEmailRecipients, captureSmsRecipients } from "./recipients";
import { computeWeeklyReport, previousCompletedWeek, weekWindowForIsoWeek, type WeeklyReportInputs, type WeeklyReport, type RprMode } from "./weekly";
import { getPreviousWeeklyReport, upsertWeeklyReport } from "./weekly-store";

function todayYMDUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveMode(): RprMode {
  // Default: program (channel-level NB revenue ÷ campaigns+flows). Switch to
  // "campaign" only once Northbeam is confirmed to split campaign-vs-flow
  // revenue for this account (open item), so numerator/denominator still agree.
  return process.env.WEEKLY_RPR_MODE === "campaign" ? "campaign" : "program";
}

export async function runWeeklyReport(targetIsoWeek?: string | null): Promise<WeeklyReport> {
  if (!isNorthbeamConfigured()) {
    throw new Error("Northbeam not configured — set NORTHBEAM_API_KEY and NORTHBEAM_CLIENT_ID in .env.local and restart.");
  }

  const win = targetIsoWeek ? weekWindowForIsoWeek(targetIsoWeek) : previousCompletedWeek(todayYMDUTC());
  if (!win) throw new Error(`Invalid week "${targetIsoWeek}". Expected ISO week like "2026-W27".`);
  const { startYMD, endYMD, isoWeek } = win;

  const warnings: string[] = [];
  const mode = resolveMode();

  // Northbeam revenue + total store revenue (1-day click, cash). ISO window for
  // the week; Northbeam interprets it in the account timezone (validated on the
  // NB page during verification).
  const nb = await getWeeklyChannelRevenue(`${startYMD}T00:00:00`, `${endYMD}T23:59:59`);
  warnings.push(...nb.warnings);

  // Recipients over the same window.
  const email = await captureEmailRecipients(startYMD, endYMD);
  if (email.truncated) warnings.push("Klaviyo report hit the page cap — email recipients may undercount.");
  const sms = await captureSmsRecipients(startYMD, endYMD);
  if (!sms.connected) {
    warnings.push(
      sms.error
        ? `Postscript unavailable (SMS revenue still from Northbeam; recipients/RPR show —): ${sms.error}`
        : "Postscript not connected — SMS recipients/RPR unavailable (SMS revenue still from Northbeam).",
    );
  }

  const emailRecipients = mode === "campaign" ? email.campaignRecipients : email.campaignRecipients + email.flowRecipients;
  if (mode === "program") {
    warnings.push("RPR is program-level (incl. flows): NB email revenue ÷ (campaign + flow sends). Switch to campaign mode once Northbeam splits campaign-vs-flow revenue.");
  }

  const inputs: WeeklyReportInputs = {
    weekStartYMD: startYMD,
    weekEndYMD: endYMD,
    emailRevenue: nb.emailRevenue,
    smsRevenue: nb.smsRevenue,
    totalStoreRevenue: nb.totalStoreRevenue,
    emailRecipients,
    smsRecipients: sms.recipients,
    denominatorSource: "northbeam_total_sales",
    rprMode: mode,
    warnings,
  };

  const prev = getPreviousWeeklyReport(isoWeek);
  const report = computeWeeklyReport(inputs, prev, new Date().toISOString());
  upsertWeeklyReport(report);
  return report;
}
