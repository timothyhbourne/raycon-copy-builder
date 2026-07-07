// Pure, dependency-free weekly-report math. No fs, no fetch, no Date-of-now:
// the route captures raw inputs + a timestamp and hands them here. Keeping this
// module pure makes every ratio guard trivially testable and keeps capture
// (network) separate from arithmetic.

export type DenominatorSource = "northbeam_total_sales" | "shopify";
export type RprMode = "campaign" | "program";

export interface WeeklyReportInputs {
  weekStartYMD: string;
  weekEndYMD: string;
  emailRevenue: number; // Northbeam, 1d click
  smsRevenue: number; // Northbeam, 1d click
  totalStoreRevenue: number; // store actual
  emailRecipients: number | null; // per the RPR definition (campaign-only when rprMode==="campaign")
  smsRecipients: number | null;
  denominatorSource: DenominatorSource;
  rprMode: RprMode;
  warnings: string[];
}

export interface ChannelBlock {
  revenue: number;
  pctOfStore: number | null; // revenue / totalStoreRevenue (0..1); null if denom <= 0
  recipients: number | null;
  revenuePerRecipient: number | null; // null if recipients <= 0 or unavailable
  revenuePer1kSends: number | null; // readability metric (RPR * 1000)
}

export interface Deltas {
  revenuePctChange: number | null; // fractional change in revenue vs prior week
  pctOfStorePointChange: number | null; // percentage-POINT change in pctOfStore
  rprPctChange: number | null; // fractional change in revenue-per-send
}

export interface WeeklyReport {
  week: { startYMD: string; endYMD: string; isoWeek: string }; // e.g. "2026-W27"
  email: ChannelBlock;
  sms: ChannelBlock;
  totalStoreRevenue: number;
  denominatorSource: DenominatorSource;
  rprMode: RprMode;
  generatedAt: string;
  warnings: string[];
  wow?: { email: Deltas; sms: Deltas };
}

// --- ratio guards: never emit NaN/Infinity; a bad denominator yields null ---

function safeDiv(numerator: number, denominator: number | null): number | null {
  if (denominator == null || !(denominator > 0)) return null;
  const v = numerator / denominator;
  return Number.isFinite(v) ? v : null;
}

function channelBlock(revenue: number, totalStoreRevenue: number, recipients: number | null): ChannelBlock {
  const rpr = recipients != null && recipients > 0 ? safeDiv(revenue, recipients) : null;
  return {
    revenue,
    pctOfStore: safeDiv(revenue, totalStoreRevenue),
    recipients,
    revenuePerRecipient: rpr,
    revenuePer1kSends: rpr == null ? null : rpr * 1000,
  };
}

function deltas(cur: ChannelBlock, prev: ChannelBlock): Deltas {
  return {
    revenuePctChange: safeDiv(cur.revenue - prev.revenue, prev.revenue),
    pctOfStorePointChange:
      cur.pctOfStore != null && prev.pctOfStore != null ? cur.pctOfStore - prev.pctOfStore : null,
    rprPctChange:
      cur.revenuePerRecipient != null && prev.revenuePerRecipient != null
        ? safeDiv(cur.revenuePerRecipient - prev.revenuePerRecipient, prev.revenuePerRecipient)
        : null,
  };
}

/**
 * Build the report. `previous` is the immediately-preceding stored snapshot (or
 * null on the first-ever run) and fills WoW. `generatedAt` is passed in (ISO)
 * so this stays free of Date-of-now.
 */
export function computeWeeklyReport(
  inputs: WeeklyReportInputs,
  previous: WeeklyReport | null,
  generatedAt: string,
): WeeklyReport {
  const email = channelBlock(inputs.emailRevenue, inputs.totalStoreRevenue, inputs.emailRecipients);
  const sms = channelBlock(inputs.smsRevenue, inputs.totalStoreRevenue, inputs.smsRecipients);

  const report: WeeklyReport = {
    week: {
      startYMD: inputs.weekStartYMD,
      endYMD: inputs.weekEndYMD,
      isoWeek: isoWeekOf(inputs.weekStartYMD),
    },
    email,
    sms,
    totalStoreRevenue: inputs.totalStoreRevenue,
    denominatorSource: inputs.denominatorSource,
    rprMode: inputs.rprMode,
    generatedAt,
    warnings: inputs.warnings,
  };

  if (previous) {
    report.wow = { email: deltas(email, previous.email), sms: deltas(sms, previous.sms) };
  }
  return report;
}

// --- week math (pure, UTC-anchored on YMD strings) ------------------------
// Week definition is Monday–Sunday (locked in the prompt). All helpers operate
// on YYYY-MM-DD strings so they never depend on the runtime's local timezone.

function toUTC(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}
function ymdOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(ymd: string, delta: number): string {
  const d = toUTC(ymd);
  d.setUTCDate(d.getUTCDate() + delta);
  return ymdOf(d);
}

/** Monday (start) of the Mon–Sun week containing `ymd`. */
export function mondayOf(ymd: string): string {
  const d = toUTC(ymd);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const backToMonday = (dow + 6) % 7; // Mon->0, Sun->6
  return addDays(ymd, -backToMonday);
}

/** The Mon–Sun window containing `ymd`. */
export function weekWindowForYMD(ymd: string): { startYMD: string; endYMD: string; isoWeek: string } {
  const startYMD = mondayOf(ymd);
  const endYMD = addDays(startYMD, 6);
  return { startYMD, endYMD, isoWeek: isoWeekOf(startYMD) };
}

/** The most recent fully-completed Mon–Sun week before the week containing `refYMD`. */
export function previousCompletedWeek(refYMD: string): { startYMD: string; endYMD: string; isoWeek: string } {
  const thisMonday = mondayOf(refYMD);
  const lastMonday = addDays(thisMonday, -7);
  const endYMD = addDays(lastMonday, 6);
  return { startYMD: lastMonday, endYMD, isoWeek: isoWeekOf(lastMonday) };
}

/** Resolve an ISO-week label like "2026-W27" to its Mon–Sun window. */
export function weekWindowForIsoWeek(isoWeek: string): { startYMD: string; endYMD: string; isoWeek: string } | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(isoWeek);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  // ISO-8601: week 1 is the week containing Jan 4th; weeks start Monday.
  const jan4 = `${year}-01-04`;
  const week1Monday = mondayOf(jan4);
  const startYMD = addDays(week1Monday, (week - 1) * 7);
  const endYMD = addDays(startYMD, 6);
  return { startYMD, endYMD, isoWeek: isoWeekOf(startYMD) };
}

/** ISO-8601 week label for the week containing `ymd`, e.g. "2026-W27". */
export function isoWeekOf(ymd: string): string {
  // Thursday of the current ISO week determines the ISO year + week number.
  const monday = toUTC(mondayOf(ymd));
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const isoYear = thursday.getUTCFullYear();
  const jan1 = new Date(`${isoYear}-01-01T00:00:00Z`);
  const week = Math.floor((thursday.getTime() - jan1.getTime()) / (7 * 24 * 3600 * 1000)) + 1;
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}
