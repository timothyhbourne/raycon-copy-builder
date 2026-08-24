"use client";
import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
import { useRouter } from "next/navigation";
import type {
  BriefInput, ExpandedBrief, Conceit, GeneratedCampaign, GeneratedSection,
  LibraryCampaign, SavedCampaign, SectionType, SectionSpec, SmsCampaign, SmsBrief
} from "@/lib/schemas";
import { DEFAULT_TONE_DIAL } from "@/lib/schemas";
import type { PlannerRow } from "@/lib/planner-types";
import { plannerRowToBriefSeed } from "@/lib/planner-copy-link";
import { nanoid } from "@/lib/nanoid";
import { expandProductCardSections, expandUspSections } from "@/lib/expand-sections";
import { compileBrief } from "@/lib/brief/compile";
import { buildCopyExport, writeToClipboard } from "@/lib/copy-export";
import { normalizeSectionElements } from "@/lib/normalize-section";
import type { CheckElement, CheckMatch } from "@/lib/constructions";
import { scrubElements, scrubMeta, collectHardRuleElements, summarizeReport, autoFixMechanical } from "@/lib/hard-rules-client";
import {
  collectCheckElements, collectMetaElements, collectSectionElements,
  specForSection, targetForKey, type RepetitionFlag,
} from "@/lib/repetition-client";
import InputForm from "@/components/InputForm";
import CampaignCanvas from "@/components/CampaignCanvas";
import SmsForm, { type EmailSource, type SmsGenerateArgs } from "@/components/sms/SmsForm";
import SmsCanvas from "@/components/sms/SmsCanvas";
import LibraryBrowser from "@/components/LibraryBrowser";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import Drawer from "@/components/ui/Drawer";
import EmptyState from "@/components/ui/EmptyState";
import { ConfirmModal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toast";
import {
  LS_DRAFT, makeSlug, resetState,
  blankCampaign, blankBriefInput, scratchBriefReady, SCRATCH_ASSISTS_DISABLED_REASON,
  type Stage, type CanvasSource, type PlannerLinkContext,
  type StepKey, type LibraryMeta, type SavedMeta,
} from "./helpers";
import { useCampaignSections } from "./useCampaignSections";
import { alignSpecIds } from "@/lib/campaign-sections";
import { unverifiedReviews, describeUnverified, migrateLegacyProvenance } from "@/lib/reviews/provenance";
import { decideLink, stripPlannerLinkFromRestoredForm } from "@/lib/planner-link-decision";
import { PRODUCT_CATEGORIES } from "@/lib/products";
import { DeepLinkReader, Stepper, AutosaveStatus, CollapseIcon, PanelIcon, LibraryIcon } from "./components";
import SectionPicker from "@/components/SectionPicker";

// One recently-touched campaign, whichever store it came from.
interface RecentItem {
  kind: "draft" | "library" | "sms";
  id: string;
  title: string;
  meta: string;
  ts: string;
}

export default function Home() {
  const [stage, setStage] = useState<Stage>("form");
  // Single loading phase — eliminates any in-between render where two booleans
  // could both be false at the same time and flash the empty state.
  const [loadingPhase, setLoadingPhase] = useState<null | "generating">(null);
  const [error, setError] = useState<string | null>(null);

  const [currentBriefInput, setCurrentBriefInput] = useState<BriefInput | null>(null);
  const [expandedBrief, setExpandedBrief] = useState<ExpandedBrief | null>(null);
  const [retrievedExamples, setRetrievedExamples] = useState<LibraryCampaign[]>([]);
  const [chosenConceit, setChosenConceit] = useState<Conceit | null>(null);
  const [campaign, setCampaign] = useState<GeneratedCampaign | null>(null);
  const [sectionStructure, setSectionStructure] = useState<SectionSpec[]>([]);
  // Similarity flags keyed by element key — see runRepetitionCheck / repetition-client.
  const [repetitionFlags, setRepetitionFlags] = useState<Record<string, RepetitionFlag>>({});
  const [savingStatus, setSavingStatus] = useState<"idle" | "saving">("idle");
  const [pendingDelete, setPendingDelete] = useState<{ id: string; kind: "saved" | "library" | "sms" } | null>(null);
  const [pendingBriefInput, setPendingBriefInput] = useState<BriefInput | null>(null);
  const [showNewConfirm, setShowNewConfirm] = useState(false);
  // Same guard as showNewConfirm, for the blank-canvas branch of the New menu.
  const [pendingBlankCanvas, setPendingBlankCanvas] = useState(false);
  // Blank-canvas + insertion state (spec 2, 3).
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  // A freshly inserted section to scroll to, so "Add section" from the toolbar
  // never looks like it did nothing.
  const [scrollToSectionId, setScrollToSectionId] = useState<string | null>(null);
  // Stage-aware chrome: a collapsible brief panel beside the canvas, plus the
  // campaign browser as an on-demand WIDE drawer. It used to be a permanent
  // 240px column wedged between the nav and the brief, which truncated every
  // title and sandwiched the brief between two lists (Phase 3b).
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(true);

  // Tracks where the canvas content came from
  const [canvasSource, setCanvasSource] = useState<CanvasSource>("new");
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [currentLibraryId, setCurrentLibraryId] = useState<string | null>(null);

  // Section mutations. These live in a hook because every one of them has to move
  // `campaign.sections` and `sectionStructure` together — the canvas only receives
  // the structure read-only, which is exactly why inserting used to leave every
  // later section resolving another section's spec (spec 4).
  const sectionOps = useCampaignSections({
    campaign,
    sectionStructure,
    setCampaign,
    setSectionStructure,
    onInserted: setScrollToSectionId,
  });

  // A hand-written canvas: the brief is editable inline and the AI assists stay
  // disabled (with a stated reason) until it carries enough to compile.
  const isScratch = canvasSource === "scratch";
  const briefReady = !isScratch || scratchBriefReady(currentBriefInput);
  const assistsDisabledReason = briefReady ? undefined : SCRATCH_ASSISTS_DISABLED_REASON;
  const productOptions = useMemo(() => PRODUCT_CATEGORIES.flatMap((c) => c.products), []);

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

  const refreshBrowseLists = useCallback(async () => {
    const [libRes, savedRes, smsRes] = await Promise.all([
      fetch("/api/library"), fetch("/api/campaigns"), fetch("/api/sms"),
    ]);
    // Each parse is independent: a single failing store (e.g. a 500) must not
    // abort the others, or one broken list blanks all three.
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

  useEffect(() => { refreshBrowseLists(); }, [refreshBrowseLists]);

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
        // NOTE: plannerLink is deliberately NOT read back. A restored canvas is
        // content, not a planner handoff — the association comes from the SAVED COPY
        // RECORD on the load paths below, which is the only source that can't go
        // stale (spec §3.1).
        const { campaign: c, expandedBrief: eb, chosenConceit: cc, sectionStructure: ss, draftId, briefInput: bi } = JSON.parse(raw);
        if (c) {
          setCampaign(migrateLegacyProvenance(c));
          setExpandedBrief(eb);
          setChosenConceit(cc);
          // Specs are resolved by id now, so a draft saved before that stamps its
          // section ids onto them on the way in (spec 4.3).
          setSectionStructure(alignSpecIds(c.sections ?? [], ss || [], "local draft"));
          setCurrentDraftId(draftId || null);
          // Restored briefs carry no planner association either — InputForm strips
          // it on its own restore, and this one must agree or the two disagree about
          // what this campaign is linked to.
          setCurrentBriefInput(bi ? stripPlannerLinkFromRestoredForm(bi) : null);
          setPlannerLink(null);
          setCanvasSource("draft");
          setStage("canvas");
        }
      } catch { /* */ }
    }
  }, []);

  // Persist in-progress work to localStorage
  useEffect(() => {
    if (campaign && canvasSource !== "library") {
      // plannerLink is NOT persisted: it is a session-scoped intent carried by a
      // deep link, and making it durable is what let it outlive the campaign that
      // created it (spec §3.1).
      localStorage.setItem(LS_DRAFT, JSON.stringify({
        campaign, expandedBrief, chosenConceit, sectionStructure,
        draftId: currentDraftId, briefInput: currentBriefInput,
      }));
    }
  }, [campaign, expandedBrief, chosenConceit, sectionStructure, currentDraftId, currentBriefInput, canvasSource]);

  // Auto-collapse the brief panel on the canvas, auto-expand on the form. Runs
  // only on stage change, so a manual toggle persists within a stage.
  useEffect(() => {
    if (stage === "canvas") setBriefOpen(false);
    else if (stage === "form") setBriefOpen(true);
  }, [stage]);

  // ---- Blank canvas (spec 2) ---------------------------------------------
  // Straight to an empty, editable canvas. No brief form, no generation, no LLM
  // call — the writer adds modules and types the copy themselves.
  const startBlankCanvas = () => {
    flushAutosaveRef.current();   // don't lose a pending library edit on the way out
    setError(null);
    setChannel("email");
    setCampaign(blankCampaign());
    setSectionStructure([]);
    setCurrentBriefInput(blankBriefInput());
    // Deliberately null: the brief compiles as soon as the writer types a name and
    // an offer (see the effect below), and until then the assists say why.
    setExpandedBrief(null);
    setChosenConceit(null);
    setRetrievedExamples([]);
    setRepetitionFlags({});
    setCurrentDraftId(null);
    setCurrentLibraryId(null);
    setPlannerLink(null);
    setCanvasSource("scratch");
    setStage("canvas");
    setNewMenuOpen(false);
  };

  // Compile the scratch canvas's minimum viable brief, debounced. compileBrief is
  // deterministic and has no LLM step, so re-running it on every edit is cheap —
  // and it is what keeps element regeneration, section variations and meta
  // regeneration alive on a hand-written canvas (spec 2.3). The same trick the
  // library-load path already uses for records saved before the brief existed.
  useEffect(() => {
    if (canvasSource !== "scratch" || !currentBriefInput) return;
    if (!scratchBriefReady(currentBriefInput)) {
      // Went back to empty: drop the compiled brief so the assists re-disable
      // rather than running against a half-brief.
      setExpandedBrief(null);
      setChosenConceit(null);
      return;
    }
    const t = setTimeout(() => {
      try {
        const compiled = compileBrief(currentBriefInput);
        setExpandedBrief(compiled.expanded_brief);
        setChosenConceit(compiled.conceit);
      } catch {
        /* a half-typed brief is not an error — the assists just stay off */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [canvasSource, currentBriefInput]);

  // ⌘/Ctrl+S → Save Draft. Kept in a ref (refreshed each render) so the single
  // listener always sees current state without re-subscribing.
  const saveShortcutRef = useRef<() => void>(() => {});
  useEffect(() => {
    saveShortcutRef.current = () => { if (campaign && stage === "canvas" && savingStatus !== "saving") handleSaveDraft(); };
  });
  // ⌘⇧A → Add section. Same ref trick, so the handler always sees the current
  // stage without re-subscribing the listener.
  const addSectionShortcutRef = useRef<() => void>(() => {});
  useEffect(() => {
    addSectionShortcutRef.current = () => {
      if (campaign && stage === "canvas" && channel === "email" && loadingPhase === null) setAddSectionOpen(true);
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveShortcutRef.current();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        addSectionShortcutRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- Planner handoff ---------------------------------------------------

  /**
   * Clear the planner handoff — ALL of it, in one place.
   *
   * Three call sites used to do this by hand, and softResetToForm forgot
   * `plannerLink`: it cleared the brief, the campaign and the structure, then left
   * the link behind so the next unrelated campaign stamped the old row (spec §3.2,
   * hole c). One helper means a future reset path can't forget a field.
   */
  const clearPlannerHandoff = useCallback(() => {
    setPlannerLink(null);
    setFormSeed(null);
    setFormSeedLabel(null);
    setSeedAiFailed(false);
    setSeedingProducts(false);
  }, []);

  // Move to a clean brief form WITHOUT destroying the canvas draft in storage
  // (the persist effect only writes when a campaign exists, and we don't remove
  // the key). Used when the writer chooses to start a planner brief over an
  // existing canvas.
  const softResetToForm = () => {
    flushAutosaveRef.current();   // persist any pending library edit before leaving
    setStage("form");
    setChannel("email");   // returning to the email brief form
    setCampaign(null);
    setExpandedBrief(null);
    setChosenConceit(null);
    setSectionStructure([]);
    setCurrentBriefInput(null);
    setCanvasSource("new");
    setCurrentDraftId(null);
    setCurrentLibraryId(null);
    // This was hole (c): without it, a soft reset kept the planner handoff and the
    // NEXT, unrelated campaign stamped the old row on save.
    clearPlannerHandoff();
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

  // Re-sync the planner's notes/learnings into the brief on demand. Reads the
  // CURRENT row (notes edited after the handoff are the whole point) and asks
  // copy-seed for the deterministic block only — no model call. Never touches
  // the generated copy; the writer regenerates when they want it applied.
  const refreshPlannerNotes = useCallback(async (): Promise<string | null> => {
    const rowId = plannerLink?.rowId ?? currentBriefInput?.planner_row_id;
    if (!rowId) return null;
    try {
      const res = await fetch(`/api/planner?id=${encodeURIComponent(rowId)}`);
      const row = res.ok ? ((await res.json()).row as PlannerRow | null) : null;
      if (!row) throw new Error("That planner row no longer exists.");
      const seedRes = await fetch("/api/copy-seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row, notes_only: true }),
      });
      if (!seedRes.ok) throw new Error("Could not read the planner notes.");
      const data = await seedRes.json();
      return (data.seed?.planner_notes as string | undefined) ?? null;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not refresh the planner notes.");
      throw e;   // InputForm resets its own refreshing state
    }
  }, [plannerLink, currentBriefInput]);

  const handleClearSeed = () => clearPlannerHandoff();

  // A pending reassignment awaiting the writer's answer (spec §3.3).
  const [pendingReassign, setPendingReassign] = useState<{
    rowId: string; copyCampaignId: string; copyStatus: "draft" | "final"; ownerName: string;
  } | null>(null);

  /**
   * Detach the planner link from the Copy Builder (spec §3.4).
   *
   * Clears the pending handoff so the next save writes nothing, and — when the row
   * has ALREADY been stamped with this copy — releases it server-side too. The
   * writer was previously told about a link only after it had been written, with no
   * way to undo it from here.
   */
  const detachPlannerLink = async () => {
    const rowId = plannerLink?.rowId ?? currentBriefInput?.planner_row_id;
    const savedCopyId = currentLibraryId ?? currentDraftId;
    clearPlannerHandoff();
    setCurrentBriefInput((prev) => (prev ? stripPlannerLinkFromRestoredForm(prev) : prev));
    if (!rowId) return;
    try {
      // Only release the row if it actually points at THIS copy — never unlink
      // someone else's campaign on our way out.
      const res = await fetch(`/api/planner?id=${encodeURIComponent(rowId)}`);
      const row = res.ok ? ((await res.json()).row ?? null) : null;
      if (savedCopyId && row?.copy_campaign_id === savedCopyId) {
        await fetch(`/api/planner/link?row_id=${encodeURIComponent(rowId)}`, { method: "DELETE" });
        toast.success("Unlinked from the planner");
        return;
      }
      toast.info("This campaign will no longer be linked to the planner.");
    } catch {
      toast.info("This campaign will no longer be linked to the planner.");
    }
  };

  /** Post the link. `reassign` is sent only after the writer has agreed to take a
   * row from another copy — without it the API answers 409 (spec §3.5). */
  const postPlannerLink = async (
    rowId: string,
    copyCampaignId: string,
    copyStatus: "draft" | "final",
    reassign = false,
  ) => {
    try {
      const res = await fetch("/api/planner/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row_id: rowId, copy_campaign_id: copyCampaignId, copy_status: copyStatus, reassign }),
      });
      if (res.ok) { toast.success("Linked to planner ✓"); return; }
      if (res.status === 409) {
        // The server's own guard caught what the client should have asked about.
        const data = await res.json().catch(() => ({}));
        const ownerName = data?.conflict?.owner_name ?? "another campaign";
        setPendingReassign({ rowId, copyCampaignId, copyStatus, ownerName });
        return;
      }
      console.error(`Planner write-back failed (HTTP ${res.status})`);
    } catch (e) {
      console.error("Planner write-back failed", e);
    }
  };

  /**
   * Stamp the planner row after a successful copy save.
   *
   * The link target used to be read straight out of ambient state and written:
   * `plannerLink?.rowId ?? currentBriefInput?.planner_row_id`, both of which
   * outlived the campaign that set them. Now the row is FETCHED and the decision is
   * explicit (see decideLink): link only when the row is free or already ours, ask
   * before taking one another copy owns, and clear the handoff when the row is gone.
   *
   * Still fire-and-forget with respect to the save: the copy is already saved, so a
   * link problem must never present as a save failure.
   */
  const writeBackToPlanner = async (copyCampaignId: string, copyStatus: "draft" | "final") => {
    const rowId = plannerLink?.rowId ?? currentBriefInput?.planner_row_id;
    if (!rowId) return;
    try {
      const res = await fetch(`/api/planner?id=${encodeURIComponent(rowId)}`);
      const row = res.ok ? ((await res.json()).row ?? null) : null;
      const decision = decideLink({ rowId, row, copyCampaignId });

      if (decision.action === "none") return;
      if (decision.action === "missing") {
        // Don't link, and stop carrying the dead reference around.
        clearPlannerHandoff();
        toast.info("That planner row no longer exists, so nothing was linked.");
        return;
      }
      // Both the "safe" and the "conflict" cases go through the same call: it is
      // sent WITHOUT reassign, so the API resolves the current owner's real name and
      // answers 409, and postPlannerLink raises the prompt from that. One code path,
      // and the message names a campaign rather than an id.
      await postPlannerLink(rowId, copyCampaignId, copyStatus);
    } catch (e) {
      console.error("Planner write-back skipped", e);
    }
  };

  // Full reset (canvas + planner handoff).
  const resetAll = () => {
    flushAutosaveRef.current();   // persist any pending library edit before clearing
    resetState({
      setStage, setCampaign, setExpandedBrief, setChosenConceit,
      setSectionStructure, setCurrentBriefInput,
      setCanvasSource, setCurrentDraftId, setCurrentLibraryId,
    });
    setChannel("email");   // "New" always returns to a fresh email brief
    clearPlannerHandoff();
    setRepetitionFlags({});
  };

  // Always confirm before generating: a plain "done with the brief?" check when
  // the canvas is empty, and a stronger "start over?" warning when a campaign
  // is already on screen (generating would replace it).
  const handleBriefSubmitRequest = (input: BriefInput) => {
    setPendingBriefInput(input);
  };

  // The whole fast path: structured picks → straight to generation. The brief is
  // compiled DETERMINISTICALLY server-side (no brief-expansion or conceits LLM
  // step); the compiled brief + conceit come back on the first stream event so
  // the client can persist them (save + regenerate/variations run off them).
  const handleBriefSubmit = async (input: BriefInput) => {
    setError(null);
    // Expand product_card sections so each card maps to a selected product, and
    // resolve every Auto USP slot to a concrete SKU — both before the structure is
    // persisted, so a saved campaign reloads with the same bindings it generated from.
    const expandedStructure = expandUspSections(
      expandProductCardSections(input.section_structure, input.products_featured),
      input.products_featured,
      input.hero_product_slug
    );
    const normalised: BriefInput = { ...input, section_structure: expandedStructure };
    setCurrentBriefInput(normalised);
    setSectionStructure(expandedStructure);
    // Clear any stale planner link when this brief is NOT tied to a planner row.
    // Without this, a plannerLink left over (persisted in localStorage) from an
    // earlier planner-seeded copy would make this fresh copy's save stamp the
    // wrong planner row — the "every copy links to the evergreen row" bug.
    if (!input.planner_row_id) setPlannerLink(null);

    // Retrieve similar past campaigns (client-side scoring) to pass into generate.
    let topExamples: LibraryCampaign[] = [];
    try {
      const libRes = await fetch("/api/library?all=true");
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
      topExamples = scored.sort((a, b) => b.score - a.score).slice(0, 4).map((x) => x.c);
      setRetrievedExamples(topExamples);
    } catch { /* retrieval is best-effort; generation proceeds without examples */ }

    // Straight to the canvas; copy streams in progressively.
    setLoadingPhase("generating");
    const empty: GeneratedCampaign = { meta: { subject_lines: [], preview_texts: [] }, sections: [] };
    setCampaign(empty);
    setRepetitionFlags({});
    setCanvasSource("new");
    setStage("canvas");

    let compiledBrief: ExpandedBrief | null = null;
    let compiledConceit: Conceit | null = null;
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief_input: normalised, retrieved_examples: topExamples }),
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
          if (!payload.startsWith("{")) continue;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.compiled) {
              // The deterministic brief, compiled server-side. Persist for save +
              // regenerate/variations, and record the derived stage/urgency.
              compiledBrief = parsed.compiled.expanded_brief;
              compiledConceit = parsed.compiled.conceit;
              setExpandedBrief(compiledBrief);
              setChosenConceit(compiledConceit);
              setCurrentBriefInput((prev) => (prev ? { ...prev, send_stage: parsed.compiled.send_stage, urgency: parsed.compiled.urgency } : prev));
              // Explain any Review card that will come back empty — we never
              // fabricate, so an empty field is always a real data gap.
              const gaps: { slug: string; name: string }[] = parsed.review_gaps ?? [];
              if (gaps.length) {
                toast.info(
                  `${gaps.length} review slot${gaps.length === 1 ? "" : "s"} could not be filled with a real review, so ${gaps.length === 1 ? "it stays" : "they stay"} empty: ${gaps.map((g) => g.name).join("; ")}. Fetch one on the canvas, paste it in manually, or add it to data/reviews/<SKU>.json.`
                );
              }
            } else if (parsed.meta) {
              // Deterministic punctuation scrub before anything renders.
              meta = scrubMeta(parsed.meta);
              setCampaign({ meta, sections: [...sections] });
            } else if (parsed.type) {
              const { elements, ...slates } = normalizeSectionElements(scrubElements(parsed.elements));
              // Take the id of the spec this section was generated FROM. Sections
              // stream back in structure order, so index alignment is exact here —
              // and adopting the id is what lets everything downstream resolve a
              // section's spec by id instead of by position (spec 4.2).
              const specForThis = expandedStructure[sections.length];
              const newSection: GeneratedSection = {
                id: specForThis?.type === parsed.type ? specForThis.id : nanoid(),
                type: parsed.type,
                elements,
                ...slates,
                // Provenance for the reviews the SERVER verified. Anything the model
                // invented was already emptied on the wire, so a Review that arrives
                // with text but no record cannot happen on this path — and if it ever
                // does, the Save Final gate catches it.
                ...(parsed.review_provenance ? { review_provenance: parsed.review_provenance } : {}),
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
      void runHardRulesCheck({ meta, sections });
      void runRepetitionCheck({ meta, sections }, { brief: compiledBrief, conceit: compiledConceit });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
      setCampaign(null);
      setStage("form");
    } finally {
      setLoadingPhase(null);
    }
  };


  // ---- Post-generation hard-rules gate --------------------------------------
  // Punctuation (em/en dashes, ellipses, stacked "!") is auto-fixed as copy
  // streams in, so it never reaches the canvas. This second pass POSTs the
  // finished copy to /api/hard-rules-check and surfaces the non-fixable
  // violations (banned words, hype words, the retired "Classic", length caps)
  // as a concise notice. Fails open — never blocks the user.
  const runHardRulesCheck = async (campaignToCheck: GeneratedCampaign) => {
    try {
      const elements = collectHardRuleElements(campaignToCheck);
      if (!elements.length) return;
      const res = await fetch("/api/hard-rules-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ elements }),
      });
      if (!res.ok) return;
      const { report } = await res.json();
      if (report && !report.ok) {
        const summary = summarizeReport(report);
        if (summary) toast.error(`Hard-rule check: ${summary}`);
      }
    } catch (e) {
      console.warn("Hard-rules check skipped:", e);
    }
  };

  // ---- Post-generation repetition checker (Step 3c) --------------------------
  // Collect the checkable elements, ask the check endpoint for near-duplicates,
  // auto-retry each offending target ONCE via the existing regenerate APIs, then
  // flag anything still too close. Fails open — never blocks saving.
  const MAX_AUTO_RETRIES = 4;

  const runRepetitionCheck = async (
    campaignToCheck: GeneratedCampaign,
    opts?: { brief?: ExpandedBrief | null; conceit?: Conceit | null },
  ) => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    // The compiled brief/conceit may have just been set from the generate
    // stream (state not yet flushed to this closure), so accept explicit values.
    const brief = opts?.brief ?? expandedBrief;
    const conceit = opts?.conceit ?? chosenConceit;
    if (!campaignToCheck?.sections || !brief || !conceit) return;

    const excludeId = currentLibraryId ?? undefined;
    const toneDial = currentBriefInput?.tone_dial ?? DEFAULT_TONE_DIAL;

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
        reason: m.reason,
        construction: m.construction,
      });
      const dedupNote = (m: CheckMatch) => {
        const prev = textById.get(m.id) ?? "";
        // A form match must name the SHAPE. Telling the model "this duplicates a
        // past campaign" when no words are shared invites it to reword and land on
        // the same construction again.
        if (m.reason === "form") {
          return `Your previous version of this element ("${prev}") is built on the same construction as a past send ("${m.match_text}", ${m.match_campaign_title}, ${m.match_date}) — shared shape: ${m.construction ?? "same build"}. The words are already different and that is not enough. Change the CONSTRUCTION: a different pattern, a different opening move, a different rhythm.`;
        }
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
                expanded_brief: brief,
                chosen_conceit: conceit,
                current_campaign_summary: summary,
                library_id: excludeId,
                avoid_note: note,
              }),
            });
            const data = await res.json();
            if (data.subject_lines || data.preview_texts) {
              working = {
                ...working,
                meta: scrubMeta({
                  subject_lines: data.subject_lines || working.meta.subject_lines,
                  preview_texts: data.preview_texts || working.meta.preview_texts,
                }),
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
                expanded_brief: brief,
                chosen_conceit: conceit,
                section_to_regenerate: { ...spec, current_content: section },
                full_campaign: working,
                steering: note,
                tone_dial: toneDial,
                retrieved_examples: retrievedExamples,
              }),
            });
            const data = await res.json();
            if (data.section) {
              const fixedSection: GeneratedSection = {
                ...data.section,
                elements: scrubElements(data.section.elements) as GeneratedSection["elements"],
              };
              working = { ...working, sections: working.sections.map((s) => (s.id === target ? fixedSection : s)) };
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
    angle: "offer_led",
    products_featured: expandedBrief?.products_featured ?? [],
    section_structure: sectionStructure,
  });

  const handleSaveDraft = async () => {
    if (!campaign) { setError("Nothing to save yet — generate a campaign first."); return; }
    const bi = currentBriefInput ?? deriveBriefFallback();
    setSavingStatus("saving");
    setError(null);
    try {
      const id = currentDraftId
        || `${new Date().toISOString().split("T")[0]}-${makeSlug(bi.campaign_name) || "untitled"}-${nanoid().slice(0, 6)}`;
      const saved: SavedCampaign = {
        id,
        campaign_name: bi.campaign_name,
        campaign_type: bi.campaign_type,
        offer: bi.offer,
        promo_code: bi.promo_code,
        audience: bi.audience,
        // Selection-driven brief fields — persisted so a reload rebuilds it.
        angle: bi.angle,
        promotion_id: bi.promotion_id,
        occasion: bi.occasion,
        hero_product_slug: bi.hero_product_slug,
        send_stage: bi.send_stage,
        urgency: bi.urgency,
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
      void writeBackToPlanner(id, "draft");   // stamp the planner row (fire-and-forget)
      await refreshBrowseLists();
      toast.success("Draft saved");
    } catch (e) {
      setSavingStatus("idle");
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  const handleSaveFinal = async () => {
    if (!campaign) { setError("Nothing to save yet — generate a campaign first."); return; }
    // THE ONE BLOCKING GATE. Everything else in the hard-rules report is craft and
    // stays advisory; a review nothing verified is a factual claim about a customer
    // who may not exist, and this is the one case where shipping is worse than
    // being interrupted (docs/REVIEWS_MODULE_SPEC.md §5.2 point 3). Checked from
    // local state, so it is instant and cannot be skipped by a failed request.
    const unverified = unverifiedReviews(campaign);
    if (unverified.length) {
      toast.error(
        `Can't finalise: ${unverified.length} review${unverified.length === 1 ? "" : "s"} ${unverified.length === 1 ? "has" : "have"} no source on record (${describeUnverified(unverified)}). Fetch a real one on the canvas, paste one in, or clear the slot.`
      );
      return;
    }
    const bi = currentBriefInput ?? deriveBriefFallback();
    // Hand-written copy gets the same gate as generated copy. The generation path
    // runs this as the stream finishes; a scratch canvas has no such moment, so
    // Save Final is where it runs. The rules are about brand safety, not about who
    // typed the words (spec 2.4).
    if (canvasSource === "scratch") void runHardRulesCheck(campaign);
    setSavingStatus("saving");
    setError(null);
    try {
      // Fall back to a nanoid when the name slugs to empty, so the id is always
      // valid (no trailing-dash "2026-07-28-") and never silently collides.
      const id = currentLibraryId ||
        `${new Date().toISOString().split("T")[0]}-${makeSlug(bi.campaign_name) || nanoid().slice(0, 6)}`;

      const res = await fetch("/api/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          brief_input: bi,
          conceit: chosenConceit,
          campaign,
          section_structure: sectionStructure,
          // Omit when there's no draft — the schema's optional id rejects null,
          // which is what forced a "Save Draft first" before Save Final worked.
          draft_id: currentDraftId ?? undefined,
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
      void writeBackToPlanner(id, "final");   // flip the planner chip to "final"
      await refreshBrowseLists();
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
          refreshBrowseLists();               // keep browser titles in sync with edits
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
        // Campaigns saved before provenance existed carry real reviews and no
        // records; they migrate to "curated" so the new gate doesn't retroactively
        // block every saved campaign (spec §6).
        setCampaign(migrateLegacyProvenance(c.campaign));
        setRepetitionFlags({});
        setSectionStructure(alignSpecIds(c.campaign?.sections ?? [], c.section_structure ?? [], `draft ${id}`));
        const savedBriefInput: BriefInput = {
          campaign_name: c.campaign_name,
          campaign_type: c.campaign_type,
          offer: c.offer,
          promo_code: c.promo_code,
          audience: c.audience,
          // Selection-driven brief fields — restored so the form rebuilds the
          // same brief (older saves predate them, so fall back sensibly).
          angle: c.angle ?? "offer_led",
          promotion_id: c.promotion_id,
          occasion: c.occasion,
          hero_product_slug: c.hero_product_slug,
          send_stage: c.send_stage,
          urgency: c.urgency,
          products_featured: c.products_featured,
          section_structure: c.section_structure ?? [],
          planner_row_id: c.planner_row_id,
        };
        setCurrentBriefInput(savedBriefInput);
        // Saves from before the selection-driven brief carry no expanded_brief /
        // chosen_conceit. Recompile deterministically rather than leaving them
        // null, which silently disabled regenerate + variations on the canvas.
        const savedCompiled = (!c.expanded_brief || !c.chosen_conceit)
          ? compileBrief(savedBriefInput)
          : null;
        setExpandedBrief(c.expanded_brief ?? savedCompiled?.expanded_brief ?? null);
        setChosenConceit(c.chosen_conceit ?? savedCompiled?.conceit ?? null);
        setPlannerLink(c.planner_row_id ? { rowId: c.planner_row_id, name: c.campaign_name, channel: "email" } : null);
        setCurrentDraftId(id);
        setCurrentLibraryId(null);
        setCanvasSource("draft");
        setChannel("email");   // email draft — canvas render is gated on channel
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
      await refreshBrowseLists();
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
      setCampaign(migrateLegacyProvenance(lib.structured.campaign));
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

    // Library entries predate id-matched specs; pair them up on the way in so the
    // canvas can resolve each section's spec by id (spec 4.3).
    setSectionStructure(
      alignSpecIds(lib.structured?.campaign?.sections ?? [], sectionStructureForView, `library ${id}`),
    );
    setRepetitionFlags({});

    const libBriefInput: BriefInput = {
      campaign_name: lib.title,
      campaign_type: lib.campaign_type,
      offer: lib.offer,
      promo_code: lib.promo_code,
      audience: lib.audience,
      // Library items predate the selection-driven brief; default the angle.
      angle: "offer_led",
      products_featured: lib.products_featured,
      section_structure: sectionStructureForView,
      planner_row_id: lib.planner_row_id,
    };
    setCurrentBriefInput(libBriefInput);
    setPlannerLink(lib.planner_row_id ? { rowId: lib.planner_row_id, name: lib.title, channel: "email" } : null);
    // Library entries predate the selection-driven brief and store no
    // expanded_brief. Leaving it null made regenerate/variations bail out with
    // "No alternatives came back" before any request was sent, because the
    // canvas guards on `expandedBrief && chosenConceit`. compileBrief is pure and
    // deterministic, so we rebuild a serviceable brief from the fields the
    // library DOES carry rather than blocking the feature.
    const libCompiled = compileBrief(libBriefInput);
    setChosenConceit(lib.conceit ? { id: "lib", name: lib.conceit, description: "" } : libCompiled.conceit);
    setExpandedBrief(libCompiled.expanded_brief);
    setCurrentLibraryId(id);
    setCurrentDraftId(null);
    setCanvasSource("library");
    setChannel("email");   // this is email copy — the canvas is gated on channel
    setStage("canvas");
  };

  const handleRenameCampaign = (name: string) => {
    if (currentBriefInput) setCurrentBriefInput({ ...currentBriefInput, campaign_name: name });
  };

  // Copy the whole campaign to the clipboard, in both flavours. The build lives
  // in lib/copy-export.ts so the Flow Builder's Copy button produces the same
  // document from the same code — two implementations would have drifted.
  const handleCopyCampaign = async () => {
    if (!campaign) return;
    const name = currentBriefInput?.campaign_name || "Campaign";
    const flavour = await writeToClipboard(buildCopyExport(campaign, sectionStructure, {
      title: name,
      ...(chosenConceit
        ? { subtitle: { label: "Conceit", value: chosenConceit.name, note: chosenConceit.description } }
        : {}),
    }));
    toast.success(flavour === "rich" ? "Copied for Google Docs" : "Copied to clipboard");
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
        variants: (data.variants as SmsCampaign["variants"]).map((v) => ({ text: autoFixMechanical(v.text) })) as SmsCampaign["variants"],
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
      void writeBackToPlanner(id, status);
      await refreshBrowseLists();
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
  const activeKey: StepKey = loadingPhase === "generating" ? "canvas" : (stage as StepKey);
  const canGoBack = (key: StepKey) => key === "form" && activeKey === "canvas";
  const onStepNavigate = (key: StepKey) => {
    if (key === "form") setStage("form");
  };

  // --- Browse surface (drawer + "pick up where you left off") --------------
  const browseCount = savedItems.length + libraryItems.length + smsItems.length;

  // The four most recently touched things across all three stores. Shown on the
  // empty canvas so the blank brief stage isn't a dead end — it used to be the
  // only place the (now drawer-bound) list of campaigns was visible.
  const recentItems: RecentItem[] = useMemo(() => {
    const items: RecentItem[] = [
      ...savedItems.map((i) => ({
        kind: "draft" as const, id: i.id, title: i.campaign_name, ts: i.updated_at ?? "",
        meta: [i.campaign_type, (i.updated_at ?? "").slice(0, 10)].filter(Boolean).join(" · "),
      })),
      ...libraryItems.map((i) => ({
        kind: "library" as const, id: i.id, title: i.title, ts: i.date ?? "",
        meta: [(i.date ?? "").slice(0, 10), i.campaign_type].filter(Boolean).join(" · "),
      })),
      ...smsItems.map((i) => ({
        kind: "sms" as const, id: i.id, title: i.name, ts: i.updated_at ?? "",
        meta: (i.updated_at ?? "").slice(0, 10),
      })),
    ];
    return items.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 4);
  }, [savedItems, libraryItems, smsItems]);

  const openRecent = (item: RecentItem) => {
    if (item.kind === "draft") handleLoadSaved(item.id);
    else if (item.kind === "library") handleViewLibrary(item.id);
    else handleLoadSms(item.id);
  };

  return (
    <div className="rc-content-panel flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Deep-link reader (Next 16 requires useSearchParams under Suspense) */}
      <Suspense fallback={null}>
        <DeepLinkReader onPlanner={handlePlannerDeepLink} onCampaign={handleCampaignDeepLink} />
      </Suspense>

      {/* Workspace toolbar — ONE full-width bar carrying what the campaign is
          and what you can do to it. Replaces the two per-channel sticky bars
          that used to sit inside the canvas column, and gives the Library a
          home as a button so it no longer needs a column of its own. */}
      <div className="shrink-0 border-b border-line bg-surface px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="secondary" size="sm" onClick={() => setLibraryOpen(true)}
            title="Browse drafts, library & SMS campaigns">
            <LibraryIcon />
            Library
            <span className="font-normal text-ink-muted tabular-nums">{browseCount}</span>
          </Button>
          <span aria-hidden className="w-px h-5 bg-line shrink-0" />
          {channel === "email" ? (
            <>
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
                <span className="t-label truncate">New campaign</span>
              )}
              {canvasSource === "library" && <Chip tone="muted" className="shrink-0">library</Chip>}
              {canvasSource === "draft" && <Chip tone="warning" className="shrink-0">draft</Chip>}
              {/* A hand-written canvas that has never been saved. Says so, so the
                  writer knows this one is theirs and is not yet persisted. */}
              {canvasSource === "scratch" && <Chip tone="accent" className="shrink-0">blank canvas</Chip>}
              {/* The planner link, BEFORE it is written. It used to be invisible
                  until the "Linked to planner ✓" toast fired after the save, which is
                  the wrong moment to find out (spec §3.4). */}
              {(plannerLink?.rowId || currentBriefInput?.planner_row_id) && stage === "canvas" && (
                <span className="inline-flex items-center gap-1 shrink-0 max-w-[240px]" title={`This copy will be linked to the planner row "${plannerLink?.name ?? currentBriefInput?.planner_row_id}"`}>
                  <Chip tone="accent" className="truncate">
                    Linked to: {plannerLink?.name ?? currentBriefInput?.planner_row_id}
                  </Chip>
                  <button
                    type="button"
                    onClick={() => void detachPlannerLink()}
                    aria-label="Detach this campaign from the planner row"
                    title="Detach from the planner row"
                    className="text-ink-muted hover:text-danger-600 text-xs leading-none px-0.5"
                  >
                    ×
                  </button>
                </span>
              )}
            </>
          ) : (
            <>
              {smsCampaign ? (
                <input
                  value={smsCampaign.name}
                  onChange={(e) => setSmsCampaign((c) => (c ? { ...c, name: e.target.value } : c))}
                  className="font-medium text-sm text-ink bg-transparent border-b border-transparent hover:border-line-strong focus:border-accent focus:outline-none min-w-0 w-56 transition-colors"
                  title="Click to rename SMS campaign"
                />
              ) : (
                <span className="t-label truncate">New SMS</span>
              )}
              <Chip tone="accent" className="shrink-0">SMS</Chip>
              {smsSource === "final" && <Chip tone="muted" className="shrink-0">final</Chip>}
              {smsSource === "draft" && <Chip tone="warning" className="shrink-0">draft</Chip>}
            </>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {channel === "email" && (
            <>
              <Stepper activeKey={activeKey} canGoBack={canGoBack} onNavigate={onStepNavigate} />
              {loadingPhase === "generating" && (
                <span className="text-xs text-ink-muted hidden xl:inline">
                  Writing — section {Math.min((campaign?.sections.length ?? 0) + 1, sectionStructure.length || 99)} of {sectionStructure.length || "…"}
                </span>
              )}
              {/* Always-available append. This is what removes the "scroll to the
                  bottom and hunt for an invisible strip" problem: the target no
                  longer moves (spec 3.1). */}
              {stage === "canvas" && campaign && loadingPhase === null && (
                <Button variant="secondary" size="sm" onClick={() => setAddSectionOpen(true)}
                  title="Add a section to the end (⌘⇧A)">
                  <svg aria-hidden className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                  Add section
                </Button>
              )}
              {campaign && (
                <Button variant="ghost" size="sm" onClick={handleCopyCampaign} title="Copy campaign for Google Docs">
                  <svg aria-hidden className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                  Copy
                </Button>
              )}
              {renderSaveButtons()}
              {campaign && (
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setNewMenuOpen((o) => !o)}
                    title="Start a new campaign"
                  >
                    New
                  </Button>
                  {newMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setNewMenuOpen(false)} />
                      <div className="absolute z-20 right-0 mt-1 bg-white border border-line rounded-md shadow-lg py-1 w-64 text-left">
                        <button
                          type="button"
                          onClick={() => {
                            setNewMenuOpen(false);
                            if (canvasSource === "library") resetAll(); else setShowNewConfirm(true);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-sunken transition-colors"
                        >
                          <div className="text-sm text-ink">New from brief</div>
                          <div className="text-xs text-ink-tertiary mt-0.5">Fill in the brief and generate the copy.</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNewMenuOpen(false);
                            if (canvasSource === "library") startBlankCanvas(); else setPendingBlankCanvas(true);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-sunken transition-colors"
                        >
                          <div className="text-sm text-ink">New blank canvas</div>
                          <div className="text-xs text-ink-tertiary mt-0.5">Write it yourself. Add modules as you go.</div>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
          {channel === "sms" && smsCampaign && (
            <>
              <Button variant="ghost" size="sm" onClick={handleSmsCopy} title="Copy selected variant">Copy</Button>
              <Button variant="secondary" size="sm" loading={smsSaving} onClick={() => handleSmsSave("draft")}>Save Draft</Button>
              <Button variant="primary" size="sm" loading={smsSaving} onClick={() => handleSmsSave("final")}>Save Final</Button>
              <Button variant="ghost" size="sm" onClick={handleSmsNew} title="Start new SMS">New</Button>
            </>
          )}
        </div>
      </div>

      {/* Two panes: the brief and the canvas. Nothing between them. */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

      {/* Brief panel (collapsible; the form stays mounted so its state is never lost) */}
      <div className={`shrink-0 border-r border-line bg-surface overflow-hidden transition-[width] duration-[250ms] ease-out-soft ${briefOpen ? "w-[420px]" : "w-12"}`}>
        {!briefOpen && (
          <button onClick={() => setBriefOpen(true)} title="Expand brief" aria-label="Expand brief"
            className="h-full w-full flex flex-col items-center gap-3 pt-4 text-ink-secondary hover:text-ink hover:bg-chrome transition-colors">
            <PanelIcon />
            <span className="[writing-mode:vertical-rl] rotate-180 t-label">Brief</span>
          </button>
        )}
        <div className={briefOpen ? "h-full overflow-y-auto p-5" : "hidden"}>
          <div className="flex items-center justify-between mb-4">
            <div className="t-label text-ink-secondary">
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
                loading={loadingPhase === "generating"}
                seed={formSeed}
                seedLabel={formSeedLabel}
                onClearSeed={handleClearSeed}
                onRefreshNotes={plannerLink?.rowId || currentBriefInput?.planner_row_id ? refreshPlannerNotes : undefined}
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
        <div className="max-w-3xl mx-auto px-6 pt-6 pb-8">
          {channel === "email" && (<>
          {error && (
            <div className="mb-4 bg-danger-50 border border-danger-200 text-danger-600 text-sm rounded-md px-4 py-3">
              {error}
            </div>
          )}

          <div>
            {stage === "form" && loadingPhase === null && (
              <div>
                <EmptyState
                  icon={
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  }
                  className="py-10"
                  title="Start a campaign"
                  description="Fill in the brief on the left and hit Generate Brief, start from a blank canvas and write it yourself, or pick up something you've already written."
                  action={
                    <div className="flex items-center justify-center gap-2 flex-wrap">
                      <Button variant="primary" size="sm" onClick={startBlankCanvas}
                        title="Write it yourself. Add modules as you go.">
                        Start blank canvas
                      </Button>
                      {browseCount > 0 && (
                        <Button variant="secondary" size="sm" onClick={() => setLibraryOpen(true)}>
                          <LibraryIcon /> Browse all {browseCount}
                        </Button>
                      )}
                    </div>
                  }
                />
                {/* The canvas would otherwise be dead space until you generate —
                    so it earns its keep by surfacing recent work. */}
                {recentItems.length > 0 && (
                  <div className="mt-2 border-t border-line pt-5">
                    <div className="t-label mb-2.5">Pick up where you left off</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {recentItems.map((item) => (
                        <button
                          key={`${item.kind}:${item.id}`}
                          type="button"
                          onClick={() => openRecent(item)}
                          className="text-left p-3 rounded-md border border-line bg-surface hover:border-line-strong hover:shadow-card transition-[box-shadow,border-color] duration-150"
                        >
                          <div className="flex items-start gap-2">
                            <div className="text-sm font-medium text-ink flex-1 break-words leading-snug">{item.title}</div>
                            <Chip tone={item.kind === "library" ? "muted" : item.kind === "sms" ? "accent" : "warning"} className="shrink-0">
                              {item.kind === "library" ? "library" : item.kind === "sms" ? "sms" : "draft"}
                            </Chip>
                          </div>
                          <div className="text-xs text-ink-tertiary mt-1 tabular-nums">{item.meta}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {stage === "canvas" && campaign && (
              <CampaignCanvas
                campaign={campaign}
                expandedBrief={expandedBrief}
                chosenConceit={chosenConceit}
                retrievedExamples={retrievedExamples}
                sectionStructure={sectionStructure}
                toneDial={currentBriefInput?.tone_dial ?? DEFAULT_TONE_DIAL}
                isGenerating={loadingPhase === "generating"}
                featuredProduct={
                  expandedBrief?.products_featured?.[0] ??
                  currentBriefInput?.products_featured?.[0] ??
                  currentBriefInput?.hero_product_slug
                }
                repetitionFlags={repetitionFlags}
                onDismissFlag={(key) => setRepetitionFlags((prev) => { const next = { ...prev }; delete next[key]; return next; })}
                onRenameFlags={(sectionId, renames) => setRepetitionFlags((prev) => {
                  // Flags are keyed "<sectionId>::<element>", so a family renumber
                  // must move them or a chip ends up on the wrong element.
                  const next: Record<string, RepetitionFlag> = {};
                  for (const [key, flag] of Object.entries(prev)) {
                    const [sid, element] = key.split("::");
                    next[sid === sectionId && renames[element] ? `${sid}::${renames[element]}` : key] = flag;
                  }
                  // Drop the flag for a renamed-away element that nothing replaced.
                  for (const oldEl of Object.keys(renames)) {
                    const oldKey = `${sectionId}::${oldEl}`;
                    if (!Object.values(renames).includes(oldEl)) delete next[oldKey];
                  }
                  return next;
                })}
                onRegenerated={(updated) => void runRepetitionCheck(updated)}
                onChange={setCampaign}
                // Section mutations come from the hook so both arrays move together.
                onInsertAt={sectionOps.insertAt}
                onDeleteSection={sectionOps.deleteSection}
                onMoveSection={sectionOps.moveSection}
                onReorder={sectionOps.reorder}
                scrollToId={scrollToSectionId}
                onScrolledTo={() => setScrollToSectionId(null)}
                scratchBrief={isScratch && currentBriefInput ? {
                  name: currentBriefInput.campaign_name,
                  offer: currentBriefInput.offer,
                  heroProduct: currentBriefInput.hero_product_slug,
                } : null}
                onScratchBriefChange={(patch) => setCurrentBriefInput((prev) => prev ? {
                  ...prev,
                  ...(patch.name !== undefined ? { campaign_name: patch.name } : {}),
                  ...(patch.offer !== undefined ? { offer: patch.offer } : {}),
                  ...(patch.heroProduct !== undefined ? {
                    hero_product_slug: patch.heroProduct || undefined,
                    // The hero is also the featured product, which is what drives
                    // review fetching and the product bindings on inserted cards.
                    products_featured: patch.heroProduct ? [patch.heroProduct] : [],
                  } : {}),
                } : prev)}
                assistsDisabledReason={assistsDisabledReason}
                productOptions={productOptions}
              />
            )}

            {/* The toolbar / ⌘⇧A path: same picker, always appending. */}
            <SectionPicker
              open={addSectionOpen}
              position={{ index: campaign?.sections.length ?? 0, label: "at the end" }}
              onClose={() => setAddSectionOpen(false)}
              onInsert={(type, specPatch) => {
                sectionOps.append(type, specPatch);
                setAddSectionOpen(false);
              }}
              selectedProducts={
                currentBriefInput?.products_featured?.length
                  ? productOptions.filter((p) => currentBriefInput.products_featured.includes(p.id))
                  : productOptions
              }
            />
          </div>
          </>)}

          {channel === "sms" && (
            <>
              {error && (
                <div className="mb-4 bg-danger-50 border border-danger-200 text-danger-600 text-sm rounded-md px-4 py-3">{error}</div>
              )}

              <div>
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
      </div>

      {/* Campaign browser — a wide drawer, so a card can show its whole title */}
      <Drawer
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        title="Campaigns"
        size="xl"
        padBody={false}
      >
        <LibraryBrowser
          libraryItems={libraryItems}
          savedItems={savedItems}
          smsItems={smsItems}
          onLoadSaved={(id) => { setLibraryOpen(false); handleLoadSaved(id); }}
          /* Deletes close the drawer first: the confirm dialog is its own focus
             trap, and nesting one inside the drawer's trap makes the confirm
             button unreachable by keyboard. */
          onDeleteSaved={(id) => { setLibraryOpen(false); handleDeleteSaved(id); }}
          onViewLibrary={(id) => { setLibraryOpen(false); handleViewLibrary(id); }}
          onDeleteLibrary={(id) => { setLibraryOpen(false); handleDeleteLibrary(id); }}
          onLoadSms={(id) => { setLibraryOpen(false); handleLoadSms(id); }}
          onDeleteSms={(id) => { setLibraryOpen(false); handleDeleteSms(id); }}
          activeSavedId={currentDraftId}
          activeLibraryId={currentLibraryId}
          activeSmsId={channel === "sms" ? smsCurrentId : null}
        />
      </Drawer>

      {/* Confirmations (shared Modal primitive) */}
      <ConfirmModal
        open={showNewConfirm}
        onClose={() => setShowNewConfirm(false)}
        onConfirm={() => { setShowNewConfirm(false); resetAll(); }}
        title="Start a new campaign?"
        body="This will clear the canvas. Make sure you've saved anything you want to keep."
        confirmLabel="Yes, start fresh"
      />
      {/* Taking a planner row from another campaign is destructive (the link is
          single-owner, so it unlinks that campaign), and it used to happen silently.
          It now requires an answer, and "Leave it" writes nothing to either record. */}
      <ConfirmModal
        open={!!pendingReassign}
        onClose={() => { setPendingReassign(null); toast.info("Left the planner link as it was."); }}
        onConfirm={() => {
          const p = pendingReassign;
          setPendingReassign(null);
          if (p) void postPlannerLink(p.rowId, p.copyCampaignId, p.copyStatus, true);
        }}
        title="That planner row is already linked"
        body={`It currently points at "${pendingReassign?.ownerName ?? "another campaign"}". Moving the link here will detach it from that campaign.`}
        confirmLabel="Move it here"
        cancelLabel="Leave it"
      />
      <ConfirmModal
        open={pendingBlankCanvas}
        onClose={() => setPendingBlankCanvas(false)}
        onConfirm={() => { setPendingBlankCanvas(false); startBlankCanvas(); }}
        title="Start a blank canvas?"
        body="This will clear the canvas. Make sure you've saved anything you want to keep."
        confirmLabel="Yes, start blank"
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
