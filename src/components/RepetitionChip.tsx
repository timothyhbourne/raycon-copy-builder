"use client";
import Chip from "./ui/Chip";
import type { RepetitionFlag } from "@/lib/repetition-client";

// Amber flag shown next to an element the repetition check couldn't dedupe after
// one auto-retry. Advisory only — never blocks saving. Dismissible.
//
// Two flavours, because they mean different things to a writer: a LEXICAL flag
// says the words are reused; a FORM flag says the construction is reused though
// the words are fresh ("Motion Never Stops" / "Sound Never Quits"). Rewording
// fixes the first and does nothing for the second.
export default function RepetitionChip({ flag, onDismiss }: { flag: RepetitionFlag; onDismiss: () => void }) {
  const isForm = flag.reason === "form";
  return (
    <span
      className="inline-flex items-center gap-1 align-middle"
      title={
        isForm
          ? `Same construction as a past send: "${flag.match_text}" — ${flag.match_campaign_title} (${flag.match_date}). Shared shape: ${flag.construction ?? "same build"}. Rewording won't fix this; build the line differently.`
          : `Similar to a past send: "${flag.match_text}" — ${flag.match_campaign_title} (${flag.match_date})`
      }
    >
      <Chip tone="warning" dot>{isForm ? "same construction" : "similar to past send"}</Chip>
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
