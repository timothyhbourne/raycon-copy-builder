const BASE = "https://a.klaviyo.com/api";
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

async function klaviyoFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const key = process.env.KLAVIYO_API_KEY;
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
      // Long waits indicate steady-state throttle exhaustion — surface to caller
      // instead of blocking the request for minutes.
      if (retryAfterSec > PATIENT_RETRY_THRESHOLD_S || attempt >= MAX_RETRIES) {
        throw new Error(
          `Klaviyo rate-limited this request. Available in ~${retryAfterSec}s. Wait and click Load again.`
        );
      }
      await sleep(Math.min(retryAfterSec * 1000, PATIENT_RETRY_DELAY_MS));
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

// Values Reports — purpose-built endpoints that return per-flow / per-campaign
// stats in one call, without us needing to know account-specific attribution
// dimension keys. We use these for the flows table and for attributed revenue.

const VALUES_REPORT_STATISTICS = [
  "recipients",
  "delivered",
  "opens",
  "opens_unique",
  "clicks",
  "clicks_unique",
  "conversion_value",
];

interface ValuesReportStatistics {
  recipients?: number;
  delivered?: number;
  opens?: number;
  opens_unique?: number;
  clicks?: number;
  clicks_unique?: number;
  conversion_value?: number;
}

export interface FlowValuesResult {
  groupings: { flow_id?: string; send_channel?: string };
  statistics: ValuesReportStatistics;
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

// Klaviyo values reports paginate via links.next even when the first page is
// empty — we have to follow until next is null. Capped to keep us from looping
// forever on a malformed cursor response.
const MAX_REPORT_PAGES = 25;

// Returns { results, truncated }. `truncated` is true when the loop stopped
// because it hit MAX_REPORT_PAGES while a `next` cursor still existed — i.e. we
// silently dropped later pages and revenue would be understated. The caller
// surfaces this as a warning instead of failing silently.
async function fetchAllPages<T>(
  endpoint: string,
  body: unknown
): Promise<{ results: T[]; truncated: boolean }> {
  const bodyStr = JSON.stringify(body);
  const results: T[] = [];
  let url: string | null = endpoint;
  let pages = 0;
  while (url && pages < MAX_REPORT_PAGES) {
    const resp: ValuesReportResponse<T> = await klaviyoFetch<ValuesReportResponse<T>>(url, {
      method: "POST",
      body: bodyStr,
    });
    results.push(...resp.data.attributes.results);
    const nextLink: string | null | undefined = resp.links?.next;
    url = nextLink ? nextLink.replace(BASE, "") : null;
    pages++;
  }
  return { results, truncated: url !== null };
}

export async function flowValuesReport(opts: ValuesReportOpts): Promise<{ results: FlowValuesResult[]; truncated: boolean }> {
  const body = {
    data: {
      type: "flow-values-report",
      attributes: {
        statistics: VALUES_REPORT_STATISTICS,
        timeframe: { start: opts.start, end: opts.end },
        conversion_metric_id: opts.conversionMetricId,
        filter: REPORT_CHANNEL_FILTER,
      },
    },
  };
  return fetchAllPages<FlowValuesResult>("/flow-values-reports/", body);
}

// Kept for debug — shows the unpaginated page-1 response so we can inspect shape.
export async function flowValuesReportRaw(opts: ValuesReportOpts): Promise<ValuesReportResponse<FlowValuesResult>> {
  const body = {
    data: {
      type: "flow-values-report",
      attributes: {
        statistics: VALUES_REPORT_STATISTICS,
        timeframe: { start: opts.start, end: opts.end },
        conversion_metric_id: opts.conversionMetricId,
        filter: REPORT_CHANNEL_FILTER,
      },
    },
  };
  return klaviyoFetch<ValuesReportResponse<FlowValuesResult>>("/flow-values-reports/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

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
  const envId = process.env.KLAVIYO_PLACED_ORDER_METRIC_ID?.trim();
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

export async function campaignValuesReport(opts: ValuesReportOpts): Promise<{ results: CampaignValuesResult[]; truncated: boolean }> {
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
  return fetchAllPages<CampaignValuesResult>("/campaign-values-reports/", body);
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
      audiences?: { included?: string[] } | null;
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
