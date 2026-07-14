"use client";
import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type {
  BriefInput, ExpandedBrief, Conceit, GeneratedCampaign, GeneratedSection,
  LibraryCampaign, SavedCampaign, SectionType, SectionSpec, SmsCampaign, SmsBrief
} from "@/lib/schemas";
import { SECTION_CATALOGUE } from "@/lib/schemas";
import { smsLength } from "@/lib/sms-format";
import type { PlannerRow } from "@/lib/planner-types";
import { plannerRowToBriefSeed } from "@/lib/planner-copy-link";
import { nanoid } from "@/lib/nanoid";
import { expandProductCardSections } from "@/lib/expand-sections";
import { extractSubheaderVariants } from "@/lib/normalize-section";
import type { CheckElement, CheckMatch } from "@/lib/constructions";
import {
  collectCheckElements, collectMetaElements, collectSectionElements,
  specForSection, targetForKey, type RepetitionFlag,
} from "@/lib/repetition-client";
import InputForm from "@/components/InputForm";
import ConceitPicker from "@/components/ConceitPicker";
import CampaignCanvas from "@/components/CampaignCanvas";
import SmsForm, { type EmailSource, type SmsGenerateArgs } from "@/components/sms/SmsForm";
import SmsCanvas from "@/components/sms/SmsCanvas";
import Sidebar from "@/components/Sidebar";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import EmptyState from "@/components/ui/EmptyState";
import { ConfirmModal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toast";

const LS_DRAFT = "raycon_canvas_draft";

type Stage = "form" | "conceits" | "canvas";

// Where the current canvas content came from
type CanvasSource = "new" | "draft" | "library";

// Planner handoff context, needed for write-back on save. Persisted alongside
// the canvas draft so it survives the generate -> save cycle and a refresh.
interface PlannerLinkContext { rowId: string; name: string; channel: string }

// Reads the deep-link query params. Isolated into its own component because
// Next 16 requires useSearchParams to sit inside a <Suspense> boundary (a static
// page that calls it otherwise fails the production build). Renders nothing; it
// just fires the callbacks once per distinct param value. Callbacks are read
// through a ref so the effect only runs on real URL changes, not every parent
// re-render (which happens on every streamed token during generation).
function DeepLinkReader({ onPlanner, onCampaign }: {
  onPlanner: (rowId: string, channel: string | null) => void;
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
    const token = planner ? `p:${planner}:${channel ?? ""}` : campaign ? `c:${campaign}` : null;
    if (!token || lastConsumed.current === token) return;
    lastConsumed.current = token;
    if (planner) cbRef.current.onPlanner(planner, channel);
    else if (campaign) cbRef.current.onCampaign(campaign);
  }, [searchParams]);
  return null;
}

type StepKey = "form" | "conceits" | "canvas";
const STEP_ORDER: Record<StepKey, number> = { form: 0, conceits: 1, canvas: 2 };

