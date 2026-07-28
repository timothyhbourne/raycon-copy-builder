"use client";

import { useState } from "react";

// Sandbox probes — first-principles single-number fetches from Northbeam.
//   #1 Platform level: Klaviyo revenue for a window. RECONCILED ✅ against the
//      CRM Campaign (v2) view with model=northbeam_custom ("Clicks only"),
//      window 1, DAILY granularity, end date pinned to the dashboard's.
//   #2 Campaign level: ONE campaign's Klaviyo revenue, matched by the Klaviyo
//      campaign name (= Northbeam's utm_campaign). The campaign-level export
//      ids are unconfirmed — a 422 here names the valid values.
// The /attribution-models endpoint does not exist (404 confirmed live); the
// model picker is hardcoded from docs.northbeam.io/docs/attribution-models.

const MODELS = [
  { id: "northbeam_custom", label: "Clicks only (northbeam_custom) — matches the dashboard" },
  { id: "northbeam_custom__va", label: "Clicks + Modeled Views (northbeam_custom__va)" },
  { id: "last_touch", label: "Last touch (last_touch) — previous client default" },
  { id: "last_touch_non_direct", label: "Last non-direct touch (last_touch_non_direct)" },
  { id: "first_touch", label: "First touch (first_touch)" },
  { id: "linear", label: "Linear (linear)" },
];
const WINDOWS = ["1", "3", "7", "14", "30", "60", "90"];

