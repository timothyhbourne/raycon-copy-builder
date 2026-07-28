import { parseCsvGrid, toRawRows, type RawRow } from "./csv";

// Turn the messy Promotional Calendar CSV into clean promotion records.
//
// The tab is NOT one-row-per-promotion. A promotion is a GROUP of rows: a header
// row (Sale, dates, Promotion, first product) followed by product-only rows
// (blank Sale/dates, just per-Product pricing). Year/Month are forward-filled
// down. This engine forward-fills, groups, normalizes dates + money, and flags
// (never crashes on) rows it can't interpret.

export interface PromoProduct {
  product: string;
  msrp?: number;
  listPrice?: number;
  salePrice?: number;
  dollarOff?: number; // positive magnitude ($ off)
  pctOff?: number;    // positive magnitude (% off)
}

export interface Promotion {
  id: string;
  year: number;
  month: string; // "January" …
  sale: string;
  promotion: string;
  type?: string;
  promotionType?: string;
  startDate?: string; // ISO yyyy-mm-dd
  startTime?: string;
  endDate?: string;   // ISO
  endTime?: string;
  days?: number;
  products: PromoProduct[];
  targetRevenue?: string;
  shopifyExecution?: string;
  learnings?: string;
  raw?: Record<string, string>;
}

export interface ConsolidateResult {
  promotions: Promotion[];
  warnings: string[];
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_INDEX: Record<string, number> = Object.fromEntries(
  MONTHS.map((m, i) => [m.toLowerCase(), i])
);

const DAY_MS = 86_400_000;

// Collapse internal newlines/whitespace to single spaces (single-line fields).
function oneLine(s: string | undefined): string {
  return (s || "").replace(/\s+/g, " ").trim();
}
// Keep multiline structure for learnings, but trim outer whitespace + normalize
// runs of blank lines.
function multiLine(s: string | undefined): string {
  return (s || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function nonEmpty(s: string | undefined): boolean {
  return !!(s && s.trim());
}

// "$119.99" / "1,299" / "-$24.00" → number (sign preserved). Blank → undefined.
export function parseMoney(s: string | undefined): number | undefined {
  if (!nonEmpty(s)) return undefined;
  const cleaned = s!.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

// "-20%" / "20%" → 20 (positive magnitude "percent off"). Blank → undefined.
export function parsePercent(s: string | undefined): number | undefined {
  if (!nonEmpty(s)) return undefined;
  const n = Number(s!.replace(/[%\s]/g, ""));
  return Number.isFinite(n) ? Math.abs(n) : undefined;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Parse messy dates: "Tue 12/27/22", "12/27/2022", "1/3/21". Strips a leading
// weekday word, expands 2-digit years to 20YY, and validates the calendar date.
// Returns null when it cannot be parsed (caller flags it).
export function parseDate(s: string | undefined): string | null {
  if (!nonEmpty(s)) return null;
  const m = s!.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  let y = Number(m[3]);
  if (m[3].length === 2) y = 2000 + y;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Validate it is a real date (rejects 2/30 etc.).
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

// Stable id from year + sale + startDate (FNV-1a → base36) so the UI can key rows
// and re-syncs don't churn ids.
function stableId(year: number, sale: string, startDate: string | undefined): string {
  const key = `${year}|${sale.toLowerCase()}|${startDate ?? ""}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return "p_" + (h >>> 0).toString(36);
}

function buildProduct(row: RawRow): PromoProduct {
  return {
    product: oneLine(row["Product"]),
    msrp: parseMoney(row["Full MSRP"]),
    listPrice: parseMoney(row["List Price"]),
    salePrice: parseMoney(row["Sale Price"]),
    dollarOff: (() => { const n = parseMoney(row["$ Off"]); return n === undefined ? undefined : Math.abs(n); })(),
    pctOff: parsePercent(row["% Off"]),
  };
}

export function consolidate(csvText: string): ConsolidateResult {
  const grid = parseCsvGrid(csvText);
  const { rows, warnings } = toRawRows(grid);

  const promotions: Promotion[] = [];
  let cur: Promotion | null = null;
  let lastYear = "";
  let lastMonth = "";

  rows.forEach((row, idx) => {
    // 1) Forward-fill Year / Month.
    if (nonEmpty(row["Year"])) lastYear = row["Year"].trim();
    if (nonEmpty(row["Month"])) lastMonth = row["Month"].trim();
    const yearStr = lastYear;
    const month = lastMonth;

    const hasSale = nonEmpty(row["Sale"]);
    const hasStart = nonEmpty(row["Start Date"]);
    const hasPromotion = nonEmpty(row["Promotion"]);
    const hasProduct = nonEmpty(row["Product"]);
    const isNewPromo = hasSale || (hasPromotion && hasStart);

    if (!isNewPromo) {
      // Continuation: a product line-item appended to the current promotion.
      if (hasProduct && cur) cur.products.push(buildProduct(row));
      else if (hasProduct && !cur) warnings.push(`Row ${idx + 1}: product "${oneLine(row["Product"])}" before any promotion — skipped.`);
      // else: a blank/spacer row with nothing to attach — ignore silently.
      return;
    }

    // 2) New promotion.
    const year = Number(yearStr);
    if (!Number.isFinite(year) || year < 2000) {
      warnings.push(`Row ${idx + 1}: promotion "${oneLine(row["Sale"]) || oneLine(row["Promotion"])}" has no resolvable Year — skipped.`);
      cur = null;
      return;
    }

    const startDate = parseDate(row["Start Date"]);
    const endDate = parseDate(row["End Date"]);
    if (nonEmpty(row["Start Date"]) && !startDate) warnings.push(`Row ${idx + 1}: unparseable Start Date "${oneLine(row["Start Date"])}" for "${oneLine(row["Sale"])}".`);
    if (nonEmpty(row["End Date"]) && !endDate) warnings.push(`Row ${idx + 1}: unparseable End Date "${oneLine(row["End Date"])}" for "${oneLine(row["Sale"])}".`);

    // 3) Days: prefer the sheet's "# days"; else compute (inclusive) from dates.
    let days: number | undefined = (() => {
      const n = Number((row["# days"] || "").replace(/[^0-9.]/g, ""));
      return Number.isFinite(n) && n > 0 ? n : undefined;
    })();
    if (startDate && endDate) {
      const a = Date.parse(startDate + "T00:00:00Z");
      const b = Date.parse(endDate + "T00:00:00Z");
      if (b < a) {
        warnings.push(`Row ${idx + 1}: End Date (${endDate}) is before Start Date (${startDate}) for "${oneLine(row["Sale"])}".`);
      } else if (days === undefined) {
        days = Math.round((b - a) / DAY_MS) + 1; // inclusive calendar days
      }
    }

    const sale = oneLine(row["Sale"]) || oneLine(row["Promotion"]);
    const promo: Promotion = {
      id: stableId(year, sale, startDate ?? undefined),
      year,
      month: month || "",
      sale,
      promotion: oneLine(row["Promotion"]),
      type: oneLine(row["Type"]) || undefined,
      promotionType: oneLine(row["Promotion Type"]) || undefined,
      startDate: startDate ?? undefined,
      startTime: oneLine(row["Start Time"]) || undefined,
      endDate: endDate ?? undefined,
      endTime: oneLine(row["End Time"]) || undefined,
      days,
      products: hasProduct ? [buildProduct(row)] : [],
      targetRevenue: oneLine(row["Target Revenue"]) || undefined,
      shopifyExecution: oneLine(row["Shopify Execution"]) || undefined,
      learnings: multiLine(row["Learnings"]) || undefined,
      raw: row,
    };
    promotions.push(promo);
    cur = promo;
  });

  // 6) Sort by startDate, then year, then month order.
  promotions.sort((a, b) => {
    if (a.startDate && b.startDate) return a.startDate.localeCompare(b.startDate);
    if (a.year !== b.year) return a.year - b.year;
    const mi = (MONTH_INDEX[a.month.toLowerCase()] ?? 99) - (MONTH_INDEX[b.month.toLowerCase()] ?? 99);
    if (mi !== 0) return mi;
    return a.sale.localeCompare(b.sale);
  });

  // De-duplicate ids defensively (two promos hashing identical → suffix).
  const seen = new Map<string, number>();
  for (const p of promotions) {
    const n = seen.get(p.id) ?? 0;
    if (n > 0) p.id = `${p.id}_${n}`;
    seen.set(p.id.replace(/_\d+$/, ""), n + 1);
  }

  return { promotions, warnings };
}

export { MONTHS };
