"use client";
import { useState, useEffect } from "react";
import type { SmsBrief } from "@/lib/schemas";
import Button from "@/components/ui/Button";

const LABEL = "block font-mono text-xs text-ink-secondary uppercase tracking-wide mb-1";
const INPUT = "w-full border border-line rounded-sm px-3 py-2 text-sm bg-surface focus:outline-none focus:border-accent transition-colors";

// One selectable email campaign to distill an SMS from.
export interface EmailSource {
  id: string;
  name: string;
  date: string;
  type: string;
  offer: string;
  promo_code?: string;
  kind: "library" | "draft";
}

export interface SmsGenerateArgs {
  brief: SmsBrief;
  sourceEmailId?: string;
  entry: "email" | "scratch";
}

interface Props {
  emailSources: EmailSource[];
  loading: boolean;
  /** Planner handoff / reload prefill. */
  seedBrief?: SmsBrief | null;
  seedSourceId?: string | null;
  onGenerate: (args: SmsGenerateArgs) => void;
}

const EMPTY: SmsBrief = { name: "", offer: "", promo_code: "", deadline: "", angle: "", audience: "" };

export default function SmsForm({ emailSources, loading, seedBrief, seedSourceId, onGenerate }: Props) {
  const [entry, setEntry] = useState<"email" | "scratch">(seedSourceId ? "email" : "scratch");
  const [brief, setBrief] = useState<SmsBrief>(seedBrief ? { ...EMPTY, ...seedBrief } : EMPTY);
  const [sourceId, setSourceId] = useState<string | null>(seedSourceId ?? null);
  const [filter, setFilter] = useState("");

  // Re-seed when the parent hands in a new prefill (planner deep-link, reload).
  useEffect(() => {
    if (seedBrief) setBrief({ ...EMPTY, ...seedBrief });
    if (seedSourceId !== undefined && seedSourceId !== null) {
      setSourceId(seedSourceId);
      setEntry("email");
    }
  }, [seedBrief, seedSourceId]);

  const set = (k: keyof SmsBrief) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setBrief((b) => ({ ...b, [k]: e.target.value }));

  const pickSource = (s: EmailSource) => {
    setSourceId(s.id);
    // Pre-fill the brief from the entry's fields where available.
    setBrief((b) => ({
      ...b,
      name: b.name || s.name,
      offer: s.offer || b.offer,
      promo_code: s.promo_code ?? b.promo_code,
    }));
  };

  const filtered = emailSources.filter(
    (s) =>
      !filter ||
      s.name.toLowerCase().includes(filter.toLowerCase()) ||
      s.type.toLowerCase().includes(filter.toLowerCase())
  );

  const canGenerate =
    !loading && brief.offer.trim().length > 0 && (entry === "scratch" || !!sourceId);

  const submit = () => {
    if (!canGenerate) return;
    onGenerate({ brief, sourceEmailId: entry === "email" ? sourceId ?? undefined : undefined, entry });
  };

  return (
    <div className="space-y-4">
      {/* Entry toggle */}
      <div className="flex gap-1 p-0.5 rounded-md bg-chrome border border-line">
        {(["email", "scratch"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setEntry(k)}
            className={`flex-1 text-xs font-medium py-1.5 rounded-sm transition-colors ${
              entry === k ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink-secondary"
            }`}
          >
            {k === "email" ? "From email campaign" : "From scratch"}
          </button>
        ))}
      </div>

      {entry === "email" && (
        <div className="space-y-2">
          <label className={LABEL}>Source email</label>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search campaigns…"
            className={INPUT}
          />
          <div className="max-h-52 overflow-y-auto space-y-1.5 pr-0.5">
            {filtered.length === 0 && (
              <div className="text-xs text-ink-muted py-4 text-center">No campaigns found.</div>
            )}
            {filtered.map((s) => (
              <button
                key={`${s.kind}-${s.id}`}
                type="button"
                onClick={() => pickSource(s)}
                className={`w-full text-left p-2.5 rounded-md border transition-[background-color,border-color] duration-150 ${
                  sourceId === s.id
                    ? "border-accent-200 border-l-2 border-l-accent bg-accent-50"
                    : "border-line hover:border-line-strong bg-surface hover:bg-chrome"
                }`}
              >
                <div className="text-sm font-medium text-slate-900 truncate">{s.name}</div>
                <div className="font-mono text-xs text-slate-400 mt-0.5">
                  {s.date} · {s.type} · {s.kind}
                </div>
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-muted leading-relaxed">
            Picking a campaign pre-fills the brief below. Generation distills its offer, hook, and deadline into SMS.
          </p>
        </div>
      )}

      {/* Brief fields — shared by both entry modes (from-email pre-fills them). */}
      <div>
        <label className={LABEL}>Campaign name</label>
        <input value={brief.name ?? ""} onChange={set("name")} placeholder="e.g. Flash sale last call" className={INPUT} />
      </div>
      <div>
        <label className={LABEL}>Offer *</label>
        <input value={brief.offer} onChange={set("offer")} placeholder="e.g. 30% off the Fitness Earbuds" className={INPUT} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Promo code</label>
          <input value={brief.promo_code ?? ""} onChange={set("promo_code")} placeholder="FLASH30" className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>Deadline</label>
          <input value={brief.deadline ?? ""} onChange={set("deadline")} placeholder="Ends Sunday" className={INPUT} />
        </div>
      </div>
      <div>
        <label className={LABEL}>Angle / hook</label>
        <textarea value={brief.angle ?? ""} onChange={set("angle")} rows={2} placeholder="The occasion or reason behind the send" className={`${INPUT} resize-none`} />
      </div>
      <div>
        <label className={LABEL}>Audience note</label>
        <input value={brief.audience ?? ""} onChange={set("audience")} placeholder="e.g. engaged subscribers" className={INPUT} />
      </div>

      <Button variant="primary" className="w-full" loading={loading} disabled={!canGenerate} onClick={submit}>
        Generate SMS
      </Button>
    </div>
  );
}
