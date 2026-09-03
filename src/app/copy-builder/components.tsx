"use client";
import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { STEP_ORDER, type StepKey } from "./helpers";

// Presentational + isolated pieces of the Copy Builder page, split out of
// page.tsx. None of these touch the page's state directly — they take props —
// so they live here to keep the page component focused on state + wiring.

// Reads the deep-link query params. Isolated into its own component because
// Next 16 requires useSearchParams to sit inside a <Suspense> boundary (a static
// page that calls it otherwise fails the production build). Renders nothing; it
// just fires the callbacks once per distinct param value. Callbacks are read
// through a ref so the effect only runs on real URL changes, not every parent
// re-render (which happens on every streamed token during generation).
export function DeepLinkReader({ onPlanner, onCampaign }: {
  onPlanner: (rowId: string, channel: string | null, variant: string | null) => void;
  onCampaign: (savedId: string) => void;
}) {
  const searchParams = useSearchParams();
  const cbRef = useRef({ onPlanner, onCampaign });
  cbRef.current = { onPlanner, onCampaign };
  const lastConsumed = useRef<string | null>(null);
  useEffect(() => {
    const planner = searchParams.get("planner");
    const campaign = searchParams.get("campaign");
    const channel = searchParams.get("channel");
    const variant = searchParams.get("variant");
    const token = planner ? `p:${planner}:${channel ?? ""}:${variant ?? ""}` : campaign ? `c:${campaign}` : null;
    if (!token || lastConsumed.current === token) return;
    lastConsumed.current = token;
    if (planner) cbRef.current.onPlanner(planner, channel, variant);
    else if (campaign) cbRef.current.onCampaign(campaign);
  }, [searchParams]);
  return null;
}

// Compact Brief → Canvas stepper. Current in accent, completed in ink with a
// check, future muted. Completed steps navigate back where possible.
export function Stepper({ activeKey, canGoBack, onNavigate }: {
  activeKey: StepKey;
  canGoBack: (key: StepKey) => boolean;
  onNavigate: (key: StepKey) => void;
}) {
  const steps: { key: StepKey; label: string }[] = [
    { key: "form", label: "Brief" },
    { key: "canvas", label: "Canvas" },
  ];
  const activeIdx = STEP_ORDER[activeKey];
  return (
    <div className="flex items-center gap-2 text-sm">
      {steps.map((s, i) => {
        const idx = STEP_ORDER[s.key];
        const state = idx < activeIdx ? "done" : idx === activeIdx ? "current" : "future";
        const clickable = state === "done" && canGoBack(s.key);
        return (
          <div key={s.key} className="flex items-center gap-2">
            {clickable ? (
              <button type="button" onClick={() => onNavigate(s.key)} className="flex items-center gap-1.5 hover:opacity-80 transition-opacity">
                <StepDot state={state} index={i} />
                <span className="font-medium text-ink">{s.label}</span>
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <StepDot state={state} index={i} />
                <span className={`font-medium ${state === "current" ? "text-accent" : state === "done" ? "text-ink" : "text-ink-muted"}`}>{s.label}</span>
              </div>
            )}
            {i < steps.length - 1 && <span className="text-ink-muted" aria-hidden>→</span>}
          </div>
        );
      })}
    </div>
  );
}

function StepDot({ state, index }: { state: "done" | "current" | "future"; index: number }) {
  return (
    <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] ${
      state === "current" ? "bg-accent text-white" : state === "done" ? "bg-ink text-white" : "bg-chrome text-ink-muted border border-line"
    }`}>
      {state === "done" ? "✓" : index + 1}
    </span>
  );
}

// Quiet autosave status shown for library canvases in place of the save button.
// mono micro text: "Saving…" → "Saved ✓" (fades to a lone ✓) → "Autosave failed — Retry".
// AutosaveStatus lives in components/ui now: the Flow Builder shows the same
// indicator, and a shared control belongs beside the other shared primitives
// rather than inside one route's helpers. Re-exported so this module stays the
// single import site for the copy-builder page.
export { default as AutosaveStatus } from "@/components/ui/AutosaveStatus";

export function CollapseIcon() {
  return (<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>);
}
export function PanelIcon() {
  return (<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></svg>);
}
// Card-grid glyph for the Library button in the workspace toolbar — it opens a
// grid of campaign cards, so it should read as "browse", not "file away".
export function LibraryIcon() {
  return (<svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></svg>);
}
