import { readEnv } from "./env";
import { acquireReportingSlot, BREAKER_THRESHOLD_S, noteThrottle, openBreaker } from "./klaviyo-limiter";

export const BASE = "https://a.klaviyo.com/api";
const REVISION = "2026-04-15";

export const METRIC_NAMES = {
  placedOrder: "Placed Order",
  receivedEmail: "Received Email",
  openedEmail: "Opened Email",
  clickedEmail: "Clicked Email",
} as const;

export type MetricName = (typeof METRIC_NAMES)[keyof typeof METRIC_NAMES];

// Klaviyo has two throttles: a burst (~1 req/s, short Retry-After) and a
// steady-state (~minutes, long Retry-After). We patiently honor short waits
// but surface long ones to the caller so the UI can show a clear "wait Xs and
// try again" message instead of hanging.
const MAX_RETRIES = 3;
const PATIENT_RETRY_THRESHOLD_S = 30;
const PATIENT_RETRY_DELAY_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Optional per-call fetch behavior. Background jobs (the metrics sync) can wait
// out longer 429 Retry-After windows than an interactive request should:
// Klaviyo's reporting endpoints have a 2/min steady quota whose Retry-After can
// approach a minute, which the interactive threshold deliberately refuses.
interface KlaviyoFetchOpts {
  patientThresholdS?: number; // max Retry-After (s) we'll sleep through (default PATIENT_RETRY_THRESHOLD_S)
  maxRetryDelayMs?: number;   // cap on a single sleep (default PATIENT_RETRY_DELAY_MS)
  /** "reporting" = the tight tier (1/s · 2/min · 225/day). A 429 there with a
   * long Retry-After opens the shared circuit breaker so every other process
   * stops calling too, instead of each one rediscovering the throttle
   * (docs/KLAVIYO_RATE_LIMIT_SPEC.md §3.3). */
  tier?: "reporting" | "standard";
}

/** Thrown on a 429 so callers can read the real Retry-After instead of parsing a
 * message. `blocked` is true once the breaker has been opened for it. */
export class KlaviyoThrottled extends Error {
  readonly retryAfterS: number;
  readonly blocked: boolean;
  constructor(retryAfterS: number, blocked: boolean) {
    super(`Klaviyo rate-limited this request (429). Available in ~${retryAfterS}s.`);
    this.name = "KlaviyoThrottled";
    this.retryAfterS = retryAfterS;
    this.blocked = blocked;
  }
}

