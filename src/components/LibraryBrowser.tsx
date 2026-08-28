"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import EmptyState from "./ui/EmptyState";
import { displayTitle } from "@/lib/campaign-name";

// The wide campaign browser. Replaces the old 240px sidebar column that sat
// between the nav and the brief: at that width every card was a truncated
// "Back To S…", and the column stole space from the two panels that actually do
// the work. It now lives in a wide drawer over the workspace, so a card can show
// its whole title plus the meta that makes it findable, and search spans every
// list (drafts, library, SMS) instead of just the library.

interface LibraryMeta {
  id: string;
  title: string;
  date: string;
  campaign_type: string;
  offer: string;
  conceit: string;
  audience: string;
  promo_code?: string;
}

interface SavedMeta {
  id: string;
  campaign_name: string;
  campaign_type: string;
  status: string;
  updated_at: string;
  offer: string;
  audience?: string;
  promo_code?: string;
}

interface SmsMetaItem {
  id: string;
  name: string;
  status: string;
  updated_at: string;
}

interface Props {
  libraryItems: LibraryMeta[];
  savedItems: SavedMeta[];
  smsItems?: SmsMetaItem[];
  onLoadSaved: (id: string) => void;
  onDeleteSaved: (id: string) => void;
  onViewLibrary: (id: string) => void;
  onDeleteLibrary: (id: string) => void;
  /** Rename a library entry without opening it (§3d). */
  onRenameLibrary?: (id: string, title: string) => void | Promise<void>;
  onLoadSms?: (id: string) => void;
  onDeleteSms?: (id: string) => void;
  activeSavedId?: string | null;
  activeLibraryId?: string | null;
  activeSmsId?: string | null;
}

type Tab = "drafts" | "library" | "sms";

const AUDIENCE_LABEL: Record<string, string> = {
  all: "All", engaged: "Engaged", lapsed: "Lapsed", post_purchase: "Post-purchase", vip: "VIP",
};
function audienceLabel(a?: string): string | null {
  if (!a) return null;
  return AUDIENCE_LABEL[a] ?? a;
}
// A readable date (drop the time; the store stamps ISO). Falls back to raw.
function shortDate(s?: string): string | null {
  if (!s) return null;
  const d = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : s;
}
function matches(haystack: (string | undefined)[], terms: string[]): boolean {
  if (!terms.length) return true;
  const text = haystack.filter(Boolean).join(" ").toLowerCase();
  return terms.every((t) => text.includes(t));
}

function MailGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="w-3.5 h-3.5">
      <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" />
    </svg>
  );
}
function PhoneGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="w-3.5 h-3.5">
      <rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" />
    </svg>
  );
}
function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="w-4 h-4">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function StatusChip({ kind }: { kind: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: "Draft", cls: "bg-warning-50 text-warning-600" },
    final: { label: "Final", cls: "bg-success-50 text-success-600" },
    library: { label: "Library", cls: "bg-info-50 text-info-600" },
  };
  const m = map[kind] ?? { label: kind, cls: "bg-sunken text-ink-tertiary" };
  return <span className={`text-[10px] font-semibold tracking-wide rounded px-1.5 py-0.5 shrink-0 ${m.cls}`}>{m.label}</span>;
}

