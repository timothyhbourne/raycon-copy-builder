import { readEnv } from "./env";

// Northbeam Data Export API client — attribution source of truth for channel
// revenue. Mirrors the conventions of lib/klaviyo.ts (defensive parsing, one
// place to adjust label/field mapping, graceful errors).
//
// The Data Export API is ASYNC: create an export job → poll until SUCCESS →
// download the signed result file. See the flow in getWeeklyChannelRevenue.

const BASE = "https://api.northbeam.io/v1";
// Northbeam's export queue can take minutes when their infra is busy (observed
// live: >80s with transient 500s). Poll every 2s with a ~5 minute budget.
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 150;

function cfg() {
  return {
    apiKey: readEnv("NORTHBEAM_API_KEY"),
    clientId: readEnv("NORTHBEAM_CLIENT_ID"),
    // "Clicks only" = `northbeam_custom` (confirmed 2026-07-23: sandbox probe
    // reconciled it to the CRM Campaign (v2) dashboard view to the dollar; NO
    // "click"-named id exists). last_touch was the pre-probe approximation.
    attributionModelId: readEnv("NORTHBEAM_ATTRIBUTION_MODEL_ID") || "northbeam_custom",
    attributionWindow: readEnv("NORTHBEAM_ATTRIBUTION_WINDOW") || "1",
    accountingMode: readEnv("NORTHBEAM_ACCOUNTING_MODE") || "cash",
    emailLabel: readEnv("NORTHBEAM_EMAIL_PLATFORM_LABEL") || "Klaviyo",
    smsLabel: readEnv("NORTHBEAM_SMS_PLATFORM_LABEL") || "Postscript",
    // Metric ids: "rev" confirmed off the team's page; total_sales must be
    // added + confirmed against /metrics. Both overridable via env.
    revenueMetricId: readEnv("NORTHBEAM_REVENUE_METRIC_ID") || "rev",
    // The store-total metric id is account-specific and NOT "total_sales" (that
    // 422s). Left blank until confirmed from the account's metric list; when
    // blank we omit it (so revenue capture still works) and the % denominator
    // degrades to "—". Set NORTHBEAM_TOTAL_SALES_METRIC_ID once confirmed.
    totalSalesMetricId: readEnv("NORTHBEAM_TOTAL_SALES_METRIC_ID"),
    level: readEnv("NORTHBEAM_LEVEL") || "platform",
    breakdown: readEnv("NORTHBEAM_BREAKDOWN") || "Platform (Northbeam)",
    // NOTE: the old NORTHBEAM_CAMPAIGN_LEVEL / NORTHBEAM_CAMPAIGN_BREAKDOWN
    // entries are gone — the 2026-07-23 probes proved campaign is a LEVEL, not
    // a breakdown ("Campaign" as a breakdown key 422s), so there is nothing to
    // configure: buildCampaignExportBody hard-codes the confirmed recipe.
  };
}

export function isNorthbeamConfigured(): boolean {
  const c = cfg();
  return !!(c.apiKey && c.clientId);
}

// The Northbeam platform labels per channel (email → Klaviyo, sms → Postscript).
// Exposed so the planner sync can look up campaign revenue by the same label the
// export reports, without reaching into cfg().
export function northbeamPlatformLabels(): { email: string; sms: string } {
  const c = cfg();
  return { email: c.emailLabel, sms: c.smsLabel };
}

// --- auth: the key goes in the Basic header. Northbeam issues it already
// formatted, but accounts differ, so we try the raw key first and, on 401,
// fall back to base64 forms — settling on whichever works and caching it. ---
let authFormCache: string | null = null;

function authForms(apiKey: string): string[] {
  const b64 = (s: string) => Buffer.from(s).toString("base64");
  return [apiKey, b64(apiKey), b64(`${apiKey}:`)];
}

