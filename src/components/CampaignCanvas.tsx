"use client";
import { useState } from "react";
import type { GeneratedCampaign, GeneratedSection, ExpandedBrief, Conceit, SectionSpec, LibraryCampaign, SectionType } from "@/lib/schemas";
import { SECTION_CATALOGUE } from "@/lib/schemas";
import { nanoid } from "@/lib/nanoid";
import SectionBlock from "./SectionBlock";
import MetaBlock from "./MetaBlock";
import RegenerateModal from "./RegenerateModal";
import DesignModal from "./DesignModal";
import Skeleton from "./ui/Skeleton";
import type { RepetitionFlag } from "@/lib/repetition-client";

interface Props {
  campaign: GeneratedCampaign;
  expandedBrief: ExpandedBrief | null;
  chosenConceit: Conceit | null;
  retrievedExamples: LibraryCampaign[];
  sectionStructure: SectionSpec[];
  toneDial: number;
  isGenerating?: boolean;
  offer?: string;
  /** Similarity flags keyed by element key (see repetition-client). */
  repetitionFlags?: Record<string, RepetitionFlag>;
  onDismissFlag?: (key: string) => void;
  /** Fired after a manual regenerate settles, so the parent can re-check. */
  onRegenerated?: (updated: GeneratedCampaign) => void;
  onChange: (c: GeneratedCampaign) => void;
  onConceitEdit: () => void;
  onNewConceits: () => void;
}

