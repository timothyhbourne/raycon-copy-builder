// Pure snapshot types + range slicing. NO fs, NO storage, NO network — so the
// dashboard can import it and slice a range IN THE BROWSER, which is what makes a
// date-range change instant and free of any round trip at all
// (docs/KLAVIYO_RATE_LIMIT_SPEC.md §3.1, §4).
//
// lib/klaviyo-snapshot.ts is the server half: it owns the Redis store and the
// merge, and re-exports everything here so server code has one import site. Same
// split, and same reason, as flow-email-id.ts vs flows.ts.

import { todayYMDInTz } from "./cache-ttl";

// THE architectural fix (spec: KLAVIYO_RATE_LIMIT_SPEC §3.1).
//
// The old measure path made a reporting call PER DATE RANGE. Every distinct range
// was its own cache key, so a manager dragging the date picker twice spent six
// reporting calls in one minute against a 2-per-minute quota. The date picker was
// a rate-limit landmine.
//
// A campaign values report is scoped by SEND DATE and every row carries its own
// send_time, so a report for a wide window is a strict superset of every narrower
// window inside it. Flows have no send date, so their sub-range totals come from a
// flow-series report at a daily interval — which also gives us per-day flow
// numbers the app could not produce at all before.
//
// So: pull ONE wide window on a schedule, store the rows, and compute any range
// the user picks by filtering locally. The dashboard makes zero Klaviyo calls, and
// changing the range is arithmetic rather than a network round trip.
//
// This module is the store plus the PURE slicing. It makes no Klaviyo calls —
// lib/klaviyo-sync.ts does the fetching. Everything here is unit-tested.

/** The statistics every campaign row and flow day carries. One shape, so a rate
 * is computed the same way wherever it comes from. */
export interface Stats {
  recipients: number;
  delivered: number;
  opens_unique: number;
  clicks_unique: number;
  conversion_value: number;
  conversions: number;
  unsubscribes: number;
  spam_complaints: number;
  bounced: number;
}

export function emptyStats(): Stats {
  return {
    recipients: 0, delivered: 0, opens_unique: 0, clicks_unique: 0,
    conversion_value: 0, conversions: 0, unsubscribes: 0, spam_complaints: 0, bounced: 0,
  };
}

export function addStats(a: Stats, b: Partial<Stats>): Stats {
  return {
    recipients: a.recipients + (b.recipients ?? 0),
    delivered: a.delivered + (b.delivered ?? 0),
    opens_unique: a.opens_unique + (b.opens_unique ?? 0),
    clicks_unique: a.clicks_unique + (b.clicks_unique ?? 0),
    conversion_value: a.conversion_value + (b.conversion_value ?? 0),
    conversions: a.conversions + (b.conversions ?? 0),
    unsubscribes: a.unsubscribes + (b.unsubscribes ?? 0),
    spam_complaints: a.spam_complaints + (b.spam_complaints ?? 0),
    bounced: a.bounced + (b.bounced ?? 0),
  };
}

export interface CampaignSnapshotRow {
  campaign_id: string;
  /** YYYY-MM-DD in the ACCOUNT's timezone — the day this campaign is counted on. */
  send_ymd: string | null;
  send_time: string | null;
  name: string;
  status: string;
  audience_count: number;
  stats: Stats;
  /**
   * True once send_time + the attribution window is in the past, i.e. Klaviyo
   * will not revise these numbers again. A sealed row is never re-fetched, which
   * is what keeps the nightly cost proportional to RECENT sends rather than to
   * total history (spec §3.4).
   */
  final: boolean;
}

export interface FlowDayRow {
  flow_id: string;
  /** YYYY-MM-DD in the account's timezone. */
  ymd: string;
  stats: Stats;
}

export interface DayTotalRow {
  ymd: string;
  revenue: number;
  orders: number;
}

export interface FlowMetaRow {
  id: string;
  name: string;
  status?: string;
}

export interface CampaignMetaRow {
  campaign_id: string;
  name: string;
  status: string;
  send_time: string | null;
  audience_count: number;
}

export interface KlaviyoSnapshot {
  /** Inclusive YMD bounds of the data held. */
  window: { start: string; end: string };
  timezone: string;
  synced_at: string;
  attribution_days: number;
  campaigns: CampaignSnapshotRow[];
  flow_days: FlowDayRow[];
  day_totals: DayTotalRow[];
  flow_meta: FlowMetaRow[];
  draft: CampaignMetaRow[];
  scheduled: CampaignMetaRow[];
  /** Per-source notes carried into every range served from this snapshot. */
  warnings: string[];
}

export function emptySnapshot(timezone = "UTC"): KlaviyoSnapshot {
  return {
    window: { start: "", end: "" },
    timezone,
    synced_at: "",
    attribution_days: DEFAULT_ATTRIBUTION_DAYS,
    campaigns: [], flow_days: [], day_totals: [], flow_meta: [], draft: [], scheduled: [],
    warnings: [],
  };
}

/** Klaviyo revises conversion attribution for 5 days after send on email and SMS
 * (push is 24h; configurable per account). Override with KLAVIYO_ATTRIBUTION_DAYS. */
export const DEFAULT_ATTRIBUTION_DAYS = 5;

