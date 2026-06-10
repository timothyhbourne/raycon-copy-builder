"use client";
import { useState } from "react";

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
}

export default function Sidebar({ libraryItems, savedItems, onLoadSaved, onDeleteSaved, onViewLibrary, onDeleteLibrary }: Props) {
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
      <div className="px-3 pt-4 pb-2">
        <div className="font-mono text-xs text-slate-500 uppercase tracking-wide mb-3">Raycon Copy Builder</div>
        <div className="flex rounded-md border border-slate-200 overflow-hidden">
          <button
            onClick={() => setTab("saved")}
            className={`flex-1 text-xs py-1.5 font-medium transition-colors ${tab === "saved" ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
          >
            Saved ({savedItems.length})
          </button>
          <button
            onClick={() => setTab("library")}
            className={`flex-1 text-xs py-1.5 font-medium transition-colors ${tab === "library" ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
          >
            Library ({libraryItems.length})
          </button>
        </div>
      </div>

      {tab === "library" && (
        <div className="px-3 pb-2">
          <input
            value={libraryFilter}
            onChange={(e) => setLibraryFilter(e.target.value)}
            placeholder="Filter..."
            className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-slate-400 bg-white"
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-1.5">
        {tab === "saved" && (
          <>
            {savedItems.length === 0 && (
              <div className="text-xs text-slate-400 text-center py-8">No saved campaigns yet</div>
            )}
            {savedItems.map((item) => (
              <div
                key={item.id}
                className="group flex items-start justify-between gap-2 p-2.5 rounded-md border border-slate-100 hover:border-slate-300 bg-white hover:bg-slate-50 cursor-pointer transition-all"
                onClick={() => onLoadSaved(item.id)}
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-900 truncate">{item.campaign_name}</div>
                  <div className="font-mono text-xs text-slate-400 mt-0.5">{item.campaign_type} · {item.status}</div>
                  <div className="text-xs text-slate-400 mt-0.5 truncate">{item.offer}</div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteSaved(item.id); }}
                  className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-all text-xs shrink-0 mt-0.5"
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
              <div className="text-xs text-slate-400 text-center py-8">No library campaigns found</div>
            )}
            {filteredLibrary.map((item) => (
              <div
                key={item.id}
                className="group flex items-start justify-between gap-2 p-2.5 rounded-md border border-slate-100 hover:border-slate-300 bg-white hover:bg-slate-50 cursor-pointer transition-all"
                onClick={() => onViewLibrary(item.id)}
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-900 truncate">{item.title}</div>
                  <div className="font-mono text-xs text-slate-400 mt-0.5">{item.date} · {item.campaign_type}</div>
                  {item.conceit && item.conceit !== "[FILL ME IN]" && (
                    <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{item.conceit}</div>
                  )}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteLibrary(item.id); }}
                  className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-all text-xs shrink-0 mt-0.5"
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
