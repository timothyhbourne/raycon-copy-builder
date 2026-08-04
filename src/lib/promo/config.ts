// Promotional Calendar source config. The tab is link-viewable, so we read it as
// CSV with no auth. The GID is PINNED (not the default gid=0, which is a
// different "daily revenue" tab): 267086982 is the Promotional Calendar tab
// whose header row is Year, Month, Sale, … (verified 2026-07-22). Pinning the
// GID means a future re-order/rename of tabs cannot silently change which sheet
// we read. Overridable via env for a future sheet move.

export const SHEET_ID = process.env.PROMO_SHEET_ID || "11sRv4m_OPS48dKFKK2Dqq2rgCC4CMzh5FoxT_aISW9Y";
export const PROMO_GID = process.env.PROMO_GID || "267086982";

// The gviz endpoint returns clean RFC-4180 CSV (quoted fields, embedded
// newlines) — preferred over /export which can vary. tqx=out:csv is the CSV
// output mode; gid pins the tab.
export function promoCsvUrl(): string {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${PROMO_GID}`;
}
