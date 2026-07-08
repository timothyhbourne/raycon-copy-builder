"use client";
import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type {
  BriefInput, ExpandedBrief, Conceit, GeneratedCampaign, GeneratedSection,
  LibraryCampaign, SavedCampaign, SectionType, SectionSpec
} from "@/lib/schemas";
import { SECTION_CATALOGUE } from "@/lib/schemas";
import type { PlannerRow } from "@/lib/planner-types";
import { plannerRowToBriefSeed } from "@/lib/planner-copy-link";
import { nanoid } from "@/lib/nanoid";
import { expandProductCardSections } from "@/lib/expand-sections";
import { extractSubheaderVariants } from "@/lib/normalize-section";
import InputForm from "@/components/InputForm";
import ConceitPicker from "@/components/ConceitPicker";
import CampaignCanvas from "@/components/CampaignCanvas";
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
  onPlanner: (rowId: string) => void;
  onCampaign: (savedId: string) => void;
}) {
  const searchParams = useSearchParams();
  const cbRef = useRef({ onPlanner, onCampaign });
  cbRef.current = { onPlanner, onCampaign };
  const lastConsumed = useRef<string | null>(null);
  useEffect(() => {
    const planner = searchParams.get("planner");
    const campaign = searchParams.get("campaign");
    const token = planner ? `p:${planner}` : campaign ? `c:${campaign}` : null;
    if (!token || lastConsumed.current === token) return;
    lastConsumed.current = token;
    if (planner) cbRef.current.onPlanner(planner);
    else if (campaign) cbRef.current.onCampaign(campaign);
  }, [searchParams]);
  return null;
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
  const [savingStatus, setSavingStatus] = useState<"idle" | "saving">("idle");
  const [pendingDelete, setPendingDelete] = useState<{ id: string; kind: "saved" | "library" } | null>(null);
  const [pendingBriefInput, setPendingBriefInput] = useState<BriefInput | null>(null);
  const [showNewConfirm, setShowNewConfirm] = useState(false);

  // Tracks where the canvas content came from
  const [canvasSource, setCanvasSource] = useState<CanvasSource>("new");
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [currentLibraryId, setCurrentLibraryId] = useState<string | null>(null);

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

  const refreshSidebar = useCallback(async () => {
    const [libRes, savedRes] = await Promise.all([fetch("/api/library"), fetch("/api/campaigns")]);
    const lib = await libRes.json();
    const saved = await savedRes.json();
    if (lib.campaigns) setLibraryItems(lib.campaigns);
    if (saved.campaigns) setSavedItems(saved.campaigns);
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

  // --- Planner handoff ---------------------------------------------------

  // Move to a clean brief form WITHOUT destroying the canvas draft in storage
  // (the persist effect only writes when a campaign exists, and we don't remove
  // the key). Used when the writer chooses to start a planner brief over an
  // existing canvas.
  const softResetToForm = () => {
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

  // ?planner=<rowId>. Guard against silently discarding an unsaved canvas.
  const handlePlannerDeepLink = (rowId: string) => {
    let hasCanvas = false;
    try {
      const raw = localStorage.getItem(LS_DRAFT);
      hasCanvas = !!(raw && JSON.parse(raw)?.campaign);
    } catch { hasCanvas = false; }
    if (hasCanvas) setPendingPlannerRowId(rowId);   // confirm before replacing
    else startPlannerBrief(rowId);
  };

  // ?campaign=<savedId>. Open an existing saved campaign (draft or finalized).
  const handleCampaignDeepLink = async (savedId: string) => {
    router.replace("/copy-builder");
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
    resetState({
      setStage, setCampaign, setExpandedBrief, setChosenConceit,
      setSectionStructure, setCurrentBriefInput, setConceits,
      setCanvasSource, setCurrentDraftId, setCurrentLibraryId,
    });
    setPlannerLink(null);
    setFormSeed(null);
    setFormSeedLabel(null);
    setSeedAiFailed(false);
  };

  // If a campaign is already on screen, hold the input and show a confirmation dialog
  const handleBriefSubmitRequest = (input: BriefInput) => {
    if (campaign) {
      setPendingBriefInput(input);
    } else {
      handleBriefSubmit(input);
    }
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
      setCampaign(null);
      setStage("conceits");
    } finally {
      setLoadingPhase(null);
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

  const handleUpdateLibrary = async () => {
    if (!campaign || !currentLibraryId) { setError("Nothing to update."); return; }
    const bi = currentBriefInput ?? deriveBriefFallback();
    setSavingStatus("saving");
    setError(null);
    try {
      const res = await fetch("/api/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: currentLibraryId,
          brief_input: bi,
          conceit: chosenConceit,
          campaign,
          section_structure: sectionStructure,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Save failed (HTTP ${res.status})`);
      }
      setSavingStatus("idle");
      await refreshSidebar();
      toast.success("Library updated");
    } catch (e) {
      setSavingStatus("idle");
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  const handleLoadSaved = async (id: string) => {
    const res = await fetch(`/api/campaigns?id=${id}`);
    if (res.ok) {
      const data = await res.json();
      if (data.campaign) {
        const c = data.campaign as SavedCampaign;
        setCampaign(c.campaign);
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

  // Save button logic based on canvas source
  const renderSaveButtons = () => {
    if (!campaign) return null;
    const saving = savingStatus === "saving";
    if (canvasSource === "library") {
      return (
        <Button variant="primary" size="sm" loading={saving} onClick={handleUpdateLibrary}>
          Save to Library
        </Button>
      );
    }
    return (
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" loading={saving} onClick={handleSaveDraft}>
          Save Draft
        </Button>
        <Button variant="primary" size="sm" loading={saving} onClick={handleSaveFinal}>
          Save Final
        </Button>
      </div>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-chrome">
      {/* Deep-link reader (Next 16 requires useSearchParams under Suspense) */}
      <Suspense fallback={null}>
        <DeepLinkReader onPlanner={handlePlannerDeepLink} onCampaign={handleCampaignDeepLink} />
      </Suspense>

      {/* Sidebar */}
      <div className="w-60 shrink-0 border-r border-slate-200 bg-white overflow-y-auto">
        <Sidebar
          libraryItems={libraryItems}
          savedItems={savedItems}
          onLoadSaved={handleLoadSaved}
          onDeleteSaved={handleDeleteSaved}
          onViewLibrary={handleViewLibrary}
          onDeleteLibrary={handleDeleteLibrary}
        />
      </div>

      {/* Input form panel */}
      <div className="w-96 shrink-0 border-r border-slate-200 bg-white overflow-y-auto">
        <div className="p-5">
          <div className="font-mono text-xs text-slate-500 uppercase tracking-wide mb-4">Campaign Brief</div>
          {seedingProducts && (
            <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
              <span className="w-3 h-3 rounded-full border-2 border-slate-200 border-t-slate-500 animate-spin" />
              Suggesting products &amp; hero angle…
            </div>
          )}
          {seedAiFailed && (
            <div className="mb-3 text-xs text-amber-600 leading-relaxed">
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
        </div>
      </div>

      {/* Main canvas area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          {/* Top bar */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3 min-w-0">
              {stage === "canvas" && currentBriefInput && loadingPhase === null ? (
                <input
                  value={currentBriefInput.campaign_name}
                  onChange={(e) => handleRenameCampaign(e.target.value)}
                  className="font-mono text-xs text-slate-700 uppercase tracking-wide bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-500 focus:outline-none min-w-0 w-48 transition-colors"
                  title="Click to rename campaign"
                />
              ) : (
                <div className="font-mono text-xs text-slate-500 uppercase tracking-wide">
                  {stage === "form" && loadingPhase === null && "Waiting for brief..."}
                  {loadingPhase === "conceits" && "Generating conceits..."}
                  {stage === "conceits" && loadingPhase === null && "Pick a conceit"}
                  {loadingPhase === "generating" && "Writing campaign..."}
                </div>
              )}
              {canvasSource === "library" && <Chip tone="muted" className="shrink-0">library</Chip>}
              {canvasSource === "draft" && <Chip tone="warning" className="shrink-0">draft</Chip>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {campaign && (
                <Button variant="ghost" size="sm" onClick={handleCopyCampaign} title="Copy campaign for Google Docs">
                  Copy
                </Button>
              )}
              {renderSaveButtons()}
              {campaign && (
                <Button variant="ghost" size="sm" onClick={() => setShowNewConfirm(true)} title="Start new campaign">
                  New
                </Button>
              )}
            </div>
          </div>

          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}

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
            <div className="flex flex-col items-center justify-center py-32 gap-5">
              <div className="w-9 h-9 rounded-full border-2 border-slate-200 border-t-slate-500 animate-spin" />
              <div className="font-mono text-xs text-slate-400 uppercase tracking-wide">Generating conceits...</div>
            </div>
          )}

          {stage === "conceits" && loadingPhase === null && (
            <div>
              {expandedBrief && (
                <div className="bg-white border border-slate-200 rounded-lg px-6 py-4 mb-6">
                  <div className="font-mono text-xs text-slate-400 uppercase tracking-wide mb-2">Expanded Brief</div>
                  <p className="text-sm text-slate-700 leading-relaxed">{expandedBrief.headline_thesis}</p>
                  <p className="text-sm text-slate-500 mt-2 leading-relaxed">{expandedBrief.tonal_direction}</p>
                </div>
              )}
              <ConceitPicker conceits={conceits} chosen={chosenConceit} onPick={handlePickConceit} />
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
              onChange={setCampaign}
              onConceitEdit={() => setStage("conceits")}
              onNewConceits={handleNewConceits}
            />
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
        onConfirm={() => { const input = pendingBriefInput; setPendingBriefInput(null); if (input) { resetAll(); handleBriefSubmit(input); } }}
        title="Start over?"
        body="This will clear the current campaign and start a new brief. Any unsaved changes will be lost."
        confirmLabel="Yes, regenerate"
      />
      <ConfirmModal
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        title={pendingDelete?.kind === "library" ? "Remove from library?" : "Delete this campaign?"}
        body={pendingDelete?.kind === "library" ? "This removes the finalized campaign from the library." : "This permanently deletes the saved draft."}
        confirmLabel={pendingDelete?.kind === "library" ? "Remove" : "Delete"}
        danger
      />
    </div>
  );
}
