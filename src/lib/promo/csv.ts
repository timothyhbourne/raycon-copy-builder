// RFC-4180 CSV parser. A REAL parser (a character state machine), not a split on
// "\n"/"," — it correctly handles quoted fields, escaped "" quotes, embedded
// newlines inside quotes, and CRLF. The Promotional Calendar has ~627 physical
// lines that collapse to far fewer logical rows because "Learnings" and other
// cells contain multi-line quoted text.

/** Parse CSV text into a grid of string cells. Never throws. */
export function parseCsvGrid(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let started = false; // whether the current row has any content yet
  const n = text.length;

  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; started = true; continue; }
    if (c === ",") { row.push(field); field = ""; started = true; continue; }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++; // CRLF
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      started = false;
      continue;
    }
    field += c;
    started = true;
  }
  // Flush a trailing field/row (file not ending in newline).
  if (started || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface RawRow { [header: string]: string }
export interface ParsedSheet {
  headers: string[];
  rows: RawRow[];
  warnings: string[];
}

// Collapse whitespace/newlines in a header name so "Promotion Exceptions\n(Eg …)"
// becomes one clean key.
function normHeader(h: string): string {
  return (h || "").replace(/\s+/g, " ").trim();
}

/**
 * Locate the header row (the one containing Year, Month, Sale) and emit raw row
 * objects keyed by header NAME — so reordered / added / trailing-empty columns
 * never break downstream code. Fully-empty rows are dropped. Cell values are
 * outer-trimmed only (internal newlines are handled later, per field).
 */
export function toRawRows(grid: string[][]): ParsedSheet {
  const warnings: string[] = [];
  const headerIdx = grid.findIndex((r) => {
    const set = new Set(r.map((c) => normHeader(c)));
    return set.has("Year") && set.has("Month") && set.has("Sale");
  });
  if (headerIdx === -1) {
    warnings.push("Header row (Year/Month/Sale) not found — sheet layout may have changed.");
    return { headers: [], rows: [], warnings };
  }

  // Map by name; keep the FIRST occurrence of each non-empty header, dropping
  // trailing/blank header columns entirely.
  const rawHeaders = grid[headerIdx].map(normHeader);
  const colByHeader = new Map<string, number>();
  const headers: string[] = [];
  rawHeaders.forEach((h, ci) => {
    if (h && !colByHeader.has(h)) { colByHeader.set(h, ci); headers.push(h); }
  });

  const rows: RawRow[] = [];
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const cells = grid[r];
    const obj: RawRow = {};
    let anyNonEmpty = false;
    for (const h of headers) {
      const v = (cells[colByHeader.get(h)!] ?? "").trim();
      obj[h] = v;
      if (v) anyNonEmpty = true;
    }
    if (anyNonEmpty) rows.push(obj);
  }
  return { headers, rows, warnings };
}
