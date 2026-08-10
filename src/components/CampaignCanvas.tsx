"use client";
import { useEffect, useRef, useState } from "react";
import type { GeneratedCampaign, GeneratedSection, ExpandedBrief, Conceit, SectionSpec, LibraryCampaign, SectionType } from "@/lib/schemas";
import { SECTION_CATALOGUE, sectionElementNames } from "@/lib/schemas";
import type { ProductReview } from "@/lib/reviews/fetch";
import { nanoid } from "@/lib/nanoid";
import SectionBlock from "./SectionBlock";
import MetaBlock from "./MetaBlock";
import VariationsModal from "./VariationsModal";
import Skeleton from "./ui/Skeleton";
import type { RepetitionFlag } from "@/lib/repetition-client";

const SECTION_CHIPS = ["Warmer", "Punchier", "More playful", "More premium", "Less salesy", "More specific"];

// A short, readable preview of a section for the variations picker. Repeatable
// families (Review N, USP N, Item N…) are picked up dynamically, so a reviews or
// usps section doesn't preview as blank.
function sectionPreview(section: GeneratedSection): string {
  const el = section.elements as Record<string, unknown>;
  const lines: string[] = [];
  const fixed = ["Headline", "Tagline", "Subheader", "Body Copy", "Body", "One-Liner", "Review", "Closing Line", "CTA"];
  const familyKeys = Object.keys(el)
    .filter((k) => /^(.+?)\s+\d+$/.test(k))
    .sort((a, b) => {
      const [, fa = "", na = "0"] = a.match(/^(.+?)\s+(\d+)$/) ?? [];
      const [, fb = "", nb = "0"] = b.match(/^(.+?)\s+(\d+)$/) ?? [];
      return fa === fb ? Number(na) - Number(nb) : fa.localeCompare(fb);
    });
  for (const k of [...fixed, ...familyKeys]) {
    const v = el[k];
    if (typeof v === "string" && v.trim()) lines.push(v.trim());
    else if (k === "Subheader" && Array.isArray(v) && typeof v[0] === "string") lines.push(v[0]);
  }
  if (Array.isArray(el["Products"])) {
    for (const p of el["Products"] as { name?: string; one_liner?: string }[]) {
      if (p?.name) lines.push(`${p.name}${p.one_liner ? ": " + p.one_liner : ""}`);
    }
  }
  return lines.slice(0, 5).join("\n") || "(no preview)";
}

interface Props {
  campaign: GeneratedCampaign;
  expandedBrief: ExpandedBrief | null;
  chosenConceit: Conceit | null;
  retrievedExamples: LibraryCampaign[];
  sectionStructure: SectionSpec[];
  toneDial: number;
  isGenerating?: boolean;
  /** The campaign's highlighted product SKU (hero / first featured). Drives the
   * standalone `reviews` section's automatic 3-review fill and its refresh. */
  featuredProduct?: string;
  /** Similarity flags keyed by element key (see repetition-client). */
  repetitionFlags?: Record<string, RepetitionFlag>;
  onDismissFlag?: (key: string) => void;
  /** Migrate repetition-flag keys after a family renumber (Review 3 → Review 2). */
  onRenameFlags?: (sectionId: string, renames: Record<string, string>) => void;
  /** Fired after a manual regenerate settles, so the parent can re-check. */
  onRegenerated?: (updated: GeneratedCampaign) => void;
  onChange: (c: GeneratedCampaign) => void;
}