export function attributionDays(): number {
  const n = Number(process.env.KLAVIYO_ATTRIBUTION_DAYS);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_ATTRIBUTION_DAYS;
}

/** YMD of an ISO instant, in a given IANA timezone. Pure. */
export function ymdInTz(iso: string | null | undefined, tz: string): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return todayYMDInTz(tz, new Date(t));
}

/**
 * Is a campaign's number final? True once its send day plus the attribution
 * window has fully passed, so Klaviyo has stopped revising it.
 */
export function isFinalOn(sendYmd: string | null, todayYmd: string, days = attributionDays()): boolean {
  if (!sendYmd) return false;
  const sealAt = addDays(sendYmd, days);
  return sealAt < todayYmd;
}

function addDays(ymd: string, delta: number): string {
  const t = Date.parse(`${ymd}T00:00:00.000Z`);
  return new Date(t + delta * 86_400_000).toISOString().slice(0, 10);
}
export { addDays as addYmdDays };

// ---------------------------------------------------------------------------
// Slicing — the whole point. Pure, and the only thing a range request needs.
// ---------------------------------------------------------------------------

export interface SlicedRow {
  id: string;
  name: string;
  status?: string;
  send_time?: string | null;
  stats: Stats;
}

export interface SlicedRange {
  start: string;
  end: string;
  campaigns: SlicedRow[];
  flows: SlicedRow[];
  total_revenue: number;
  order_count: number;
  /** Days in the requested range the snapshot has no data for. */
  missing_days: string[];
  covered: boolean;
}

function inRange(ymd: string | null, start: string, end: string): boolean {
  return !!ymd && ymd >= start && ymd <= end;
}

/**
 * Everything a range needs, computed from the snapshot alone. Zero Klaviyo calls.
 *
 * `missing_days` is deliberate: if someone asks for a range the snapshot does not
 * cover, we say so rather than quietly returning a smaller number. A partial
 * revenue figure that looks complete is worse than an explicit gap.
 */
export function sliceRange(snap: KlaviyoSnapshot, start: string, end: string): SlicedRange {
  const campaigns: SlicedRow[] = snap.campaigns
    .filter((c) => inRange(c.send_ymd, start, end))
    .map((c) => ({ id: c.campaign_id, name: c.name, status: c.status, send_time: c.send_time, stats: c.stats }));

  const flowTotals = new Map<string, Stats>();
  for (const d of snap.flow_days) {
    if (!inRange(d.ymd, start, end)) continue;
    flowTotals.set(d.flow_id, addStats(flowTotals.get(d.flow_id) ?? emptyStats(), d.stats));
  }
  const flowNames = new Map(snap.flow_meta.map((f) => [f.id, f]));
  const flows: SlicedRow[] = [...flowTotals].map(([id, stats]) => ({
    id,
    name: flowNames.get(id)?.name ?? `(unknown flow ${id})`,
    status: flowNames.get(id)?.status,
    stats,
  }));

  let total_revenue = 0;
  let order_count = 0;
  const haveDay = new Set<string>();
  for (const d of snap.day_totals) {
    if (!inRange(d.ymd, start, end)) continue;
    haveDay.add(d.ymd);
    total_revenue += d.revenue;
    order_count += d.orders;
  }

  const missing_days: string[] = [];
  for (let ymd = start; ymd <= end; ymd = addDays(ymd, 1)) {
    if (!haveDay.has(ymd)) missing_days.push(ymd);
  }

  campaigns.sort((a, b) => b.stats.conversion_value - a.stats.conversion_value);
  flows.sort((a, b) => b.stats.conversion_value - a.stats.conversion_value);

  return { start, end, campaigns, flows, total_revenue, order_count, missing_days, covered: missing_days.length === 0 };
}

// ---------------------------------------------------------------------------
// Rates — per DELIVERED, not per recipient (spec §3.5)
// ---------------------------------------------------------------------------

export interface Rates {
  open_rate: number;
  click_rate: number;
  unsubscribe_rate: number;
  spam_rate: number;
  bounce_rate: number;
  delivery_rate: number;
  revenue_per_recipient: number;
}

/**
 * Rates computed against DELIVERED, which is what
 * docs/WEEKLY_REPORT_PROMPT.md already specified and what the old foldStat threw
 * `delivered` away rather than doing. Bounce rate is the exception and is per
 * RECIPIENT by definition — a bounce is precisely a non-delivery, so dividing it
 * by delivered would be circular.
 *
 * revenue_per_recipient stays per recipient: it is a cost-of-send measure and the
 * planner, Copy Performance and Northbeam reconciliation all compare against it.
 */
export function ratesOf(s: Stats): Rates {
  const perDelivered = (n: number) => (s.delivered > 0 ? n / s.delivered : 0);
  return {
    open_rate: perDelivered(s.opens_unique),
    click_rate: perDelivered(s.clicks_unique),
    unsubscribe_rate: perDelivered(s.unsubscribes),
    spam_rate: perDelivered(s.spam_complaints),
    bounce_rate: s.recipients > 0 ? s.bounced / s.recipients : 0,
    delivery_rate: s.recipients > 0 ? s.delivered / s.recipients : 0,
    revenue_per_recipient: s.recipients > 0 ? s.conversion_value / s.recipients : 0,
  };
}
