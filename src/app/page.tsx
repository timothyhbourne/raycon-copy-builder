"use client";
import { useState, useEffect, useCallback } from "react";
import type {
  BriefInput, ExpandedBrief, Conceit, GeneratedCampaign, GeneratedSection,
  LibraryCampaign, SavedCampaign, SectionType, SectionSpec
} from "@/lib/schemas";
import { SECTION_CATALOGUE } from "@/lib/schemas";
import { nanoid } from "@/lib/nanoid";
import InputForm from "@/components/InputForm";
import ConceitPicker from "@/components/ConceitPicker";
import CampaignCanvas from "@/components/CampaignCanvas";
import Sidebar from "@/components/Sidebar";

const LS_DRAFT = "raycon_canvas_draft";

type Stage = "form" | "conceits" | "canvas";

// Where the current canvas content came from
type CanvasSource = "new" | "draft" | "library";

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
  const [savingStatus, setSavingStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
  const [pendingBriefInput, setPendingBriefInput] = useState<BriefInput | null>(null);
  const [showNewConfirm, setShowNewConfirm] = useState(false);

  // Tracks where the canvas content came from
  const [canvasSource, setCanvasSource] = useState<CanvasSource>("new");
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [currentLibraryId, setCurrentLibraryId] = useState<string | null>(null);

  const [libraryItems, setLibraryItems] = useState<LibraryMeta[]>([]);
  const [savedItems, setSavedItems] = useState<SavedMeta[]>([]);

  const refreshSidebar = useCallback(async () => {
    const [libRes, savedRes] = await Promise.all([fetch("/api/library"), fetch("/api/campaigns")]);
    const lib = await libRes.json();
    const saved = await savedRes.json();
    if (lib.campaigns) setLibraryItems(lib.campaigns);
    if (saved.campaigns) setSavedItems(saved.campaigns);
  }, []);

  useEffect(() => { refreshSidebar(); }, [refreshSidebar]);

  // Restore in-progress draft from localStorage on load
  useEffect(() => {
    const raw = localStorage.getItem(LS_DRAFT);
    if (raw) {
      try {
        const { campaign: c, expandedBrief: eb, chosenConceit: cc, sectionStructure: ss, draftId, briefInput: bi } = JSON.parse(raw);
        if (c) {
          setCampaign(c);
          setExpandedBrief(eb);
          setChosenConceit(cc);
          setSectionStructure(ss || []);
          setCurrentDraftId(draftId || null);
          setCurrentBriefInput(bi || null);   // ← was missing — caused Save Draft to silently bail
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
        draftId: currentDraftId, briefInput: currentBriefInput,
      }));
    }
  }, [campaign, expandedBrief, chosenConceit, sectionStructure, currentDraftId, currentBriefInput, canvasSource]);

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
    setCurrentBriefInput(input);
    setSectionStructure(input.section_structure);
    try {
      // Kick off brief expansion AND library fetch in parallel
      const [briefRes, libRes] = await Promise.all([
        fetch("/api/brief", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
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
              const newSection: GeneratedSection = {
                id: nanoid(),
                type: parsed.type,
                elements: parsed.elements,
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

  const handleSaveDraft = async () => {
    if (!campaign || !currentBriefInput) return;
    setSavingStatus("saving");
    try {
      const id = currentDraftId || `${new Date().toISOString().split("T")[0]}-${makeSlug(currentBriefInput.campaign_name)}-${nanoid().slice(0, 6)}`;
      const saved: SavedCampaign = {
        id,
        campaign_name: currentBriefInput.campaign_name,
        campaign_type: currentBriefInput.campaign_type,
        offer: currentBriefInput.offer,
        promo_code: currentBriefInput.promo_code,
        audience: currentBriefInput.audience,
        hero_angle: currentBriefInput.hero_angle,
        products_featured: currentBriefInput.products_featured,
        section_structure: sectionStructure,
        expanded_brief: expandedBrief ?? undefined,
        chosen_conceit: chosenConceit ?? undefined,
        campaign,
        status: "draft",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(saved),
      });
      setCurrentDraftId(id);
      setCanvasSource("draft");
      setSavingStatus("saved");
      await refreshSidebar();
      setTimeout(() => setSavingStatus("idle"), 2000);
    } catch {
      setSavingStatus("idle");
    }
  };

  const handleSaveFinal = async () => {
    if (!campaign || !currentBriefInput) return;
    setSavingStatus("saving");
    try {
      const id = currentLibraryId ||
        `${new Date().toISOString().split("T")[0]}-${makeSlug(currentBriefInput.campaign_name)}`;

      await fetch("/api/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          brief_input: currentBriefInput,
          conceit: chosenConceit,
          campaign,
          section_structure: sectionStructure,
          draft_id: currentDraftId,
        }),
      });

      // Keep the canvas exactly as-is — just transition it to library source
      // so the button flips to "update" mode and the draft slot is cleared.
      setCurrentLibraryId(id);
      setCurrentDraftId(null);
      setCanvasSource("library");
      setSavingStatus("saved");
      await refreshSidebar();
      setTimeout(() => setSavingStatus("idle"), 2000);
    } catch {
      setSavingStatus("idle");
    }
  };

  const handleUpdateLibrary = async () => {
    if (!campaign || !currentBriefInput || !currentLibraryId) return;
    setSavingStatus("saving");
    try {
      await fetch("/api/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: currentLibraryId,
          brief_input: currentBriefInput,
          conceit: chosenConceit,
          campaign,
          section_structure: sectionStructure,
        }),
      });
      setSavingStatus("saved");
      await refreshSidebar();
      setTimeout(() => setSavingStatus("idle"), 2000);
    } catch {
      setSavingStatus("idle");
    }
  };

  const handleLoadSaved = async (id: string) => {
    const res = await fetch(`/api/campaigns?id=${id}`);
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
      });
      setCurrentDraftId(id);
      setCurrentLibraryId(null);
      setCanvasSource("draft");
      setStage("canvas");
    }
  };

  const handleDeleteSaved = async (id: string) => {
    if (!confirm("Delete this campaign?")) return;
    await fetch(`/api/campaigns?id=${id}`, { method: "DELETE" });
    if (currentDraftId === id) {
      resetState({
        setStage, setCampaign, setExpandedBrief, setChosenConceit,
        setSectionStructure, setCurrentBriefInput, setConceits,
        setCanvasSource, setCurrentDraftId, setCurrentLibraryId,
      });
    }
    await refreshSidebar();
  };

  const handleDeleteLibrary = async (id: string) => {
    if (!confirm("Remove this campaign from the library?")) return;
    await fetch(`/api/library?id=${id}`, { method: "DELETE" });
    if (currentLibraryId === id) {
      resetState({
        setStage, setCampaign, setExpandedBrief, setChosenConceit,
        setSectionStructure, setCurrentBriefInput, setConceits,
        setCanvasSource, setCurrentDraftId, setCurrentLibraryId,
      });
    }
    await refreshSidebar();
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
    });
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
      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 2000);
    } catch {
      await navigator.clipboard.writeText(plain);
      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 2000);
    }
  };

  // Save button logic based on canvas source
  const renderSaveButtons = () => {
    if (!campaign) return null;
    if (canvasSource === "library") {
      return (
        <button
          onClick={handleUpdateLibrary}
          disabled={savingStatus === "saving"}
          className="text-xs bg-slate-900 text-white hover:bg-slate-700 px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
        >
          {savingStatus === "saving" ? "Saving..." : savingStatus === "saved" ? "Saved!" : "Save to Library"}
        </button>
      );
    }
    return (
      <div className="flex gap-2">
        <button
          onClick={handleSaveDraft}
          disabled={savingStatus === "saving"}
          className="text-xs border border-slate-200 text-slate-600 hover:bg-slate-50 px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
        >
          {savingStatus === "saving" ? "Saving..." : savingStatus === "saved" ? "Saved!" : "Save Draft"}
        </button>
        <button
          onClick={handleSaveFinal}
          disabled={savingStatus === "saving"}
          className="text-xs bg-slate-900 text-white hover:bg-slate-700 px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
        >
          Save Final
        </button>
      </div>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#f4f4ef" }}>
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
          <InputForm onSubmit={handleBriefSubmitRequest} loading={loadingPhase === "conceits"} />
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
              {canvasSource === "library" && (
                <span className="font-mono text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded shrink-0">library</span>
              )}
              {canvasSource === "draft" && (
                <span className="font-mono text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded shrink-0">draft</span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {campaign && (
                <button
                  onClick={handleCopyCampaign}
                  className="text-xs text-slate-500 hover:text-slate-900 border border-slate-200 px-3 py-1.5 rounded-md transition-colors hover:bg-slate-50"
                  title="Copy campaign for Google Docs"
                >
                  {copyStatus === "copied" ? "✓ Copied" : "Copy"}
                </button>
              )}
              {renderSaveButtons()}
              {campaign && (
                <button
                  onClick={() => setShowNewConfirm(true)}
                  className="text-xs text-slate-400 hover:text-slate-700 border border-slate-200 px-3 py-1.5 rounded-md transition-colors"
                  title="Start new campaign"
                >
                  New
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {stage === "form" && loadingPhase === null && (
            <div className="text-center py-24 text-slate-400">
              <div className="text-4xl mb-4">✍</div>
              <div className="text-sm">Fill in the brief and click Generate Brief to start.</div>
            </div>
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
              onChange={setCampaign}
              onConceitEdit={() => setStage("conceits")}
              onNewConceits={handleNewConceits}
            />
          )}
        </div>
      </div>
      {/* New campaign confirmation dialog */}
      {showNewConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <div className="font-semibold text-slate-900 mb-2">Start a new campaign?</div>
            <p className="text-sm text-slate-500 mb-5 leading-relaxed">
              This will clear the canvas. Make sure you&apos;ve saved anything you want to keep.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowNewConfirm(false)}
                className="text-sm text-slate-600 border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowNewConfirm(false);
                  resetState({
                    setStage, setCampaign, setExpandedBrief, setChosenConceit,
                    setSectionStructure, setCurrentBriefInput, setConceits,
                    setCanvasSource, setCurrentDraftId, setCurrentLibraryId,
                  });
                }}
                className="text-sm bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-700 transition-colors"
              >
                Yes, start fresh
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Regenerate confirmation dialog */}
      {pendingBriefInput && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <div className="font-semibold text-slate-900 mb-2">Start over?</div>
            <p className="text-sm text-slate-500 mb-5 leading-relaxed">
              This will clear the current campaign and start a new brief. Any unsaved changes will be lost.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setPendingBriefInput(null)}
                className="text-sm text-slate-600 border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const input = pendingBriefInput;
                  setPendingBriefInput(null);
                  resetState({
                    setStage, setCampaign, setExpandedBrief, setChosenConceit,
                    setSectionStructure, setCurrentBriefInput, setConceits,
                    setCanvasSource, setCurrentDraftId, setCurrentLibraryId,
                  });
                  handleBriefSubmit(input);
                }}
                className="text-sm bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-700 transition-colors"
              >
                Yes, regenerate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
