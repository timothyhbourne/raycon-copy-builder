"use client";
import { useEffect, useMemo, useState } from "react";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import type { PlannerRow } from "@/lib/planner-types";
import { statusLabel } from "@/lib/planner-types";
import type { Promotion } from "@/lib/promo/consolidate";
import { holidayName } from "@/lib/holidays";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import PlatformBadge from "@/components/ui/PlatformBadge";
import { ymdOf, STATUS_STYLE, type CopyEntry } from "./format";
import { ChannelGlyph, CopyGlyph } from "./components";
import {
  buildMonthCells, toWeeks, promosInRange, assignLanes, assignColors, layoutWeekBands,
  type DayCell, type PromoBand,
} from "./calendar-grid";

// The Planner month calendar. Extracted from page.tsx (which was ~1.5k lines) so
// the grid geometry, the promotion bands, and the day cell each have one home.
// The fiddly parts — month boundaries, multi-week bands, lane stacking — live as
// pure functions in ./calendar-grid.ts and are unit-tested there.
//
// Vertical order inside a week, defined and non-overlapping:
//   promo bands (their own row, above the cells) -> day number + today badge
//   -> holiday chip -> campaign entries.

const MAX_LANES = 3;
// Tailwind v4 only emits a @theme variable when some utility actually uses it,
// so referencing var(--color-band-N) from an inline style alone leaves the
// variable undefined and the band renders TRANSPARENT. Naming the classes as
// literals here puts them in front of the class scanner and keeps the fill.
const BAND_BG = ["bg-band-1", "bg-band-2", "bg-band-3", "bg-band-4", "bg-band-5", "bg-band-6"] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Props {
  rows: PlannerRow[];
  cursor: { y: number; m: number };
  setCursor: (c: { y: number; m: number }) => void;
  onEntry: (r: PlannerRow) => void;
  onDay: (dayYmd: string) => void;
  onReschedule: (id: string, ymd: string) => void;
  copyEntry: (r: PlannerRow) => CopyEntry;
  onViewCopy: (id: string, status?: "draft" | "final") => void;
}