export async function klaviyoFetch<T = unknown>(path: string, init?: RequestInit, opts?: KlaviyoFetchOpts): Promise<T> {
  const key = readEnv("KLAVIYO_API_KEY");
  if (!key) {
    throw new Error("KLAVIYO_API_KEY is not set in .env.local. Add it and restart the dev server.");
  }
  const headers = {
    Authorization: `Klaviyo-API-Key ${key}`,
    revision: REVISION,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(init?.headers || {}),
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`${BASE}${path}`, { ...init, headers, cache: "no-store" });
    if (res.status === 429) {
      const retryAfterRaw = res.headers.get("Retry-After");
      const retryAfterSec = retryAfterRaw ? Math.ceil(parseFloat(retryAfterRaw)) : 1;
      const thresholdS = opts?.patientThresholdS ?? PATIENT_RETRY_THRESHOLD_S;
      const maxDelayMs = opts?.maxRetryDelayMs ?? PATIENT_RETRY_DELAY_MS;
      const reporting = opts?.tier === "reporting";

      // A LONG Retry-After on the reporting tier is not something to retry — it
      // has been observed in the wild at 18+ hours. Open the breaker and stop.
      if (reporting && retryAfterSec > BREAKER_THRESHOLD_S) {
        await openBreaker(retryAfterSec);
        throw new KlaviyoThrottled(retryAfterSec, true);
      }
      if (reporting) await noteThrottle();

      // Waits beyond the caller's patience indicate steady-state throttle
      // exhaustion — surface to the caller instead of blocking for minutes.
      if (retryAfterSec > thresholdS || attempt >= MAX_RETRIES) {
        throw new KlaviyoThrottled(retryAfterSec, false);
      }
      await sleep(Math.min(retryAfterSec * 1000, maxDelayMs));
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Klaviyo API ${res.status} on ${path}: ${text.slice(0, 500)}`);
    }
    return (await res.json()) as T;
  }
  throw new Error(`Klaviyo API on ${path}: exhausted retries`);
}

// Metric IDs are per-account — resolve once per process.
let metricIdCache: Record<string, string> | null = null;

interface MetricListResponse {
  data: Array<{ id: string; attributes: { name: string } }>;
  links?: { next?: string | null };
}

async function loadMetricIds(): Promise<Record<string, string>> {
  if (metricIdCache) return metricIdCache;
  const map: Record<string, string> = {};
  let url: string | null = "/metrics/";
  while (url) {
    const data: MetricListResponse = await klaviyoFetch(url);
    for (const m of data.data) map[m.attributes.name] = m.id;
    const next = data.links?.next;
    url = next ? next.replace(BASE, "") : null;
  }
  metricIdCache = map;
  return map;
}

export async function getMetricId(name: MetricName): Promise<string> {
  const map = await loadMetricIds();
  const id = map[name];
  if (!id) {
    throw new Error(
      `Klaviyo metric "${name}" not found in this account. Available metrics: ${Object.keys(map).slice(0, 20).join(", ")}`
    );
  }
  return id;
}

interface AggregateOptions {
  metricId: string;
  start: string; // ISO datetime
  end: string;   // ISO datetime
  measurements?: string[]; // default ["sum_value", "count"]
  by?: string[];           // e.g. ["$flow"] or ["$campaign"]
  interval?: "day" | "week" | "month";
  // Timezone the datetime filter + bucketing are interpreted in. Must match the
  // basis used for the values-report timeframe so "total" and "attributed"
  // revenue cover the same day boundaries. Defaults to UTC for back-compat.
  timezone?: string;
}

interface AggregateResponse {
  data: {
    attributes: {
      dates: string[];
      data: Array<{
        dimensions: string[];
        measurements: Record<string, number[]>;
      }>;
    };
  };
}

export async function aggregateMetric(opts: AggregateOptions): Promise<AggregateResponse["data"]["attributes"]> {
  const body = {
    data: {
      type: "metric-aggregate",
      attributes: {
        metric_id: opts.metricId,
        measurements: opts.measurements ?? ["sum_value", "count"],
        interval: opts.interval ?? "day",
        timezone: opts.timezone ?? "UTC",
        filter: [
          `greater-or-equal(datetime,${opts.start})`,
          `less-than(datetime,${opts.end})`,
        ],
        ...(opts.by && opts.by.length ? { by: opts.by } : {}),
      },
    },
  };
  const res = await klaviyoFetch<AggregateResponse>("/metric-aggregates/", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.data.attributes;
}

export function sumArray(arr: number[] | undefined): number {
  if (!arr) return 0;
  let total = 0;
  for (const n of arr) total += n || 0;
  return total;
}

export interface FlowListItem {
  id: string;
  name: string;
  status?: string;
}

interface FlowsResponse {
  data: Array<{
    id: string;
    attributes: { name: string; status?: string };
  }>;
  links?: { next?: string | null };
}

export async function listFlows(): Promise<FlowListItem[]> {
  const out: FlowListItem[] = [];
  let url: string | null = "/flows/";
  while (url) {
    const data: FlowsResponse = await klaviyoFetch(url);
    for (const f of data.data) {
      out.push({ id: f.id, name: f.attributes.name, status: f.attributes.status });
    }
    const next = data.links?.next;
    url = next ? next.replace(BASE, "") : null;
  }
  return out;
}

// Audiences — Klaviyo segments and lists. Same shape/pagination as flows
// (data[].id, data[].attributes.name, links.next). Used by the planner's
// audience picker so include/exclude names stay consistent with Klaviyo.
export interface AudienceItem {
  id: string;
  name: string;
  type: "segment" | "list";
  /** Profile count, when we have one. Absent is normal and means "not measured" —
   * never treat it as zero (see fetchAudienceSize for why it's often absent). */
  size?: number;
  size_synced_at?: string;
}
interface AudienceResponse { data: Array<{ id: string; attributes: { name: string } }>; links?: { next?: string | null } }

/**
 * Page cap for the audience catalogue. Measured 2026-08-29: 9 pages of segments
 * and 27 of lists. The previous cap was 30, so lists were three pages from
 * silently truncating — and a truncated catalogue looks complete, which is the
 * worst failure mode for a picker someone briefs a VA from.
 */
const MAX_AUDIENCE_PAGES = 80;

async function listAudienceResource(
  path: string,
  type: "segment" | "list",
): Promise<{ items: AudienceItem[]; truncated: boolean }> {
  const out: AudienceItem[] = [];
  let url: string | null = path;
  let pages = 0;
  while (url && pages < MAX_AUDIENCE_PAGES) {
    const data: AudienceResponse = await klaviyoFetch(url);
    for (const a of data.data) out.push({ id: a.id, name: a.attributes.name, type });
    const next = data.links?.next;
    url = next ? next.replace(BASE, "") : null;
    pages++;
  }
  // A live cursor at the cap means we stopped early and are missing audiences.
  return { items: out, truncated: url !== null };
}

export function listSegments(): Promise<{ items: AudienceItem[]; truncated: boolean }> {
  return listAudienceResource("/segments/", "segment");
}
export function listLists(): Promise<{ items: AudienceItem[]; truncated: boolean }> {
  return listAudienceResource("/lists/", "list");
}

/**
 * One audience's profile count, or null.
 *
 * `profile_count` is NOT available on the collection endpoints — revision
 * 2026-04-15 rejects it outright ("fields must be in [created, definition, id,
 * is_active, is_processing, is_starred, name, updated]"), which is why the spec's
 * assumption that the list call carries sizes doesn't hold. It IS available on the
 * single-resource endpoint via additional-fields, but that variant is separately
 * and hard throttled: measured 429 / Retry-After 1 on ALTERNATING sequential calls
 * at 120ms spacing. So the caller must pace this, and a null answer is expected
 * rather than exceptional.
 */
export async function fetchAudienceSize(id: string, type: "segment" | "list"): Promise<number | null> {
  const field = type === "segment" ? "additional-fields%5Bsegment%5D" : "additional-fields%5Blist%5D";
  try {
    const resp = await klaviyoFetch<{ data?: { attributes?: { profile_count?: number } } }>(
      `/${type === "segment" ? "segments" : "lists"}/${encodeURIComponent(id)}/?${field}=profile_count`,
      undefined,
      // A short 429 here is the normal case, so ride it out briefly rather than
      // failing the audience.
      { patientThresholdS: 5, maxRetryDelayMs: 5_000 },
    );
    const n = resp?.data?.attributes?.profile_count;
    return typeof n === "number" ? n : null;
  } catch {
    return null;   // size is an extra; never fail the catalogue over it
  }
}

// Lightweight recent-first campaign list for the planner's email campaign picker
// (typeahead). Returns id, name, status, send_time. Capped — the picker only
// needs recent campaigns, and the id here matches groupings.campaign_id in the
// values report (same id as in a Klaviyo campaign URL).
export interface KlaviyoCampaignItem { id: string; name: string; status: string; send_time: string | null }
interface CampaignPickerResponse {
  data: Array<{ id: string; attributes: { name: string; status: string; send_time?: string | null; send_strategy?: { datetime?: string | null } | null } }>;
  links?: { next?: string | null };
}
export async function listKlaviyoCampaigns(maxPages = 3): Promise<KlaviyoCampaignItem[]> {
  const out: KlaviyoCampaignItem[] = [];
  const filter = encodeURIComponent("equals(messages.channel,'email')");
  let url: string | null = `/campaigns/?filter=${filter}&sort=-created_at`;
  let pages = 0;
  while (url && pages < maxPages) {
    const data: CampaignPickerResponse = await klaviyoFetch(url);
    for (const c of data.data) {
      out.push({
        id: c.id,
        name: c.attributes.name,
        status: c.attributes.status,
        send_time: c.attributes.send_time ?? c.attributes.send_strategy?.datetime ?? null,
      });
    }
    const next = data.links?.next;
    url = next ? next.replace(BASE, "") : null;
    pages++;
  }
  return out;
}

// Values Reports — purpose-built endpoints that return per-flow / per-campaign
// stats in one call, without us needing to know account-specific attribution
// dimension keys. We use these for the flows table and for attributed revenue.

// Everything we want per campaign / per flow, in ONE call. The deliverability
// half (unsubscribes, spam complaints, bounces) costs zero extra requests — it
// was always available in the call we already make, and we simply weren't asking
// (spec §3.5). Verified live against revision 2026-04-15.
const VALUES_REPORT_STATISTICS = [
  "recipients",
  "delivered",
  "opens",
  "opens_unique",
  "clicks",
  "clicks_unique",
  "conversion_value",
  "conversions",
  "unsubscribes",
  "spam_complaints",
  "bounced",
];

export interface ValuesReportStatistics {
  recipients?: number;
  delivered?: number;
  opens?: number;
  opens_unique?: number;
  clicks?: number;
  clicks_unique?: number;
  conversion_value?: number;
  conversions?: number;
  unsubscribes?: number;
  spam_complaints?: number;
  bounced?: number;
}

export interface CampaignValuesResult {
  groupings: { campaign_id?: string; send_channel?: string };
  statistics: ValuesReportStatistics;
}

interface ValuesReportResponse<T> {
  data: { attributes: { results: T[] } };
  links?: { next?: string | null };
}

interface ValuesReportOpts {
  start: string;
  end: string;
  conversionMetricId: string;
}

// SHARED channel scope for BOTH the flow and campaign values reports. Klaviyo's
// values reports require a `filter` to return data, and — critically — the two
// halves of "attributed revenue" must be measured on the SAME basis. Previously
// flows were filtered to email while campaigns had no channel filter (all
// channels), so attributed_from_flows excluded SMS/push while
// attributed_from_campaigns included them. We standardize on email-only for both
// (Raycon is email-first). To widen later, change this ONE constant to e.g.
// any(send_channel,['email','sms','push']) and it applies to both reports.
const REPORT_CHANNEL_FILTER = "equals(send_channel,'email')";

// Klaviyo values reports paginate via links.next EVEN WHEN THE LEADING PAGES ARE
// EMPTY. Measured live on this account, 2026-08-25, flow-values over 25 days:
//
//     page 1: 0 rows, next=VhgXNi
//     page 2: 0 rows, next=Tww4ya
//     page 3: 4 rows, next=ThNzLG
//     page 4: 81 rows, next=null
//
// So one flow report is FOUR reporting calls, and the campaign report is one.
// This is the defect behind the 429s, and the previous version of this function
// is what caused them: it followed the cursor back-to-back, which against a
// 2-per-minute steady quota throttles on page 3 every single time — so a flow
// report could never complete, and each attempt still burned two quota units.
//
// EVERY page now goes through the shared limiter. That is what makes a paginated
// report possible at all: four pages, 31 seconds apart, is compliant; four pages
// in four seconds is a guaranteed 429.
const MAX_REPORT_PAGES = 25;

export interface PagedFetchOpts {
  /** Day key in the account's timezone, for the daily counter. */
  day: string;
  /** How long a single page may wait for its slot. A background sync waits; an
   * interactive caller should pass 0 and handle the refusal. */
  waitMs?: number;
  onProgress?: (page: number, rows: number) => void;
  /**
   * Resume from this cursor URL instead of page 1. A flow report is four pages and
   * each page needs its own 31s pacing slot, so it takes ~2 minutes — longer than
   * any serverless invocation. Persisting the cursor lets a run fetch a page or two,
   * keep the rows, and have the next invocation carry on where it stopped.
   */
  startUrl?: string;
  /** Stop after this many pages and hand the cursor back. */
  maxPages?: number;
}

export type PagedResult<T> =
  | { ok: true; results: T[]; truncated: boolean; pages: number; nextUrl: string | null }
  | { ok: false; reason: "blocked" | "daily_cap" | "timeout" | "throttled"; retryAfterS?: number; pages: number };

const REPORT_FETCH_OPTS: KlaviyoFetchOpts = {
  tier: "reporting",
  // Pages are paced by the limiter, so a 429 here means someone else spent the
  // window. Ride out a short one rather than abandoning a half-read report.
  patientThresholdS: 90,
  maxRetryDelayMs: 90_000,
};

/**
 * Follow a report's cursor to the end, one limiter-gated call per page.
 *
 * Returns a discriminated result rather than throwing, because "we could not
 * finish this report right now" is an expected outcome that the caller must be
 * able to distinguish from bad data: a partial report is not a small revenue
 * number, it is a wrong one.
 */
async function fetchAllPagesGated<T>(
  endpoint: string,
  body: unknown,
  opts: PagedFetchOpts,
): Promise<PagedResult<T>> {
  const bodyStr = JSON.stringify(body);
  const results: T[] = [];
  let url: string | null = opts.startUrl || endpoint;
  let pages = 0;
  const maxPages = Math.min(opts.maxPages ?? MAX_REPORT_PAGES, MAX_REPORT_PAGES);

  while (url && pages < maxPages) {
    const slot = await acquireReportingSlot({ day: opts.day, waitMs: opts.waitMs ?? 0 });
    if (!slot.ok) {
      // Keep whatever we already paid for: those rows are real and the cursor lets
      // a later run continue. Only a run that got NOTHING is a failure.
      if (pages > 0) return { ok: true, results, truncated: false, pages, nextUrl: url };
      return { ok: false, reason: slot.reason, retryAfterS: slot.retryAfterS, pages };
    }

    let resp: ValuesReportResponse<T>;
    try {
      resp = await klaviyoFetch<ValuesReportResponse<T>>(url, { method: "POST", body: bodyStr }, REPORT_FETCH_OPTS);
    } catch (e) {
      if (e instanceof KlaviyoThrottled) {
        if (pages > 0) return { ok: true, results, truncated: false, pages, nextUrl: url };
        return { ok: false, reason: "throttled", retryAfterS: e.retryAfterS, pages };
      }
      throw e;
    }
    const page = resp.data.attributes.results ?? [];
    results.push(...page);
    pages++;
    opts.onProgress?.(pages, page.length);
    const nextLink: string | null | undefined = resp.links?.next;
    url = nextLink ? nextLink.replace(BASE, "") : null;
  }
  // `truncated` means we hit the hard safety cap with a cursor still live — a real
  // data loss. Stopping at maxPages with a cursor to hand back is not that.
  return { ok: true, results, truncated: pages >= MAX_REPORT_PAGES && url !== null, pages, nextUrl: url };
}

// `flowValuesReport` and its debug twin used to live here. Both are gone: a flow
// has no send date, so a values report over a wide window cannot be sliced into
// sub-ranges — which is the whole basis of the snapshot. Per-flow numbers come
// from `flowSeriesReport` at a daily interval instead, which gives us per-day flow
// figures the app could not produce at all before
// (docs/KLAVIYO_RATE_LIMIT_SPEC.md §3.1).

interface MetricRaw {
  id: string;
  attributes: { name: string; integration?: { key?: string; name?: string; category?: string } };
}

interface MetricListResp { data: MetricRaw[]; links?: { next?: string | null } }

export async function listMetricsByName(name: string): Promise<MetricRaw[]> {
  const matches: MetricRaw[] = [];
  let url: string | null = "/metrics/";
  while (url) {
    const resp: MetricListResp = await klaviyoFetch<MetricListResp>(url);
    for (const m of resp.data) if (m.attributes.name === name) matches.push(m);
    const nextLink: string | null | undefined = resp.links?.next;
    url = nextLink ? nextLink.replace(BASE, "") : null;
  }
  return matches;
}

export interface MetricCandidate {
  id: string;
  integrationKey?: string;
  integrationName?: string;
  category?: string;
}

export interface ResolvedMetric {
  id: string;
  chosen: MetricCandidate;
  candidates: MetricCandidate[];
  ambiguous: boolean;
  source: "env" | "default" | "auto"; // how the id was chosen (for debug auditing)
}

// The Shopify "Placed Order" metric for this account. Klaviyo accounts commonly
// have MORE THAN ONE "Placed Order" metric (e.g. a Shopify one and an API one),
// and scanning /metrics/ to disambiguate is both slow (multi-page) and produced
// a recurring "multiple metrics found" warning. We pin the Shopify id so revenue
// is always computed against the right metric and we skip the scan entirely.
// Override per account with KLAVIYO_PLACED_ORDER_METRIC_ID in .env.local.
const DEFAULT_PLACED_ORDER_METRIC_ID = "JxF6bB";

// Resolve the conversion metric. Pinned by default (env var, else the hardcoded
// Shopify id) so we never page /metrics/ on the hot path. Only if pinning is
// explicitly disabled (both env var and default blank) do we fall back to the
// name-based auto-resolution and its ambiguity flag.
export async function resolvePlacedOrderMetric(): Promise<ResolvedMetric> {
  const envId = readEnv("KLAVIYO_PLACED_ORDER_METRIC_ID");
  const pinned = envId || DEFAULT_PLACED_ORDER_METRIC_ID;
  if (pinned) {
    const chosen: MetricCandidate = { id: pinned, integrationKey: "shopify", integrationName: "Shopify" };
    return {
      id: pinned,
      chosen,
      candidates: [chosen],
      ambiguous: false, // pinned — no ambiguity, no warning
      source: envId ? "env" : "default",
    };
  }
  // Fallback (only reached if pinning is disabled): deterministic name-based
  // resolution preferring the Shopify integration, with ambiguity surfaced.
  const metrics = await listMetricsByName(METRIC_NAMES.placedOrder);
  const candidates: MetricCandidate[] = metrics.map((m) => ({
    id: m.id,
    integrationKey: m.attributes.integration?.key,
    integrationName: m.attributes.integration?.name,
    category: m.attributes.integration?.category,
  }));
  if (candidates.length === 0) {
    throw new Error(`Klaviyo metric "${METRIC_NAMES.placedOrder}" not found in this account.`);
  }
  const shopify =
    candidates.find((c) => (c.integrationKey || "").toLowerCase() === "shopify") ??
    candidates.find((c) => (c.integrationName || "").toLowerCase() === "shopify") ??
    candidates.find((c) => (c.category || "").toLowerCase() === "ecommerce");
  const chosen = shopify ?? candidates[0];
  return { id: chosen.id, chosen, candidates, ambiguous: candidates.length > 1, source: "auto" };
}

// Account timezone — used so the metric aggregate and the values-report
// timeframe cover the same day boundaries (see dayRangeISO). Cached per process.
let accountTzCache: string | null = null;
interface AccountResponse { data: Array<{ attributes: { timezone?: string } }> }

export async function getAccountTimezone(): Promise<string> {
  if (accountTzCache) return accountTzCache;
  try {
    const resp = await klaviyoFetch<AccountResponse>("/accounts/");
    accountTzCache = resp.data?.[0]?.attributes?.timezone || "UTC";
  } catch {
    // A timezone lookup failure shouldn't take down the whole dashboard.
    accountTzCache = "UTC";
  }
  return accountTzCache;
}

export function campaignValuesReport(opts: ValuesReportOpts & PagedFetchOpts): Promise<PagedResult<CampaignValuesResult>> {
  const body = {
    data: {
      type: "campaign-values-report",
      attributes: {
        statistics: VALUES_REPORT_STATISTICS,
        timeframe: { start: opts.start, end: opts.end },
        conversion_metric_id: opts.conversionMetricId,
        // Same channel scope as flows so both halves of attributed revenue are
        // measured on the same basis (see REPORT_CHANNEL_FILTER). Previously
        // absent, which made campaigns all-channel while flows were email-only.
        filter: REPORT_CHANNEL_FILTER,
      },
    },
  };
  return fetchAllPagesGated<CampaignValuesResult>("/campaign-values-reports/", body, opts);
}

// ---------------------------------------------------------------------------
// Series Reports — per-interval (daily) stats for ALL flows / campaigns in ONE
// call. This is how the metrics sync stays inside Klaviyo's reporting quota
// (burst 1/s, steady 2/m, 225/day — shared across the reporting endpoints): a
// whole 60-day backfill is 1 flow-series + 1 campaign-series call instead of
// 2 calls per day. Response shape: attributes.date_times[] (one ISO datetime
// per interval bucket, account-timezone day boundaries) and attributes.results[]
// where each result = { groupings, statistics: { stat: number[] } } with arrays
// aligned to date_times.
// ---------------------------------------------------------------------------

// The SAME statistics as the values report, so a flow day and a campaign row
// carry identical fields and the dashboard can compute one set of rates from
// either. Verified live: flow-series returns each of these as an array aligned to
// date_times.
const SERIES_STATISTICS = VALUES_REPORT_STATISTICS;

export interface SeriesResult<G> {
  groupings: G;
  statistics: Record<string, number[]>;
}

interface SeriesReportResponse<G> {
  data: { attributes: { date_times: string[]; results: SeriesResult<G>[] } };
  links?: { next?: string | null };
}

export interface SeriesReport<G> {
  dateTimes: string[];
  results: SeriesResult<G>[];
  truncated: boolean;
}

export type PagedSeriesResult<G> =
  | { ok: true; report: SeriesReport<G>; pages: number; nextUrl: string | null }
  | { ok: false; reason: "blocked" | "daily_cap" | "timeout" | "throttled"; retryAfterS?: number; pages: number };

/** Series reports paginate exactly like values reports — measured live at 4 pages
 * for a 60-day daily flow series — so every page is limiter-gated the same way. */
async function fetchAllSeriesPagesGated<G>(
  endpoint: string,
  body: unknown,
  opts: PagedFetchOpts,
): Promise<PagedSeriesResult<G>> {
  const bodyStr = JSON.stringify(body);
  const results: SeriesResult<G>[] = [];
  let dateTimes: string[] = [];
  let url: string | null = opts.startUrl || endpoint;
  let pages = 0;
  const maxPages = Math.min(opts.maxPages ?? MAX_REPORT_PAGES, MAX_REPORT_PAGES);

  while (url && pages < maxPages) {
    const slot = await acquireReportingSlot({ day: opts.day, waitMs: opts.waitMs ?? 0 });
    if (!slot.ok) {
      if (pages > 0) return { ok: true, report: { dateTimes, results, truncated: false }, pages, nextUrl: url };
      return { ok: false, reason: slot.reason, retryAfterS: slot.retryAfterS, pages };
    }

    let resp: SeriesReportResponse<G>;
    try {
      resp = await klaviyoFetch<SeriesReportResponse<G>>(url, { method: "POST", body: bodyStr }, REPORT_FETCH_OPTS);
    } catch (e) {
      if (e instanceof KlaviyoThrottled) {
        if (pages > 0) return { ok: true, report: { dateTimes, results, truncated: false }, pages, nextUrl: url };
        return { ok: false, reason: "throttled", retryAfterS: e.retryAfterS, pages };
      }
      throw e;
    }
    // date_times comes back on EVERY page, so a resumed run still gets its labels.
    if (!dateTimes.length) dateTimes = resp.data.attributes.date_times ?? [];
    results.push(...(resp.data.attributes.results ?? []));
    pages++;
    opts.onProgress?.(pages, resp.data.attributes.results?.length ?? 0);
    const nextLink: string | null | undefined = resp.links?.next;
    url = nextLink ? nextLink.replace(BASE, "") : null;
  }
  return {
    ok: true,
    report: { dateTimes, results, truncated: pages >= MAX_REPORT_PAGES && url !== null },
    pages,
    nextUrl: url,
  };
}

/** Klaviyo rejects a daily interval over a window longer than this — verified
 * live: "Cannot pass in an interval longer than 60 days for use with daily
 * interval". The sync chunks a wider backfill into windows of this size. */
export const MAX_DAILY_SERIES_DAYS = 60;

export type FlowSeriesGrouping = { flow_id?: string; send_channel?: string; flow_message_id?: string };

export function flowSeriesReport(
  opts: ValuesReportOpts & PagedFetchOpts,
): Promise<PagedSeriesResult<FlowSeriesGrouping>> {
  const body = {
    data: {
      type: "flow-series-report",
      attributes: {
        statistics: SERIES_STATISTICS,
        timeframe: { start: opts.start, end: opts.end },
        interval: "daily",
        conversion_metric_id: opts.conversionMetricId,
        filter: REPORT_CHANNEL_FILTER,
      },
    },
  };
  return fetchAllSeriesPagesGated<FlowSeriesGrouping>("/flow-series-reports/", body, opts);
}

// `campaignSeriesReport` used to live here, commented "404s on this account". It
// 404s on EVERY account: /api/campaign-series-reports/ does not exist in the
// Klaviyo spec at all — campaigns have a values report only, while flows, forms
// and segments have both. Deleted rather than kept "for a future revision"
// (docs/KLAVIYO_RATE_LIMIT_SPEC.md §2.4). Campaigns are bucketed by the
// send_time on each row of the values report instead, which is what the snapshot
// in lib/klaviyo-snapshot.ts does.

/**
 * Timeframe for a SERIES report. Klaviyo's series `timeframe.end` is INCLUSIVE and
 * its `date_times` come back as NAIVE account-day labels stamped "+00:00" —
 * verified live: sending 2026-08-20 → 2026-08-22 returned exactly three buckets,
 * labelled 08-20, 08-21, 08-22.
 *
 * So a series window must send the LAST DAY IT WANTS, not the day after, and its
 * bucket labels must be read with slice(0,10) rather than converted as instants.
 * Doing the latter shifted every flow day one day earlier.
 */
export function seriesRangeISO(startYMD: string, endYMD: string): { start: string; end: string } {
  return { start: `${startYMD}T00:00:00`, end: `${endYMD}T00:00:00` };
}

/** The day a series bucket label refers to. The label is already the account-tz
 * day; it must NOT be timezone-converted. */
export function seriesBucketYMD(label: string): string {
  return label.slice(0, 10);
}

export function dayRangeISO(startYMD: string, endYMD: string): { start: string; end: string } {
  // Return NAIVE local-time ISO boundaries (no trailing "Z"), end-exclusive.
  // Klaviyo interprets these in the timezone we pass alongside them: the metric
  // aggregate reads them under its `timezone` field, and the values-report
  // `timeframe` reads them in the account timezone. By passing the SAME naive
  // boundaries + the SAME account timezone to both, "total" (aggregate) and
  // "attributed" (values reports) cover identical day boundaries — fixing the
  // prior UTC-vs-account-TZ drift at the day edges.
  const endDate = new Date(`${endYMD}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 1); // exclusive end = day after endYMD
  const endYMDExclusive = endDate.toISOString().slice(0, 10);
  return { start: `${startYMD}T00:00:00`, end: `${endYMDExclusive}T00:00:00` };
}

