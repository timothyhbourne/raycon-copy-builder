# Prompt: ingest the company Promotional Calendar (Google Sheet) into the app

Hand this to Claude Code from the repo root. Goal: pull the company-wide **Promotional Calendar** tab from a Google Sheet, consolidate its messy multi-row structure into clean promotion records on the backend, refresh it daily, and show it in an elegant page filtered by **Year** and **Month**.

Run `npx tsc --noEmit` after each task. Do not regress recent work (hard-rules gate, copy-variations, metrics/UI).

## Source of truth
- Sheet: `https://docs.google.com/spreadsheets/d/11sRv4m_OPS48dKFKK2Dqq2rgCC4CMzh5FoxT_aISW9Y/edit`
- Sheet ID: `11sRv4m_OPS48dKFKK2Dqq2rgCC4CMzh5FoxT_aISW9Y`
- The tab we want is the **Promotional Calendar** (it is the first/default sheet). It is already **link-viewable**, so it can be fetched as CSV with no auth:
  - `https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:csv&gid=<GID>` (returns clean CSV), or
  - `https://docs.google.com/spreadsheets/d/<ID>/export?format=csv&gid=<GID>`
  - **Pin the GID.** Open the Promotional Calendar tab in the browser and copy the `#gid=...` value from the URL, so a future re-order of tabs cannot change which sheet we read. Put `SHEET_ID` and `PROMO_GID` in a config constant (or env vars).

### The actual columns (map by header NAME, not index)
`Year, Month, Sale, Channel, Secondary Channel, Type, Start Date, Start Time, End Date, End Time, # days, Promotion, Target PC2, Promotion Exceptions, Promotion Type, Learnings, Creative Assets Needed, Target Revenue, Product, Full MSRP, List Price, Sale Price, $ Off, % Off, PC1, PC1 %, PC2, PC2 %, Shopify Execution, Influencer Tracking Impact, Influencer Personalization On/Off, Amazon Execution, Retail Execution, Other` (+ many trailing empty columns).

The stakeholder cares most about: **Year, Month, Sale, Start Date, Start Time, End Date, End Time, Promotion, # days.** Channel is not important (it applies to all). Keep pricing/product detail available but secondary.

### Why this needs a real "consolidation engine" (the messy part)
The tab is NOT one-row-per-promotion. A single promotion is a **group of rows**:
- The **first row** of a promotion has `Sale`, dates, `Promotion`, etc.
- **Following rows** leave `Year/Month/Sale/dates` BLANK and carry only per-**Product** pricing (`Product, Full MSRP, List Price, Sale Price, $ Off, % Off`).
- `Year` and `Month` are also left blank for later promotions in the same month (they must be **forward-filled** down).
- Cells contain **embedded newlines inside quotes** (e.g. a "Learnings" note spanning lines), and there are **trailing empty columns**.

Concrete example from the sheet: the "Get Fit" promotion (Jan 2023) occupies a header row (Fitness Earbud pricing) plus a second row for "Fitness Speaker" whose Year/Month/Sale/dates are all blank. The next promotion "Throwback" starts with blank Year/Month (forward-fill from January 2023).

---

## Task 1 — Config + fetch
- Add `src/lib/promo/config.ts` with `SHEET_ID`, `PROMO_GID`, and a `promoCsvUrl()` builder.
- Add `src/lib/promo/fetch.ts` exporting `fetchPromoCsv(): Promise<string>` that GETs the CSV export URL. Handle non-200 / HTML (means the sheet lost public access) with a clear error.

## Task 2 — Robust CSV parse
- Parse with a real CSV parser that handles quoted fields and **embedded newlines** (use `papaparse` or `csv-parse` — do NOT split on `\n`/`,`). 627 physical lines collapse to far fewer logical rows because of multiline cells.
- Find the header row by locating the row containing `Year`, `Month`, `Sale`; build a `header -> columnIndex` map so added/reordered/trailing-empty columns never break parsing.
- Emit an array of raw row objects keyed by header name; trim whitespace; drop fully-empty rows.