export default function CampaignCanvas({
  campaign,
  expandedBrief,
  chosenConceit,
  retrievedExamples,
  sectionStructure,
  toneDial,
  isGenerating = false,
  offer,
  repetitionFlags,
  onDismissFlag,
  onRegenerated,
  onChange,
  onConceitEdit,
  onNewConceits,
}: Props) {
  const [regenModal, setRegenModal] = useState<{ sectionId: string; type: string } | null>(null);
  const [regeneratingSection, setRegeneratingSection] = useState<string | null>(null);
  const [regeneratingMeta, setRegeneratingMeta] = useState(false);
  const [designModal, setDesignModal] = useState<{ sectionId: string } | null>(null);
  const [designingSection, setDesigningSection] = useState<string | null>(null);

  const updateSection = (id: string, s: GeneratedSection) => {
    onChange({ ...campaign, sections: campaign.sections.map((sec) => (sec.id === id ? s : sec)) });
  };

  const deleteSection = (id: string) => {
    onChange({ ...campaign, sections: campaign.sections.filter((s) => s.id !== id) });
  };

  const moveSection = (id: string, dir: "up" | "down") => {
    const idx = campaign.sections.findIndex((s) => s.id === id);
    if (dir === "up" && idx === 0) return;
    if (dir === "down" && idx === campaign.sections.length - 1) return;
    const updated = [...campaign.sections];
    const swap = dir === "up" ? idx - 1 : idx + 1;
    [updated[idx], updated[swap]] = [updated[swap], updated[idx]];
    onChange({ ...campaign, sections: updated });
  };

  const insertAfter = (afterId: string) => {
    const idx = campaign.sections.findIndex((s) => s.id === afterId);
    const newSection: GeneratedSection = {
      id: nanoid(),
      type: "body" as SectionType,
      elements: Object.fromEntries(SECTION_CATALOGUE["body"].map((el) => [el, ""])),
    };
    const updated = [...campaign.sections];
    updated.splice(idx + 1, 0, newSection);
    onChange({ ...campaign, sections: updated });
  };

  const handleRegenerate = async (sectionId: string, steering: string, sectionTone: number) => {
    if (!expandedBrief || !chosenConceit) return;
    setRegeneratingSection(sectionId);
    setRegenModal(null);
    try {
      const sectionIdx = campaign.sections.findIndex((s) => s.id === sectionId);
      if (sectionIdx === -1) return;
      const section = campaign.sections[sectionIdx];
      // Match by position first (so multiple product_card sections each get
      // their own spec / product_slug), fall back to first-of-type.
      const sectionSpec = sectionStructure[sectionIdx]?.type === section.type
        ? sectionStructure[sectionIdx]
        : sectionStructure.find((s) => s.type === section.type) || { id: "", type: section.type };

      const res = await fetch("/api/regenerate-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expanded_brief: expandedBrief,
          chosen_conceit: chosenConceit,
          section_to_regenerate: { ...sectionSpec, current_content: section },
          full_campaign: campaign,
          steering,
          tone_dial: sectionTone,
          retrieved_examples: retrievedExamples,
        }),
      });
      const data = await res.json();
      if (data.section) {
        const updated = { ...campaign, sections: campaign.sections.map((sec) => (sec.id === sectionId ? data.section : sec)) };
        onChange(updated);
        onRegenerated?.(updated);
      }
    } finally {
      setRegeneratingSection(null);
    }
  };

  const handleRegenerateMeta = async () => {
    if (!expandedBrief || !chosenConceit) return;
    setRegeneratingMeta(true);
    try {
      const summary = campaign.sections
        .map((s) => `${s.type}: ${Object.values(s.elements).slice(0, 2).join(" | ")}`)
        .join("\n");

      const res = await fetch("/api/regenerate-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expanded_brief: expandedBrief,
          chosen_conceit: chosenConceit,
          current_campaign_summary: summary,
        }),
      });
      const data = await res.json();
      if (data.subject_lines || data.preview_texts) {
        const updated = {
          ...campaign,
          meta: {
            subject_lines: data.subject_lines || campaign.meta.subject_lines,
            preview_texts: data.preview_texts || campaign.meta.preview_texts,
          },
        };
        onChange(updated);
        onRegenerated?.(updated);
      }
    } finally {
      setRegeneratingMeta(false);
    }
  };

  const handleDesign = async (sectionId: string) => {
    const section = campaign.sections.find((s) => s.id === sectionId);
    if (!section) return;
    setDesignModal({ sectionId });
    setDesigningSection(sectionId);
    try {
      const elements: Record<string, string> = {};
      for (const [k, v] of Object.entries(section.elements)) {
        if (typeof v === "string") elements[k] = v;
      }
      const res = await fetch("/api/design-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section_type: section.type, elements, offer }),
      });
      const data = await res.json();
      if (data.image) updateSection(sectionId, { ...section, design_image: data.image });
      if (data.error) console.error("Design error:", data.error);
    } finally {
      setDesigningSection(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Conceit bar */}
      <div className="bg-white border border-slate-200 rounded-lg px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="t-label mb-1">Conceit</div>
            {chosenConceit ? (
              <>
                <div className="font-semibold text-slate-900">{chosenConceit.name}</div>
                <div className="text-sm text-slate-500 mt-0.5 leading-relaxed">{chosenConceit.description}</div>
              </>
            ) : (
              <div className="text-sm text-slate-400">No conceit selected</div>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={onConceitEdit} className="text-xs text-slate-500 hover:text-slate-900 border border-slate-200 rounded px-2 py-1 hover:bg-slate-50 transition-colors">edit</button>
            <button onClick={onNewConceits} className="text-xs text-slate-500 hover:text-slate-900 border border-slate-200 rounded px-2 py-1 hover:bg-slate-50 transition-colors">propose new</button>
          </div>
        </div>
      </div>

      {/* Meta block */}
      <MetaBlock
        meta={campaign.meta}
        onChange={(meta) => onChange({ ...campaign, meta })}
        onRegenerate={handleRegenerateMeta}
        regenerating={regeneratingMeta}
        flags={repetitionFlags}
        onDismissFlag={onDismissFlag}
      />

      {/* Section blocks */}
      {campaign.sections.map((section, i) => {
        // Find the matching spec to carry grid dimensions into the renderer.
        // Match by position first (most accurate), fall back to type.
        const spec = sectionStructure[i] ?? sectionStructure.find((s) => s.type === section.type);
        const gridCols = section.type === "product_grid" ? (spec?.grid_cols ?? 2) : undefined;
        const isNewest = isGenerating && i === campaign.sections.length - 1;
        return (
          <div key={section.id} className={`relative ${isNewest ? "rc-section-enter" : ""}`}>
            {regeneratingSection === section.id && (
              <div className="absolute inset-0 bg-white/70 rounded-lg flex items-center justify-center z-10">
                <span className="text-xs text-slate-500 animate-pulse">Regenerating...</span>
              </div>
            )}
            <SectionBlock
              section={section}
              index={i}
              total={campaign.sections.length}
              gridCols={gridCols}
              flags={repetitionFlags}
              onDismissFlag={onDismissFlag}
              onChange={(s) => updateSection(section.id, s)}
              onRegenerate={() => setRegenModal({ sectionId: section.id, type: section.type })}
              onDelete={() => deleteSection(section.id)}
              onMoveUp={() => moveSection(section.id, "up")}
              onMoveDown={() => moveSection(section.id, "down")}
              onInsertAfter={() => insertAfter(section.id)}
              onDesign={section.type === "header" ? () => handleDesign(section.id) : undefined}
            />
          </div>
        );
      })}

      {/* "more coming" affordance while streaming */}
      {isGenerating && (
        <div className="rounded-md border border-line bg-surface p-6 space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      )}

      {regenModal && (
        <RegenerateModal
          sectionType={regenModal.type}
          defaultTone={toneDial}
          onConfirm={(steering, sectionTone) => handleRegenerate(regenModal.sectionId, steering, sectionTone)}
          onClose={() => setRegenModal(null)}
        />
      )}

      {designModal && (() => {
        const sec = campaign.sections.find((s) => s.id === designModal.sectionId);
        return (
          <DesignModal
            image={sec?.design_image ?? ""}
            isGenerating={designingSection === designModal.sectionId}
            onRegenerate={() => handleDesign(designModal.sectionId)}
            onClose={() => setDesignModal(null)}
          />
        );
      })()}
    </div>
  );
}