// Klaviyo campaign metadata (names, status, send times). Named with the
// `Klaviyo` prefix to avoid confusion with the unrelated local email-copy drafts
// in lib/campaigns.ts. The /campaigns/ endpoint REQUIRES a messages.channel
// filter or it errors. Rather than paging all history (slow, mostly discarded),
// we fetch metadata only for what the UI needs: the specific campaigns that had
// activity in the values report (by id), plus small status-scoped pages for the
// Draft / Scheduled subsections. Verified against revision 2026-04-15: fields
// are attributes.{name,status,send_time,scheduled_at,created_at,updated_at,
// send_strategy.datetime,audiences.included}.
export interface KlaviyoCampaign {
  id: string;
  name: string;
  status: string;
  send_time: string | null;         // actual (sent) or scheduled send datetime; null for drafts
  strategy_datetime: string | null; // send_strategy.datetime — intended datetime, may exist on drafts
  scheduled_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  audience_count: number;           // number of included lists/segments (names would need extra calls)
}

interface CampaignsListResponse {
  data: Array<{
    id: string;
    attributes: {
      name: string;
      status: string;
      send_time?: string | null;
      scheduled_at?: string | null;
      created_at?: string | null;
      updated_at?: string | null;
      send_strategy?: { datetime?: string | null } | null;
      audiences?: { included?: string[]; excluded?: string[] } | null;
    };
  }>;
  links?: { next?: string | null };
}

