"use client";
import { useState } from "react";
import Link from "next/link";
import EmptyState from "./ui/EmptyState";

// Phase 3 (spec: FLOWS_COPY_ENGINE_SPEC.md §5) — the browse redesign. Replaces
// the old flat 3-tab strip (Saved / Library / SMS) of truncated one-liners with
// a CHANNEL-FIRST browser: Email and SMS as first-class modes, the Draft/Library
// distinction demoted to a facet within Email, and richer cards that show
// substance (channel glyph, type, status, date, audience, offer/idea) instead of
// a glimpse. Flows are their own surface (/flows) — linked from the header so the
// Email / SMS / Flows separation reads at a glance. Props/handlers are unchanged.

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
  onLoadSms?: (id: string) => void;
  onDeleteSms?: (id: string) => void;
  activeSavedId?: string | null;
  activeLibraryId?: string | null;
  activeSmsId?: string | null;
}

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

function StatusChip({ kind }: { kind: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: "Draft", cls: "bg-warning-50 text-warning-600" },
    final: { label: "Final", cls: "bg-success-50 text-success-600" },
    library: { label: "Library", cls: "bg-info-50 text-info-600" },
  };
  const m = map[kind] ?? { label: kind, cls: "bg-sunken text-ink-tertiary" };
  return <span className={`text-[10px] font-semibold tracking-wide rounded px-1.5 py-0.5 shrink-0 ${m.cls}`}>{m.label}</span>;
}