// Human date for the popover, from a bare ISO day (no timezone shift).
function fmtDay(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function promoRange(p: Promotion): string {
  if (p.startDate && p.endDate) return `${fmtDay(p.startDate)} — ${fmtDay(p.endDate)}`;
  return fmtDay(p.startDate || p.endDate);
}

export default function CalendarView({
  rows, cursor, setCursor, onEntry, onDay, onReschedule, copyEntry, onViewCopy,
}: Props) {
  const { y, m } = cursor;
  const first = new Date(y, m, 1);
  const todayYmd = useMemo(() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  }, []);

  // The Promotional Calendar, fetched once and filtered per month on the client.
  // Fetched WITHOUT ?year so a promo spanning a year boundary still resolves when
  // the grid's leading/trailing cells fall in the neighbouring year. The route is
  // daily-cached server-side, so this is one cheap call.
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/promotions")
      .then((r) => r.json())
      .then((d) => { if (!cancelled && Array.isArray(d.promotions)) setPromotions(d.promotions); })
      .catch(() => { /* no bands — the calendar is still fully usable */ });
    return () => { cancelled = true; };
  }, []);

  // Read-only detail popover for a clicked band.
  const [openPromo, setOpenPromo] = useState<{ promo: Promotion; color: number } | null>(null);

  const byDay = useMemo(() => {
    const map = new Map<string, PlannerRow[]>();
    for (const r of rows) {
      const k = ymdOf(r.planned_send_at);
      if (!k) continue;
      const list = map.get(k);
      if (list) list.push(r); else map.set(k, [r]);
    }
    return map;
  }, [rows]);

  const cells = useMemo(() => buildMonthCells(y, m), [y, m]);
  const weeks = useMemo(() => toWeeks(cells), [cells]);
  // Promos overlapping the whole visible grid (including the adjacent-month
  // padding), so a band that only touches a trailing cell still draws.
  const visiblePromos = useMemo(
    () => promosInRange(promotions, cells[0].ymd, cells[cells.length - 1].ymd),
    [promotions, cells],
  );
  // Lanes are assigned across the whole month, not per week, so a promo keeps the
  // same row as it continues and never reads as two different promos.
  const lanes = useMemo(() => assignLanes(visiblePromos), [visiblePromos]);
  // Colours are de-collided across OVERLAPPING promos so two bands stacked on the
  // same week are always distinct — computed over the WHOLE calendar, not the
  // visible slice, so a promo keeps its colour as you page between months.
  const colors = useMemo(() => assignColors(promotions), [promotions]);

  const goPrev = () => setCursor(m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 });
  const goNext = () => setCursor(m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 });
  const goToday = () => { const t = new Date(); setCursor({ y: t.getFullYear(), m: t.getMonth() }); };
  const navBtn = "w-7 h-7 inline-flex items-center justify-center rounded-sm border border-line text-ink-secondary hover:bg-chrome transition-colors";

  const onDragEnd = (res: DropResult) => {
    if (!res.destination) return;
    const dest = res.destination.droppableId.replace("cal:", "");
    const src = res.source.droppableId.replace("cal:", "");
    if (dest && dest !== src) onReschedule(res.draggableId, dest);
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      {/* Fill the full (wide) workspace width — the 7-column grid and day cells
          stretch to fill, no dead gutter on the right. */}
      <div className="w-full bg-surface border border-line rounded-md shadow-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <div className="flex items-center gap-2">
            <button onClick={goPrev} aria-label="Previous month" title="Previous month" className={navBtn}>←</button>
            <div className="text-sm font-medium text-ink min-w-[9rem] text-center">{first.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</div>
            <button onClick={goNext} aria-label="Next month" title="Next month" className={navBtn}>→</button>
            <Button variant="ghost" size="sm" onClick={goToday}>Today</Button>
          </div>
          <div className="flex items-center gap-3 t-label">
            <span className="flex items-center gap-1"><span aria-hidden>📧</span> Email</span>
            <span className="flex items-center gap-1"><span aria-hidden>📱</span> SMS</span>
          </div>
        </div>
        <div key={`${y}-${m}`} className="rc-animate-fade">
          <div className="grid grid-cols-7 t-label border-b border-line">
            {WEEKDAYS.map((d) => <div key={d} className="px-2 py-1.5 text-center">{d}</div>)}
          </div>
          {weeks.map((week, wi) => (
            <WeekRow
              key={week[0].ymd}
              week={week}
              isTrailingWeek={wi > 0 && week.every((c) => !c.inMonth)}
              promos={visiblePromos}
              lanes={lanes}
              colors={colors}
              byDay={byDay}
              todayYmd={todayYmd}
              onDay={onDay}
              onEntry={onEntry}
              copyEntry={copyEntry}
              onViewCopy={onViewCopy}
              onOpenPromo={setOpenPromo}
            />
          ))}
        </div>
        <div className="px-4 py-2 text-[11px] text-ink-muted border-t border-line">Drag an entry to another day to reschedule · click to edit · click a promotion band for details</div>
      </div>

      <PromoDetail entry={openPromo} onClose={() => setOpenPromo(null)} />
    </DragDropContext>
  );
}

