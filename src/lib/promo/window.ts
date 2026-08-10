import type { Promotion } from "./consolidate";

// Date-window queries over the Promotional Calendar. PURE (types only, no I/O)
// so both the client calendar grid and the server copy-seed route share one
// definition of "this promotion is running then".
//
// All dates are bare ISO "YYYY-MM-DD", which compare correctly as strings.

/**
 * A promotion's effective window. A promo carrying only one of the two dates is
 * treated as a single-day event; one carrying neither can't be placed at all,
 * and one whose end precedes its start is malformed (the consolidator warns).
 */
export function promoWindow(p: Promotion): { start: string; end: string } | null {
  const start = p.startDate || p.endDate;
  const end = p.endDate || p.startDate;
  if (!start || !end || end < start) return null;
  return { start, end };
}

/**
 * Dated promotions in a stable order: earliest start first, longer promos before
 * shorter ones (a long backdrop band sits above the short sale inside it), id as
 * the final tiebreak. Undated promos are dropped — they can't be placed.
 * Total and deterministic, which is what makes lane and colour assignment stable.
 */
export function sortPromos(promos: Promotion[]): Promotion[] {
  return promos
    .filter((p) => promoWindow(p) !== null)
    .sort((a, b) => {
      const wa = promoWindow(a)!, wb = promoWindow(b)!;
      if (wa.start !== wb.start) return wa.start.localeCompare(wb.start);
      if (wa.end !== wb.end) return wb.end.localeCompare(wa.end);
      return a.id.localeCompare(b.id);
    });
}

/** Promotions whose window overlaps [from, to] inclusive, earliest first. */
export function promosInRange(promos: Promotion[], from: string, to: string): Promotion[] {
  return sortPromos(promos).filter((p) => {
    const w = promoWindow(p)!;
    return w.start <= to && w.end >= from;
  });
}

/**
 * The promotion running on a given day — the honest "is this send part of a
 * promotion?" link, since a planner row carries no promotion id of its own.
 * Shortest window wins when several overlap: a 3-day flash sale sitting inside a
 * month-long seasonal push is the more specific context for that day's copy.
 */
export function promoOnDate(promos: Promotion[], ymd: string): Promotion | undefined {
  if (!ymd) return undefined;
  const hits = promosInRange(promos, ymd, ymd);
  if (hits.length <= 1) return hits[0];
  return hits.reduce((best, p) => {
    const wb = promoWindow(best)!, wp = promoWindow(p)!;
    const lenB = Date.parse(wb.end) - Date.parse(wb.start);
    const lenP = Date.parse(wp.end) - Date.parse(wp.start);
    return lenP < lenB ? p : best;
  });
}
