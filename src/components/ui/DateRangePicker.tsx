"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

// Custom From/To range picker matching the token system — replaces the two
// native <input type="date"> controls (which rendered the browser's own
// calendar). Emits the "YYYY-MM-DD" string shape the planner filter expects.
//
// Dependency-light and hand-built. Accessibility: the trigger is a real button
// with aria-expanded; the popover traps nothing but closes on Escape / outside
// click and restores focus; every day and preset is a focusable <button> so the
// whole control is reachable by keyboard.

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const pad = (n: number) => String(n).padStart(2, "0");
const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => toKey(new Date());
function keyToDate(key: string): Date | null {
  if (!key) return null;
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return isNaN(dt.getTime()) ? null : dt;
}
function daysAgoKey(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toKey(d);
}
function monthStartKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}
const fmt = (key: string) => {
  const d = keyToDate(key);
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
};

export default function DateRangePicker({
  start,
  end,
  onChange,
  className = "",
}: {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // The month shown in the grid; seeded from the current start (or today).
  const seed = keyToDate(start) ?? new Date();
  const [cursor, setCursor] = useState({ y: seed.getFullYear(), m: seed.getMonth() });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popId = useId();

  // Close on outside click / Escape; restore focus to the trigger on Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = useMemo(() => {
    if (start && end) return `${fmt(start)} – ${fmt(end)}`;
    if (start) return `From ${fmt(start)}`;
    if (end) return `Until ${fmt(end)}`;
    return "All dates";
  }, [start, end]);

  // A day click extends/starts a range. If both ends are set (or none), start
  // fresh; otherwise complete the range, ordering the two endpoints.
  const pickDay = useCallback((key: string) => {
    if (!start || (start && end)) { onChange(key, ""); return; }
    if (key < start) onChange(key, start);
    else onChange(start, key);
  }, [start, end, onChange]);

  const preset = (s: string, e: string) => { onChange(s, e); setOpen(false); };
  const clear = () => { onChange("", ""); setOpen(false); };

  // Drag-to-select: pointer-down on a start day, move to preview the range under
  // the cursor, commit on pointer-up. A press with no movement falls through to
  // the click handler (click-start/click-end), and keyboard Enter still clicks —
  // so mouse-drag, click, and keyboard all work. We only fire onChange on commit
  // (never per hovered day), so a fetch happens once per committed range.
  const [drag, setDrag] = useState<{ start: string; hover: string; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    if (!drag) return;
    const onUp = () => {
      if (drag.moved) {
        const [s, e] = drag.start <= drag.hover ? [drag.start, drag.hover] : [drag.hover, drag.start];
        onChange(s, e);
        suppressClick.current = true; // the click that follows this drag is a no-op
      }
      setDrag(null);
    };
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, [drag, onChange]);

  // Highlight follows the live drag preview while dragging, else the committed range.
  const hiStart = drag?.moved ? (drag.start <= drag.hover ? drag.start : drag.hover) : start;
  const hiEnd = drag?.moved ? (drag.start <= drag.hover ? drag.hover : drag.start) : end;

  // Build the month grid.
  const { y, m } = cursor;
  const first = new Date(y, m, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const dayKey = (d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const tKey = todayKey();

  const goPrev = () => setCursor(m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 });
  const goNext = () => setCursor(m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 });

  const navBtn = "w-7 h-7 inline-flex items-center justify-center rounded-sm border border-line text-ink-secondary hover:bg-chrome transition-colors";
  const presets: { label: string; run: () => void }[] = [
    { label: "Month to date", run: () => preset(monthStartKey(), tKey) },
    { label: "Today", run: () => preset(tKey, tKey) },
    { label: "Last 7 days", run: () => preset(daysAgoKey(6), tKey) },
    { label: "Last 30 days", run: () => preset(daysAgoKey(29), tKey) },
    { label: "Last 90 days", run: () => preset(daysAgoKey(89), tKey) },
  ];

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        className={`inline-flex items-center gap-2 text-sm border rounded-sm pl-2.5 pr-2 py-1.5 bg-surface transition-colors ${
          open ? "border-accent" : "border-line hover:border-line-strong"
        } ${start || end ? "text-ink" : "text-ink-muted"}`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-ink-muted shrink-0">
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span className="whitespace-nowrap">{label}</span>
        {(start || end) && (
          <span role="button" tabIndex={0} aria-label="Clear date range"
            onClick={(e) => { e.stopPropagation(); clear(); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); clear(); } }}
            className="ml-0.5 text-ink-muted hover:text-ink transition-colors">✕</span>
        )}
      </button>

      {open && (
        <div id={popId} role="dialog" aria-label="Choose a date range"
          className="absolute z-30 mt-2 flex bg-surface border border-line rounded-md shadow-pop overflow-hidden rc-animate-fade">
          {/* presets rail */}
          <div className="flex flex-col gap-0.5 p-2 border-r border-line bg-canvas min-w-[132px]">
            {presets.map((p) => (
              <button key={p.label} type="button" onClick={p.run}
                className="text-left text-[13px] px-2.5 py-1.5 rounded-sm text-ink-secondary hover:bg-accent-50 hover:text-accent transition-colors">
                {p.label}
              </button>
            ))}
            <div className="mt-auto pt-1">
              <button type="button" onClick={clear}
                className="w-full text-left text-[13px] px-2.5 py-1.5 rounded-sm text-ink-muted hover:bg-chrome hover:text-ink-secondary transition-colors">
                Clear
              </button>
            </div>
          </div>

          {/* calendar */}
          <div className="p-3 w-[248px]">
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={goPrev} aria-label="Previous month" className={navBtn}>←</button>
              <div className="text-sm font-medium text-ink">{first.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</div>
              <button type="button" onClick={goNext} aria-label="Next month" className={navBtn}>→</button>
            </div>
            <div className="grid grid-cols-7 mb-1">
              {WEEKDAYS.map((d) => <div key={d} className="t-label text-center py-1">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-y-0.5 select-none" style={{ touchAction: "none" }}>
              {cells.map((d, i) => {
                if (!d) return <div key={`e-${i}`} />;
                const key = dayKey(d);
                const isStart = key === hiStart;
                const isEnd = key === hiEnd;
                const inRange = hiStart && hiEnd && key > hiStart && key < hiEnd;
                const isToday = key === tKey;
                const selected = isStart || isEnd;
                return (
                  <button key={key} type="button"
                    onPointerDown={() => setDrag({ start: key, hover: key, moved: false })}
                    onPointerEnter={() => setDrag((cur) => (cur && cur.hover !== key ? { ...cur, hover: key, moved: true } : cur))}
                    onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } pickDay(key); }}
                    aria-label={fmt(key)} aria-pressed={selected}
                    className={`h-8 text-[13px] font-mono tabular-nums flex items-center justify-center transition-colors ${
                      selected ? "bg-accent text-white rounded-sm font-medium"
                        : inRange ? "bg-accent-50 text-accent"
                        : "text-ink-secondary hover:bg-chrome rounded-sm"
                    } ${isToday && !selected ? "ring-1 ring-inset ring-accent-200 rounded-sm" : ""}`}>
                    {d}
                  </button>
                );
              })}
            </div>
            {start && !end && (
              <div className="mt-2 t-label text-center">Pick an end date</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