// One browse card. Titles WRAP here (no truncation) — being able to read the
// whole campaign name is the entire reason this surface exists.
function BrowseCard({
  active, glyph, title, metaLine, subtitle, tags, statusKind, onClick, onDelete, deleteLabel, onRename,
}: {
  active: boolean;
  glyph: React.ReactNode;
  title: string;
  metaLine: string;
  subtitle?: string;
  tags?: (string | null | undefined)[];
  statusKind: string;
  onClick: () => void;
  onDelete: () => void;
  /** Present when this row can be renamed in place. Titles are display, ids are
   * identity — a rename never touches the id
   * (docs/CAMPAIGN_NAMING_FIX_SPEC.md §3d). */
  onRename?: (title: string) => void | Promise<void>;
  deleteLabel: string;
}) {
  const shownTags = (tags ?? []).filter((t): t is string => !!t);
  // A blank title used to render as literally nothing, so two unnamed campaigns
  // were indistinguishable rows (docs/CAMPAIGN_NAMING_FIX_SPEC.md §2c). The
  // fallback reads as a fallback — muted italic — so it is never mistaken for a
  // name someone chose. The meta line already carries the date and type, which is
  // what tells two untitled entries apart.
  const shown = displayTitle(title);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = () => {
    const next = draft.trim();
    setRenaming(false);
    if (next && next !== title.trim()) void onRename?.(next);
  };

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className={`group relative flex flex-col gap-1.5 p-3 rounded-md border cursor-pointer text-left transition-[background-color,border-color,box-shadow] duration-150 focus:outline-none focus-visible:border-accent ${
        active
          ? "border-accent-200 border-l-2 border-l-accent bg-accent-50"
          : "border-line hover:border-line-strong bg-surface hover:shadow-card"
      }`}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 shrink-0 ${active ? "text-accent" : "text-ink-muted"}`}>{glyph}</span>
        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setRenaming(false);
            }}
            onBlur={commit}
            placeholder="Name this campaign"
            aria-label="Campaign name"
            className="flex-1 min-w-0 text-sm font-medium text-ink bg-surface border border-accent rounded px-1.5 py-0.5 focus:outline-none placeholder:font-normal placeholder:italic placeholder:text-ink-muted"
          />
        ) : (
          <div className={`text-sm flex-1 break-words leading-snug pr-4 ${
            shown.isFallback ? "font-normal italic text-ink-muted" : "font-medium text-ink"}`}>
            {shown.text}
          </div>
        )}
        <StatusChip kind={statusKind} />
      </div>
      <div className="text-xs text-ink-tertiary tabular-nums">{metaLine}</div>
      {subtitle && <div className="text-xs text-ink-secondary line-clamp-2 leading-relaxed">{subtitle}</div>}
      {shownTags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-0.5">
          {shownTags.map((t) => (
            <span key={t} className="text-[10px] font-medium text-ink-muted bg-chrome border border-line rounded-full px-1.5 py-0.5">
              {t}
            </span>
          ))}
        </div>
      )}
      <div className="absolute bottom-2 right-2 flex items-center gap-2">
        {onRename && !renaming && (
          <button
            onClick={(e) => { e.stopPropagation(); setDraft(title.trim()); setRenaming(true); }}
            aria-label="Rename campaign"
            title="Rename campaign"
            // Persistent on an untitled row: that is exactly when it is needed, and
            // hover-only is how the existing rename control stayed hidden.
            className={`transition-opacity text-[11px] ${
              shown.isFallback
                ? "opacity-100 text-accent hover:underline"
                : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-ink-tertiary hover:text-ink"
            }`}
          >
            Rename
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          aria-label={deleteLabel}
          title={deleteLabel}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-ink-tertiary hover:text-danger-600 transition-opacity text-xs"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default function LibraryBrowser({
  libraryItems, savedItems, smsItems = [],
  onLoadSaved, onDeleteSaved, onViewLibrary, onDeleteLibrary, onRenameLibrary, onLoadSms, onDeleteSms,
  activeSavedId, activeLibraryId, activeSmsId,
}: Props) {
  // Until the writer picks a tab, land on the first one that has anything —
  // opening the browser onto an empty "Drafts" while 37 library campaigns sit
  // one click away is exactly the "I can't see my campaigns" problem again.
  const [pickedTab, setPickedTab] = useState<Tab | null>(null);
  const tab: Tab = pickedTab ?? (savedItems.length ? "drafts" : libraryItems.length ? "library" : "drafts");
  const setTab = setPickedTab;
  const [query, setQuery] = useState("");

  const terms = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);

  // Search spans every list, and the tab counts show WHERE the matches are — so
  // a search never hides its own answer behind an unselected tab.
  const drafts = useMemo(
    () => savedItems.filter((i) => matches([i.campaign_name, i.campaign_type, i.offer, i.status, i.audience, i.promo_code], terms)),
    [savedItems, terms]
  );
  const library = useMemo(
    () => libraryItems.filter((i) => matches([i.title, i.campaign_type, i.offer, i.conceit, i.audience, i.promo_code, i.date], terms)),
    [libraryItems, terms]
  );
  const sms = useMemo(
    () => smsItems.filter((i) => matches([i.name, i.status], terms)),
    [smsItems, terms]
  );

  const counts: Record<Tab, number> = { drafts: drafts.length, library: library.length, sms: sms.length };
  const searching = terms.length > 0;
  const totalMatches = counts.drafts + counts.library + counts.sms;
  // Searching with nothing in the current tab but hits elsewhere: point there.
  const elsewhere = (["drafts", "library", "sms"] as Tab[]).filter((t) => t !== tab && counts[t] > 0);

  const TABS: { key: Tab; label: string; total: number }[] = [
    { key: "drafts", label: "Drafts", total: savedItems.length },
    { key: "library", label: "Library", total: libraryItems.length },
    { key: "sms", label: "SMS", total: smsItems.length },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Sticky controls: search first, then the three lists as tabs */}
      <div className="shrink-0 border-b border-line px-5 py-3 bg-surface">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none"><SearchGlyph /></span>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search campaigns — name, offer, angle, audience…"
            aria-label="Search campaigns"
            className="w-full text-sm bg-surface border border-line rounded-md pl-9 pr-16 py-2 focus:outline-none focus:border-accent transition-colors"
          />
          {searching && (
            <button type="button" onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ink-muted hover:text-ink px-1.5 py-1 transition-colors">
              Clear ✕
            </button>
          )}
        </div>

        <div className="flex items-center gap-5 mt-3">
          {TABS.map(({ key, label, total }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`relative pb-2 text-sm font-medium transition-colors ${tab === key ? "text-ink" : "text-ink-muted hover:text-ink-secondary"}`}
            >
              <span className="inline-flex items-center gap-1.5">
                {key === "sms" ? <PhoneGlyph /> : <MailGlyph />}
                {label}
                <span className="font-normal text-ink-muted tabular-nums">
                  {searching ? `${counts[key]}/${total}` : total}
                </span>
              </span>
              {tab === key && <span aria-hidden className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-accent" />}
            </button>
          ))}
          <Link href="/flows" className="ml-auto text-[11px] font-medium text-ink-muted hover:text-accent transition-colors pb-2">
            Flows →
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {searching && (
          <div className="text-xs text-ink-muted mb-3">
            {totalMatches} match{totalMatches === 1 ? "" : "es"} for “{query.trim()}”
            {counts[tab] === 0 && elsewhere.length > 0 && (
              <> — none in {tab === "sms" ? "SMS" : tab}, but{" "}
                {elsewhere.map((t, i) => (
                  <span key={t}>
                    {i > 0 && " and "}
                    <button type="button" onClick={() => setTab(t)} className="font-medium text-accent hover:underline">
                      {counts[t]} in {t === "sms" ? "SMS" : t}
                    </button>
                  </span>
                ))}
              </>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
          {tab === "drafts" && drafts.map((item) => (
            <BrowseCard
              key={item.id}
              active={activeSavedId === item.id}
              glyph={<MailGlyph />}
              title={item.campaign_name}
              metaLine={[item.campaign_type, shortDate(item.updated_at)].filter(Boolean).join(" · ")}
              subtitle={item.offer || undefined}
              tags={[audienceLabel(item.audience), item.promo_code]}
              statusKind={item.status}
              onClick={() => onLoadSaved(item.id)}
              onDelete={() => onDeleteSaved(item.id)}
              deleteLabel="Delete draft"
            />
          ))}

          {tab === "library" && library.map((item) => (
            <BrowseCard
              key={item.id}
              active={activeLibraryId === item.id}
              glyph={<MailGlyph />}
              title={item.title}
              metaLine={[shortDate(item.date), item.campaign_type].filter(Boolean).join(" · ")}
              subtitle={item.conceit && item.conceit !== "[FILL ME IN]" ? item.conceit : item.offer || undefined}
              tags={[audienceLabel(item.audience), item.promo_code]}
              statusKind="library"
              onClick={() => onViewLibrary(item.id)}
              onDelete={() => onDeleteLibrary(item.id)}
              onRename={onRenameLibrary ? (t) => onRenameLibrary(item.id, t) : undefined}
              deleteLabel="Remove from library"
            />
          ))}

          {tab === "sms" && sms.map((item) => (
            <BrowseCard
              key={item.id}
              active={activeSmsId === item.id}
              glyph={<PhoneGlyph />}
              title={item.name}
              metaLine={shortDate(item.updated_at) ?? "sms"}
              statusKind={item.status}
              onClick={() => onLoadSms?.(item.id)}
              onDelete={() => onDeleteSms?.(item.id)}
              deleteLabel="Delete SMS campaign"
            />
          ))}
        </div>

        {counts[tab] === 0 && (
          <EmptyState
            className="py-14"
            title={
              searching
                ? `No ${tab === "sms" ? "SMS campaigns" : tab} match “${query.trim()}”`
                : tab === "drafts" ? "No saved drafts yet"
                : tab === "library" ? "Nothing in the library yet"
                : "No SMS campaigns yet"
            }
            description={
              searching
                ? "Try a shorter term, a product name, or the offer."
                : tab === "drafts" ? "Drafts you save from the canvas land here."
                : tab === "library" ? "Campaigns you finalize are kept here as reference for future copy."
                : "SMS copy you save lands here."
            }
          />
        )}
      </div>
    </div>
  );
}
