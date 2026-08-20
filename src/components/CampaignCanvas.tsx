"use client";
import { useEffect, useRef, useState } from "react";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import type { GeneratedCampaign, GeneratedSection, ExpandedBrief, Conceit, SectionSpec, LibraryCampaign, SectionType, HeadlineVariant } from "@/lib/schemas";
import { sectionElementNames } from "@/lib/schemas";
import { specForSection } from "@/lib/campaign-sections";
import type { ProductReview } from "@/lib/reviews/fetch";
import type { ReviewProvenance } from "@/lib/schemas";
import SectionBlock from "./SectionBlock";
import MetaBlock from "./MetaBlock";
import VariationsModal from "./VariationsModal";
import SectionPicker from "./SectionPicker";
import InsertDivider from "./InsertDivider";
import Button from "./ui/Button";
import Skeleton from "./ui/Skeleton";
import EmptyState from "./ui/EmptyState";
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
    else if (k === "Subheader" && Array.isArray(v)) {
      // Show more than option 1: two variations can differ a lot across their 3
      // subheader options and still look identical if only the first is shown.
      // Capped at 2 (+ an ellipsis) so the card stays compact.
      const opts = (v as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0);
      if (opts.length) {
        const shown = opts.slice(0, 2).map((o, i) => `${i + 1}. ${o.trim()}`).join("  ");
        lines.push(opts.length > 2 ? `${shown} …` : shown);
      }
    }
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

  // ---- Section mutations (spec 4) ----------------------------------------
  // These come from the page's useCampaignSections hook rather than living here,
  // because every one of them has to update `campaign.sections` AND
  // `sectionStructure` together, and this component only ever receives the
  // structure read-only. Doing it locally is what made inserted sections inherit
  // the wrong spec.
  onInsertAt: (index: number, type: SectionType, specPatch?: Partial<SectionSpec>) => void;
  onDeleteSection: (id: string) => void;
  onMoveSection: (id: string, dir: "up" | "down") => void;
  onReorder: (from: number, to: number) => void;
  /** A section id to scroll into view once (after an insert), then forget. */
  scrollToId?: string | null;
  onScrolledTo?: () => void;

  // ---- Scratch canvases (spec 2) -----------------------------------------
  /** Editable minimum-viable brief, shown in the brief bar instead of the
   * compiled conceit. Present only for a hand-written (scratch) canvas. */
  scratchBrief?: { name: string; offer: string; heroProduct?: string } | null;
  onScratchBriefChange?: (patch: { name?: string; offer?: string; heroProduct?: string }) => void;
  /** Why the AI assists are disabled, if they are. Set on a scratch canvas whose
   * brief is still too thin to compile. Renders as a tooltip on the disabled
   * controls — never a dead button (spec 2.3). */
  assistsDisabledReason?: string;
  /** Products offered for section config + the hero picker. */
  productOptions?: { id: string; name: string }[];
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
  onInsertAt,
  onDeleteSection,
  onMoveSection,
  onReorder,
  scrollToId,
  onScrolledTo,
  scratchBrief,
  onScratchBriefChange,
  assistsDisabledReason,
  productOptions = [],
}: Props) {
  const [regenModal, setRegenModal] = useState<{ sectionId: string; type: string } | null>(null);
  const [regeneratingMeta, setRegeneratingMeta] = useState(false);
  // Which boundary the picker is inserting at. null = closed.
  const [pickerAt, setPickerAt] = useState<number | null>(null);
  const assistsEnabled = !assistsDisabledReason;

  const updateSection = (id: string, s: GeneratedSection) => {
    onChange({ ...campaign, sections: campaign.sections.map((sec) => (sec.id === id ? s : sec)) });
  };

  // Insert / delete / move / reorder are the page's (see Props) so the section
  // list and the spec list can never drift apart.

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    onReorder(result.source.index, result.destination.index);
  };

  // Scroll a freshly inserted section into view. Without this, "Add section" from
  // the toolbar appends somewhere below the fold and looks like it did nothing.
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scrollToId) return;
    const el = sheetRef.current?.querySelector<HTMLElement>(`[data-section-id="${scrollToId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    onScrolledTo?.();
  }, [scrollToId, onScrolledTo]);

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
  ): Promise<{ value?: string; variants?: string[]; headline_variants?: HeadlineVariant[] } | null> => {
    const section = campaign.sections.find((s) => s.id === sectionId);
    if (!section || !expandedBrief || !chosenConceit) return null;
    // By id. The old position-then-type lookup posted another section's spec the
    // moment anything had been inserted above this one.
    const spec = specForSection(sectionStructure, section);
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
      if (Array.isArray(data.headline_variants)) return { headline_variants: data.headline_variants as HeadlineVariant[] };
      if (typeof data.value === "string") return { value: data.value };
      if (Array.isArray(data.variants)) return { variants: data.variants as string[] };
      return null;
    } catch {
      return null;
    }
  };

  // Standalone `reviews` sections auto-fill their empty Review slots with REAL
  // reviews — the model never writes them (the server strips anything it does), so
  // an empty slot is a data gap this fills.
  //
  // The slot list is derived from the SECTION, not hardcoded: it used to be
  // ["Review 1","Review 2","Review 3"] with limit=3, so adding Review 4 on the
  // canvas produced a slot the auto-fill could never reach and it stayed empty
  // forever (docs/REVIEWS_MODULE_SPEC.md §2.1). Only empty slots are filled — edits
  // and manual reviews are never clobbered — and each fill records its provenance,
  // without which the review cannot be saved.
  const reviewFillRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (isGenerating || !featuredProduct) return;
    const reviewKeys = (sec: GeneratedSection) =>
      Object.keys(sec.elements ?? {}).filter((k) => /^Review \d+$/.test(k))
        .sort((a, b) => Number(a.split(" ")[1]) - Number(b.split(" ")[1]));
    const emptySlot = (sec: GeneratedSection, k: string) =>
      String((sec.elements as Record<string, unknown>)[k] ?? "").trim() === "";
    const needsFill = (sec: GeneratedSection) =>
      sec.type === "reviews" && reviewKeys(sec).some((k) => emptySlot(sec, k));

    const targets = campaign.sections.filter(needsFill);
    if (!targets.length) return;
    // How many reviews the whole canvas needs, so the fetch limit follows the
    // section's real slot count instead of a hardcoded 3.
    const needed = targets.reduce((n, sec) => n + reviewKeys(sec).filter((k) => emptySlot(sec, k)).length, 0);
    const attemptKey = `${featuredProduct}:${needed}:${targets.map((t) => t.id).join(",")}`;
    if (reviewFillRef.current.has(attemptKey)) return;
    reviewFillRef.current.add(attemptKey);

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/reviews?product=${encodeURIComponent(featuredProduct)}&limit=${Math.min(Math.max(needed, 1), 10)}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { reviews?: ProductReview[]; provenance?: ReviewProvenance[] };
        const list = data.reviews ?? [];
        if (!list.length || cancelled) return;
        const fmt = (r: ProductReview) => (r.author ? `${r.text} — ${r.author}` : r.text);
        // Don't place a review that is already on screen in another slot.
        const taken = new Set(
          campaign.sections.flatMap((sec) =>
            Object.entries(sec.elements ?? {})
              .filter(([k, v]) => /^Review( \d+)?$/.test(k) && typeof v === "string" && v.trim())
              .map(([, v]) => (v as string).trim()),
          ),
        );
        let cursor = 0;
        const sections = campaign.sections.map((sec) => {
          if (!needsFill(sec)) return sec;
          const elements = { ...sec.elements };
          const provenance = { ...(sec.review_provenance ?? {}) };
          for (const key of reviewKeys(sec)) {
            if (!emptySlot(sec, key)) continue;
            while (cursor < list.length && taken.has(fmt(list[cursor]).trim())) cursor++;
            if (cursor >= list.length) break;
            const chosen = list[cursor];
            elements[key] = fmt(chosen);
            taken.add(fmt(chosen).trim());
            // The provenance record is what makes this review saveable at all.
            provenance[key] = data.provenance?.[cursor] ?? { origin: "fetched", fetched_at: new Date().toISOString() };
            cursor++;
          }
          return { ...sec, elements, review_provenance: provenance };
        });
        if (!cancelled) onChange({ ...campaign, sections });
      } catch {
        /* network hiccup — slots stay empty, the writer can fetch per slot */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign, featuredProduct, isGenerating]);

  return (
    <div className="space-y-4">
      {/* Brief bar. For a generated campaign this is the compiled angle, read-only.
          For a hand-written (scratch) canvas it is the minimum viable brief, live
          and editable: a name and an offer are all compileBrief() needs to switch
          the AI assists on, and collecting them inline means the writer can start
          typing sections immediately instead of clearing a modal first (spec 2.3). */}
      <div className="bg-white border border-line rounded-lg px-6 py-4">
        {scratchBrief ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="t-label">Brief</div>
              {assistsDisabledReason ? (
                <span className="text-[11px] text-warning-600">{assistsDisabledReason}</span>
              ) : (
                <span className="text-[11px] text-ink-muted">
                  {chosenConceit?.name ? `Compiled: ${chosenConceit.name}` : "Compiled"}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block">
                <span className="t-label text-ink-secondary">Campaign name</span>
                <input
                  value={scratchBrief.name}
                  onChange={(e) => onScratchBriefChange?.({ name: e.target.value })}
                  placeholder="Back to School — Launch"
                  className="mt-1 w-full text-sm text-ink border-b border-line focus:border-accent focus:outline-none py-1 bg-transparent"
                />
              </label>
              <label className="block">
                <span className="t-label text-ink-secondary">Offer</span>
                <input
                  value={scratchBrief.offer}
                  onChange={(e) => onScratchBriefChange?.({ offer: e.target.value })}
                  placeholder="20% off sitewide"
                  className="mt-1 w-full text-sm text-ink border-b border-line focus:border-accent focus:outline-none py-1 bg-transparent"
                />
              </label>
              <label className="block">
                <span className="t-label text-ink-secondary">Hero product <span className="normal-case tracking-normal text-ink-muted">(optional)</span></span>
                <select
                  value={scratchBrief.heroProduct ?? ""}
                  onChange={(e) => onScratchBriefChange?.({ heroProduct: e.target.value })}
                  className="mt-1 w-full text-sm text-ink border-b border-line focus:border-accent focus:outline-none py-1 bg-transparent"
                >
                  <option value="">None</option>
                  {productOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            </div>
          </div>
        ) : (
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
        )}
      </div>

      {/* Meta block */}
      <MetaBlock
        meta={campaign.meta}
        onChange={(meta) => onChange({ ...campaign, meta })}
        onRegenerate={handleRegenerateMeta}
        regenerating={regeneratingMeta}
        flags={repetitionFlags}
        onDismissFlag={onDismissFlag}
        disabledReason={assistsDisabledReason}
      />

      {/* Email body — one connected sheet so the sections read as a single
          document, not a stack of isolated cards. */}
      <div className="rc-canvas-sheet" ref={sheetRef}>
        {/* An empty canvas is nothing but add-section actions, so it says so
            plainly rather than rendering a blank sheet with a hairline on it. */}
        {campaign.sections.length === 0 && !isGenerating ? (
          <div className="px-10 py-12">
            <EmptyState
              icon={
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="7" rx="1.5" />
                  <path d="M3 15h18M3 19h12" />
                </svg>
              }
              title="Add your first section"
              description="Build the email module by module — a header to hook, a body to sell, cards for the products. You can reorder and rewrite any of it later."
              action={<Button variant="primary" size="sm" onClick={() => setPickerAt(0)}>Add section</Button>}
            />
          </div>
        ) : (
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="canvas-sections">
              {(droppable) => (
                <div ref={droppable.innerRef} {...droppable.droppableProps}>
                  {campaign.sections.map((section, i) => {
                    // The spec is resolved BY ID (spec 4). No positional or
                    // type-based fallback: a wrong spec silently renders the wrong
                    // slot count, grid size or product binding.
                    const spec = specForSection(sectionStructure, section);
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
                      <Draggable key={section.id} draggableId={section.id} index={i} isDragDisabled={isGenerating}>
                        {(draggable, snapshot) => (
                          <div
                            ref={draggable.innerRef}
                            {...draggable.draggableProps}
                            data-section-id={section.id}
                            className={`relative bg-surface ${isNewest ? "rc-section-enter" : ""} ${snapshot.isDragging ? "shadow-pop rounded-md" : ""}`}
                          >
                            {/* n + 1 dividers for n sections: this one is the
                                boundary ABOVE the section, which is how a section
                                can finally be added at the top. */}
                            <InsertDivider onClick={() => setPickerAt(i)} />
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
                              onDelete={() => onDeleteSection(section.id)}
                              onMoveUp={() => onMoveSection(section.id, "up")}
                              onMoveDown={() => onMoveSection(section.id, "down")}
                              productSlug={reviewSlug}
                              defaultTone={toneDial}
                              onRegenerateElement={
                                assistsEnabled && expandedBrief && chosenConceit
                                  ? (key, steering, tone) => regenerateElement(section.id, key, steering, tone)
                                  : undefined
                              }
                              assistsDisabledReason={assistsDisabledReason}
                              dragHandleProps={draggable.dragHandleProps}
                              onRequestDeleteSection={() => onDeleteSection(section.id)}
                              onRenameFlags={onRenameFlags}
                            />
                          </div>
                        )}
                      </Draggable>
                    );
                  })}
                  {droppable.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        )}

        {/* "more coming" affordance while streaming */}
        {isGenerating && (
          <div className="px-10 py-8 space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        )}

        {/* The trailing boundary. Appending is also always available from the
            toolbar (and Cmd-Shift-A), so the writer never has to hunt for this. */}
        {campaign.sections.length > 0 && !isGenerating && (
          <InsertDivider onClick={() => setPickerAt(campaign.sections.length)} label="Add section at the end" />
        )}
      </div>

      <SectionPicker
        open={pickerAt !== null}
        position={
          pickerAt === null ? null
            : pickerAt === 0 && campaign.sections.length > 0 ? { index: 0, label: "at the top" }
            : pickerAt >= campaign.sections.length ? { index: pickerAt, label: "at the end" }
            : { index: pickerAt, label: `before section ${pickerAt + 1}` }
        }
        onClose={() => setPickerAt(null)}
        onInsert={(type, specPatch) => {
          onInsertAt(pickerAt ?? campaign.sections.length, type, specPatch);
          setPickerAt(null);
        }}
        selectedProducts={productOptions}
      />

      {regenModal && (() => {
        const sectionId = regenModal.sectionId;
        const section = campaign.sections.find((s) => s.id === sectionId);
        const sectionSpec = (section && specForSection(sectionStructure, section))
          || { id: sectionId, type: regenModal.type as SectionType };
        return (
          <VariationsModal
            title={`${regenModal.type} section`}
            chips={SECTION_CHIPS}
            showTone
            defaultTone={toneDial}
            onFetch={async (feedback, tone, prior) => {
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
                  // What the user has already seen and passed on, so a new set
                  // is genuinely new rather than the same prompt run again.
                  prior_variations: prior.map((p) => ({ label: p.label, preview: p.preview })),
                }),
              });
              const data = await res.json();
              const vars = (data.variations ?? []) as { label: string; section: GeneratedSection }[];
              const items = vars.map((v) => ({ label: v.label, preview: sectionPreview(v.section), payload: v.section }));
              const failures = ((data.failures ?? []) as { failed: string }[]).map((f) => f.failed);
              return { items, failures };
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