// ---------- one week: the promo band row, then the seven day cells ----------
function WeekRow({
  week, isTrailingWeek, promos, lanes, colors, byDay, todayYmd, onDay, onEntry, copyEntry, onViewCopy, onOpenPromo,
}: {
  week: DayCell[];
  isTrailingWeek: boolean;
  promos: Promotion[];
  lanes: Map<string, number>;
  colors: Map<string, number>;
  byDay: Map<string, PlannerRow[]>;
  todayYmd: string;
  onDay: (ymd: string) => void;
  onEntry: (r: PlannerRow) => void;
  copyEntry: (r: PlannerRow) => CopyEntry;
  onViewCopy: (id: string, status?: "draft" | "final") => void;
  onOpenPromo: (e: { promo: Promotion; color: number }) => void;
}) {
  const { bands, overflow } = useMemo(
    () => layoutWeekBands(week, promos, lanes, MAX_LANES),
    [week, promos, lanes],
  );
  const laneCount = bands.length ? Math.max(...bands.map((b) => b.lane)) + 1 : 0;

  return (
    // A subtle divider marks the month boundary when a whole trailing week
    // belongs to the next month.
    <div className={isTrailingWeek ? "border-t-2 border-line-strong" : ""}>
      {/* Band row — only rendered when this week actually carries a promotion,
          so a month with none has no row and no layout shift. */}
      {(laneCount > 0 || overflow > 0) && (
        <div
          className="grid grid-cols-7 gap-y-0.5 px-1 pt-1 border-r border-line"
          style={{ gridTemplateRows: `repeat(${laneCount + (overflow > 0 ? 1 : 0)}, auto)` }}
        >
          {bands.map((b) => (
            <Band key={b.promo.id} band={b} color={colors.get(b.promo.id) ?? 0} onOpen={onOpenPromo} />
          ))}
          {overflow > 0 && (
            <div className="text-[10px] text-ink-muted text-right pr-1" style={{ gridColumn: "1 / span 7", gridRow: laneCount + 1 }}>
              +{overflow} more promotion{overflow === 1 ? "" : "s"}
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-7">
        {week.map((cell) => (
          <DayCellView
            key={cell.ymd}
            cell={cell}
            entries={byDay.get(cell.ymd) ?? []}
            isToday={cell.ymd === todayYmd}
            onDay={onDay}
            onEntry={onEntry}
            copyEntry={copyEntry}
            onViewCopy={onViewCopy}
          />
        ))}
      </div>
    </div>
  );
}

// ---------- a promotion band ----------
function Band({ band, color: colorIndex, onOpen }: {
  band: PromoBand; color: number; onOpen: (e: { promo: Promotion; color: number }) => void;
}) {
  const { promo, colStart, span, lane, isStart, isEnd } = band;
  const detail = [promo.promotion, promo.promotionType].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen({ promo, color: colorIndex }); }}
      title={detail ? `${promo.sale} — ${detail}` : promo.sale}
      aria-label={`Promotion ${promo.sale}, ${promoRange(promo)}`}
      style={{
        gridColumn: `${colStart + 1} / span ${span}`,
        gridRow: lane + 1,
        // Square off the edge where the promo continues past this week, so the
        // pill visibly runs on rather than looking like a separate promo.
        borderTopLeftRadius: isStart ? undefined : 0,
        borderBottomLeftRadius: isStart ? undefined : 0,
        borderTopRightRadius: isEnd ? undefined : 0,
        borderBottomRightRadius: isEnd ? undefined : 0,
      }}
      className={`min-w-0 rounded-sm px-1.5 py-0.5 text-left text-[10px] font-medium leading-tight text-white truncate hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 transition-[filter] ${BAND_BG[colorIndex] ?? BAND_BG[0]}`}
    >
      {isStart ? promo.sale : <span className="opacity-90">… {promo.sale} continues</span>}
    </button>
  );
}

// ---------- one day cell ----------
function DayCellView({
  cell, entries, isToday, onDay, onEntry, copyEntry, onViewCopy,
}: {
  cell: DayCell;
  entries: PlannerRow[];
  isToday: boolean;
  onDay: (ymd: string) => void;
  onEntry: (r: PlannerRow) => void;
  copyEntry: (r: PlannerRow) => CopyEntry;
  onViewCopy: (id: string, status?: "draft" | "final") => void;
}) {
  const weekday = new Date(cell.ymd + "T00:00:00").getDay();
  const weekend = weekday === 0 || weekday === 6;
  const holiday = holidayName(cell.ymd);

  // Adjacent-month days are recessed and muted, but fully live: clickable to
  // create, a valid drop target, and they show their real entries/holidays.
  const bg = !cell.inMonth ? "bg-sunken" : weekend ? "bg-chrome/60 hover:bg-chrome" : "hover:bg-chrome";

  return (
    <Droppable droppableId={`cal:${cell.ymd}`}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.droppableProps}
          onClick={() => onDay(cell.ymd)}
          className={`relative min-h-[96px] border-b border-r border-line p-1.5 cursor-pointer transition-colors ${
            snapshot.isDraggingOver ? "bg-accent-50" : bg
          } ${isToday ? "ring-1 ring-inset ring-accent" : ""}`}
        >
          <div className="flex items-center justify-between gap-1">
            <span className={`text-[11px] font-mono tabular-nums ${
              isToday ? "text-accent font-semibold" : cell.inMonth ? "text-ink-secondary" : "text-ink-muted"
            }`}>{cell.day}</span>
            {isToday && <span className="text-[9px] font-medium capitalize text-accent">Today</span>}
          </div>
          {holiday && (
            // A real, readable marker — not a grey dot. Informational and
            // pointer-transparent, so it never blocks click-to-create or the drop
            // target beneath it.
            <div
              title={holiday}
              className="pointer-events-none mt-1 flex items-center gap-1 rounded-sm bg-holiday-50 border border-holiday-200 px-1.5 py-0.5 text-holiday-600"
            >
              <span aria-hidden className="text-[9px] leading-none shrink-0">★</span>
              <span className="truncate text-[10px] font-medium leading-tight">{holiday}</span>
            </div>
          )}
          <div className="space-y-1 mt-1">
            {entries.map((r, idx) => (
              <Draggable draggableId={r.id} index={idx} key={r.id}>
                {(dp, snap) => {
                  const ce = copyEntry(r);
                  const st = STATUS_STYLE[r.status];
                  // dnd owns the inline transform while dragging; append the tilt
                  // rather than overwrite it so the drag position is preserved.
                  const style = snap.isDragging
                    ? { ...dp.draggableProps.style, transform: `${dp.draggableProps.style?.transform ?? ""} rotate(1deg)` }
                    : dp.draggableProps.style;
                  return (
                    <div ref={dp.innerRef} {...dp.draggableProps} {...dp.dragHandleProps} style={style}
                      onClick={(e) => { e.stopPropagation(); onEntry(r); }}
                      title={`${r.name} · ${statusLabel(r.status, r.channel)}`}
                      className={`flex items-center gap-1 rounded-sm px-1.5 py-1 border transition-[box-shadow] duration-150 ease-out-soft ${st.pill} ${
                        snap.isDragging ? "shadow-pop" : "hover:shadow-card"
                      }`}>
                      <ChannelGlyph channel={r.channel} className="shrink-0" />
                      {r.status === "scheduled" && <PlatformBadge channel={r.channel} compact className="shrink-0" />}
                      {st.check && <span className="text-[9px] leading-none shrink-0" aria-hidden>✓</span>}
                      <span className={`text-[11px] truncate ${st.strike ? "line-through" : ""}`}>{r.name}</span>
                      {(ce === "draft" || ce === "final") && r.copy_campaign_id && (
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); onViewCopy(r.copy_campaign_id!, ce); }}
                          title="View copy" aria-label="View copy"
                          className="ml-auto shrink-0 text-ink-muted hover:text-ink transition-colors">
                          <CopyGlyph />
                        </button>
                      )}
                    </div>
                  );
                }}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        </div>
      )}
    </Droppable>
  );
}

