"use client";
import { useState } from "react";
import EmptyState from "./ui/EmptyState";

interface LibraryMeta {
  id: string;
  title: string;
  date: string;
  campaign_type: string;
  offer: string;
  conceit: string;
  audience: string;
}

interface SavedMeta {
  id: string;
  campaign_name: string;
  campaign_type: string;
  status: string;
  updated_at: string;
  offer: string;
}

interface Props {
  libraryItems: LibraryMeta[];
  savedItems: SavedMeta[];
  onLoadSaved: (id: string) => void;
  onDeleteSaved: (id: string) => void;
  onViewLibrary: (id: string) => void;
  onDeleteLibrary: (id: string) => void;
  activeSavedId?: string | null;
  activeLibraryId?: string | null;
}

export default function Sidebar({ libraryItems, savedItems, onLoadSaved, onDeleteSaved, onViewLibrary, onDeleteLibrary, activeSavedId, activeLibraryId }: Props) {
  const [tab, setTab] = useState<"saved" | "library">("saved");
  const [libraryFilter, setLibraryFilter] = useState("");

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
        <div className="font-mono text-[10px] text-ink-muted uppercase tracking-wide mb-3">Copy Builder</div>
        <div className="flex gap-4 border-b border-line">
          {([["saved", "Saved", savedItems.length], ["library", "Library", libraryItems.length]] as const).map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`relative pb-2 text-sm font-medium transition-colors ${tab === key ? "text-ink" : "text-ink-muted hover:text-ink-secondary"}`}
            >
              {label} <span className="font-normal text-ink-muted">({count})</span>
              {tab === key && <span aria-hidden className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-accent" />}
            </button>
          ))}
        </div>
      </div>

      {tab === "library" && (
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
        {tab === "saved" && (
          <>
            {savedItems.length === 0 && (
              <EmptyState className="py-10" title="No saved campaigns yet" />
            )}
            {savedItems.map((item) => (
              <div
                key={item.id}
                className={`group flex items-start justify-between gap-2 p-2.5 rounded-md border cursor-pointer transition-[background-color,border-color] duration-150 ${
                  activeSavedId === item.id
                    ? "border-accent-200 border-l-2 border-l-accent bg-accent-50"
                    : "border-line hover:border-line-strong bg-surface hover:bg-chrome"
                }`}
                onClick={() => onLoadSaved(item.id)}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 truncate">{item.campaign_name}</div>
                  <div className="font-mono text-xs text-slate-400 mt-0.5">{item.campaign_type} · {item.status}</div>
                  <div className="text-xs text-slate-400 mt-0.5 truncate">{item.offer}</div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteSaved(item.id); }}
                  aria-label="Delete draft"
                  title="Delete draft"
                  className="opacity-40 group-hover:opacity-100 focus-visible:opacity-100 text-slate-400 hover:text-danger-600 transition-opacity text-xs shrink-0 mt-0.5"
                >
                  ✕
                </button>
              </div>
            ))}
          </>
        )}

        {tab === "library" && (
          <>
            {filteredLibrary.length === 0 && (
              <EmptyState className="py-10" title="No library campaigns found" />
            )}
            {filteredLibrary.map((item) => (
              <div
                key={item.id}
                className={`group flex items-start justify-between gap-2 p-2.5 rounded-md border cursor-pointer transition-[background-color,border-color] duration-150 ${
                  activeLibraryId === item.id
                    ? "border-accent-200 border-l-2 border-l-accent bg-accent-50"
                    : "border-line hover:border-line-strong bg-surface hover:bg-chrome"
                }`}
                onClick={() => onViewLibrary(item.id)}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 truncate">{item.title}</div>
                  <div className="font-mono text-xs text-slate-400 mt-0.5">{item.date} · {item.campaign_type}</div>
                  {item.conceit && item.conceit !== "[FILL ME IN]" && (
                    <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{item.conceit}</div>
                  )}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteLibrary(item.id); }}
                  aria-label="Remove from library"
                  title="Remove from library"
                  className="opacity-40 group-hover:opacity-100 focus-visible:opacity-100 text-slate-400 hover:text-danger-600 transition-opacity text-xs shrink-0 mt-0.5"
                >
                  ✕
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
