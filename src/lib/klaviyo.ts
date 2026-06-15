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
        timezone: "UTC",
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

// Klaviyo's flow-values-reports requires a `filter` scope to return data. The
// minimal scope that includes everything is a channel filter — email is where
// virtually all Raycon flow revenue lives. If SMS / push flows need to be
// included later, widen this to any(messages.channel,["email","sms","push"]).
// Valid filter fields per Klaviyo: variation, variation_name, flow_message_name,
// flow_message_id, text_message_format, tag_id, tag_name, flow_id, flow_name,
// send_channel. We use send_channel='email' since that's where Raycon flow
// revenue lives. Widen later (e.g. any(send_channel,['email','sms','push'])) if
// SMS or push flows need to be included.
const FLOW_REPORT_FILTER = "equals(send_channel,'email')";

// Klaviyo values reports paginate via links.next even when the first page is
// empty — we have to follow until next is null. Capped to keep us from looping
// forever on a malformed cursor response.
const MAX_REPORT_PAGES = 25;

async function fetchAllPages<T>(
  endpoint: string,
  body: unknown
): Promise<T[]> {
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
  return results;
}

export async function flowValuesReport(opts: ValuesReportOpts): Promise<FlowValuesResult[]> {
  const body = {
    data: {
      type: "flow-values-report",
      attributes: {
        statistics: VALUES_REPORT_STATISTICS,
        timeframe: { start: opts.start, end: opts.end },
        conversion_metric_id: opts.conversionMetricId,
        filter: FLOW_REPORT_FILTER,
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
        filter: FLOW_REPORT_FILTER,
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
  attributes: { name: string; integration?: { name?: string; category?: string } };
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

export async function campaignValuesReport(opts: ValuesReportOpts): Promise<CampaignValuesResult[]> {
  const body = {
    data: {
      type: "campaign-values-report",
      attributes: {
        statistics: VALUES_REPORT_STATISTICS,
        timeframe: { start: opts.start, end: opts.end },
        conversion_metric_id: opts.conversionMetricId,
      },
    },
  };
  return fetchAllPages<CampaignValuesResult>("/campaign-values-reports/", body);
}

export function dayRangeISO(startYMD: string, endYMD: string): { start: string; end: string } {
  // Klaviyo expects ISO 8601 datetime. Treat dates as UTC days, end exclusive.
  const start = new Date(`${startYMD}T00:00:00Z`).toISOString();
  const endDate = new Date(`${endYMD}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 1); // make end-of-day inclusive by adding one day exclusive
  const end = endDate.toISOString();
  return { start, end };
}