async function northbeamFetch<T = unknown>(pathname: string, init?: RequestInit): Promise<T> {
  const c = cfg();
  if (!c.apiKey || !c.clientId) {
    throw new Error("Northbeam not configured — set NORTHBEAM_API_KEY and NORTHBEAM_CLIENT_ID in .env.local and restart.");
  }
  const forms = authFormCache ? [authFormCache] : authForms(c.apiKey);
  let lastErr = "";
  for (const form of forms) {
    const res = await fetch(`${BASE}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Basic ${form}`,
        "Data-Client-ID": c.clientId,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      cache: "no-store",
    });
    if (res.status === 401 && !authFormCache && forms.length > 1) {
      lastErr = `401 with one Basic form`;
      continue; // try the next auth form
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Northbeam API ${res.status} on ${pathname}: ${text.slice(0, 400)}`);
    }
    authFormCache = form; // remember the form that worked
    return (await res.json()) as T;
  }
  throw new Error(`Northbeam auth failed on ${pathname} (${lastErr}). Check NORTHBEAM_API_KEY / the Basic header form.`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- export request body. Shape confirmed live against the API (422-driven):
//   time_granularity: "WEEKLY" (not "WEEK")
//   breakdowns: array of { key, values } dicts; key is the human label
//     "Platform (Northbeam)"; values selects the platform rows we want.
//   attribution_models: REQUIRED (the API rejects the body without it).
// The one place these enum values live, so config changes are localized. ---
function buildExportBody(periodStartISO: string, periodEndISO: string) {
  const c = cfg();
  return {
    level: c.level, // "platform"
    time_granularity: "WEEKLY",
    period_type: "FIXED",
    period_options: {
      period_starting_at: periodStartISO,
      period_ending_at: periodEndISO,
    },
    breakdowns: [{ key: c.breakdown, values: [c.emailLabel, c.smsLabel] }],
    // total-sales only when a confirmed id is set — an invalid id 422s the whole
    // export, which would take revenue down with it.
    metrics: c.totalSalesMetricId
      ? [{ id: c.revenueMetricId }, { id: c.totalSalesMetricId }]
      : [{ id: c.revenueMetricId }],
    attribution_options: {
      attribution_models: [c.attributionModelId], // required; 1-day click ⇒ last-click model
      attribution_windows: [c.attributionWindow], // "1" = 1-day
      accounting_modes: [c.accountingMode], // "cash"
    },
  };
}

// Campaign-level export body — the CONFIRMED recipe (sandbox probe #2,
// 2026-07-23, reconciled live to the CRM Campaign (v2) view):
//   - campaign is a LEVEL, not a breakdown ("Campaign" as a breakdown key 422s);
//     the campaign name arrives as a CSV COLUMN (see campaignNameOf).
//   - every breakdown REQUIRES `values` — platform breakdown only, with the two
//     platform labels we care about.
//   - DAILY granularity, always: WEEKLY buckets spill revenue across arbitrary
//     window edges (probe #1 overshot ~$7.6k until DAILY + pinned end date).
//   - `options` with include_ids so a future id-based match is possible.
// Same attribution_options as the weekly report so the two reconcile.
function buildCampaignExportBody(periodStartISO: string, periodEndISO: string) {
  const c = cfg();
  return {
    level: "campaign",
    time_granularity: "DAILY",
    period_type: "FIXED",
    period_options: {
      period_starting_at: periodStartISO,
      period_ending_at: periodEndISO,
    },
    breakdowns: [{ key: c.breakdown, values: [c.emailLabel, c.smsLabel] }],
    options: { export_aggregation: "BREAKDOWN", remove_zero_spend: false, aggregate_data: false, include_ids: true, include_kind_and_platform: true },
    metrics: [{ id: c.revenueMetricId }],
    attribution_options: {
      attribution_models: [c.attributionModelId],
      attribution_windows: [c.attributionWindow],
      accounting_modes: [c.accountingMode],
    },
  };
}

interface ExportCreateResponse { data_export_id?: string; id?: string }
interface ExportResultResponse { status?: string; result?: string[] }

async function createExport(body: unknown): Promise<string> {
  const resp = await northbeamFetch<ExportCreateResponse>("/exports/data-export", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const id = resp.data_export_id || resp.id;
  if (!id) throw new Error(`Northbeam create-export returned no data_export_id: ${JSON.stringify(resp).slice(0, 300)}`);
  return id;
}

// Poll once/second. A 200 does NOT mean ready — the body's status field does.
// The result endpoint intermittently returns transient HTML 500s ("Please try
// again in 30 seconds") while a larger export is assembling — those are part of
// normal polling, so tolerate a bounded run of 5xx with backoff and keep
// polling. Client errors (401/404/422) still fail fast: they are real.
async function pollExport(dataExportId: string): Promise<string> {
  let transient = 0;
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    let resp: ExportResultResponse;
    try {
      resp = await northbeamFetch<ExportResultResponse>(`/exports/data-export/result/${encodeURIComponent(dataExportId)}`);
      transient = 0;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = Number((msg.match(/Northbeam API (\d{3})/) || [])[1]);
      if (status >= 500 && ++transient <= 8) {
        await sleep(3000);
        continue;
      }
      throw e;
    }
    const status = (resp.status || "").toUpperCase();
    if (status === "SUCCESS") {
      const url = resp.result?.[0];
      if (!url) throw new Error("Northbeam export SUCCESS but no result file url.");
      return url;
    }
    if (status && status !== "PENDING" && status !== "RUNNING" && status !== "IN_PROGRESS") {
      throw new Error(`Northbeam export failed with status "${status}": ${JSON.stringify(resp).slice(0, 300)}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Northbeam export did not finish within ~${Math.round(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS / 60000)} minutes. Their export queue may be backed up — try again shortly.`);
}

// --- defensive parsing of the downloaded file (CSV or JSON, columns not
// guaranteed stable). The signed URL is pre-authorized — do NOT send auth
// headers (they'd break the signature). ---
type Row = Record<string, string | number>;

function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ;
      } else if (ch === "," && !inQ) { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = splitLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const row: Row = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    return row;
  });
}

async function downloadRows(fileUrl: string): Promise<Row[]> {
  const res = await fetch(fileUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`Northbeam result download failed: ${res.status}`);
  const text = await res.text();
  const trimmed = text.trimStart();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const json = JSON.parse(text);
    if (Array.isArray(json)) return json as Row[];
    const arr = json.rows ?? json.data ?? json.results ?? [];
    return Array.isArray(arr) ? (arr as Row[]) : [];
  }
  return parseCsv(text);
}

function pickNum(row: Row, keys: string[]): number | null {
  for (const k of keys) {
    const v = row?.[k];
    if (typeof v === "number" && !isNaN(v)) return v;
    if (typeof v === "string") {
      const n = Number(v.replace(/[$,\s]/g, ""));
      if (v.trim() !== "" && !isNaN(n)) return n;
    }
  }
  return null;
}

// The ONE place platform labels are matched (case-insensitive, trimmed). Adjust
// here if the live breakdown row labels differ from the env defaults.
function platformOf(row: Row): string {
  const c = cfg();
  // The downloaded CSV names the breakdown column "breakdown_platform_northbeam"
  // (confirmed live), not by the request key. Keep the others as fallbacks.
  const candidates = ["breakdown_platform_northbeam", c.breakdown, "Platform (Northbeam)", "platform", "Platform", "breakdown", "breakdown_value", "channel"];
  for (const k of candidates) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}
function labelMatches(row: Row, label: string): boolean {
  return platformOf(row).toLowerCase() === label.trim().toLowerCase();
}
function revenueOf(row: Row): number {
  const c = cfg();
  return pickNum(row, [c.revenueMetricId, "rev", "revenue", "attributed_rev", "attributed_revenue"]) ?? 0;
}
// The campaign-name column, read defensively across candidate keys (same idea
// as platformOf). At level=campaign the name is a LEVEL column (not a
// breakdown_* column) and matches the Klaviyo campaign name / utm_campaign.
// "campaign_name" CONFIRMED live 2026-07-23 (retrofit check: columns were
// breakdown_platform_northbeam, campaign_name, campaign_id, kind, platform,
// status, accounting_mode, attribution_model, attribution_window, rev); the
// rest are fallbacks only.
function campaignNameOf(row: Row): string {
  const candidates = [
    "campaign_name", "campaign", "campaignName", "breakdown_campaign",
    "Campaign", "utm_campaign", "name",
  ];
  for (const k of candidates) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

// Canonical form for matching a Northbeam campaign name to a linked platform
// campaign name. Conservative on purpose: both sides derive from the SAME
// platform campaign name (Northbeam's campaign dimension = utm_campaign, which
// defaults to the Klaviyo/Postscript campaign name), so case-fold + Unicode
// normalize + whitespace-collapse is enough. We deliberately do NOT strip emoji
// or pipes ("RAY | O55 …") — those are part of the real name on both sides, and
// stripping them invites false matches. This is the ONE place to loosen the rule
// if the debug route shows a systematic, safe-to-ignore difference.
export function normalizeCampaignName(name: string): string {
  return (name || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}
function totalSalesOf(row: Row): number | null {
  const c = cfg();
  return pickNum(row, [c.totalSalesMetricId, "total_sales", "totalSales", "total sales"]);
}

export interface NorthbeamChannelRevenue {
  emailRevenue: number; // Klaviyo email, 1d click
  smsRevenue: number; // Postscript SMS, 1d click
  totalStoreRevenue: number; // store actual (see extraction note)
  raw: unknown; // parsed rows, kept for debugging / audit
  warnings: string[];
}

// Store total from the same export. total_sales is a store-level (non-attributed)
// metric, so Northbeam typically repeats the SAME value on every platform row —
// in which case we use that single value. If rows carry DIFFERENT values it's
// being reported per-platform, so we sum. Either way this must be validated
// against the Shopify admin total (see the report's verification step); flip the
// interpretation here if validation shows otherwise.
function extractTotalStoreRevenue(rows: Row[]): number {
  const vals = rows.map(totalSalesOf).filter((v): v is number => v != null);
  if (vals.length === 0) return 0;
  const allEqual = vals.every((v) => Math.abs(v - vals[0]) < 0.01);
  return allEqual ? vals[0] : vals.reduce((a, b) => a + b, 0);
}

export async function getWeeklyChannelRevenue(weekStartISO: string, weekEndISO: string): Promise<NorthbeamChannelRevenue> {
  const c = cfg();
  const warnings: string[] = [];
  const body = buildExportBody(weekStartISO, weekEndISO);
  const id = await createExport(body);
  const fileUrl = await pollExport(id);
  const rows = await downloadRows(fileUrl);

  const emailRows = rows.filter((r) => labelMatches(r, c.emailLabel));
  const smsRows = rows.filter((r) => labelMatches(r, c.smsLabel));
  if (emailRows.length === 0) warnings.push(`No Northbeam row matched the email label "${c.emailLabel}" this week — email revenue counted as 0.`);
  if (smsRows.length === 0) warnings.push(`No Northbeam row matched the SMS label "${c.smsLabel}" this week — SMS revenue counted as 0.`);

  const emailRevenue = emailRows.reduce((a, r) => a + revenueOf(r), 0);
  const smsRevenue = smsRows.reduce((a, r) => a + revenueOf(r), 0);
  const totalStoreRevenue = extractTotalStoreRevenue(rows);
  if (!c.totalSalesMetricId) {
    warnings.push("Total store revenue unavailable — set NORTHBEAM_TOTAL_SALES_METRIC_ID (confirm the id from the account's metric list). % of store shows —.");
  }

  return { emailRevenue, smsRevenue, totalStoreRevenue, raw: rows, warnings };
}

// --- debug helpers (used by the secret-protected debug route) to confirm the
// remaining live unknowns: metric ids, attribution-model id, exact row labels. ---
// Discovery endpoints — all under /exports/ (confirmed from the Data Export
// docs 2026-07-23; the bare /metrics, /attribution-models, /breakdowns paths
// all 404).
export async function listMetrics(): Promise<unknown> {
  return northbeamFetch("/exports/metrics");
}
export async function listBreakdowns(): Promise<unknown> {
  return northbeamFetch("/exports/breakdowns");
}
export async function listAttributionModels(): Promise<unknown> {
  return northbeamFetch("/exports/attribution-models");
}
export async function runRawExport(weekStartISO: string, weekEndISO: string): Promise<{ requestBody: unknown; rows: Row[]; platforms: string[] }> {
  const body = buildExportBody(weekStartISO, weekEndISO);
  const id = await createExport(body);
  const fileUrl = await pollExport(id);
  const rows = await downloadRows(fileUrl);
  const platforms = Array.from(new Set(rows.map(platformOf).filter(Boolean)));
  return { requestBody: body, rows, platforms };
}

// --- sandbox probe (first-principles single-number fetch) ---------------------
// Platform-level export over an arbitrary window with an OVERRIDABLE attribution
// model id, so the Sandbox page can reconcile against the CRM Campaign (v2)
// dashboard view ("Clicks only" model) without touching the weekly-report
// config. Returns everything needed to debug on sight: the exact request body,
// discovered columns, per-platform totals, and the Klaviyo number itself.
export async function runPlatformProbe(
  periodStartISO: string,
  periodEndISO: string,
  attributionModelId?: string,
  attributionWindow?: string,
  timeGranularity?: string,
): Promise<{
  requestBody: unknown; columns: string[]; platforms: string[];
  totalsByPlatform: Record<string, number>; klaviyoRevenue: number; rowCount: number; rows: Row[];
}> {
  const c = cfg();
  const body = {
    ...buildExportBody(periodStartISO, periodEndISO) as Record<string, unknown>,
    // DAILY by default: for an arbitrary window, WEEKLY buckets can spill
    // revenue across the period edges (whole-week bucketing); the dashboard
    // computes on daily granularity, so reconcile on daily.
    time_granularity: timeGranularity || "DAILY",
    attribution_options: {
      attribution_models: [attributionModelId || c.attributionModelId],
      attribution_windows: [attributionWindow || c.attributionWindow],
      accounting_modes: [c.accountingMode],
    },
  };
  const id = await createExport(body);
  const fileUrl = await pollExport(id);
  const rows = await downloadRows(fileUrl);
  const columns = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const platforms = Array.from(new Set(rows.map(platformOf).filter(Boolean)));
  const totalsByPlatform: Record<string, number> = {};
  for (const r of rows) {
    const p = platformOf(r);
    if (p) totalsByPlatform[p] = (totalsByPlatform[p] ?? 0) + revenueOf(r);
  }
  const klaviyoRevenue = rows.filter((r) => labelMatches(r, c.emailLabel)).reduce((a, r) => a + revenueOf(r), 0);
  return { requestBody: body, columns, platforms, totalsByPlatform, klaviyoRevenue, rowCount: rows.length, rows };
}

// Sandbox probe #2 — campaign-level, one campaign's revenue. Same override
// pattern as runPlatformProbe. Klaviyo rows only; revenue summed per campaign
// name across daily rows; the query is matched normalized (exact, then
// containment). `candidates` lists what Northbeam ACTUALLY calls its campaigns
// (top by revenue) so a non-match is diagnosable on sight.
export async function runCampaignProbe(
  periodStartISO: string,
  periodEndISO: string,
  campaignQuery: string,
  attributionModelId?: string,
  attributionWindow?: string,
  timeGranularity?: string,
  campaignBreakdownKey?: string,
  /** Which platform's rows to match against — the email label (Klaviyo, default)
   * or the SMS label (Postscript). Campaign flows sent from Postscript surface
   * here via their utm_campaign, since the public Postscript API has no
   * campaign/flow/analytics endpoints at all (confirmed 2026-07-23). */
  platformLabel?: string,
): Promise<{
  requestBody: unknown; columns: string[]; platforms: string[]; rowCount: number;
  strategyUsed: string; attempts: { strategy: string; error: string }[];
  matchType: "exact" | "contains" | "none";
  matchedName: string | null; matchedRevenue: number | null;
  candidates: { name: string; revenue: number }[];
}> {
  const c = cfg();
  // The probe shares the CONFIRMED recipe (buildCampaignExportBody) and only
  // layers the caller's overrides on top — model/window/granularity, plus an
  // optional extra breakdown key for diagnosing account dimensions.
  const makeBody = (extraBreakdown?: { key: string; values: string[] }) => {
    const base = buildCampaignExportBody(periodStartISO, periodEndISO);
    return {
      ...base,
      ...(extraBreakdown ? { breakdowns: [...base.breakdowns, extraBreakdown] } : {}),
      time_granularity: timeGranularity || base.time_granularity,
      attribution_options: {
        attribution_models: [attributionModelId || c.attributionModelId],
        attribution_windows: [attributionWindow || c.attributionWindow],
        accounting_modes: [c.accountingMode],
      },
    } as Record<string, unknown>;
  };
  const strategies: { strategy: string; body: Record<string, unknown> }[] = [
    // A user-supplied breakdown key (from /exports/breakdowns) is tried first if given.
    ...(campaignBreakdownKey ? [{ strategy: `breakdown key "${campaignBreakdownKey}"`, body: makeBody({ key: campaignBreakdownKey, values: [] }) }] : []),
    { strategy: "level=campaign, platform breakdown only (name from columns)", body: makeBody() },
  ];
  const attempts: { strategy: string; error: string }[] = [];
  let body: Record<string, unknown> | null = null;
  let strategyUsed = "";
  let id = "";
  for (const s of strategies) {
    try {
      id = await createExport(s.body);
      body = s.body;
      strategyUsed = s.strategy;
      break;
    } catch (e) {
      attempts.push({ strategy: s.strategy, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (!body) {
    throw new Error(`All campaign-export strategies rejected:\n${attempts.map((a) => `- ${a.strategy}: ${a.error}`).join("\n")}`);
  }
  const fileUrl = await pollExport(id);
  const rows = await downloadRows(fileUrl);
  const columns = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const platforms = Array.from(new Set(rows.map(platformOf).filter(Boolean)));

  const byName = new Map<string, { name: string; revenue: number }>();
  const wantLabel = platformLabel || c.emailLabel;
  for (const r of rows) {
    if (!labelMatches(r, wantLabel)) continue; // selected platform only
    const name = campaignNameOf(r);
    if (!name) continue;
    const key = normalizeCampaignName(name);
    const cur = byName.get(key) ?? { name, revenue: 0 };
    cur.revenue += revenueOf(r);
    byName.set(key, cur);
  }

  const q = normalizeCampaignName(campaignQuery);
  let matchType: "exact" | "contains" | "none" = "none";
  let matched = byName.get(q) ?? null;
  if (matched) {
    matchType = "exact";
  } else if (q) {
    const contains = Array.from(byName.entries()).filter(([k]) => k.includes(q) || q.includes(k));
    if (contains.length === 1) { matched = contains[0][1]; matchType = "contains"; }
  }
  const candidates = Array.from(byName.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 40);
  return {
    requestBody: body, columns, platforms, rowCount: rows.length,
    strategyUsed, attempts,
    matchType, matchedName: matched?.name ?? null, matchedRevenue: matched?.revenue ?? null, candidates,
  };
}

// --- campaign-level revenue (planner NB-rev column) --------------------------

export interface NorthbeamCampaignRevenue {
  platform: string;     // raw platform label as reported ("Klaviyo" | "Postscript")
  campaignName: string; // raw campaign name as reported (utm_campaign)
  revenue: number;      // 1-day click, cash — same attribution as the weekly report
}

// Per-campaign 1-day-click cash revenue for both platforms over an arbitrary
// window. Mirrors getWeeklyChannelRevenue but at campaign level. With DAILY
// granularity a campaign appears once per day it earned revenue — the caller
// sums by (platform, normalized name), so no de-duplication is needed here.
// Rows with no resolvable campaign name are dropped (they can't be matched).
export async function getCampaignRevenue(periodStartISO: string, periodEndISO: string): Promise<NorthbeamCampaignRevenue[]> {
  const body = buildCampaignExportBody(periodStartISO, periodEndISO);
  const id = await createExport(body);
  const fileUrl = await pollExport(id);
  const rows = await downloadRows(fileUrl);
  return rows
    .map((r) => ({ platform: platformOf(r), campaignName: campaignNameOf(r), revenue: revenueOf(r) }))
    .filter((r) => r.campaignName);
}

// Distinct campaign names Northbeam reports for ONE platform over a window,
// summed and sorted by revenue (top earners first — the ones worth linking).
// Feeds the planner's Northbeam-campaign picker: picking from this list makes
// the join key typo-proof. Same aggregation the sandbox probe's `candidates`
// path uses, so the picker and probe always agree.
export async function listNorthbeamCampaignNames(
  platformLabel: string,
  periodStartISO: string,
  periodEndISO: string,
): Promise<{ name: string; revenue: number }[]> {
  const entries = await getCampaignRevenue(periodStartISO, periodEndISO);
  const byName = new Map<string, { name: string; revenue: number }>();
  const want = platformLabel.trim().toLowerCase();
  for (const e of entries) {
    if (e.platform.trim().toLowerCase() !== want) continue;
    const k = normalizeCampaignName(e.campaignName);
    const cur = byName.get(k) ?? { name: e.campaignName, revenue: 0 };
    cur.revenue += e.revenue;
    byName.set(k, cur);
  }
  return Array.from(byName.values()).sort((a, b) => b.revenue - a.revenue);
}

// Debug helper (used by /api/planner/northbeam-debug) to confirm the live
// unknowns for the campaign export: the discovered column names, the distinct
// campaign-name strings Northbeam reports (what we match against), and the
// distinct platform labels. Drives the level/breakdown-key confirmation off the
// 422s exactly like the platform path was confirmed.
export async function runRawCampaignExport(periodStartISO: string, periodEndISO: string): Promise<{
  requestBody: unknown; rows: Row[]; normalized: NorthbeamCampaignRevenue[];
  columns: string[]; campaignNames: string[]; platforms: string[]; totalsByPlatform: Record<string, number>;
}> {
  const body = buildCampaignExportBody(periodStartISO, periodEndISO);
  const id = await createExport(body);
  const fileUrl = await pollExport(id);
  const rows = await downloadRows(fileUrl);
  const normalized = rows
    .map((r) => ({ platform: platformOf(r), campaignName: campaignNameOf(r), revenue: revenueOf(r) }))
    .filter((r) => r.campaignName);
  const columns = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const campaignNames = Array.from(new Set(rows.map(campaignNameOf).filter(Boolean))).sort();
  const platforms = Array.from(new Set(rows.map(platformOf).filter(Boolean)));
  // Per-platform revenue totals — reconcile these against the weekly report's
  // channel totals and the CRM v2 view for the same window/accounting mode.
  const totalsByPlatform: Record<string, number> = {};
  for (const r of normalized) totalsByPlatform[r.platform] = (totalsByPlatform[r.platform] ?? 0) + r.revenue;
  return { requestBody: body, rows, normalized, columns, campaignNames, platforms, totalsByPlatform };
}