function campaignFromRaw(c: CampaignsListResponse["data"][number]): KlaviyoCampaign {
  const a = c.attributes;
  return {
    id: c.id,
    name: a.name,
    status: a.status,
    send_time: a.send_time ?? null,
    strategy_datetime: a.send_strategy?.datetime ?? null,
    scheduled_at: a.scheduled_at ?? null,
    created_at: a.created_at ?? null,
    updated_at: a.updated_at ?? null,
    audience_count: a.audiences?.included?.length ?? 0,
  };
}

// Fetch metadata for a specific set of campaign ids — the ones that had activity
// in the campaign values report. We chunk the id list to keep the filter/URL a
// sane length; each chunk is ONE sequential call (~50 ids). This replaces the
// old "page recent-first through ~500 campaigns" scan: for a 30-day range that's
// typically a single call instead of five.
const IDS_PER_CALL = 50;

export async function fetchCampaignsByIds(ids: string[]): Promise<KlaviyoCampaign[]> {
  const out: KlaviyoCampaign[] = [];
  for (let i = 0; i < ids.length; i += IDS_PER_CALL) {
    const chunk = ids.slice(i, i + IDS_PER_CALL);
    const idList = chunk.map((id) => `'${id}'`).join(",");
    const filter = encodeURIComponent(`and(equals(messages.channel,'email'),any(id,[${idList}]))`);
    let url: string | null = `/campaigns/?filter=${filter}`;
    while (url) {
      const resp: CampaignsListResponse = await klaviyoFetch<CampaignsListResponse>(url);
      for (const c of resp.data) out.push(campaignFromRaw(c));
      const next = resp.links?.next;
      url = next ? next.replace(BASE, "") : null;
    }
  }
  return out;
}

