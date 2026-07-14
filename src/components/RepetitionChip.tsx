"use client";
import Chip from "./ui/Chip";
import type { RepetitionFlag } from "@/lib/repetition-client";

// Amber flag shown next to an element the similarity checker couldn't dedupe
// after one auto-retry. Advisory only — never blocks saving. Dismissible.
export default function RepetitionChip({ flag, onDismiss }: { flag: RepetitionFlag; onDismiss: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 align-middle"
      title={`Similar to a past send: "${flag.match_text}" — ${flag.match_campaign_title} (${flag.match_date})`}
    >
      <Chip tone="warning" dot>similar to past send</Chip>
      <button
        onClick={onDismiss}
        aria-label="Dismiss similarity flag"
        className="text-warning-600 hover:text-warning-700 text-xs leading-none px-0.5"
      >
        ×
      </button>
    </span>
  );
}
