"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Modal from "./ui/Modal";
import Chip from "./ui/Chip";
import SkeletonBlock from "./ui/Skeleton";
import { smsLength } from "@/lib/sms-format";
import { SMS_VARIANT_LABELS } from "@/lib/schemas";

// Full-copy document viewer: a clean, read-only, Google-Docs-like view of a
// linked campaign's complete copy, layered over the planner. Fetches fresh on
// every open (?full=1) so copy-builder edits project through immediately. Strictly
// read-only — plain text nodes only, selectable for copy-paste.

interface FullElement { label: string; value: string }
interface FullProduct { name: string; one_liner: string; cta: string }
interface FullSection {
  type: string;
  elements: FullElement[];
  products?: FullProduct[];
  grid_cols?: number;
  grid_rows?: number;
}
interface CopyFull {
  id: string;
  source: "draft" | "library" | "sms";
  campaign_name: string;
  updated_at: string;
  conceit_name?: string;
  subject_lines: string[];
  preview_texts: string[];
  sections: FullSection[];
  // SMS-only: the three variants and which one ships.
  kind?: "sms";
  variants?: { text: string }[];
  selected_variant?: number;
}

const microLabel = "font-mono text-[10px] text-ink-muted uppercase tracking-wider";

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return iso;
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function CopyDocModal({ copyId, status, onClose, onStale }: {
  copyId: string;
  status?: "draft" | "final";
  onClose: () => void;
  onStale?: () => void;
}) {
  const [data, setData] = useState<CopyFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await fetch(`/api/planner/copy?id=${encodeURIComponent(copyId)}&full=1`);
        if (res.status === 404) {
          if (!cancelled) setError("This copy no longer exists. It may have been deleted.");
          onStale?.();
          return;
        }
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || "Failed to load copy");
        if (!cancelled) setData(j as CopyFull);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load copy");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copyId]);

  const cols = (s: FullSection) => Math.max(1, s.grid_cols ?? 2);

  return (
    <Modal open size="document" onClose={onClose}>
      {/* Header (fixed) */}
      <div className="flex items-start gap-4 px-10 pt-7 pb-4 border-b border-line shrink-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-2xl font-semibold text-ink tracking-tight truncate">
              {data?.campaign_name ?? (loading ? "Loading…" : "Copy")}
            </h2>
            {status && <Chip tone={status === "final" ? "success" : "warning"}>{status}</Chip>}
          </div>
          {data && <div className="text-xs text-ink-muted mt-1">Updated {relativeTime(data.updated_at)}</div>}
        </div>
        <div className="flex items-center gap-4 shrink-0 pt-1">
          <Link href={`/copy-builder?campaign=${copyId}`} className="text-[12px] text-accent hover:underline whitespace-nowrap">Edit in Copy Builder →</Link>
          <button onClick={onClose} aria-label="Close" title="Close (Esc)" className="text-ink-muted hover:text-ink text-lg leading-none transition-colors">✕</button>
        </div>
      </div>

      {/* Document body (scrolls) */}
      <div className="flex-1 overflow-y-auto px-10 py-8">
        {loading ? (
          <div className="space-y-6">
            <SkeletonBlock className="h-7 w-2/3" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2">
                <SkeletonBlock className="h-3 w-24" />
                <SkeletonBlock className="h-4 w-full" />
                <SkeletonBlock className="h-4 w-5/6" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-10">
            <div className="text-sm text-ink-secondary mb-4">{error}</div>
            <button onClick={onClose} className="text-sm text-accent hover:underline">Close</button>
          </div>
        ) : data?.kind === "sms" && data.variants ? (
          <div className="space-y-3">
            {data.variants.map((v, i) => {
              const { chars, encoding, segments } = smsLength(v.text);
              const selected = data.selected_variant === i;
              return (
                <div
                  key={i}
                  className={`rounded-md border p-4 ${selected ? "border-accent-200 border-l-2 border-l-accent bg-accent-50" : "border-line"}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className={microLabel}>{SMS_VARIANT_LABELS[i] ?? `Variant ${i + 1}`}</span>
                    {selected && <Chip tone="accent">selected</Chip>}
                  </div>
                  <div className="text-[15px] text-ink leading-relaxed whitespace-pre-line">{v.text}</div>
                  <div className="mt-2 pt-2 border-t border-line font-mono text-[11px] text-ink-muted">
                    {chars} · {encoding} · {segments} segment{segments === 1 ? "" : "s"}
                  </div>
                </div>
              );
            })}
          </div>
        ) : data ? (
          <>
            {/* Meta */}
            {data.subject_lines.length > 0 && (
              <div className="mb-6">
                <div className={microLabel}>Subject Lines</div>
                <ol className="mt-1.5 space-y-1 list-decimal list-inside marker:text-ink-muted marker:font-mono marker:text-xs">
                  {data.subject_lines.map((s, i) => <li key={i} className="text-[15px] text-ink leading-relaxed">{s}</li>)}
                </ol>
              </div>
            )}
            {data.preview_texts.length > 0 && (
              <div className="mb-8">
                <div className={microLabel}>Preview Texts</div>
                <ol className="mt-1.5 space-y-1 list-decimal list-inside marker:text-ink-muted marker:font-mono marker:text-xs">
                  {data.preview_texts.map((p, i) => <li key={i} className="text-[15px] text-ink-secondary leading-relaxed">{p}</li>)}
                </ol>
              </div>
            )}

            {/* Sections in order */}
            <div>
              {data.sections.map((s, i) => (
                <section key={i} className={i > 0 ? "border-t border-line pt-6 mt-6" : ""}>
                  {s.elements.map((el, j) => (
                    <div key={j} className="mb-4 last:mb-0">
                      <div className={microLabel}>{el.label}</div>
                      <div className="text-[15px] text-ink leading-relaxed whitespace-pre-line mt-1">{el.value}</div>
                    </div>
                  ))}
                  {s.products && s.products.length > 0 && (
                    <div className="mt-3 grid gap-4" style={{ gridTemplateColumns: `repeat(${cols(s)}, minmax(0, 1fr))` }}>
                      {s.products.map((p, k) => (
                        <div key={k} className="border border-line rounded-md p-4">
                          <div className="text-[15px] font-semibold text-ink">{p.name}</div>
                          {p.one_liner && <div className="text-sm text-ink-secondary leading-relaxed mt-1.5">{p.one_liner}</div>}
                          {p.cta && <div className="text-sm text-ink-muted italic mt-1.5">{p.cta}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>

            {/* Conceit — quiet footer */}
            {data.conceit_name && (
              <div className="mt-10 pt-4 border-t border-line text-xs text-ink-muted">Conceit: {data.conceit_name}</div>
            )}
          </>
        ) : null}
      </div>
    </Modal>
  );
}