// Fetch campaigns by status (Draft / Scheduled) for the status subsections.
// These aren't date-bound. One page (up to 100) is plenty for a status glance;
// if more exist we set truncated so the caller can warn instead of paging all
// history. Sorted recent-first.
const STATUS_MAX_PAGES = 1;

export async function fetchCampaignsByStatus(status: string): Promise<{ campaigns: KlaviyoCampaign[]; truncated: boolean }> {
  const out: KlaviyoCampaign[] = [];
  const filter = encodeURIComponent(`and(equals(messages.channel,'email'),equals(status,'${status}'))`);
  let url: string | null = `/campaigns/?filter=${filter}&sort=-created_at`;
  let pages = 0;
  while (url && pages < STATUS_MAX_PAGES) {
    const resp: CampaignsListResponse = await klaviyoFetch<CampaignsListResponse>(url);
    for (const c of resp.data) out.push(campaignFromRaw(c));
    const next = resp.links?.next;
    url = next ? next.replace(BASE, "") : null;
    pages++;
  }
  return { campaigns: out, truncated: url !== null };
}

// Audiences of a single campaign, ids resolved to names. Reads
// audiences.included / audiences.excluded off the campaign retrieve endpoint
// (GET /campaigns/{id}/ — same attribute shape parsed in fetchCampaignsByIds)
// plus the campaign status, then resolves each id against the segment + list
// catalogues. Unresolvable ids come back labeled "(unknown audience)" rather
// than being dropped. Used by the planner editor to auto-populate audiences from
// the linked Klaviyo campaign.
export interface CampaignAudienceRef { id: string; name: string; type: "segment" | "list" }
export interface CampaignAudiences { status: string; included: CampaignAudienceRef[]; excluded: CampaignAudienceRef[] }