## Task 3 — Consolidation + normalization engine (the core)
Create `src/lib/promo/consolidate.ts` turning raw rows into clean records:
```ts
export interface PromoProduct { product: string; msrp?: number; listPrice?: number; salePrice?: number; dollarOff?: number; pctOff?: number; }
export interface Promotion {
  id: string;            // stable hash of year+sale+startDate
  year: number;
  month: string;         // "January" ...
  sale: string;
  promotion: string;     // the human description ("20% off Fitness Series")
  type?: string;         // CRM / Acquisition / etc.
  promotionType?: string;
  startDate?: string;    // ISO yyyy-mm-dd
  startTime?: string;
  endDate?: string;      // ISO
  endTime?: string;
  days?: number;         // from "# days", else computed from dates
  products: PromoProduct[];
  targetRevenue?: string;
  shopifyExecution?: string;
  learnings?: string;
  raw?: Record<string,string>; // keep the source row for debugging
}
```
Rules the engine must implement:
1. **Forward-fill** `Year` and `Month` down (blank inherits the last seen value).
2. **Group into promotions.** A new promotion begins when `Sale` (or `Promotion` + `Start Date`) is non-empty. Rows with a `Product` but blank `Sale`/`Start Date` are **line-items appended to the current promotion's `products[]`**.
3. **Normalize dates.** Parse messy formats like `"Tue 12/27/22"` and 2-digit years into ISO. Validate `start <= end`; if `# days` is blank, compute it from the dates. Flag (do not crash) any row whose dates cannot be parsed.
4. **Normalize money/percent.** `"$119.99"` → number; `"-20%"` → `-20` (or `20` as "percent off" — pick one and be consistent). Blank → undefined.
5. **Clean text.** Collapse internal newlines to spaces in single-line fields; keep `learnings` multiline. Drop trailing empty columns entirely.
6. Sort promotions by `startDate` (then year/month). Produce a stable `id` so the UI can key rows.

Write a small unit test (or a `scripts/` dry-run) that runs the engine over the live CSV and prints the consolidated promotions for one month, so the grouping can be eyeballed.

## Task 4 — Storage, read API, daily refresh
Mirror the existing file-store idiom (`src/lib/metrics/store.ts`, `src/lib/planner.ts`):
- `src/lib/promo/store.ts`: read/write `data/promo-calendar.json` = `{ synced_at: string, promotions: Promotion[] }`.
- `POST /api/promotions/sync`: fetch → parse → consolidate → write store. Returns count + synced_at.
- `GET /api/promotions?year=&month=`: read the store, filter by year/month when provided, return `{ promotions, years: number[], synced_at }` (also return the distinct `years` present, to build the Year toggle). If the store is missing or `synced_at` is >24h old, trigger a sync first (daily-cache-on-read, same as metrics).
- **Daily cron:** add to `vercel.json` crons: `{ "path": "/api/promotions/sync", "schedule": "0 5 * * *" }` (join the two existing crons).
- Note the persistence caveat documented in `metrics/store.ts` (serverless FS is ephemeral); use the same `StorageAdapter` approach if present so it degrades gracefully.

## Task 5 — UI page (elegant, filter by Year + Month)
- New route `src/app/promotions/page.tsx` (+ `layout.tsx` mirroring `planner/layout.tsx`: white `bg-surface` workspace, `PageHeader`, "Synced X ago" + a manual **Sync now** button like the dashboard).
- **Controls:** a **Year** toggle (built from the `years` the API returns; default current year) and a **Month** toggle (Jan–Dec; default current month). Use the existing `SegmentedToggle` for consistency.
- **Content:** the matching promotions as clean cards — `Sale` as the title, the date range (`startDate startTime → endDate endTime`), a `# days` chip, the `Promotion` description, and an expandable product/pricing table (`Product, MSRP, Sale Price, % Off`). Keep `Channel` out of the headline (show it as a small tag at most). Elegant, hairline-structured, matching the planner look.
- Empty state when a year/month has no promotions.

## Task 6 — Navigation
- Add a nav item under the **Plan** group in `src/components/AppNav.tsx` (next to Planner): `{ href: "/promotions", label: "Promotions", Icon: <a calendar-ish icon> }`.

---

## Guardrails / notes
- **Auth:** the CSV path works only while the sheet stays link-viewable. If it is ever locked down, the fallback is the Google Sheets API with a service-account key — flag this rather than silently failing; the fetch step should surface a clear "sheet is no longer public" error.
- **Resilience:** map columns by header name; never assume column order or count. Never crash on a bad row — collect and report parse warnings.
- **Read-only ingest:** this feature only READS the sheet. Do not attempt to write back.
- **Scope:** only the Promotional Calendar tab. Ignore the sheet's other tabs.

## Acceptance criteria
- [ ] `POST /api/promotions/sync` pulls the live sheet and writes consolidated `data/promo-calendar.json`.
- [ ] Multi-row promotions are correctly grouped (products nested), Year/Month forward-filled, dates normalized to ISO, `# days` filled when blank.
- [ ] `/promotions` shows Year + Month toggles; selecting e.g. July 2026 shows exactly that month's promotions in a clean layout.
- [ ] Daily cron refreshes the data; a manual Sync now works; "Synced X ago" shows freshness.
- [ ] Column reordering or new trailing columns in the sheet do not break parsing.
- [ ] `npx tsc --noEmit` clean; a browser pass on `/promotions`.