// ---------- read-only promotion detail ----------
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="t-label text-ink-secondary mb-0.5">{label}</div>
      <div className="text-sm text-ink whitespace-pre-wrap leading-relaxed">{children}</div>
    </div>
  );
}

function PromoDetail({ entry, onClose }: {
  entry: { promo: Promotion; color: number } | null; onClose: () => void;
}) {
  if (!entry) return null;
  const { promo } = entry;
  return (
    <Modal open onClose={onClose} size="md" title={
      <span className="flex items-center gap-2">
        <span aria-hidden className={`w-2.5 h-2.5 rounded-full shrink-0 ${BAND_BG[entry.color] ?? BAND_BG[0]}`} />
        {promo.sale}
      </span>
    }>
      <div className="space-y-3">
        <Row label="Dates">{promoRange(promo)}{promo.days ? ` · ${promo.days} day${promo.days === 1 ? "" : "s"}` : ""}</Row>
        {promo.promotion && <Row label="Promotion">{promo.promotion}</Row>}
        {promo.promotionType && <Row label="Type">{promo.promotionType}</Row>}
        {promo.products.length > 0 && (
          <Row label="Products">
            <ul className="space-y-0.5">
              {promo.products.filter((p) => p.product).map((p, i) => (
                <li key={`${p.product}-${i}`} className="text-sm">
                  {p.product}
                  {p.pctOff != null ? ` — ${p.pctOff}% off` : p.dollarOff != null ? ` — $${p.dollarOff} off` : ""}
                </li>
              ))}
            </ul>
          </Row>
        )}
        {promo.learnings && <Row label="Learnings">{promo.learnings}</Row>}
      </div>
    </Modal>
  );
}