interface ProbeResult {
  elapsedMs: number;
  window?: { start: string; end: string };
  modelRequested?: string;
  attributionWindowRequested?: string;
  // probe #1
  klaviyoRevenue?: number;
  totalsByPlatform?: Record<string, number>;
  // probe #2
  campaignQuery?: string;
  matchType?: "exact" | "contains" | "none";
  matchedName?: string | null;
  matchedRevenue?: number | null;
  candidates?: { name: string; revenue: number }[];
  // shared debug
  strategyUsed?: string;
  attempts?: { strategy: string; error: string }[];
  breakdowns?: unknown;
  platforms?: string[];
  columns?: string[];
  rowCount?: number;
  requestBody?: unknown;
  error?: string;
}

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function SandboxPage() {
  const [model, setModel] = useState("northbeam_custom");
  const [window_, setWindow] = useState("1");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [campaign, setCampaign] = useState("RAY | O25 30% Flash Sale | US | 07.16.26");
  const [platform, setPlatform] = useState<"klaviyo" | "postscript">("klaviyo");
  const [breakdownKey, setBreakdownKey] = useState("");
  const [busy, setBusy] = useState<"platform" | "campaign" | "breakdowns" | null>(null);
  const [result, setResult] = useState<ProbeResult | null>(null);

  async function run(kind: "platform" | "campaign" | "breakdowns") {
    setBusy(kind);
    setResult(null);
    try {
      const qs = new URLSearchParams({ model, window: window_ });
      if (start) qs.set("start", start);
      if (end) qs.set("end", end);
      if (kind === "campaign") {
        qs.set("campaign", campaign.trim());
        qs.set("platform", platform);
        if (breakdownKey.trim()) qs.set("key", breakdownKey.trim());
      }
      if (kind === "breakdowns") qs.set("breakdowns", "1");
      const path = kind === "platform" ? "/api/sandbox/northbeam" : "/api/sandbox/northbeam-campaign";
      const res = await fetch(`${path}?${qs}`);
      setResult(await res.json());
    } catch (e) {
      setResult({ elapsedMs: 0, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  const hasPlatformNumber = typeof result?.klaviyoRevenue === "number" && !result.error;
  const hasCampaignResult = result?.matchType !== undefined && !result?.error;

  return (
    <div>
      <div className="mb-6">
        <div className="t-label text-slate-500 mb-1">Sandbox</div>
        <h1 className="text-2xl font-semibold text-slate-900">Sandbox data entry</h1>
        <p className="text-sm text-slate-500 mt-1">
          Northbeam probes. #1 platform level (reconciled ✅) · #2 campaign level — one
          campaign&apos;s revenue by its Klaviyo name. Clicks only · Cash · daily.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="text-sm text-slate-600">
          Model{" "}
          <select value={model} onChange={(e) => setModel(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-2 text-sm">
            {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <label className="text-sm text-slate-600">
          Window (days){" "}
          <select value={window_} onChange={(e) => setWindow(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-2 text-sm">
            {WINDOWS.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </label>
        <label className="text-sm text-slate-600">
          Start{" "}
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-2 text-sm" />
        </label>
        <label className="text-sm text-slate-600">
          End{" "}
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-2 text-sm" />
        </label>
        <button
          onClick={() => run("platform")}
          disabled={busy !== null}
          className="rounded-md bg-slate-900 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy === "platform" ? "Fetching… (1–3 min when the queue is busy)" : "#1 Fetch Klaviyo revenue"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <input
          value={campaign}
          onChange={(e) => setCampaign(e.target.value)}
          placeholder="Klaviyo campaign name (Northbeam utm_campaign)"
          className="border border-slate-300 rounded-md px-3 py-2 text-sm w-[420px]"
        />
        <label className="text-sm text-slate-600">
          Platform{" "}
          <select value={platform} onChange={(e) => setPlatform(e.target.value as "klaviyo" | "postscript")}
            className="border border-slate-300 rounded-md px-3 py-2 text-sm">
            <option value="klaviyo">Klaviyo (email)</option>
            <option value="postscript">Postscript (SMS)</option>
          </select>
        </label>
        <input
          value={breakdownKey}
          onChange={(e) => setBreakdownKey(e.target.value)}
          placeholder='campaign breakdown key (blank = none)'
          className="border border-slate-300 rounded-md px-3 py-2 text-sm w-72"
        />
        <button
          onClick={() => run("campaign")}
          disabled={busy !== null || !campaign.trim()}
          className="rounded-md bg-indigo-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy === "campaign" ? "Fetching… (1–3 min when the queue is busy)" : "#2 Fetch campaign revenue"}
        </button>
        <button
          onClick={() => run("breakdowns")}
          disabled={busy !== null}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy === "breakdowns" ? "Listing…" : "List breakdown keys"}
        </button>
      </div>

      {hasPlatformNumber && (
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-6 max-w-md">
          <div className="t-label text-slate-500 mb-1">
            Klaviyo revenue · {result?.window?.start} → {result?.window?.end} · {result?.modelRequested} · {result?.attributionWindowRequested}d
          </div>
          <div className="text-4xl font-semibold text-slate-900">{fmtUsd(result!.klaviyoRevenue!)}</div>
          {result?.totalsByPlatform && (
            <div className="mt-3 text-sm text-slate-600">
              {Object.entries(result.totalsByPlatform).map(([p, v]) => (
                <div key={p}>{p}: {fmtUsd(v)}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {hasCampaignResult && (
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-6 max-w-2xl">
          <div className="t-label text-slate-500 mb-1">
            Campaign revenue · {result?.window?.start} → {result?.window?.end} · {result?.modelRequested} · {result?.attributionWindowRequested}d
          </div>
          {result?.matchType !== "none" ? (
            <>
              <div className="text-4xl font-semibold text-slate-900">{fmtUsd(result!.matchedRevenue ?? 0)}</div>
              <div className="mt-2 text-sm text-slate-600">
                Matched ({result?.matchType}): <span className="font-medium">{result?.matchedName}</span>
              </div>
            </>
          ) : (
            <>
              <div className="text-lg font-semibold text-amber-700">No campaign matched “{result?.campaignQuery}”.</div>
              <div className="mt-2 text-sm text-slate-600">
                Northbeam&apos;s campaign names in this window (top by revenue) — find yours below, then adjust the query:
              </div>
              <ul className="mt-2 text-sm text-slate-700 max-h-64 overflow-auto space-y-1">
                {(result?.candidates ?? []).map((c) => (
                  <li key={c.name} className="flex justify-between gap-4">
                    <button className="text-left underline decoration-dotted" onClick={() => setCampaign(c.name)}>{c.name}</button>
                    <span className="tabular-nums">{fmtUsd(c.revenue)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {result?.error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 max-w-2xl whitespace-pre-wrap">
          {result.error}
        </div>
      )}

      {result && (
        <details open={!hasPlatformNumber && !hasCampaignResult} className="max-w-4xl">
          <summary className="cursor-pointer text-sm font-medium text-slate-700 mb-2">
            Debug detail ({result.elapsedMs} ms)
          </summary>
          <pre className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs overflow-auto max-h-[480px]">
            {JSON.stringify({ ...result, rows: undefined }, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
