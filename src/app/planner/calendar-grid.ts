import type { Promotion } from "@/lib/promo/consolidate";
import { promoWindow, promosInRange, sortPromos } from "@/lib/promo/window";

// Re-exported so the calendar's callers (and its tests) have one import site.
export { promoWindow, promosInRange, sortPromos };

// Pure geometry for the Planner month grid: which real dates each cell holds,
// and where a promotion's band sits inside a week. Split out of CalendarView so
// the fiddly parts (month boundaries, multi-week bands, lane stacking) are
// unit-tested rather than eyeballed in the browser.
//
// Every date here is a local "YYYY-MM-DD". Never toISOString() on a local Date —
// that shifts the day west of UTC and would mis-key a whole column.

export interface DayCell {
  /** Real ISO date this cell stands for — including leading/trailing days that
   *  belong to the adjacent month. Always the true date, never null. */
  ymd: string;
  /** Day-of-month number to print. */
  day: number;
  /** False for the previous/next month's days padding the first/last week. */
  inMonth: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local-date -> "YYYY-MM-DD". */
export function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The month's grid: leading cells are the tail of the previous month, trailing
 * cells the head of the next, both carrying their REAL dates so click-to-create,
 * drops, holidays, and promo bands all resolve correctly from either month's
 * view. Length is always a multiple of 7.
 */
export function buildMonthCells(y: number, m: number): DayCell[] {
  const leading = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const total = Math.ceil((leading + daysInMonth) / 7) * 7;
  const cells: DayCell[] = [];
  for (let i = 0; i < total; i++) {
    // Date normalizes out-of-range day numbers, so this walks cleanly across
    // month AND year boundaries (Dec -> Jan) with no special cases.
    const d = new Date(y, m, 1 - leading + i);
    cells.push({ ymd: ymdLocal(d), day: d.getDate(), inMonth: d.getMonth() === m && d.getFullYear() === y });
  }
  return cells;
}

/** Split a flat cell list into weeks of 7. */
export function toWeeks(cells: DayCell[]): DayCell[][] {
  const weeks: DayCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * One lane per promotion for the WHOLE visible month, not per week — a promo
 * that changed row between weeks would read as two different promos. Greedy
 * first-fit over the sorted list; two promos share a lane only when their
 * windows don't overlap.
 */
export function assignLanes(promos: Promotion[]): Map<string, number> {
  const laneEnd: string[] = [];   // last occupied date per lane
  const lanes = new Map<string, number>();
  for (const p of promos) {
    const w = promoWindow(p);
    if (!w) continue;
    let lane = laneEnd.findIndex((end) => end < w.start);
    if (lane === -1) { lane = laneEnd.length; laneEnd.push(w.end); }
    else if (w.end > laneEnd[lane]) laneEnd[lane] = w.end;
    lanes.set(p.id, lane);
  }
  return lanes;
}

export interface PromoBand {
  promo: Promotion;
  /** 0-6 weekday column the band starts in, and how many columns it covers. */
  colStart: number;
  span: number;
  lane: number;
  /** True on the week the promo actually begins — carries the full name.
   *  False on continuation weeks, which show the quieter "… continues". */
  isStart: boolean;
  /** True on the week the promo ends (rounds the trailing edge). */
  isEnd: boolean;
}

export interface WeekBands {
  bands: PromoBand[];
  /** Promos overlapping this week that didn't fit in the visible lanes. */
  overflow: number;
}

/**
 * Place each overlapping promotion inside one week, clipped to the week's edges.
 * Promos beyond `maxLanes` are counted into `overflow` ("+N more") instead of
 * pushing the week arbitrarily tall.
 */
export function layoutWeekBands(
  week: DayCell[],
  promos: Promotion[],
  lanes: Map<string, number>,
  maxLanes = 3,
): WeekBands {
  if (week.length === 0) return { bands: [], overflow: 0 };
  const from = week[0].ymd;
  const to = week[week.length - 1].ymd;
  const bands: PromoBand[] = [];
  let overflow = 0;

  for (const p of promosInRange(promos, from, to)) {
    const lane = lanes.get(p.id);
    if (lane === undefined) continue;
    if (lane >= maxLanes) { overflow++; continue; }
    const w = promoWindow(p)!;
    const colStart = Math.max(0, week.findIndex((c) => c.ymd >= w.start));
    let colEnd = week.length - 1;
    for (let i = week.length - 1; i >= 0; i--) {
      if (week[i].ymd <= w.end) { colEnd = i; break; }
    }
    bands.push({
      promo: p,
      colStart,
      span: Math.max(1, colEnd - colStart + 1),
      lane,
      isStart: w.start >= from,
      isEnd: w.end <= to,
    });
  }
  return { bands, overflow };
}

/**
 * Stable 0-5 index into the band palette, hashed off the promo id so a
 * promotion keeps its colour across months and re-syncs. This is the PREFERRED
 * colour — see assignColors() for the collision handling.
 */
export function promoColorIndex(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 6;
}

/**
 * Final band colour per promotion: the hashed preference, nudged to the next
 * free slot when a promo it OVERLAPS already took that colour. A six-colour hash
 * collides often enough to matter — on the real calendar, "The Summer Event" and
 * "Back to School" both hash to 4 and share a week — and two same-coloured bands
 * stacked on one week read as one promo.
 *
 * Non-overlapping promos may still share a colour; they're never seen together.
 *
 * Pass the WHOLE calendar, not one month's slice: the result must not depend on
 * which month is on screen, or a promo spanning Aug->Sep would change colour as
 * you navigate and stop reading as the same promo. Sorting happens here so the
 * mapping is deterministic whatever order the caller holds.
 */
export function assignColors(promos: Promotion[]): Map<string, number> {
  const placed: { start: string; end: string; color: number }[] = [];
  const out = new Map<string, number>();
  for (const p of sortPromos(promos)) {
    const w = promoWindow(p)!;
    const taken = new Set(
      placed.filter((a) => a.start <= w.end && a.end >= w.start).map((a) => a.color)
    );
    const seed = promoColorIndex(p.id);
    let color = seed;
    for (let i = 0; i < 6; i++) {
      const c = (seed + i) % 6;
      if (!taken.has(c)) { color = c; break; }   // all six taken -> keep the hash
    }
    out.set(p.id, color);
    placed.push({ start: w.start, end: w.end, color });
  }
  return out;
}