interface CampaignRetrieveResponse {
  data?: {
    id: string;
    attributes: {
      status?: string;
      audiences?: { included?: string[]; excluded?: string[] } | null;
    };
  };
}

/**
 * The audiences on a linked Klaviyo campaign, ids resolved to names.
 *
 * `known` is the caller's name map — normally the SYNCED catalogue
 * (lib/klaviyo-audiences.ts). Without it this falls back to fetching the whole
 * catalogue live, which measures at 36 sequential requests and 17.5 seconds just
 * to turn a handful of ids into names. That fallback exists so the function still
 * works standalone; the planner route passes the catalogue.
 */
export async function getCampaignAudiences(
  campaignId: string,
  known?: Map<string, { id: string; name: string; type: "segment" | "list" }>,
): Promise<CampaignAudiences> {
  const resp = await klaviyoFetch<CampaignRetrieveResponse>(`/campaigns/${encodeURIComponent(campaignId)}/`);
  const attrs = resp.data?.attributes;
  const includedIds = attrs?.audiences?.included ?? [];
  const excludedIds = attrs?.audiences?.excluded ?? [];

  let nameMap = known;
  if (!nameMap || nameMap.size === 0) {
    nameMap = new Map();
    const segs = await listSegments();
    const lists = await listLists();
    for (const a of [...segs.items, ...lists.items]) nameMap.set(a.id, { id: a.id, name: a.name, type: a.type });
  }
  const resolve = (ids: string[]): CampaignAudienceRef[] =>
    ids.map((id) => {
      const hit = nameMap!.get(id);
      // An id the catalogue doesn't know is still shown, by id: dropping it would
      // hide part of what was actually built, which is the one thing this must not do.
      return hit ? { id: hit.id, name: hit.name, type: hit.type } : { id, name: `(unknown audience ${id})`, type: "segment" as const };
    });
  return { status: attrs?.status ?? "", included: resolve(includedIds), excluded: resolve(excludedIds) };
}
