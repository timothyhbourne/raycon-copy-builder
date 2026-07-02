// Postscript (SMS) HTTP client — mirrors the shape of lib/klaviyo.ts.
//
// Verified against Postscript's public API docs (July 2026):
//   Base URL:  https://api.postscript.io/api/v2
//   Auth:      Authorization: Bearer <PRIVATE_API_KEY>   (capital "Bearer", one space, no colon)
//   Campaigns: GET /campaigns
//   Analytics fields (per Postscript reporting): Clicked, Ordered, Earned (revenue),
//              CTR / click-through rate, unique/total clicks. SMS has NO opens.
//
// The exact JSON field names for the campaign + analytics responses are not
// crisply published and we have no key to test live yet, so parsing is
// DEFENSIVE: every field is read via a small set of fallback keys, centralized
// in `extractMetrics()` / `parseCampaign()`. When the real key is added, hit a
// live campaign once and confirm/trim these fallbacks — that's the one spot to
// adjust. Never fabricate an open rate for SMS.

const BASE = "https://api.postscript.io/api/v2";
const MAX_RETRIES = 3;

export function isPostscriptConfigured(): boolean {
  return !!process.env.POSTSCRIPT_API_KEY;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function postscriptFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const key = process.env.POSTSCRIPT_API_KEY;
  if (!key) {
    // Callers should check isPostscriptConfigured() first and degrade gracefully;
    // this guard is a backstop.
    throw new Error("POSTSCRIPT_NOT_CONFIGURED");
  }
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(init?.headers || {}),
  };
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`${BASE}${path}`, { ...init, headers, cache: "no-store" });
    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      const waitS = retryAfter ? Math.ceil(parseFloat(retryAfter)) : 1;
      if (attempt >= MAX_RETRIES) {
        throw new Error(`Postscript rate-limited. Available in ~${waitS}s. Try Sync again shortly.`);
      }
      await sleep(Math.min(waitS * 1000, 5000));
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Postscript API ${res.status} on ${path}: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }
  throw new Error(`Postscript API on ${path}: exhausted retries`);
}

export interface PostscriptCampaign {
  id: string;
  name: string;
  status: string;
  send_time: string | null;
}

export interface PostscriptMetrics {
  recipients: number | null;
  click_rate: number | null;   // 0..1
  revenue: number | null;
  revenue_per_recipient: number | null;
  // open_rate intentionally absent — SMS has no opens.
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickNum(obj: any, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "number" && !isNaN(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  }
  return null;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickStr(obj: any, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseCampaign(c: any): PostscriptCampaign {
  return {
    id: String(c?.id ?? c?.campaign_id ?? ""),
    name: pickStr(c, ["name", "title", "campaign_name"]) ?? "(unnamed campaign)",
    status: pickStr(c, ["status", "state"]) ?? "unknown",
    send_time: pickStr(c, ["send_time", "sent_at", "send_date", "scheduled_at", "send_at", "created_at"]),
  };
}

// Centralized metric mapping — the ONE place to adjust once a live response is
// available. Reads recipients/clicks/revenue from either the top-level object
// or a nested analytics/stats/metrics block, with click_rate derived if absent.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractMetrics(raw: any): PostscriptMetrics {
  const a = raw?.analytics ?? raw?.stats ?? raw?.metrics ?? raw ?? {};
  const recipients = pickNum(a, ["recipients", "sent", "sent_count", "sends", "delivered", "num_sent"]);
  let clickRate = pickNum(a, ["click_rate", "ctr", "click_through_rate", "clickthrough_rate"]);
  const clicks = pickNum(a, ["unique_clicks", "clicks", "clicked", "total_clicks"]);
  if (clickRate === null && clicks !== null && recipients && recipients > 0) {
    clickRate = clicks / recipients;
  } else if (clickRate !== null && clickRate > 1) {
    clickRate = clickRate / 100; // normalize a percentage to a 0..1 fraction
  }
  const revenue = pickNum(a, ["revenue", "earned", "total_revenue", "sales"]);
  const rpr = recipients && recipients > 0 && revenue !== null ? revenue / recipients : null;
  return { recipients, click_rate: clickRate, revenue, revenue_per_recipient: rpr };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractList(resp: any): any[] {
  if (Array.isArray(resp)) return resp;
  return resp?.campaigns ?? resp?.data ?? resp?.results ?? [];
}

export async function listPostscriptCampaigns(): Promise<PostscriptCampaign[]> {
  const out: PostscriptCampaign[] = [];
  // Follow cursor/offset pagination defensively: Postscript v2 commonly returns a
  // `cursor`/`next` token; stop when absent. Cap pages as a safety backstop.
  let url: string | null = "/campaigns";
  let pages = 0;
  while (url && pages < 20) {
    const resp: unknown = await postscriptFetch(url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = resp as any;
    for (const c of extractList(r)) {
      const parsed = parseCampaign(c);
      if (parsed.id) out.push(parsed);
    }
    const cursor = r?.cursor ?? r?.next_cursor ?? r?.next;
    url = cursor && typeof cursor === "string"
      ? (cursor.startsWith("http") ? cursor.replace(BASE, "") : `/campaigns?cursor=${encodeURIComponent(cursor)}`)
      : null;
    pages++;
  }
  return out;
}

// Per-campaign metrics. Fetches the campaign detail (which carries analytics for
// sent campaigns) and maps it. Returns null if the campaign can't be fetched.
export async function getPostscriptCampaignMetrics(campaignId: string): Promise<PostscriptMetrics | null> {
  try {
    const resp = await postscriptFetch(`/campaigns/${encodeURIComponent(campaignId)}`);
    return extractMetrics(resp);
  } catch (e) {
    if (e instanceof Error && e.message === "POSTSCRIPT_NOT_CONFIGURED") throw e;
    // A single campaign failing to resolve shouldn't blow up a whole sync.
    console.error("[postscript] metrics fetch failed for", campaignId, e);
    return null;
  }
}