// Compact Brief → Conceit → Canvas stepper. Current in accent, completed in ink
// with a check, future muted. Completed steps navigate back where possible.
function Stepper({ activeKey, canGoBack, onNavigate }: {
  activeKey: StepKey;
  canGoBack: (key: StepKey) => boolean;
  onNavigate: (key: StepKey) => void;
}) {
  const steps: { key: StepKey; label: string }[] = [
    { key: "form", label: "Brief" },
    { key: "conceits", label: "Conceit" },
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
    <span className={`flex items-center justify-center w-5 h-5 rounded-full font-mono text-[10px] ${
      state === "current" ? "bg-accent text-white" : state === "done" ? "bg-ink text-white" : "bg-chrome text-ink-muted border border-line"
    }`}>
      {state === "done" ? "✓" : index + 1}
    </span>
  );
}
// Quiet autosave status shown for library canvases in place of the save button.
// mono micro text: "Saving…" → "Saved ✓" (fades to a lone ✓) → "Autosave failed — Retry".
function AutosaveStatus({ status, onRetry }: {
  status: "idle" | "saving" | "saved" | "check" | "error";
  onRetry: () => void;
}) {
  if (status === "idle") return null;
  if (status === "error") {
    return (
      <div className="flex items-center gap-2 font-mono text-[11px] text-danger-600">
        <span>Autosave failed</span>
        <button
          type="button"
          onClick={onRetry}
          className="px-1.5 py-0.5 rounded-sm border border-danger-200 text-danger-600 hover:bg-danger-50 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }
  if (status === "saving") {
    return (
      <div className="flex items-center gap-1.5 font-mono text-[11px] text-ink-muted">
        <span className="w-3 h-3 rounded-full border-2 border-line border-t-ink-muted animate-spin" aria-hidden />
        Saving…
      </div>
    );
  }
  // "saved" (with label) and "check" (label faded out) share the checkmark.
  return (
    <div className="flex items-center gap-1 font-mono text-[11px] text-ink-muted" aria-live="polite">
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
      {status === "saved" && <span>Saved</span>}
    </div>
  );
}
function CollapseIcon() {
  return (<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>);
}
function PanelIcon() {
  return (<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></svg>);
}

interface LibraryMeta extends Omit<LibraryCampaign, "body"> {}
interface SavedMeta extends Omit<SavedCampaign, "campaign" | "expanded_brief" | "section_structure"> {}

function makeSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function resetState(setters: {
  setStage: (s: Stage) => void;
  setCampaign: (c: GeneratedCampaign | null) => void;
  setExpandedBrief: (e: ExpandedBrief | null) => void;
  setChosenConceit: (c: Conceit | null) => void;
  setSectionStructure: (s: SectionSpec[]) => void;
  setCurrentBriefInput: (b: BriefInput | null) => void;
  setConceits: (c: Conceit[]) => void;
  setCanvasSource: (s: CanvasSource) => void;
  setCurrentDraftId: (id: string | null) => void;
  setCurrentLibraryId: (id: string | null) => void;
}) {
  setters.setStage("form");
  setters.setCampaign(null);
  setters.setExpandedBrief(null);
  setters.setChosenConceit(null);
  setters.setSectionStructure([]);
  setters.setCurrentBriefInput(null);
  setters.setConceits([]);
  setters.setCanvasSource("new");
  setters.setCurrentDraftId(null);
  setters.setCurrentLibraryId(null);
  localStorage.removeItem(LS_DRAFT);
}

export default function Home() {
  const [stage, setStage] = useState<Stage>("form");
  // Single loading phase — eliminates any in-between render where two booleans
  // could both be false at the same time and flash the empty state.
  const [loadingPhase, setLoadingPhase] = useState<null | "conceits" | "generating">(null);
  const [error, setError] = useState<string | null>(null);

  const [currentBriefInput, setCurrentBriefInput] = useState<BriefInput | null>(null);
  const [expandedBrief, setExpandedBrief] = useState<ExpandedBrief | null>(null);
  const [retrievedExamples, setRetrievedExamples] = useState<LibraryCampaign[]>([]);
  const [conceits, setConceits] = useState<Conceit[]>([]);
  const [chosenConceit, setChosenConceit] = useState<Conceit | null>(null);
  const [campaign, setCampaign] = useState<GeneratedCampaign | null>(null);
  const [sectionStructure, setSectionStructure] = useState<SectionSpec[]>([]);
  // Similarity flags keyed by element key — see runRepetitionCheck / repetition-client.
  const [repetitionFlags, setRepetitionFlags] = useState<Record<string, RepetitionFlag>>({});
  const [savingStatus, setSavingStatus] = useState<"idle" | "saving">("idle");
  const [pendingDelete, setPendingDelete] = useState<{ id: string; kind: "saved" | "library" | "sms" } | null>(null);
  const [pendingBriefInput, setPendingBriefInput] = useState<BriefInput | null>(null);
  const [showNewConfirm, setShowNewConfirm] = useState(false);
  // Stage-aware chrome (Phase 3a): collapsible sidebar + brief panel.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [briefOpen, setBriefOpen] = useState(true);

  // Tracks where the canvas content came from
  const [canvasSource, setCanvasSource] = useState<CanvasSource>("new");
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [currentLibraryId, setCurrentLibraryId] = useState<string | null>(null);

  // --- Library autosave state/refs ---------------------------------------
  // A library canvas persists every edit automatically (see the autosave block
  // below). These refs hold the machinery; the status drives the quiet UI that
  // replaces the "Save to Library" button when canvasSource === "library".
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "check" | "error">("idle");
  const savingRef = useRef(false);          // a save is in flight (single-flight guard)
  const dirtyRef = useRef(false);           // edits await persistence
  const failCountRef = useRef(0);           // consecutive autosave failures (for one-shot toast)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveIdRef = useRef<string | null>(null);   // library id we've baselined (don't save on load)
  const flushSaveRef = useRef<() => void>(() => {});
  const flushAutosaveRef = useRef<() => void>(() => {});
  const beaconSaveRef = useRef<() => void>(() => {});

  const [libraryItems, setLibraryItems] = useState<LibraryMeta[]>([]);
  const [savedItems, setSavedItems] = useState<SavedMeta[]>([]);

  const router = useRouter();
  // --- Planner handoff (Planner -> Copy Builder link) ---
  const [formSeed, setFormSeed] = useState<Partial<BriefInput> | null>(null);
  const [formSeedLabel, setFormSeedLabel] = useState<string | null>(null);
  const [plannerLink, setPlannerLink] = useState<PlannerLinkContext | null>(null);
  const [seedingProducts, setSeedingProducts] = useState(false);
  const [seedAiFailed, setSeedAiFailed] = useState(false);
  const [pendingPlannerRowId, setPendingPlannerRowId] = useState<string | null>(null);
  const [pendingPlannerSmsRowId, setPendingPlannerSmsRowId] = useState<string | null>(null);

  // --- SMS mode (channel switch) -----------------------------------------
  // Email mode leaves every bit of the email state/logic above untouched.
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [smsCampaign, setSmsCampaign] = useState<SmsCampaign | null>(null);
  const [smsSource, setSmsSource] = useState<"new" | "draft" | "final">("new");
  const [smsCurrentId, setSmsCurrentId] = useState<string | null>(null);
  const [smsLoading, setSmsLoading] = useState(false);
  const [smsSaving, setSmsSaving] = useState(false);
  const [smsItems, setSmsItems] = useState<{ id: string; name: string; status: string; updated_at: string }[]>([]);
  const [smsSeedBrief, setSmsSeedBrief] = useState<SmsBrief | null>(null);
  const [smsSeedSourceId, setSmsSeedSourceId] = useState<string | null>(null);
  const [pendingSmsGen, setPendingSmsGen] = useState<SmsGenerateArgs | null>(null);

  const refreshSidebar = useCallback(async () => {
    const [libRes, savedRes, smsRes] = await Promise.all([
      fetch("/api/library"), fetch("/api/campaigns"), fetch("/api/sms"),
    ]);
    // Each parse is independent: a single failing store (e.g. a 500) must not
    // abort the others, or one broken sidebar section blanks all three.
    const lib = await libRes.json().catch(() => ({}));
    const saved = await savedRes.json().catch(() => ({}));
    const sms = await smsRes.json().catch(() => ({}));
    if (lib.campaigns) setLibraryItems(lib.campaigns);
    if (saved.campaigns) setSavedItems(saved.campaigns);
    if (sms.campaigns) {
      setSmsItems(sms.campaigns.map((c: { id: string; name: string; status: string; updated_at: string }) => ({
        id: c.id, name: c.name, status: c.status, updated_at: c.updated_at,
      })));
    }
  }, []);

  useEffect(() => { refreshSidebar(); }, [refreshSidebar]);

  // Restore in-progress draft from localStorage on load.
  useEffect(() => {
    // A ?campaign deep link loads a specific saved campaign — don't restore the
    // in-progress draft over it. A ?planner deep link still restores (so the
    // "unsaved campaign" guard has something to keep, and "Keep working" works).
    const params = new URLSearchParams(window.location.search);
    if (params.has("campaign")) return;
    const raw = localStorage.getItem(LS_DRAFT);
    if (raw) {
      try {
        const { campaign: c, expandedBrief: eb, chosenConceit: cc, sectionStructure: ss, draftId, briefInput: bi, plannerLink: pl } = JSON.parse(raw);
        if (c) {
          setCampaign(c);
          setExpandedBrief(eb);
          setChosenConceit(cc);
          setSectionStructure(ss || []);
          setCurrentDraftId(draftId || null);
          setCurrentBriefInput(bi || null);   // ← was missing — caused Save Draft to silently bail
          setPlannerLink(pl || null);
          setCanvasSource("draft");
          setStage("canvas");
        }
      } catch { /* */ }
    }
  }, []);

  // Persist in-progress work to localStorage
  useEffect(() => {
    if (campaign && canvasSource !== "library") {
      localStorage.setItem(LS_DRAFT, JSON.stringify({
        campaign, expandedBrief, chosenConceit, sectionStructure,
        draftId: currentDraftId, briefInput: currentBriefInput, plannerLink,
      }));
    }
  }, [campaign, expandedBrief, chosenConceit, sectionStructure, currentDraftId, currentBriefInput, canvasSource, plannerLink]);

  // Auto-collapse the brief panel on the canvas, auto-expand on the form. Runs
  // only on stage change, so a manual toggle persists within a stage.
  useEffect(() => {
    if (stage === "canvas") setBriefOpen(false);
    else if (stage === "form") setBriefOpen(true);
  }, [stage]);

  // ⌘/Ctrl+S → Save Draft. Kept in a ref (refreshed each render) so the single
  // listener always sees current state without re-subscribing.
  const saveShortcutRef = useRef<() => void>(() => {});
  useEffect(() => {
    saveShortcutRef.current = () => { if (campaign && stage === "canvas" && savingStatus !== "saving") handleSaveDraft(); };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveShortcutRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- Planner handoff ---------------------------------------------------

  // Move to a clean brief form WITHOUT destroying the canvas draft in storage
  // (the persist effect only writes when a campaign exists, and we don't remove
  // the key). Used when the writer chooses to start a planner brief over an
  // existing canvas.
  const softResetToForm = () => {
    flushAutosaveRef.current();   // persist any pending library edit before leaving
    setStage("form");
    setCampaign(null);
    setExpandedBrief(null);
    setChosenConceit(null);
    setSectionStructure([]);
    setCurrentBriefInput(null);
    setConceits([]);
    setCanvasSource("new");
    setCurrentDraftId(null);
    setCurrentLibraryId(null);
  };

  // Seed a new brief from a planner row: deterministic map instantly, then AI
  // proposes products + hero angle. Never auto-generates.
  const startPlannerBrief = async (rowId: string) => {
    router.replace("/copy-builder");   // consume the param so a refresh won't re-seed
    setError(null);
    softResetToForm();
    // 1. Fetch the row.
    let row: PlannerRow | null = null;
    try {
      const res = await fetch(`/api/planner?id=${encodeURIComponent(rowId)}`);
      if (res.ok) row = (await res.json()).row ?? null;
    } catch { /* fall through */ }
    if (!row) {
      toast.error("That planner row no longer exists.");
      return;   // falls through to a normal empty form
    }
    // 2. Seed deterministically immediately so name/offer/code show at once.
    setFormSeed(plannerRowToBriefSeed(row));
    setFormSeedLabel(row.name);
    setPlannerLink({ rowId: row.id, name: row.name, channel: row.channel });
    setSeedAiFailed(false);
    setSeedingProducts(true);
    // 3. Smart-fill (Haiku) proposes products + hero angle; merge when it lands.
    try {
      const res = await fetch("/api/copy-seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row }),
      });
      const data = await res.json();
      if (data.seed) setFormSeed(data.seed as Partial<BriefInput>);
      if (data.ai_failed) setSeedAiFailed(true);
    } catch {
      setSeedAiFailed(true);   // handoff still works; user fills the two gaps
    } finally {
      setSeedingProducts(false);
    }
  };

  // ?planner=<rowId>[&channel=sms]. Guard against silently discarding an unsaved canvas.
  const handlePlannerDeepLink = (rowId: string, channelParam: string | null) => {
    if (channelParam === "sms") {
      if (smsCampaign) setPendingPlannerSmsRowId(rowId);   // confirm before replacing
      else startSmsPlannerBrief(rowId);
      return;
    }
    let hasCanvas = false;
    try {
      const raw = localStorage.getItem(LS_DRAFT);
      hasCanvas = !!(raw && JSON.parse(raw)?.campaign);
    } catch { hasCanvas = false; }
    if (hasCanvas) setPendingPlannerRowId(rowId);   // confirm before replacing
    else startPlannerBrief(rowId);
  };

  // Seed SMS mode from a planner row: switch channel, prefill the brief from the
  // row's offer/code, stash the planner link for write-back. Never auto-generates.
  const startSmsPlannerBrief = async (rowId: string) => {
    router.replace("/copy-builder");   // consume the params
    setError(null);
    let row: PlannerRow | null = null;
    try {
      const res = await fetch(`/api/planner?id=${encodeURIComponent(rowId)}`);
      if (res.ok) row = (await res.json()).row ?? null;
    } catch { /* fall through */ }
    if (!row) {
      toast.error("That planner row no longer exists.");
      return;
    }
    setChannel("sms");
    setSmsCampaign(null);
    setSmsCurrentId(null);
    setSmsSource("new");
    setSmsSeedSourceId(null);
    setSmsSeedBrief({
      name: row.name,
      offer: row.offer || "",
      promo_code: row.promo_code,
      audience: row.audience_included?.map((a) => a.name).join(", ") || undefined,
    });
    setPlannerLink({ rowId: row.id, name: row.name, channel: "sms" });
  };

  // ?campaign=<savedId>. Open an existing saved campaign (email draft/library, or
  // an SMS campaign). Try the SMS store first — its ids never collide with email.
  const handleCampaignDeepLink = async (savedId: string) => {
    router.replace("/copy-builder");
    try {
      const res = await fetch(`/api/sms?id=${encodeURIComponent(savedId)}`);
      if (res.ok) { await handleLoadSms(savedId); return; }
    } catch { /* fall through to email */ }
    await handleLoadSaved(savedId);
  };

  const handleClearSeed = () => {
    setFormSeed(null);
    setFormSeedLabel(null);
    setPlannerLink(null);
    setSeedAiFailed(false);
    setSeedingProducts(false);
  };

  // Stamp the planner row after a successful copy save. Fire-and-forget: a
  // write-back failure must never surface as a copy-save failure (copy is saved).
  const writeBackToPlanner = (copyCampaignId: string, copyStatus: "draft" | "final") => {
    const rowId = plannerLink?.rowId ?? currentBriefInput?.planner_row_id;
    if (!rowId) return;
    fetch("/api/planner/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row_id: rowId, copy_campaign_id: copyCampaignId, copy_status: copyStatus }),
    })
      .then((res) => {
        if (res.ok) {
          toast.success("Linked to planner ✓");
        } else {
          console.error(`Planner write-back failed (HTTP ${res.status})`);
        }
      })
      .catch((e) => console.error("Planner write-back failed", e));
  };

  // Full reset (canvas + planner handoff). Clearing the handoff matters: a stale
  // plannerLink would otherwise make the next save stamp the wrong planner row.
  const resetAll = () => {
    flushAutosaveRef.current();   // persist any pending library edit before clearing
    resetState({
      setStage, setCampaign, setExpandedBrief, setChosenConceit,
      setSectionStructure, setCurrentBriefInput, setConceits,
      setCanvasSource, setCurrentDraftId, setCurrentLibraryId,
    });
    setPlannerLink(null);
    setFormSeed(null);
    setFormSeedLabel(null);
    setSeedAiFailed(false);
    setRepetitionFlags({});
  };

  // Always confirm before generating: a plain "done with the brief?" check when
  // the canvas is empty, and a stronger "start over?" warning when a campaign
  // is already on screen (generating would replace it).
  const handleBriefSubmitRequest = (input: BriefInput) => {
    setPendingBriefInput(input);
  };

  const handleBriefSubmit = async (input: BriefInput) => {
    setLoadingPhase("conceits");
    setError(null);
    // Expand product_card sections so each card maps to a selected product.
    // This shapes the structure the canvas, brief, and generation all see.
    const expandedStructure = expandProductCardSections(input.section_structure, input.products_featured);
    const normalised: BriefInput = { ...input, section_structure: expandedStructure };
    setCurrentBriefInput(normalised);
    setSectionStructure(expandedStructure);
    try {
      // Kick off brief expansion AND library fetch in parallel
      const [briefRes, libRes] = await Promise.all([
        fetch("/api/brief", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(normalised),
        }),
        fetch("/api/library?all=true"),
      ]);

      const briefData = await briefRes.json();
      if (briefData.error) throw new Error(briefData.error);
      setExpandedBrief(briefData.expanded_brief);

      // One bulk fetch for all library campaigns with bodies (avoids N round-trips)
      const libData = await libRes.json();
      const library: LibraryCampaign[] = libData.campaigns || [];
      const scored = library.map((c) => {
        let score = 0;
        if (c.campaign_type === input.campaign_type) score += 3;
        if (c.audience === input.audience) score += 2;
        if (c.products_featured?.some((p: string) => input.products_featured.includes(p))) score += 2;
        const ageYears = (Date.now() - new Date(c.date).getTime()) / (365 * 24 * 60 * 60 * 1000);
        score += Math.max(0, 2 - ageYears * 0.4);
        return { c, score };
      });
      const topExamples = scored.sort((a, b) => b.score - a.score).slice(0, 8).map((x) => x.c);
      setRetrievedExamples(topExamples);

      const cRes = await fetch("/api/conceits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expanded_brief: briefData.expanded_brief, retrieved_examples: topExamples }),
      });
      const cData = await cRes.json();
      if (cData.error) throw new Error(cData.error);
      setConceits(cData.conceits || []);
      setStage("conceits");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoadingPhase(null);
    }
  };

  const handlePickConceit = async (conceit: Conceit) => {
    setChosenConceit(conceit);
    setLoadingPhase("generating");
    setError(null);

    // Initialise an empty campaign and show the canvas immediately so content
    // appears progressively as each JSONL line streams in.
    const empty: GeneratedCampaign = { meta: { subject_lines: [], preview_texts: [] }, sections: [] };
    setCampaign(empty);
    setRepetitionFlags({});
    setCanvasSource("new");
    setStage("canvas");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expanded_brief: expandedBrief,
          chosen_conceit: conceit,
          section_structure: sectionStructure,
          retrieved_examples: retrievedExamples,
          tone_dial: currentBriefInput?.tone_dial ?? 1,
        }),
      });

      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let meta = empty.meta;
      let sections: GeneratedSection[] = [];
      let sseBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const events = sseBuffer.split("\n\n");
        sseBuffer = events.pop() ?? "";

        for (const event of events) {
          const line = event.trim();
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          // Only attempt to parse lines that look like JSON objects —
          // skips any preamble prose the model might emit before the JSONL.
          if (!payload.startsWith("{")) continue;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.meta) {
              meta = parsed.meta;
              setCampaign({ meta, sections: [...sections] });
            } else if (parsed.type) {
              const { elements, subheader_variants, subheader_selected } = extractSubheaderVariants(parsed.elements);
              const newSection: GeneratedSection = {
                id: nanoid(),
                type: parsed.type,
                elements,
                ...(subheader_variants ? { subheader_variants, subheader_selected } : {}),
              };
              sections = [...sections, newSection];
              setCampaign({ meta, sections });
            }
          } catch {
            // Ignore unparseable lines (e.g. partial JSON mid-stream)
          }
        }
      }
      toast.success(`Campaign written — ${sections.length} section${sections.length === 1 ? "" : "s"}`);
      // Post-generation similarity pass (auto-retries offenders, then flags).
      void runRepetitionCheck({ meta, sections });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
      setCampaign(null);
      setStage("conceits");
    } finally {
      setLoadingPhase(null);
    }
  };

  // ---- Post-generation repetition checker (Step 3c) --------------------------
  // Collect the checkable elements, ask the check endpoint for near-duplicates,
  // auto-retry each offending target ONCE via the existing regenerate APIs, then
  // flag anything still too close. Fails open — never blocks saving.
  const MAX_AUTO_RETRIES = 4;

  const runRepetitionCheck = async (campaignToCheck: GeneratedCampaign) => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (!campaignToCheck?.sections || !expandedBrief || !chosenConceit) return;

    const excludeId = currentLibraryId ?? undefined;
    const toneDial = currentBriefInput?.tone_dial ?? 1;

    const postCheck = async (elements: CheckElement[]): Promise<CheckMatch[]> => {
      if (!elements.length) return [];
      const res = await fetch("/api/check-repetition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ elements, exclude_id: excludeId }),
      });
      if (!res.ok) throw new Error("check-repetition failed");
      return (await res.json()).matches ?? [];
    };

    try {
      let working = campaignToCheck;
      const initial = collectCheckElements(working, sectionStructure);
      const textById = new Map(initial.map((e) => [e.id, e.text]));
      const matches = await postCheck(initial);
      if (!matches.length) { setRepetitionFlags({}); return; }

      // Group offenders by the single target that one regeneration would fix:
      // "meta" for subject/preview lines, otherwise the owning section id.
      const byTarget = new Map<string, CheckMatch[]>();
      for (const m of matches) {
        const t = targetForKey(m.id);
        const key = t.kind === "meta" ? "meta" : t.sectionId;
        const arr = byTarget.get(key) ?? [];
        arr.push(m);
        byTarget.set(key, arr);
      }

      const toFlag = (m: CheckMatch): RepetitionFlag => ({
        match_text: m.match_text,
        match_campaign_title: m.match_campaign_title,
        match_date: m.match_date,
        score: m.score,
      });
      const dedupNote = (m: CheckMatch) => {
        const prev = textById.get(m.id) ?? "";
        return `Your previous version of this element ("${prev}") duplicates a past campaign ("${m.match_text}", ${m.match_campaign_title}, ${m.match_date}). Write a structurally different construction.`;
      };

      const flags: Record<string, RepetitionFlag> = {};
      let retriesLeft = MAX_AUTO_RETRIES;

      for (const [target, targetMatches] of byTarget) {
        if (retriesLeft <= 0) {
          for (const m of targetMatches) flags[m.id] = toFlag(m);
          continue;
        }
        retriesLeft--;
        const note = dedupNote(targetMatches[0]);

        try {
          if (target === "meta") {
            const summary = working.sections
              .map((s) => `${s.type}: ${Object.values(s.elements).slice(0, 2).join(" | ")}`)
              .join("\n");
            const res = await fetch("/api/regenerate-meta", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                expanded_brief: expandedBrief,
                chosen_conceit: chosenConceit,
                current_campaign_summary: summary,
                library_id: excludeId,
                avoid_note: note,
              }),
            });
            const data = await res.json();
            if (data.subject_lines || data.preview_texts) {
              working = {
                ...working,
                meta: {
                  subject_lines: data.subject_lines || working.meta.subject_lines,
                  preview_texts: data.preview_texts || working.meta.preview_texts,
                },
              };
              setCampaign(working);
            }
            const recheck = await postCheck(collectMetaElements(working.meta));
            for (const rm of recheck) flags[rm.id] = toFlag(rm);
          } else {
            const idx = working.sections.findIndex((s) => s.id === target);
            if (idx === -1) continue;
            const section = working.sections[idx];
            const spec = specForSection(sectionStructure, idx, section.type) ?? { id: "", type: section.type };
            const res = await fetch("/api/regenerate-section", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                expanded_brief: expandedBrief,
                chosen_conceit: chosenConceit,
                section_to_regenerate: { ...spec, current_content: section },
                full_campaign: working,
                steering: note,
                tone_dial: toneDial,
                retrieved_examples: retrievedExamples,
              }),
            });
            const data = await res.json();
            if (data.section) {
              working = { ...working, sections: working.sections.map((s) => (s.id === target ? data.section : s)) };
              setCampaign(working);
            }
            const newIdx = working.sections.findIndex((s) => s.id === target);
            const newSection = working.sections[newIdx];
            const recheck = newSection
              ? await postCheck(collectSectionElements(newSection, specForSection(sectionStructure, newIdx, newSection.type)))
              : [];
            for (const rm of recheck) flags[rm.id] = toFlag(rm);
          }
        } catch {
          // A single failed retry just leaves the original offenders flagged.
          for (const m of targetMatches) flags[m.id] = toFlag(m);
        }
      }

      setRepetitionFlags(flags);
    } catch (e) {
      // Fail open on any endpoint/offline failure — never block the user.
      console.warn("Repetition check skipped:", e);
    }
  };

  // Fallback brief if currentBriefInput was somehow lost (e.g. a stale
  // localStorage draft saved before briefInput was persisted). Without this,
  // the save handlers silently bail and saving appears broken.
  const deriveBriefFallback = (): BriefInput => ({
    campaign_name: chosenConceit?.name || "Untitled campaign",
    campaign_type: expandedBrief?.campaign_type ?? "promo",
    offer: "",
    promo_code: undefined,
    audience: expandedBrief?.audience ?? "all",
    hero_angle: expandedBrief?.hero_angle_verbatim ?? expandedBrief?.rewritten_hero_angle ?? "",
    products_featured: expandedBrief?.products_featured ?? [],
    section_structure: sectionStructure,
  });

  const handleSaveDraft = async () => {
    if (!campaign) { setError("Nothing to save yet — generate a campaign first."); return; }
    const bi = currentBriefInput ?? deriveBriefFallback();
    setSavingStatus("saving");
    setError(null);
    try {
      const id = currentDraftId || `${new Date().toISOString().split("T")[0]}-${makeSlug(bi.campaign_name)}-${nanoid().slice(0, 6)}`;
      const saved: SavedCampaign = {
        id,
        campaign_name: bi.campaign_name,
        campaign_type: bi.campaign_type,
        offer: bi.offer,
        promo_code: bi.promo_code,
        audience: bi.audience,
        hero_angle: bi.hero_angle,
        products_featured: bi.products_featured,
        section_structure: sectionStructure,
        expanded_brief: expandedBrief ?? undefined,
        chosen_conceit: chosenConceit ?? undefined,
        campaign,
        status: "draft",
        planner_row_id: plannerLink?.rowId ?? bi.planner_row_id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(saved),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Save failed (HTTP ${res.status})`);
      }
      setCurrentDraftId(id);
      setCanvasSource("draft");
      setSavingStatus("idle");
      writeBackToPlanner(id, "draft");   // stamp the planner row (fire-and-forget)
      await refreshSidebar();
      toast.success("Draft saved");
    } catch (e) {
      setSavingStatus("idle");
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  const handleSaveFinal = async () => {
    if (!campaign) { setError("Nothing to save yet — generate a campaign first."); return; }
    const bi = currentBriefInput ?? deriveBriefFallback();
    setSavingStatus("saving");
    setError(null);
    try {
      const id = currentLibraryId ||
        `${new Date().toISOString().split("T")[0]}-${makeSlug(bi.campaign_name)}`;

      const res = await fetch("/api/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          brief_input: bi,
          conceit: chosenConceit,
          campaign,
          section_structure: sectionStructure,
          draft_id: currentDraftId,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Save failed (HTTP ${res.status})`);
      }

      // Keep the canvas exactly as-is — just transition it to library source
      // so the button flips to "update" mode and the draft slot is cleared.
      setCurrentLibraryId(id);
      setCurrentDraftId(null);
      setCanvasSource("library");
      setSavingStatus("idle");
      writeBackToPlanner(id, "final");   // flip the planner chip to "final"
      await refreshSidebar();
      toast.success("Saved to library");
    } catch (e) {
      setSavingStatus("idle");
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  // --- Library autosave --------------------------------------------------
  // A library-loaded campaign is what the planner's copy viewer shows, so every
  // edit must persist itself. The mechanics: a debounce effect marks the canvas
  // dirty and schedules a save 1.5s after the last change; flushSave runs it
  // single-flight with a trailing follow-up; exit paths flush synchronously.
  //
  // Latest state, read at flush time so a save always ships the freshest content
  // (the debounce/single-flight callbacks fire outside the render that scheduled
  // them). Mirrors exactly the payload the old manual "Save to Library" sent.
  const autosaveDataRef = useRef<{
    campaign: GeneratedCampaign | null;
    sectionStructure: SectionSpec[];
    briefInput: BriefInput;
    chosenConceit: Conceit | null;
    currentLibraryId: string | null;
    canvasSource: CanvasSource;
  }>(null!);
  autosaveDataRef.current = {
    campaign,
    sectionStructure,
    briefInput: currentBriefInput ?? deriveBriefFallback(),
    chosenConceit,
    currentLibraryId,
    canvasSource,
  };

  // POST the current library canvas to /api/finalize. Throws on HTTP failure.
  const runLibrarySave = async () => {
    const d = autosaveDataRef.current;
    if (!d.campaign || !d.currentLibraryId) return;
    const res = await fetch("/api/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: d.currentLibraryId,
        brief_input: d.briefInput,
        conceit: d.chosenConceit,
        campaign: d.campaign,
        section_structure: d.sectionStructure,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `Save failed (HTTP ${res.status})`);
    }
  };

  // Single-flight with trailing latest: never two saves at once; if edits land
  // mid-flight the dirty flag triggers exactly one follow-up when this settles.
  flushSaveRef.current = () => {
    if (savingRef.current) { dirtyRef.current = true; return; }
    if (autosaveTimerRef.current) { clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = null; }
    if (savedFadeTimerRef.current) { clearTimeout(savedFadeTimerRef.current); savedFadeTimerRef.current = null; }
    dirtyRef.current = false;
    savingRef.current = true;
    setAutosaveStatus("saving");
    runLibrarySave()
      .then(() => {
        savingRef.current = false;
        failCountRef.current = 0;
        if (dirtyRef.current) {
          flushSaveRef.current();          // trailing: newer edits arrived while saving
        } else {
          setAutosaveStatus("saved");
          savedFadeTimerRef.current = setTimeout(() => setAutosaveStatus("check"), 2000);
          refreshSidebar();                // keep sidebar titles in sync with edits
        }
      })
      .catch(() => {
        savingRef.current = false;
        dirtyRef.current = true;           // keep dirty so the next edit / Retry re-attempts
        failCountRef.current += 1;
        setAutosaveStatus("error");
        // One toast on the second consecutive failure — not one per retry.
        if (failCountRef.current === 2) toast.error("Autosave failed — your changes are still here. Hit Retry.");
      });
  };

  // Flush a pending debounced save immediately (used on exit paths).
  flushAutosaveRef.current = () => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
      flushSaveRef.current();
    } else if (dirtyRef.current && !savingRef.current) {
      flushSaveRef.current();
    }
  };

  // Best-effort flush for page unload / unmount: sendBeacon (falls back to a
  // keepalive fetch) so an in-flight tab close doesn't drop the last edit.
  beaconSaveRef.current = () => {
    const d = autosaveDataRef.current;
    if (d.canvasSource !== "library" || !d.currentLibraryId || !d.campaign) return;
    if (!dirtyRef.current && !autosaveTimerRef.current) return;   // nothing pending
    const body = JSON.stringify({
      id: d.currentLibraryId,
      brief_input: d.briefInput,
      conceit: d.chosenConceit,
      campaign: d.campaign,
      section_structure: d.sectionStructure,
    });
    try {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/api/finalize", blob)) return;
    } catch { /* fall through to keepalive fetch */ }
    fetch("/api/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  };

  // Debounced autosave loop — watches everything that feeds a finalize payload.
  // The first pass after a library canvas loads (or a Save Final flips the
  // source to "library") only records the baseline id; it never saves unchanged
  // content. Later changes to the same id schedule a save 1.5s after the last.
  // loadingPhase gates it so nothing fires during generation.
  useEffect(() => {
    const active = canvasSource === "library" && !!currentLibraryId && !!campaign && loadingPhase === null;
    if (!active) { autosaveIdRef.current = null; return; }
    if (autosaveIdRef.current !== currentLibraryId) {
      autosaveIdRef.current = currentLibraryId;   // freshly loaded/finalized — baseline, don't save
      return;
    }
    dirtyRef.current = true;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      flushSaveRef.current();
    }, 1500);
    return () => {
      if (autosaveTimerRef.current) { clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = null; }
    };
  }, [campaign, sectionStructure, currentBriefInput, chosenConceit, canvasSource, currentLibraryId, loadingPhase]);

  // Flush on tab close / navigation away / unmount.
  useEffect(() => {
    const onExit = () => beaconSaveRef.current();
    window.addEventListener("pagehide", onExit);
    window.addEventListener("beforeunload", onExit);
    return () => {
      window.removeEventListener("pagehide", onExit);
      window.removeEventListener("beforeunload", onExit);
      beaconSaveRef.current();   // component unmount (route change away from the builder)
    };
  }, []);

  const handleLoadSaved = async (id: string) => {
    flushAutosaveRef.current();   // persist any pending library edit before switching
    const res = await fetch(`/api/campaigns?id=${id}`);
    if (res.ok) {
      const data = await res.json();
      if (data.campaign) {
        const c = data.campaign as SavedCampaign;
        setCampaign(c.campaign);
        setRepetitionFlags({});
        setExpandedBrief(c.expanded_brief ?? null);
        setChosenConceit(c.chosen_conceit ?? null);
        setSectionStructure(c.section_structure ?? []);
        setCurrentBriefInput({
          campaign_name: c.campaign_name,
          campaign_type: c.campaign_type,
          offer: c.offer,
          promo_code: c.promo_code,
          audience: c.audience,
          hero_angle: c.hero_angle,
          products_featured: c.products_featured,
          section_structure: c.section_structure ?? [],
          planner_row_id: c.planner_row_id,
        });
        setPlannerLink(c.planner_row_id ? { rowId: c.planner_row_id, name: c.campaign_name, channel: "email" } : null);
        setCurrentDraftId(id);
        setCurrentLibraryId(null);
        setCanvasSource("draft");
        setStage("canvas");
        return;
      }
    }
    // Not a draft — a finalized copy lives in the library under this id. This is
    // the "Open copy" path for a Save Final'd campaign.
    const libRes = await fetch(`/api/library?id=${id}`);
    if (libRes.ok) {
      await handleViewLibrary(id);
      return;
    }
    // Neither store has it: the saved campaign was deleted (stale link).
    toast.error("That draft no longer exists.");
  };

  // Deletes open a ConfirmModal; confirmDelete does the work.
  const handleDeleteSaved = (id: string) => setPendingDelete({ id, kind: "saved" });
  const handleDeleteLibrary = (id: string) => setPendingDelete({ id, kind: "library" });

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const { id, kind } = pendingDelete;
    setPendingDelete(null);
    try {
      if (kind === "saved") {
        await fetch(`/api/campaigns?id=${id}`, { method: "DELETE" });
        if (currentDraftId === id) resetAll();
        toast.success("Draft deleted");
      } else if (kind === "sms") {
        await fetch(`/api/sms?id=${id}`, { method: "DELETE" });
        if (smsCurrentId === id) handleSmsNew();
        toast.success("SMS campaign deleted");
      } else {
        await fetch(`/api/library?id=${id}`, { method: "DELETE" });
        if (currentLibraryId === id) resetAll();
        toast.success("Removed from library");
      }
      await refreshSidebar();
    } catch {
      toast.error("Delete failed");
    }
  };

  const handleViewLibrary = async (id: string) => {
    flushAutosaveRef.current();   // persist edits to the current library canvas before switching
    const res = await fetch(`/api/library?id=${id}`);
    const data = await res.json();
    if (!data.campaign) return;
    const lib = data.campaign as LibraryCampaign;

    let sectionStructureForView: SectionSpec[] = [];

    if (lib.structured?.campaign) {
      // Faithful reload — grids, section types, and element grouping intact.
      setCampaign(lib.structured.campaign);
      sectionStructureForView = lib.structured.section_structure ?? [];
    } else {
      // Legacy / doc-sourced entry: reconstruct best-effort from the flattened body.
      const sections = lib.body.split(/\n(?=# )/).filter(Boolean).map((block) => {
        const firstLine = block.match(/^# (.+)/)?.[1] ?? "Section";
        const content = block.replace(/^# .+\n?/, "").trim();
        return {
          id: nanoid(),
          type: "body" as SectionType,
          elements: { [firstLine]: content },
        };
      });

      const metaSubjects = sections.filter(s => "Subject Line" in s.elements);
      const metaPreviews = sections.filter(s => "Preview Text" in s.elements);
      const bodySections = sections.filter(s => !("Subject Line" in s.elements) && !("Preview Text" in s.elements));

      setCampaign({
        meta: {
          subject_lines: metaSubjects.map(s => s.elements["Subject Line"] as string),
          preview_texts: metaPreviews.map(s => s.elements["Preview Text"] as string),
        },
        sections: bodySections,
      });
    }

    setSectionStructure(sectionStructureForView);
    setRepetitionFlags({});

    setCurrentBriefInput({
      campaign_name: lib.title,
      campaign_type: lib.campaign_type,
      offer: lib.offer,
      promo_code: lib.promo_code,
      audience: lib.audience,
      hero_angle: lib.hero_angle,
      products_featured: lib.products_featured,
      section_structure: sectionStructureForView,
      planner_row_id: lib.planner_row_id,
    });
    setPlannerLink(lib.planner_row_id ? { rowId: lib.planner_row_id, name: lib.title, channel: "email" } : null);
    setChosenConceit(lib.conceit ? { id: "lib", name: lib.conceit, description: "" } : null);
    setExpandedBrief(null);
    setCurrentLibraryId(id);
    setCurrentDraftId(null);
    setCanvasSource("library");
    setStage("canvas");
  };

  const handleNewConceits = async () => {
    if (!expandedBrief) return;
    setLoadingPhase("conceits");
    setError(null);
    try {
      const res = await fetch("/api/conceits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expanded_brief: expandedBrief, retrieved_examples: retrievedExamples }),
      });
      const data = await res.json();
      if (data.conceits) setConceits(data.conceits);
      setStage("conceits");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to get conceits");
    } finally {
      setLoadingPhase(null);
    }
  };

  const handleRenameCampaign = (name: string) => {
    if (currentBriefInput) setCurrentBriefInput({ ...currentBriefInput, campaign_name: name });
  };

  // Build plain + HTML versions of the campaign for clipboard export
  const handleCopyCampaign = async () => {
    if (!campaign) return;
    const name = currentBriefInput?.campaign_name || "Campaign";
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const hr = "─────────────────────────────────────";

    // ── Plain text ──────────────────────────────────────────────────────────
    const plainParts: string[] = [];

    plainParts.push(name.toUpperCase());
    if (chosenConceit) plainParts.push(`Conceit: ${chosenConceit.name} — ${chosenConceit.description}`);
    plainParts.push("");

    campaign.meta.subject_lines.forEach((s, i) =>
      plainParts.push(`SUBJECT LINE ${i + 1}: ${s}`)
    );
    campaign.meta.preview_texts.forEach((p, i) =>
      plainParts.push(`PREVIEW TEXT ${i + 1}: ${p}`)
    );

    campaign.sections.forEach((sec, i) => {
      plainParts.push(hr);
      Object.entries(sec.elements).forEach(([k, v]) => {
        if (Array.isArray(v)) {
          v.forEach((prod, pi) => {
            plainParts.push(`[${pi + 1}] ${prod.name}`);
            plainParts.push(`    ${prod.one_liner}`);
            plainParts.push(`    ${prod.cta}`);
            plainParts.push("");
          });
        } else {
          plainParts.push(`${k.toUpperCase()}: ${v}`);
        }
      });
    });

    const plain = plainParts.join("\n");

    // ── HTML (Google Docs renders bold labels + <hr> as divider lines) ──────
    const htmlParts: string[] = [];

    // Header block — name + conceit + meta all in one paragraph each
    htmlParts.push(`<p><strong>${esc(name.toUpperCase())}</strong></p>`);
    if (chosenConceit) {
      htmlParts.push(`<p>Conceit: <strong>${esc(chosenConceit.name)}</strong> — ${esc(chosenConceit.description)}</p>`);
    }

    // Subject lines and preview texts grouped into one paragraph each (no inter-line dividers)
    const metaLines: string[] = [];
    campaign.meta.subject_lines.forEach((s, i) =>
      metaLines.push(`<strong>SUBJECT LINE ${i + 1}:</strong> ${esc(s)}`)
    );
    campaign.meta.preview_texts.forEach((p, i) =>
      metaLines.push(`<strong>PREVIEW TEXT ${i + 1}:</strong> ${esc(p)}`)
    );
    if (metaLines.length) htmlParts.push(`<p>${metaLines.join("<br>")}</p>`);

    // Each section = one <hr> divider.
    // product_grid → HTML table with grid_cols columns.
    // Everything else → one <p> with fields joined by <br><br>.
    const tdStyle = "border:1px solid #e0e0e0;padding:10px;vertical-align:top;";

    campaign.sections.forEach((sec, i) => {
      htmlParts.push("<hr>");

      if (sec.type === "product_grid") {
        // Look up grid_cols from the section structure spec (by position, then type)
        const spec = sectionStructure[i] ?? sectionStructure.find((s) => s.type === "product_grid");
        const cols = spec?.grid_cols ?? 2;

        // Separate subheader-type fields from the products array
        const headerFields: string[] = [];
        let products: { name: string; one_liner: string; cta: string }[] = [];
        Object.entries(sec.elements).forEach(([k, v]) => {
          if (Array.isArray(v)) {
            products = v;
          } else {
            headerFields.push(`<strong>${esc(k.toUpperCase())}:</strong> ${esc(v as string)}`);
          }
        });
        if (headerFields.length) {
          htmlParts.push(`<p>${headerFields.join("<br><br>")}</p>`);
        }

        // Build table: slice products into rows of `cols` cells
        const rows: string[] = [];
        for (let r = 0; r < products.length; r += cols) {
          const slice = products.slice(r, r + cols);
          const cells = slice.map((prod) =>
            `<td style="${tdStyle}"><strong>${esc(prod.name)}</strong><br><br>${esc(prod.one_liner)}<br><br><em>${esc(prod.cta)}</em></td>`
          );
          // Pad incomplete last row so table stays square
          while (cells.length < cols) cells.push(`<td style="${tdStyle}"></td>`);
          rows.push(`<tr>${cells.join("")}</tr>`);
        }
        htmlParts.push(
          `<table style="border-collapse:collapse;width:100%">${rows.join("")}</table>`
        );
      } else {
        const fieldLines: string[] = [];
        Object.entries(sec.elements).forEach(([k, v]) => {
          if (Array.isArray(v)) {
            v.forEach((prod) => {
              fieldLines.push(`<strong>PRODUCT:</strong> ${esc(prod.name)}`);
              fieldLines.push(`<strong>ONE-LINER:</strong> ${esc(prod.one_liner)}`);
              fieldLines.push(`<strong>CTA:</strong> ${esc(prod.cta)}`);
            });
          } else {
            fieldLines.push(`<strong>${esc(k.toUpperCase())}:</strong> ${esc(v as string)}`);
          }
        });
        htmlParts.push(`<p>${fieldLines.join("<br><br>")}</p>`);
      }
    });

    const html = `<html><body>${htmlParts.join("")}</body></html>`;

    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      toast.success("Copied for Google Docs");
    } catch {
      await navigator.clipboard.writeText(plain);
      toast.success("Copied to clipboard");
    }
  };

  // --- SMS mode handlers -------------------------------------------------
  // The email campaigns a from-email SMS can distill from: library entries first,
  // then saved drafts. Both resolve through /api/planner/copy at generate time.
  const emailSources: EmailSource[] = [
    ...libraryItems.map((l) => ({
      id: l.id, name: l.title, date: l.date, type: l.campaign_type, offer: l.offer, promo_code: l.promo_code, kind: "library" as const,
    })),
    ...savedItems.map((s) => ({
      id: s.id, name: s.campaign_name, date: (s.updated_at || "").slice(0, 10), type: s.campaign_type, offer: s.offer, promo_code: s.promo_code, kind: "draft" as const,
    })),
  ];

  // Flatten a CopyFull document into plain text the SMS prompt can distill.
  const smsSourceFromCopyFull = (full: {
    campaign_name?: string; subject_lines?: string[]; preview_texts?: string[];
    sections?: { elements?: { label: string; value: string }[]; products?: { name: string; one_liner: string; cta: string }[] }[];
  }): string => {
    const parts: string[] = [];
    if (full.campaign_name) parts.push(full.campaign_name);
    for (const s of full.subject_lines ?? []) parts.push(`Subject: ${s}`);
    for (const p of full.preview_texts ?? []) parts.push(`Preview: ${p}`);
    for (const sec of full.sections ?? []) {
      for (const el of sec.elements ?? []) parts.push(`${el.label}: ${el.value}`);
      for (const p of sec.products ?? []) parts.push(`${p.name}: ${p.one_liner} (${p.cta})`);
    }
    return parts.join("\n");
  };

  const handleSmsGenerateRequest = (args: SmsGenerateArgs) => setPendingSmsGen(args);

  const handleSmsGenerate = async ({ brief, sourceEmailId, entry }: SmsGenerateArgs) => {
    setSmsLoading(true);
    setError(null);
    try {
      let source_email: string | undefined;
      if (entry === "email" && sourceEmailId) {
        try {
          const r = await fetch(`/api/planner/copy?id=${encodeURIComponent(sourceEmailId)}&full=1`);
          if (r.ok) source_email = smsSourceFromCopyFull(await r.json());
        } catch { /* generate from the brief alone if the source can't be read */ }
      }
      const res = await fetch("/api/sms-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief, source_email }),
      });
      const data = await res.json();
      if (!res.ok || !data.variants) throw new Error(data.error || "Generation failed");
      const now = new Date().toISOString();
      setSmsCampaign({
        id: "",   // assigned on save
        name: brief.name?.trim() || brief.offer.slice(0, 40) || "SMS campaign",
        source_email_id: entry === "email" ? sourceEmailId : undefined,
        brief: { offer: brief.offer, promo_code: brief.promo_code, deadline: brief.deadline, angle: brief.angle, audience: brief.audience },
        variants: data.variants,
        selected_variant: 0,
        planner_row_id: plannerLink?.rowId,
        status: "draft",
        created_at: now,
        updated_at: now,
      });
      setSmsSource("new");
      setSmsCurrentId(null);
      toast.success("3 SMS variants written");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setSmsLoading(false);
    }
  };

  const handleSmsSave = async (status: "draft" | "final") => {
    if (!smsCampaign) return;
    setSmsSaving(true);
    setError(null);
    try {
      const id = smsCurrentId || `${new Date().toISOString().split("T")[0]}-${makeSlug(smsCampaign.name)}-${nanoid().slice(0, 6)}`;
      const now = new Date().toISOString();
      const toSave: SmsCampaign = {
        ...smsCampaign,
        id,
        status,
        created_at: smsCampaign.created_at || now,
        updated_at: now,
        planner_row_id: plannerLink?.rowId ?? smsCampaign.planner_row_id,
      };
      const res = await fetch("/api/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toSave),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Save failed (HTTP ${res.status})`); }
      setSmsCampaign(toSave);
      setSmsCurrentId(id);
      setSmsSource(status === "final" ? "final" : "draft");
      writeBackToPlanner(id, status);
      await refreshSidebar();
      toast.success(status === "final" ? "SMS saved as final" : "SMS draft saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSmsSaving(false);
    }
  };

  const handleSmsSelect = (i: number) =>
    setSmsCampaign((c) => (c ? { ...c, selected_variant: i } : c));

  const handleSmsVariantChange = (i: number, text: string) =>
    setSmsCampaign((c) => {
      if (!c) return c;
      const variants = [...c.variants] as SmsCampaign["variants"];
      variants[i] = { text };
      return { ...c, variants };
    });

  const handleLoadSms = async (id: string) => {
    const res = await fetch(`/api/sms?id=${encodeURIComponent(id)}`);
    if (!res.ok) { toast.error("That SMS campaign no longer exists."); return; }
    const c = (await res.json()).campaign as SmsCampaign;
    setChannel("sms");
    setSmsCampaign(c);
    setSmsCurrentId(c.id);
    setSmsSource(c.status === "final" ? "final" : "draft");
    setSmsSeedBrief({ name: c.name, offer: c.brief.offer, promo_code: c.brief.promo_code, deadline: c.brief.deadline, angle: c.brief.angle, audience: c.brief.audience });
    setSmsSeedSourceId(c.source_email_id ?? null);
    setPlannerLink(c.planner_row_id ? { rowId: c.planner_row_id, name: c.name, channel: "sms" } : null);
  };

  const handleDeleteSms = (id: string) => setPendingDelete({ id, kind: "sms" });

  const handleSmsCopy = async () => {
    if (!smsCampaign) return;
    const text = smsCampaign.variants[smsCampaign.selected_variant]?.text ?? "";
    try { await navigator.clipboard.writeText(text); toast.success("SMS copied"); }
    catch { toast.error("Copy failed"); }
  };

  const handleSmsNew = () => {
    setSmsCampaign(null);
    setSmsCurrentId(null);
    setSmsSource("new");
    setSmsSeedBrief(null);
    setSmsSeedSourceId(null);
    setPlannerLink(null);
  };

  // Retry a failed autosave. Dirty is already set from the failure.
  const handleAutosaveRetry = () => flushSaveRef.current();

  // Save button logic based on canvas source
  const renderSaveButtons = () => {
    if (!campaign) return null;
    const saving = savingStatus === "saving";
    // Library canvases autosave — no button, just a quiet status where it sat.
    if (canvasSource === "library") {
      return <AutosaveStatus status={autosaveStatus} onRetry={handleAutosaveRetry} />;
    }
    return (
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" loading={saving} onClick={handleSaveDraft} title="Save Draft (⌘S)">
          Save Draft
        </Button>
        <Button variant="primary" size="sm" loading={saving} onClick={handleSaveFinal}>
          Save Final
        </Button>
      </div>
    );
  };

  // Stepper state derived from stage + loading phase.
  const activeKey: StepKey = loadingPhase === "conceits" ? "conceits" : loadingPhase === "generating" ? "canvas" : (stage as StepKey);
  const canGoBack = (key: StepKey) => {
    if (key === "form") return activeKey === "conceits";
    if (key === "conceits") return activeKey === "canvas" && conceits.length > 0;
    return false;
  };
  const onStepNavigate = (key: StepKey) => {
    if (key === "form") setStage("form");
    else if (key === "conceits") setStage("conceits");
  };

  return (
    <div className="flex h-screen overflow-hidden bg-chrome">
      {/* Deep-link reader (Next 16 requires useSearchParams under Suspense) */}
      <Suspense fallback={null}>
        <DeepLinkReader onPlanner={handlePlannerDeepLink} onCampaign={handleCampaignDeepLink} />
      </Suspense>

      {/* Sidebar (collapsible) */}
      <div className={`shrink-0 border-r border-line bg-surface overflow-hidden transition-[width] duration-[250ms] ease-out-soft ${sidebarOpen ? "w-60" : "w-12"}`}>
        {sidebarOpen ? (
          <div className="relative h-full overflow-y-auto">
            <button onClick={() => setSidebarOpen(false)} title="Collapse" aria-label="Collapse sidebar"
              className="absolute top-3.5 right-2 z-10 text-ink-muted hover:text-ink p-1 rounded-sm hover:bg-chrome transition-colors">
              <CollapseIcon />
            </button>
            <Sidebar
              libraryItems={libraryItems}
              savedItems={savedItems}
              smsItems={smsItems}
              onLoadSaved={handleLoadSaved}
              onDeleteSaved={handleDeleteSaved}
              onViewLibrary={handleViewLibrary}
              onDeleteLibrary={handleDeleteLibrary}
              onLoadSms={handleLoadSms}
              onDeleteSms={handleDeleteSms}
              activeSavedId={currentDraftId}
              activeLibraryId={currentLibraryId}
              activeSmsId={channel === "sms" ? smsCurrentId : null}
            />
          </div>
        ) : (
          <button onClick={() => setSidebarOpen(true)} title="Saved & Library" aria-label="Expand sidebar"
            className="w-full flex justify-center pt-4 text-ink-muted hover:text-ink transition-colors">
            <PanelIcon />
          </button>
        )}
      </div>

      {/* Brief panel (collapsible; the form stays mounted so its state is never lost) */}
      <div className={`shrink-0 border-r border-line bg-surface overflow-hidden transition-[width] duration-[250ms] ease-out-soft ${briefOpen ? "w-96" : "w-12"}`}>
        {!briefOpen && (
          <button onClick={() => setBriefOpen(true)} title="Expand brief" aria-label="Expand brief"
            className="h-full w-full flex flex-col items-center gap-3 pt-4 text-ink-secondary hover:text-ink hover:bg-chrome transition-colors">
            <PanelIcon />
            <span className="[writing-mode:vertical-rl] rotate-180 font-mono text-[11px] uppercase tracking-wide">Brief</span>
          </button>
        )}
        <div className={briefOpen ? "h-full overflow-y-auto p-5" : "hidden"}>
          <div className="flex items-center justify-between mb-4">
            <div className="font-mono text-xs text-ink-secondary uppercase tracking-wide">
              {channel === "sms" ? "SMS Copy" : "Campaign Brief"}
            </div>
            <button onClick={() => setBriefOpen(false)} title="Collapse brief" aria-label="Collapse brief"
              className="text-ink-muted hover:text-ink p-1 rounded-sm hover:bg-chrome transition-colors">
              <CollapseIcon />
            </button>
          </div>

          {/* Channel switch — Email keeps the app exactly as it was. */}
          <div className="flex gap-1 p-0.5 rounded-md bg-chrome border border-line mb-4">
            {(["email", "sms"] as const).map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => setChannel(ch)}
                className={`flex-1 text-xs font-medium py-1.5 rounded-sm transition-colors ${
                  channel === ch ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink-secondary"
                }`}
              >
                {ch === "email" ? "Email" : "SMS"}
              </button>
            ))}
          </div>

          {channel === "email" && (
            <>
              {seedingProducts && (
                <div className="mb-3 flex items-center gap-2 text-xs text-ink-muted">
                  <span className="w-3 h-3 rounded-full border-2 border-line border-t-ink-muted animate-spin" />
                  Suggesting products &amp; hero angle…
                </div>
              )}
              {seedAiFailed && (
                <div className="mb-3 text-xs text-warning-600 leading-relaxed">
                  AI suggestions unavailable — add products and a hero angle to continue.
                </div>
              )}
              <InputForm
                onSubmit={handleBriefSubmitRequest}
                loading={loadingPhase === "conceits"}
                seed={formSeed}
                seedLabel={formSeedLabel}
                onClearSeed={handleClearSeed}
              />
            </>
          )}

          {channel === "sms" && (
            <SmsForm
              emailSources={emailSources}
              loading={smsLoading}
              seedBrief={smsSeedBrief}
              seedSourceId={smsSeedSourceId}
              onGenerate={handleSmsGenerateRequest}
            />
          )}
        </div>
      </div>

      {/* Main canvas area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 pb-8">
          {channel === "email" && (<>
          {/* Sticky top bar + stepper */}
          <div className="sticky top-0 z-10 bg-chrome border-b border-line -mx-6 px-6">
            <div className="flex items-center justify-between gap-3 py-3">
              <div className="flex items-center gap-3 min-w-0">
                {stage === "canvas" && currentBriefInput && loadingPhase === null ? (
                  <div className="group relative flex items-center min-w-0">
                    <input
                      value={currentBriefInput.campaign_name}
                      onChange={(e) => handleRenameCampaign(e.target.value)}
                      className="font-medium text-sm text-ink bg-transparent border-b border-transparent hover:border-line-strong focus:border-accent focus:outline-none min-w-0 w-56 pr-5 transition-colors"
                      title="Click to rename campaign"
                    />
                    <svg aria-hidden className="pointer-events-none absolute right-0 w-3.5 h-3.5 text-ink-muted opacity-0 group-hover:opacity-100 transition-opacity" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                  </div>
                ) : (
                  <span className="font-mono text-xs text-ink-muted uppercase tracking-wide">New campaign</span>
                )}
                {canvasSource === "library" && <Chip tone="muted" className="shrink-0">library</Chip>}
                {canvasSource === "draft" && <Chip tone="warning" className="shrink-0">draft</Chip>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {campaign && (
                  <Button variant="ghost" size="sm" onClick={handleCopyCampaign} title="Copy campaign for Google Docs">
                    <svg aria-hidden className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    Copy
                  </Button>
                )}
                {renderSaveButtons()}
                {campaign && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => canvasSource === "library" ? resetAll() : setShowNewConfirm(true)}
                    title="Start new campaign"
                  >
                    New
                  </Button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4 pb-3">
              <Stepper activeKey={activeKey} canGoBack={canGoBack} onNavigate={onStepNavigate} />
              {loadingPhase === "conceits" && <span className="text-xs text-ink-muted">Generating conceits…</span>}
              {loadingPhase === "generating" && (
                <span className="text-xs text-ink-muted">
                  Writing — section {Math.min((campaign?.sections.length ?? 0) + 1, sectionStructure.length || 99)} of {sectionStructure.length || "…"}
                </span>
              )}
            </div>
          </div>

          {error && (
            <div className="mt-4 bg-danger-50 border border-danger-200 text-danger-600 text-sm rounded-md px-4 py-3">
              {error}
            </div>
          )}

          <div className="pt-5">
            {stage === "form" && loadingPhase === null && (
              <EmptyState
                icon={
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                }
                title="Start a campaign"
                description="Fill in the brief on the left and click Generate Brief to begin."
              />
            )}

            {loadingPhase === "conceits" && (
              <ConceitPicker loading conceits={[]} chosen={null} onPick={() => {}} />
            )}

            {stage === "conceits" && loadingPhase === null && (
              <div>
                {expandedBrief && (
                  <div className="bg-surface border border-line rounded-md px-6 py-4 mb-6">
                    <div className="font-mono text-xs text-ink-muted uppercase tracking-wide mb-2">Expanded Brief</div>
                    <p className="text-sm text-ink leading-relaxed">{expandedBrief.headline_thesis}</p>
                    <p className="text-sm text-ink-secondary mt-2 leading-relaxed">{expandedBrief.tonal_direction}</p>
                  </div>
                )}
                <ConceitPicker conceits={conceits} chosen={chosenConceit} onPick={handlePickConceit} onShuffle={handleNewConceits} />
              </div>
            )}

            {stage === "canvas" && campaign && (
              <CampaignCanvas
                campaign={campaign}
                expandedBrief={expandedBrief}
                chosenConceit={chosenConceit}
                retrievedExamples={retrievedExamples}
                sectionStructure={sectionStructure}
                toneDial={currentBriefInput?.tone_dial ?? 1}
                isGenerating={loadingPhase === "generating"}
                offer={currentBriefInput?.offer ?? ""}
                repetitionFlags={repetitionFlags}
                onDismissFlag={(key) => setRepetitionFlags((prev) => { const next = { ...prev }; delete next[key]; return next; })}
                onRegenerated={(updated) => void runRepetitionCheck(updated)}
                onChange={setCampaign}
                onConceitEdit={() => setStage("conceits")}
                onNewConceits={handleNewConceits}
              />
            )}
          </div>
          </>)}

          {channel === "sms" && (
            <>
              {/* SMS top bar */}
              <div className="sticky top-0 z-10 bg-chrome border-b border-line -mx-6 px-6">
                <div className="flex items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {smsCampaign ? (
                      <input
                        value={smsCampaign.name}
                        onChange={(e) => setSmsCampaign((c) => (c ? { ...c, name: e.target.value } : c))}
                        className="font-medium text-sm text-ink bg-transparent border-b border-transparent hover:border-line-strong focus:border-accent focus:outline-none min-w-0 w-56 transition-colors"
                        title="Click to rename SMS campaign"
                      />
                    ) : (
                      <span className="font-mono text-xs text-ink-muted uppercase tracking-wide">New SMS</span>
                    )}
                    <Chip tone="accent" className="shrink-0">SMS</Chip>
                    {smsSource === "final" && <Chip tone="muted" className="shrink-0">final</Chip>}
                    {smsSource === "draft" && <Chip tone="warning" className="shrink-0">draft</Chip>}
                  </div>
                  {smsCampaign && (
                    <div className="flex items-center gap-2 shrink-0">
                      <Button variant="ghost" size="sm" onClick={handleSmsCopy} title="Copy selected variant">Copy</Button>
                      <Button variant="secondary" size="sm" loading={smsSaving} onClick={() => handleSmsSave("draft")}>Save Draft</Button>
                      <Button variant="primary" size="sm" loading={smsSaving} onClick={() => handleSmsSave("final")}>Save Final</Button>
                      <Button variant="ghost" size="sm" onClick={handleSmsNew} title="Start new SMS">New</Button>
                    </div>
                  )}
                </div>
              </div>

              {error && (
                <div className="mt-4 bg-danger-50 border border-danger-200 text-danger-600 text-sm rounded-md px-4 py-3">{error}</div>
              )}

              <div className="pt-5">
                {!smsCampaign && !smsLoading && (
                  <EmptyState
                    icon={
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                    }
                    title="Write SMS copy"
                    description="Pick an email campaign to distill, or write a short brief, then Generate SMS."
                  />
                )}
                {smsLoading && !smsCampaign && (
                  <div className="flex items-center gap-2 text-sm text-ink-muted py-10 justify-center">
                    <span className="w-4 h-4 rounded-full border-2 border-line border-t-ink-muted animate-spin" />
                    Writing SMS variants…
                  </div>
                )}
                {smsCampaign && (
                  <SmsCanvas
                    campaign={smsCampaign}
                    isGenerating={smsLoading}
                    onSelect={handleSmsSelect}
                    onChangeVariant={handleSmsVariantChange}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {/* Confirmations (shared Modal primitive) */}
      <ConfirmModal
        open={showNewConfirm}
        onClose={() => setShowNewConfirm(false)}
        onConfirm={() => { setShowNewConfirm(false); resetAll(); }}
        title="Start a new campaign?"
        body="This will clear the canvas. Make sure you've saved anything you want to keep."
        confirmLabel="Yes, start fresh"
      />
      <ConfirmModal
        open={!!pendingPlannerRowId}
        onClose={() => { setPendingPlannerRowId(null); router.replace("/copy-builder"); }}
        onConfirm={() => { const id = pendingPlannerRowId; setPendingPlannerRowId(null); if (id) startPlannerBrief(id); }}
        title="You have an unsaved campaign"
        body="Start the planner brief? Your current canvas stays saved in this browser, so you can get back to it later."
        confirmLabel="Start planner brief"
        cancelLabel="Keep working"
      />
      <ConfirmModal
        open={!!pendingBriefInput}
        onClose={() => setPendingBriefInput(null)}
        onConfirm={() => { const input = pendingBriefInput; setPendingBriefInput(null); if (input) { if (campaign) resetAll(); handleBriefSubmit(input); } }}
        title={campaign ? "Start over?" : "Generate the brief?"}
        body={campaign
          ? "This will clear the current campaign and start a new brief. Any unsaved changes will be lost."
          : "Make sure you're done with the brief — this will expand it and generate conceits."}
        confirmLabel={campaign ? "Yes, regenerate" : "Yes, generate"}
      />
      <ConfirmModal
        open={!!pendingSmsGen}
        onClose={() => setPendingSmsGen(null)}
        onConfirm={() => { const a = pendingSmsGen; setPendingSmsGen(null); if (a) handleSmsGenerate(a); }}
        title={smsCampaign ? "Regenerate SMS?" : "Generate SMS?"}
        body={smsCampaign
          ? "This replaces the current variants. Any unsaved edits will be lost."
          : "This writes 3 SMS variants from the brief."}
        confirmLabel={smsCampaign ? "Yes, regenerate" : "Yes, generate"}
      />
      <ConfirmModal
        open={!!pendingPlannerSmsRowId}
        onClose={() => { setPendingPlannerSmsRowId(null); router.replace("/copy-builder"); }}
        onConfirm={() => { const id = pendingPlannerSmsRowId; setPendingPlannerSmsRowId(null); if (id) startSmsPlannerBrief(id); }}
        title="You have unsaved SMS copy"
        body="Start the planner SMS brief? Your current SMS variants will be cleared unless saved."
        confirmLabel="Start SMS brief"
        cancelLabel="Keep working"
      />
      <ConfirmModal
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        title={pendingDelete?.kind === "library" ? "Remove from library?" : pendingDelete?.kind === "sms" ? "Delete this SMS campaign?" : "Delete this campaign?"}
        body={pendingDelete?.kind === "library" ? "This removes the finalized campaign from the library." : pendingDelete?.kind === "sms" ? "This permanently deletes the saved SMS campaign." : "This permanently deletes the saved draft."}
        confirmLabel={pendingDelete?.kind === "library" ? "Remove" : "Delete"}
        danger
      />
    </div>
  );
}
