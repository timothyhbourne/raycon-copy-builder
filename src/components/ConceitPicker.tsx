"use client";
import type { Conceit, ConceitArchitecture } from "@/lib/schemas";
import Button from "./ui/Button";
import Chip from "./ui/Chip";
import Skeleton from "./ui/Skeleton";

const ARCH_LABEL: Record<ConceitArchitecture, string> = {
  offer_led: "Offer-led",
  story_led: "Story-led",
  product_truth_led: "Product-truth-led",
};

interface Props {
  conceits: Conceit[];
  chosen: Conceit | null;
  onPick: (c: Conceit) => void;
  loading?: boolean;
  onShuffle?: () => void;
}

export default function ConceitPicker({ conceits, chosen, onPick, loading = false, onShuffle }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="t-label">Choose a conceit</p>
        {onShuffle && !loading && (
          <Button variant="secondary" size="sm" onClick={onShuffle}>Shuffle conceits</Button>
        )}
      </div>

      {loading
        ? [0, 1, 2].map((i) => (
            <div key={i} className="rounded-md border border-line bg-surface p-4 space-y-2.5">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          ))
        : conceits.map((c, i) => {
            const selected = chosen?.id === c.id;
            return (
              <button
                key={c.id}
                onClick={() => onPick(c)}
                style={{ animationDelay: `${i * 60}ms` }}
                className={`rc-animate-rise w-full text-left p-4 rounded-md border transition-[transform,border-color,box-shadow] duration-150 ease-out-soft hover:-translate-y-px ${
                  selected
                    ? "border-accent bg-accent-50"
                    : "border-line bg-surface hover:border-line-strong hover:shadow-card"
                }`}
              >
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="font-mono text-xs text-ink-muted tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                  <span className="font-semibold text-base text-ink">{c.name}</span>
                  {c.architecture && <Chip tone="muted" className="ml-auto self-center">{ARCH_LABEL[c.architecture]}</Chip>}
                </div>
                <div className="text-sm text-ink-secondary leading-relaxed">{c.description}</div>
              </button>
            );
          })}
    </div>
  );
}