// One browse card — channel glyph + title + a meta row + optional idea/offer +
// audience chip. `active` gets the accent treatment; delete reveals on hover.
function BrowseCard({
  active, glyph, title, metaLine, subtitle, audience, statusKind, onClick, onDelete, deleteLabel,
}: {
  active: boolean;
  glyph: React.ReactNode;
  title: string;
  metaLine: string;
  subtitle?: string;
  audience?: string | null;
  statusKind: string;
  onClick: () => void;
  onDelete: () => void;
  deleteLabel: string;
}) {
  return (
    <div
      onClick={onClick}
      className={`group flex items-start gap-2.5 p-2.5 rounded-md border cursor-pointer transition-[background-color,border-color] duration-150 ${
        active
          ? "border-accent-200 border-l-2 border-l-accent bg-accent-50"
          : "border-line hover:border-line-strong bg-surface hover:bg-chrome"
      }`}
    >
      <span className={`mt-0.5 shrink-0 ${active ? "text-accent" : "text-ink-muted"}`}>{glyph}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-ink truncate flex-1">{title}</div>
          <StatusChip kind={statusKind} />
        </div>
        <div className="text-xs text-ink-tertiary mt-0.5 truncate">{metaLine}</div>
        {subtitle && <div className="text-xs text-ink-tertiary mt-0.5 line-clamp-2">{subtitle}</div>}
        {audience && (
          <span className="inline-block mt-1 text-[10px] font-medium text-ink-muted bg-chrome border border-line rounded-full px-1.5 py-0.5">
            {audience}
          </span>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        aria-label={deleteLabel}
        title={deleteLabel}
        className="opacity-40 group-hover:opacity-100 focus-visible:opacity-100 text-ink-tertiary hover:text-danger-600 transition-opacity text-xs shrink-0 mt-0.5"
      >
        ✕
      </button>
    </div>
  );
}

export default function Sidebar({
  libraryItems, savedItems, smsItems = [],
  onLoadSaved, onDeleteSaved, onViewLibrary, onDeleteLibrary, onLoadSms, onDeleteSms,
  activeSavedId, activeLibraryId, activeSmsId,
}: Props) {
  const [mode, setMode] = useState<"email" | "sms">("email");
  const [emailSource, setEmailSource] = useState<"drafts" | "library">("drafts");
  const [libraryFilter, setLibraryFilter] = useState("");

  const emailCount = savedItems.length + libraryItems.length;

  const filteredLibrary = libraryItems.filter(
    (item) =>
      !libraryFilter ||
      item.title.toLowerCase().includes(libraryFilter.toLowerCase()) ||
      item.campaign_type.toLowerCase().includes(libraryFilter.toLowerCase()) ||
      item.conceit.toLowerCase().includes(libraryFilter.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-4">
        <div className="flex items-center justify-between mb-3">
          <div className="t-label">Copy Builder</div>
          <Link href="/flows" className="text-[11px] font-medium text-ink-muted hover:text-accent transition-colors">Flows →</Link>
        </div>

        {/* Channel-first segmented control */}
        <div className="flex gap-1 p-0.5 rounded-md bg-chrome border border-line">
          {([["email", "Email", emailCount], ["sms", "SMS", smsItems.length]] as const).map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-[5px] py-1.5 text-sm font-medium transition-colors ${
                mode === key ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink-secondary"
              }`}
            >
              {key === "email" ? <MailGlyph /> : <PhoneGlyph />}
              {label} <span className="font-normal text-ink-muted">({count})</span>
            </button>
          ))}
        </div>

        {/* Email source facet (Draft/Library demoted from a top tab) */}
        {mode === "email" && (
          <div className="flex gap-4 border-b border-line mt-3">
            {([["drafts", "Drafts", savedItems.length], ["library", "Library", libraryItems.length]] as const).map(([key, label, count]) => (
              <button
                key={key}
                onClick={() => setEmailSource(key)}
                className={`relative pb-2 text-sm font-medium transition-colors ${emailSource === key ? "text-ink" : "text-ink-muted hover:text-ink-secondary"}`}
              >
                {label} <span className="font-normal text-ink-muted">({count})</span>
                {emailSource === key && <span aria-hidden className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-accent" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {mode === "email" && emailSource === "library" && (
        <div className="px-3 pt-3">
          <input
            value={libraryFilter}
            onChange={(e) => setLibraryFilter(e.target.value)}
            placeholder="Filter…"
            className="w-full text-sm border border-line rounded-sm px-2 py-1.5 bg-surface focus:outline-none focus:border-accent transition-colors"
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 pt-3 pb-4 space-y-1.5">
        {/* Email · Drafts */}
        {mode === "email" && emailSource === "drafts" && (
          <>
            {savedItems.length === 0 && <EmptyState className="py-10" title="No saved campaigns yet" />}
            {savedItems.map((item) => (
              <BrowseCard
                key={item.id}
                active={activeSavedId === item.id}
                glyph={<MailGlyph />}
                title={item.campaign_name}
                metaLine={[item.campaign_type, shortDate(item.updated_at)].filter(Boolean).join(" · ")}
                subtitle={item.offer || undefined}
                audience={audienceLabel(item.audience)}
                statusKind={item.status}
                onClick={() => onLoadSaved(item.id)}
                onDelete={() => onDeleteSaved(item.id)}
                deleteLabel="Delete draft"
              />
            ))}
          </>
        )}

        {/* Email · Library */}
        {mode === "email" && emailSource === "library" && (
          <>
            {filteredLibrary.length === 0 && <EmptyState className="py-10" title="No library campaigns found" />}
            {filteredLibrary.map((item) => (
              <BrowseCard
                key={item.id}
                active={activeLibraryId === item.id}
                glyph={<MailGlyph />}
                title={item.title}
                metaLine={[shortDate(item.date), item.campaign_type].filter(Boolean).join(" · ")}
                subtitle={item.conceit && item.conceit !== "[FILL ME IN]" ? item.conceit : item.offer || undefined}
                audience={audienceLabel(item.audience)}
                statusKind="library"
                onClick={() => onViewLibrary(item.id)}
                onDelete={() => onDeleteLibrary(item.id)}
                deleteLabel="Remove from library"
              />
            ))}
          </>
        )}

        {/* SMS */}
        {mode === "sms" && (
          <>
            {smsItems.length === 0 && <EmptyState className="py-10" title="No SMS campaigns yet" />}
            {smsItems.map((item) => (
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
          </>
        )}
      </div>
    </div>
  );
}
