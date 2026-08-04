// Self-contained major-holiday lookup for the planner calendar (US + Europe).
// No external date/holiday library — movable dates (Easter) are computed per year
// so markers stay correct across years. Scope is intentionally narrow: only
// well-known public holidays, so the calendar stays calm.
//
// Keyed lookups go through holidayName(ymd) where ymd is "YYYY-MM-DD".

// Anonymous Gregorian ("Computus") algorithm → Easter Sunday for a given year.
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

// nth weekday of a month, e.g. nthWeekday(2026, 11, 4, 4) = 4th Thursday of Nov.
// weekday: 0=Sun..6=Sat. n is 1-based.
function nthWeekday(year: number, month1: number, weekday: number, n: number): string {
  const first = new Date(year, month1 - 1, 1).getDay();
  const offset = (weekday - first + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  return ymd(year, month1, day);
}

// last weekday of a month, e.g. last Monday of May (US Memorial Day).
function lastWeekday(year: number, month1: number, weekday: number): string {
  const lastDay = new Date(year, month1, 0).getDate();
  const lastDow = new Date(year, month1 - 1, lastDay).getDay();
  const day = lastDay - ((lastDow - weekday + 7) % 7);
  return ymd(year, month1, day);
}

// Add n days to a "YYYY-MM-DD", returning a new "YYYY-MM-DD".
function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

// Build the holiday map for a single year. Cached so month navigation is cheap.
const cache = new Map<number, Map<string, string>>();

function buildYear(year: number): Map<string, string> {
  const map = new Map<string, string>();
  const easter = easterSunday(year);
  const easterKey = ymd(year, easter.month, easter.day);

  const add = (key: string, name: string) => map.set(key, name);

  add(ymd(year, 1, 1), "New Year's Day");
  add(addDays(easterKey, -2), "Good Friday");
  add(addDays(easterKey, 1), "Easter Monday");
  add(ymd(year, 5, 1), "May Day / Labour Day");
  add(lastWeekday(year, 5, 1), "Memorial Day (US)");
  add(ymd(year, 7, 4), "Independence Day (US)");
  add(nthWeekday(year, 9, 1, 1), "Labor Day (US)");
  add(nthWeekday(year, 11, 4, 4), "Thanksgiving (US)");
  add(ymd(year, 12, 24), "Christmas Eve");
  add(ymd(year, 12, 25), "Christmas Day");
  add(ymd(year, 12, 26), "Boxing Day");
  add(ymd(year, 12, 31), "New Year's Eve");

  return map;
}

function yearMap(year: number): Map<string, string> {
  let m = cache.get(year);
  if (!m) { m = buildYear(year); cache.set(year, m); }
  return m;
}

// Holiday name for a "YYYY-MM-DD" key, or null if the date isn't a marked holiday.
export function holidayName(key: string): string | null {
  const year = Number(key.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  return yearMap(year).get(key) ?? null;
}
