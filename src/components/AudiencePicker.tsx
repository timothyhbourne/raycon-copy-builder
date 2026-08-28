"use client";
import { useEffect, useMemo, useState } from "react";
import type { AudienceRef } from "@/lib/planner-types";
import type { AudienceItem } from "@/lib/klaviyo";
import Button from "./ui/Button";
import { toast } from "./ui/Toast";

// The audience brief picker (spec: PLANNER_AUDIENCE_BRIEF_SPEC.md §5.1).
//
// This is the control the whole spec exists for: the planner had no way to CHOOSE
// an audience at all, only to record what Klaviyo had already done. It reads the
// synced catalogue (/api/klaviyo/audiences — a store read, zero Klaviyo calls), so
// it opens instantly instead of paying 36 sequential requests on a cold lambda.

export interface AudienceCatalogueState {
  audiences: AudienceItem[];
  synced_at: string | null;
  truncated: boolean;
  empty?: boolean;
}

/** Compact profile count. A segment's size is the main thing that makes this
 * choice hard, so it has to be readable at a glance. */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

function shortTime(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "unknown";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** One shared fetch of the catalogue for every picker on screen. */
export function useAudienceCatalogue(): {
  state: AudienceCatalogueState | null;
  loading: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<AudienceCatalogueState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const res = await fetch("/api/klaviyo/audiences");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load audiences");
      setState(json as AudienceCatalogueState);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load the audience list.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/klaviyo/audiences/sync", { method: "POST" });
      const json = await res.json();
      if (res.status === 429) { toast.info(json.error || "Just refreshed — try again shortly."); return; }
      if (!res.ok) throw new Error(json.error || "Refresh failed");
      await load();
      toast.success(`Audiences refreshed — ${json.audiences} found`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  return { state, loading, refreshing, refresh };
}

interface Props {
  catalogue: AudienceCatalogueState | null;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  included: AudienceRef[];
  excluded: AudienceRef[];
  onChangeIncluded: (next: AudienceRef[]) => void;
  onChangeExcluded: (next: AudienceRef[]) => void;
  note: string;
  onChangeNote: (next: string) => void;
}

const toRef = (a: AudienceItem): AudienceRef => ({ id: a.id, name: a.name, type: a.type });

export default function AudiencePicker({
  catalogue, loading, refreshing, onRefresh,
  included, excluded, onChangeIncluded, onChangeExcluded, note, onChangeNote,
}: Props) {
  const [target, setTarget] = useState<"include" | "exclude">("include");
  const [q, setQ] = useState("");

  const chosenIds = useMemo(
    () => new Set([...included, ...excluded].map((a) => a.id || a.name)),
    [included, excluded],
  );

  const matches = useMemo(() => {
    const all = catalogue?.audiences ?? [];
    const needle = q.trim().toLowerCase();
    const pool = needle ? all.filter((a) => a.name.toLowerCase().includes(needle)) : all;
    // Already-chosen entries drop out of the list rather than being clickable
    // no-ops, and the biggest are shown first when nothing is typed: the segment
    // you want is far more often a large one than the 12th alphabetically.
    return pool
      .filter((a) => !chosenIds.has(a.id))
      .sort((a, b) => (needle ? a.name.localeCompare(b.name) : (b.size ?? -1) - (a.size ?? -1) || a.name.localeCompare(b.name)))
      .slice(0, 40);
  }, [catalogue, q, chosenIds]);

  const add = (a: AudienceItem) => {
    const ref = toRef(a);
    if (target === "include") onChangeIncluded([...included, ref]);
    else onChangeExcluded([...excluded, ref]);
    setQ("");
  };
  const removeIncluded = (key: string) => onChangeIncluded(included.filter((a) => (a.id || a.name) !== key));
  const removeExcluded = (key: string) => onChangeExcluded(excluded.filter((a) => (a.id || a.name) !== key));

  const sizeOf = (ref: AudienceRef): number | undefined =>
    catalogue?.audiences.find((a) => a.id === ref.id)?.size;

  const chip = (a: AudienceRef, kind: "in" | "out", onRemove: () => void) => {
    const size = sizeOf(a);
    return (
      <span key={`${kind}-${a.id || a.name}`}
        className="inline-flex items-center gap-1 text-[11px] bg-surface border border-line rounded-sm px-1.5 py-0.5 text-ink-secondary">
        <span className={kind === "in" ? "text-success-600" : "text-danger-600"} aria-hidden>{kind === "in" ? "+" : "−"}</span>
        {a.name}
        {size != null && <span className="text-ink-muted tabular-nums">· {formatCount(size)}</span>}
        <button type="button" onClick={onRemove} aria-label={`Remove ${a.name}`}
          className="text-ink-muted hover:text-danger-600 ml-0.5 leading-none">×</button>
      </span>
    );
  };

  return (
    <div>
      {(included.length > 0 || excluded.length > 0) && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {included.map((a) => chip(a, "in", () => removeIncluded(a.id || a.name)))}
          {excluded.map((a) => chip(a, "out", () => removeExcluded(a.id || a.name)))}
        </div>
      )}

      <div className="flex items-center gap-1.5 mb-1.5">
        {(["include", "exclude"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTarget(t)}
            className={`text-[11px] px-2 py-0.5 rounded-sm border transition-colors ${
              target === t ? "border-accent bg-accent-50 text-accent" : "border-line bg-surface text-ink-secondary hover:border-line-strong"
            }`}
          >
            {t === "include" ? "Include" : "Exclude"}
          </button>
        ))}
        <span className="ml-auto t-label">
          {catalogue?.empty
            ? "not synced yet"
            : `${catalogue?.audiences.length ?? 0} audiences · as of ${shortTime(catalogue?.synced_at ?? null)}`}
        </span>
        <Button size="sm" variant="ghost" loading={refreshing} onClick={onRefresh}
          title="Pull the latest segments and lists from Klaviyo">
          Refresh
        </Button>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={loading ? "Loading audiences…" : `Search segments and lists to ${target}…`}
        disabled={loading}
        className="w-full border border-line rounded-sm px-2 py-1.5 text-sm bg-surface focus:outline-none focus:border-accent transition-colors"
      />

      {/* A missing segment has an obvious explanation and an obvious fix (§4). */}
      {catalogue?.empty && (
        <div className="mt-1.5 text-xs text-ink-muted">
          The audience list hasn&apos;t synced yet. Hit Refresh to pull it now.
        </div>
      )}
      {catalogue?.truncated && (
        <div className="mt-1.5 text-xs text-warning-600">
          Klaviyo returned more audiences than we fetch in one pass — some may be missing from this list.
        </div>
      )}

      {!loading && q.trim() && matches.length === 0 && (
        <div className="mt-1.5 text-xs text-ink-muted">
          Nothing matches “{q.trim()}”. If it was just created in Klaviyo, hit Refresh.
        </div>
      )}

      {matches.length > 0 && (
        <div className="mt-1.5 max-h-56 overflow-y-auto border border-line rounded-sm divide-y divide-line">
          {matches.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => add(a)}
              className="w-full text-left px-2 py-1.5 hover:bg-accent-50 transition-colors flex items-center gap-2"
            >
              <span className="text-[10px] uppercase tracking-wide text-ink-muted w-12 shrink-0">{a.type}</span>
              <span className="text-sm text-ink flex-1 min-w-0 truncate">{a.name}</span>
              <span className="text-xs text-ink-muted tabular-nums shrink-0">
                {a.size != null ? formatCount(a.size) : "—"}
              </span>
            </button>
          ))}
        </div>
      )}

      <input
        value={note}
        onChange={(e) => onChangeNote(e.target.value)}
        placeholder="Note for whoever builds this — e.g. cap at 3 sends/week"
        className="mt-2 w-full border border-line rounded-sm px-2 py-1.5 text-sm bg-surface focus:outline-none focus:border-accent transition-colors"
      />
    </div>
  );
}
