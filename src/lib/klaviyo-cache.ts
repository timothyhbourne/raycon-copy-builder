import path from "path";
import { getAdapter } from "./storage";
import {
  getAccountTimezone, listFlows, fetchCampaignsByStatus,
  campaignValuesReport, flowValuesReport,
  type FlowListItem, type KlaviyoCampaign, type CampaignValuesResult, type FlowValuesResult,
} from "./klaviyo";
import { isFresh, rangeTtlMs, todayYMDInTz } from "./cache-ttl";

// Redis caches for the slow-moving Klaviyo metadata + the tight-tier report
// results (spec: ANALYTICS_RATE_LIMIT_SPEC §4 Layer 4). All analytics caches
// share one namespace ("measure") behind the storage seam, so they're durable
// and shared across serverless instances + users — fixing §2.4 (per-process
// caches that reset on cold start) and §2.5/§2.7 (metadata re-fetched every view,
// planner sync + weekly report duplicating report calls the dashboard made).

const DATA_ROOT = path.join(process.cwd(), "data");
const store = getAdapter(DATA_ROOT, "measure");

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

interface Entry<T> { v: T; at: string }

// Read-through cache: serve fresh; on a miss/stale, load + store; on a loader
// failure, fall back to a stale value if we have one (never fail on cacheable
// metadata just because the upstream hiccuped).
async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  let prev: Entry<T> | null = null;
  try {
    const raw = await store.read(key);
    if (raw != null) {
      prev = JSON.parse(raw) as Entry<T>;
      if (isFresh(prev.at, ttlMs)) return prev.v;
    }
  } catch { /* fall through to loader */ }
  try {
    const v = await loader();
    try { await store.write(key, JSON.stringify({ v, at: new Date().toISOString() } satisfies Entry<T>)); } catch { /* best-effort */ }
    return v;
  } catch (e) {
    if (prev) return prev.v; // serve stale rather than fail
    throw e;
  }
}

// ---- metadata (range-independent; shared across every range view) ----
export function getAccountTimezoneCached(): Promise<string> {
  return cached("meta:tz", DAY_MS, getAccountTimezone);
}
export function getFlowListCached(): Promise<FlowListItem[]> {
  return cached("meta:flows:v1", HOUR_MS, listFlows);
}
export function getDraftCampaignsCached(): Promise<{ campaigns: KlaviyoCampaign[]; truncated: boolean }> {
  return cached("meta:draft:v1", HOUR_MS, () => fetchCampaignsByStatus("Draft"));
}
export function getScheduledCampaignsCached(): Promise<{ campaigns: KlaviyoCampaign[]; truncated: boolean }> {
  return cached("meta:scheduled:v1", HOUR_MS, () => fetchCampaignsByStatus("Scheduled"));
}

// ---- report-level caches (for planner sync + weekly report, which fetch
// specific windows rather than whole dashboard ranges). TTL by range mutability
// so a past send window is fetched once. ----
async function reportTtl(start: string, end: string): Promise<number> {
  const tz = await getAccountTimezoneCached();
  return rangeTtlMs(start, end, todayYMDInTz(tz));
}
export async function getCampaignValuesCached(start: string, end: string, conversionMetricId: string): Promise<{ results: CampaignValuesResult[]; truncated: boolean }> {
  return cached(`campvals:v1:${start}..${end}`, await reportTtl(start, end), () => campaignValuesReport({ start, end, conversionMetricId }));
}
export async function getFlowValuesCached(start: string, end: string, conversionMetricId: string): Promise<{ results: FlowValuesResult[]; truncated: boolean }> {
  return cached(`flowvals:v1:${start}..${end}`, await reportTtl(start, end), () => flowValuesReport({ start, end, conversionMetricId }));
}
