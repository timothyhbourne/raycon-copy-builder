"use client";
import { useState } from "react";
import type { GeneratedCampaign, GeneratedSection, ExpandedBrief, Conceit, SectionSpec, LibraryCampaign, SectionType } from "@/lib/schemas";
import { SECTION_CATALOGUE } from "@/lib/schemas";
import { nanoid } from "@/lib/nanoid";
import SectionBlock from "./SectionBlock";
import MetaBlock from "./MetaBlock";
import RegenerateModal from "./RegenerateModal";

interface Props {
  campaign: GeneratedCampaign;
  expandedBrief: ExpandedBrief | null;
  chosenConceit: Conceit | null;
  retrievedExamples: LibraryCampaign[];
  sectionStructure: SectionSpec[];
  toneDial: number;
  isGenerating?: boolean;
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
  onChange,
  onConceitEdit,
  onNewConceits,
}: Props) {
  const [regenModal, setRegenModal] = useState<{ sectionId: string; type: string } | null>(null);
  const [regeneratingSection, setRegeneratingSection] = useState<string | null>(null);
  const [regeneratingMeta, setRegeneratingMeta] = useState(false);

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
      const section = campaign.sections.find((s) => s.id === sectionId);
      if (!section) return;
      const sectionSpec = sectionStructure.find((s) => s.type === section.type) || { id: "", type: section.type };

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
      if (data.section) updateSection(sectionId, data.section);
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
        onChange({
          ...campaign,
          meta: {
            subject_lines: data.subject_lines || campaign.meta.subject_lines,
            preview_texts: data.preview_texts || campaign.meta.preview_texts,
          },
        });
      }
    } finally {
      setRegeneratingMeta(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Streaming progress banner */}
      {isGenerating && (
        <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5">
          <div className="w-4 h-4 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin shrink-0" />
          <span className="font-mono text-xs text-slate-500 uppercase tracking-wide">Writing campaign…</span>
        </div>
      )}
      {/* Conceit bar */}
      <div className="bg-white border border-slate-200 rounded-lg px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-xs text-slate-400 uppercase tracking-wide mb-1">Conceit</div>
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
      />

      {/* Section blocks */}
      {campaign.sections.map((section, i) => {
        // Find the matching spec to carry grid dimensions into the renderer.
        // Match by position first (most accurate), fall back to type.
        const spec = sectionStructure[i] ?? sectionStructure.find((s) => s.type === section.type);
        const gridCols = section.type === "product_grid" ? (spec?.grid_cols ?? 2) : undefined;
        return (
          <div key={section.id} className="relative">
            {regeneratingSection === section.id && (
              <div className="absolute inset-0 bg-white/70 rounded-lg flex items-center justify-center z-10">
                <span className="font-mono text-xs text-slate-500 animate-pulse">Regenerating...</span>
              </div>
            )}
            <SectionBlock
              section={section}
              index={i}
              total={campaign.sections.length}
              gridCols={gridCols}
              onChange={(s) => updateSection(section.id, s)}
              onRegenerate={() => setRegenModal({ sectionId: section.id, type: section.type })}
              onDelete={() => deleteSection(section.id)}
              onMoveUp={() => moveSection(section.id, "up")}
              onMoveDown={() => moveSection(section.id, "down")}
              onInsertAfter={() => insertAfter(section.id)}
            />
          </div>
        );
      })}

      {regenModal && (
        <RegenerateModal
          sectionType={regenModal.type}
          defaultTone={toneDial}
          onConfirm={(steering, sectionTone) => handleRegenerate(regenModal.sectionId, steering, sectionTone)}
          onClose={() => setRegenModal(null)}
        />
      )}
    </div>
  );
}