export default function CampaignCanvas({
  campaign,
  expandedBrief,
  chosenConceit,
  retrievedExamples,
  sectionStructure,
  toneDial,
  isGenerating = false,
  featuredProduct,
  repetitionFlags,
  onDismissFlag,
  onRenameFlags,
  onRegenerated,
  onChange,
}: Props) {
  const [regenModal, setRegenModal] = useState<{ sectionId: string; type: string } | null>(null);
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

  const insertAfter = (afterId: string, type: SectionType) => {
    const idx = campaign.sections.findIndex((s) => s.id === afterId);
    const newSection: GeneratedSection = {
      id: nanoid(),
      type,
      elements: Object.fromEntries((SECTION_CATALOGUE[type] ?? []).map((el) => [el, ""])),
    };
    const updated = [...campaign.sections];
    updated.splice(idx + 1, 0, newSection);
    onChange({ ...campaign, sections: updated });
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

  // Rewrite ONE element. The returned value is applied by SectionBlock (which
  // owns the per-element spinner/undo); this only performs the call and reports
  // the result, then lets the parent re-run its quality gates.
  const regenerateElement = async (
    sectionId: string,
    elementKey: string,
    steering?: string,
    tone?: number
  ): Promise<{ value?: string; variants?: string[] } | null> => {
    const idx = campaign.sections.findIndex((s) => s.id === sectionId);
    const section = campaign.sections[idx];
    if (!section || !expandedBrief || !chosenConceit) return null;
    const spec = sectionStructure[idx]?.type === section.type
      ? sectionStructure[idx]
      : sectionStructure.find((s) => s.type === section.type);
    try {
      const res = await fetch("/api/regenerate-element", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          element_key: elementKey,
          section,
          section_spec: spec,
          full_campaign: campaign,
          expanded_brief: expandedBrief,
          chosen_conceit: chosenConceit,
          steering: steering ?? "",
          tone_dial: tone ?? toneDial,
          retrieved_examples: retrievedExamples,
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (typeof data.value === "string") return { value: data.value };
      if (Array.isArray(data.variants)) return { variants: data.variants as string[] };
      return null;
    } catch {
      return null;
    }
  };

  // Standalone `reviews` sections auto-fill their Review 1/2/3 slots with REAL
  // reviews for the campaign's highlighted product — the model never writes them
  // (never-fabricate rule leaves them empty), so we fetch and place them here.
  // Only empty slots are filled (edits are never clobbered); each (product,
  // section-set) is attempted once so onChange can't spin the effect.
  const REVIEW_KEYS = ["Review 1", "Review 2", "Review 3"];
  const reviewFillRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (isGenerating || !featuredProduct) return;
    const emptySlot = (s: GeneratedSection, k: string) =>
      String((s.elements as Record<string, unknown>)[k] ?? "").trim() === "";
    const needsFill = (s: GeneratedSection) =>
      s.type === "reviews" && REVIEW_KEYS.some((k) => emptySlot(s, k));
    const targets = campaign.sections.filter(needsFill);
    if (!targets.length) return;
    const attemptKey = `${featuredProduct}:${targets.map((t) => t.id).join(",")}`;
    if (reviewFillRef.current.has(attemptKey)) return;
    reviewFillRef.current.add(attemptKey);

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/reviews?product=${encodeURIComponent(featuredProduct)}&limit=3`);
        if (!res.ok || cancelled) return;
        const list = ((await res.json())?.reviews ?? []) as ProductReview[];
        if (!list.length || cancelled) return;
        const fmt = (r: ProductReview) => (r.author ? `${r.text} — ${r.author}` : r.text);
        const sections = campaign.sections.map((s) => {
          if (!needsFill(s)) return s;
          const elements = { ...s.elements };
          let ri = 0;
          for (const k of REVIEW_KEYS) {
            if (emptySlot(s, k) && ri < list.length) elements[k] = fmt(list[ri++]);
          }
          return { ...s, elements };
        });
        if (!cancelled) onChange({ ...campaign, sections });
      } catch {
        /* network hiccup — slots stay empty, user can retry via regenerate */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign, featuredProduct, isGenerating]);

  return (
    <div className="space-y-4">
      {/* Brief bar — the deterministically compiled angle/thesis (read-only). */}
      <div className="bg-white border border-line rounded-lg px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="t-label mb-1">Brief</div>
            {chosenConceit ? (
              <>
                <div className="font-semibold text-ink">{chosenConceit.name}</div>
                <div className="text-sm text-ink-tertiary mt-0.5 leading-relaxed">{chosenConceit.description}</div>
              </>
            ) : (
              <div className="text-sm text-ink-tertiary">Compiling…</div>
            )}
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

      {/* Email body — one connected sheet so the sections read as a single
          document, not a stack of isolated cards. */}
      <div className="rc-canvas-sheet">
        {campaign.sections.map((section, i) => {
          // Find the matching spec to carry grid dimensions into the renderer.
          // Match by position first (most accurate), fall back to type.
          const spec = sectionStructure[i] ?? sectionStructure.find((s) => s.type === section.type);
          const gridCols = section.type === "product_grid" ? (spec?.grid_cols ?? 2) : undefined;
          // Product the Review refresh control should pull for: the card's own
          // product for product_card_review; the campaign's first featured product
          // for a plain reviews section.
          const reviewSlug = section.type === "product_card_review"
            ? spec?.product_slug
            : section.type === "reviews"
              ? (featuredProduct ?? expandedBrief?.products_featured?.[0])
              : undefined;
          // The elements this section is SUPPOSED to have, per its spec: N USP
          // slots, plus/minus optional and switched-off elements. Without this the
          // renderer falls back to the raw catalogue and would resurrect a
          // Subheader the user removed, or show only 3 slots on a 5-USP section.
          const catalogueElements = spec ? sectionElementNames(spec) : undefined;
          const isNewest = isGenerating && i === campaign.sections.length - 1;
          return (
            <div key={section.id} className={`relative ${isNewest ? "rc-section-enter" : ""}`}>
              <SectionBlock
                section={section}
                index={i}
                total={campaign.sections.length}
                gridCols={gridCols}
                catalogueElements={catalogueElements}
                flags={repetitionFlags}
                onDismissFlag={onDismissFlag}
                onChange={(s) => updateSection(section.id, s)}
                onRegenerate={() => setRegenModal({ sectionId: section.id, type: section.type })}
                onDelete={() => deleteSection(section.id)}
                onMoveUp={() => moveSection(section.id, "up")}
                onMoveDown={() => moveSection(section.id, "down")}
                onInsertAfter={(type) => insertAfter(section.id, type)}
                productSlug={reviewSlug}
                defaultTone={toneDial}
                onRegenerateElement={
                  expandedBrief && chosenConceit
                    ? (key, steering, tone) => regenerateElement(section.id, key, steering, tone)
                    : undefined
                }
                onRequestDeleteSection={() => deleteSection(section.id)}
                onRenameFlags={onRenameFlags}
              />
            </div>
          );
        })}

        {/* "more coming" affordance while streaming */}
        {isGenerating && (
          <div className="px-10 py-8 space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        )}
      </div>

      {regenModal && (() => {
        const sectionId = regenModal.sectionId;
        const idx = campaign.sections.findIndex((s) => s.id === sectionId);
        const section = campaign.sections[idx];
        const sectionSpec = sectionStructure[idx]?.type === section?.type
          ? sectionStructure[idx]
          : sectionStructure.find((s) => s.type === section?.type) || { id: "", type: regenModal.type as SectionType };
        return (
          <VariationsModal
            title={`${regenModal.type} section`}
            chips={SECTION_CHIPS}
            showTone
            defaultTone={toneDial}
            onFetch={async (feedback, tone) => {
              if (!expandedBrief || !chosenConceit || !section) return [];
              const res = await fetch("/api/section-variations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  expanded_brief: expandedBrief,
                  chosen_conceit: chosenConceit,
                  section_to_regenerate: { ...sectionSpec, current_content: section },
                  full_campaign: campaign,
                  feedback,
                  tone_dial: tone,
                  retrieved_examples: retrievedExamples,
                }),
              });
              const data = await res.json();
              const vars = (data.variations ?? []) as { label: string; section: GeneratedSection }[];
              return vars.map((v) => ({ label: v.label, preview: sectionPreview(v.section), payload: v.section }));
            }}
            onApply={(payload) => {
              const newSection = payload as GeneratedSection;
              // A section-wide rewrite must not bring back elements deleted on the
              // canvas: carry the removal list over and drop any element the model
              // returned for a key the user had already removed.
              const removed = section?.removed_elements ?? [];
              const removedSet = new Set(removed);
              const elements = Object.fromEntries(
                Object.entries(newSection.elements).filter(([k]) => !removedSet.has(k))
              );
              const merged: GeneratedSection = {
                ...newSection,
                id: sectionId,
                elements,
                ...(removed.length ? { removed_elements: removed } : {}),
              };
              const updated = {
                ...campaign,
                sections: campaign.sections.map((s) => (s.id === sectionId ? merged : s)),
              };
              onChange(updated);
              onRegenerated?.(updated);
            }}
            onClose={() => setRegenModal(null)}
          />
        );
      })()}

    </div>
  );
}
