import fs from "fs";
import path from "path";

// Northbeam Data Export API client — attribution source of truth for channel
// revenue. Mirrors the conventions of lib/klaviyo.ts / lib/postscript.ts
// (defensive parsing, one place to adjust label/field mapping, graceful errors).
//
// The Data Export API is ASYNC: create an export job → poll until SUCCESS →
// download the signed result file. See the flow in getWeeklyChannelRevenue.

const BASE = "https://api.northbeam.io/v1";
const POLL_INTERVAL_MS = 1000;
const POLL_MAX_ATTEMPTS = 60;

// --- env (mirror anthropic.ts: process.env, falling back to .env.local, since
// the Claude-desktop dev environment can set system env keys to "") ---
function readEnv(name: string): string {
  const sys = process.env[name];
  if (sys && sys.trim()) return sys.trim();
  try {
    const envFile = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    const m = envFile.match(new RegExp(`^${name}=(.+)$`, "m"));
    if (m) return m[1].trim();
  } catch {
    /* .env.local absent in prod — rely on process.env */
  }
  return "";
}

function cfg() {
  return {
    apiKey: readEnv("NORTHBEAM_API_KEY"),
    clientId: readEnv("NORTHBEAM_CLIENT_ID"),
    // "1-day click" ⇒ a last-click model + the 1-day window. last_touch is
    // Northbeam's last-click model (confirmed valid live; click-named ids like
    // "last_click" are rejected). Overridable if the team confirms a different one.
    attributionModelId: readEnv("NORTHBEAM_ATTRIBUTION_MODEL_ID") || "last_touch",
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
  };
}

export function isNorthbeamConfigured(): boolean {
  const c = cfg();
  return !!(c.apiKey && c.clientId);
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
async function pollExport(dataExportId: string): Promise<string> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    const resp = await northbeamFetch<ExportResultResponse>(`/exports/data-export/result/${encodeURIComponent(dataExportId)}`);
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
  throw new Error(`Northbeam export did not finish within ${POLL_MAX_ATTEMPTS}s. Try again (the manual "Run now" retries).`);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickNum(row: any, keys: string[]): number | null {
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
export async function listMetrics(): Promise<unknown> {
  return northbeamFetch("/metrics");
}
export async function listAttributionModels(): Promise<unknown> {
  return northbeamFetch("/attribution-models");
}
export async function runRawExport(weekStartISO: string, weekEndISO: string): Promise<{ requestBody: unknown; rows: Row[]; platforms: string[] }> {
  const body = buildExportBody(weekStartISO, weekEndISO);
  const id = await createExport(body);
  const fileUrl = await pollExport(id);
  const rows = await downloadRows(fileUrl);
  const platforms = Array.from(new Set(rows.map(platformOf).filter(Boolean)));
  return { requestBody: body, rows, platforms };
}
