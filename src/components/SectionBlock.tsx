"use client";
import { useState } from "react";
import type { DraggableProvidedDragHandleProps } from "@hello-pangea/dnd";
import type { GeneratedSection, ProductInGrid, HeadlineVariant, ReviewProvenance } from "@/lib/schemas";
import { SECTION_CATALOGUE, OPTIONAL_ELEMENTS, DEFAULT_TONE_DIAL } from "@/lib/schemas";
import type { ProductReview } from "@/lib/reviews/fetch";
import {
  visibleElementKeys, addableElements, deleteElement, addElement, canDeleteElement,
  isReviewElement,
} from "@/lib/element-families";
import EditableField from "./EditableField";
import RepetitionChip from "./RepetitionChip";
import ReviewProvenanceLine from "./ReviewProvenanceLine";
import { elementKey, gridProductKey, type RepetitionFlag } from "@/lib/repetition-client";

interface Props {
  section: GeneratedSection;
  index: number;
  total: number;
  /** Number of columns for product_grid sections */
  gridCols?: number;
  /** The elements this section should have, derived from its SectionSpec by the
   * canvas (USP slot count, optional elements, switched-off removable ones).
   * Falls back to the raw type catalogue when no spec matched the section. */
  catalogueElements?: string[];
  /** Similarity flags keyed by element key (see repetition-client). */
  flags?: Record<string, RepetitionFlag>;
  onDismissFlag?: (key: string) => void;
  onChange: (s: GeneratedSection) => void;
  onRegenerate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  /** Drag handle bindings from the canvas's Draggable. Absent = no drag (the
   * arrow buttons stay, and remain the keyboard-accessible path). */
  dragHandleProps?: DraggableProvidedDragHandleProps | null;
  /** Set when the AI assists cannot run yet (a scratch canvas with no brief).
   * The controls render DISABLED with this as their tooltip — a stated reason,
   * never a dead button (spec 2.3). */
  assistsDisabledReason?: string;
  /** Product SKU this section's Review is about — drives the Review refresh
   * control (product_card_review: the card's product; reviews: the campaign's
   * featured product). Absent → no refresh control. */
  productSlug?: string;
  /** Regenerate ONE element via /api/regenerate-element. Resolves to the new
   * value (or 3 options for a Subheader), or null when it couldn't. Absent →
   * per-element regenerate controls are hidden. */
  onRegenerateElement?: (
    elementKey: string,
    steering?: string,
    tone?: number
  ) => Promise<{ value?: string; variants?: string[]; headline_variants?: HeadlineVariant[] } | null>;
  /** Delete the whole section — offered when the user tries to remove its last element. */
  onRequestDeleteSection?: () => void;
  /** Repetition-flag keys to migrate after a family renumber (old key → new key). */
  onRenameFlags?: (sectionId: string, renames: Record<string, string>) => void;
  defaultTone?: number;
}

export default function SectionBlock({
  section,
  index,
  total,
  gridCols,
  catalogueElements,
  flags,
  onDismissFlag,
  onChange,
  onRegenerate,
  onDelete,
  onMoveUp,
  onMoveDown,
  dragHandleProps,
  assistsDisabledReason,
  productSlug,
  onRegenerateElement,
  onRequestDeleteSection,
  onRenameFlags,
  defaultTone = DEFAULT_TONE_DIAL,
}: Props) {
  const [hovered, setHovered] = useState(false);
  const [draggingProduct, setDraggingProduct] = useState<number | null>(null);
  const [dragOverProduct, setDragOverProduct] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // Per-element transient state, all keyed by element name so one element's
  // spinner/error/undo never touches another's.
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<{ key: string; message: string } | null>(null);
  const [steerKey, setSteerKey] = useState<string | null>(null);
  const [steerText, setSteerText] = useState("");
  const [steerTone, setSteerTone] = useState(defaultTone);
  // Previous value held for a one-click revert after a regenerate — per-element
  // regeneration invites experimentation, and without undo a good line is lost.
  const [undo, setUndo] = useState<{
    key: string;
    value: string | ProductInGrid[];
    variants?: string[];
    selected?: number;
    headlineVariants?: HeadlineVariant[];
    headlineSelected?: number;
    tagline?: string | ProductInGrid[];
    /** Review elements only: the record that made the previous text saveable. */
    provenance?: ReviewProvenance;
  } | null>(null);
  const [confirmLast, setConfirmLast] = useState<string | null>(null);

  const flagFor = (key: string): RepetitionFlag | undefined => flags?.[key];

  // The elements this section shows: its own order first (so generated copy — e.g.
  // a bundle's USPs before its CTA — keeps the order it was written in), then any
  // catalogue elements still missing, minus anything deleted on the canvas.
  // Appending the missing catalogue keys is what lets a freshly INSERTED blank
  // section be filled in; `removed_elements` is what stops a DELETED element from
  // coming straight back through that same path.
  // Prefer the spec-derived list (variable USP count, switched-off Subheader/CTA);
  // fall back to the raw type catalogue for a section with no matching spec.
  const catalogue = catalogueElements ?? SECTION_CATALOGUE[section.type] ?? [];
  const elementKeys = visibleElementKeys(section, catalogue);
  const addable = addableElements(section, section.type, catalogue, OPTIONAL_ELEMENTS[section.type] ?? []);

  const updateElement = (key: string, value: string | ProductInGrid[]) => {
    const next: GeneratedSection = { ...section, elements: { ...section.elements, [key]: value } };
    // Headline and Tagline are a PAIR held in headline_variants. Editing the
    // Tagline field by hand has to write back into the selected candidate, or the
    // edit silently disappears the next time the writer switches candidates.
    if (key === "Tagline" && typeof value === "string" && section.headline_variants?.length) {
      const i = section.headline_selected ?? 0;
      next.headline_variants = section.headline_variants.map((v, idx) => (idx === i ? { ...v, tagline: value } : v));
    }
    onChange(next);
  };

  // Review refresh: cycle through real fetched reviews for this product; on
  // exhausting the list, re-pull fresh from the storefront (refresh=1). Swaps
  // both the review text and the attributed reviewer name. NEVER fabricates —
  // this is why Review elements route here instead of to the LLM.
  //
  // Keyed by element so `Review 2` can be swapped on its own, and so a `reviews`
  // section never shows the same review twice: each slot skips any review already
  // placed in a sibling slot.
  const [reviewList, setReviewList] = useState<ProductReview[] | null>(null);
  const [reviewProv, setReviewProv] = useState<ReviewProvenance[] | null>(null);
  const [reviewIdxByKey, setReviewIdxByKey] = useState<Record<string, number>>({});
  const fmtReview = (r: ProductReview) => (r.author ? `${r.text} — ${r.author}` : r.text);

  /** Place a real review AND its provenance. The two always move together: a
   * review element without a provenance record cannot be saved (it blocks Save
   * Final), so writing the text alone would produce copy that looks fine and
   * refuses to ship. */
  const applyReview = (key: string, text: string, provenance: ReviewProvenance) => {
    onChange({
      ...section,
      elements: { ...section.elements, [key]: text },
      review_provenance: { ...(section.review_provenance ?? {}), [key]: provenance },
    });
  };

  const fetchReviews = async (refresh: boolean): Promise<{ list: ProductReview[]; prov: ReviewProvenance[] }> => {
    const res = await fetch(`/api/reviews?product=${encodeURIComponent(productSlug as string)}&limit=8${refresh ? "&refresh=1" : ""}`);
    const data = (await res.json()) as { reviews?: ProductReview[]; provenance?: ReviewProvenance[] };
    const list = data.reviews ?? [];
    const prov = data.provenance ?? [];
    setReviewList(list);
    setReviewProv(prov);
    return { list, prov };
  };

  const cycleReview = async (key = "Review", opts: { refresh?: boolean } = {}) => {
    if (!productSlug || busyKey) return;
    setBusyKey(key);
    setErrorKey(null);
    try {
      let list = opts.refresh ? null : reviewList;
      let prov = opts.refresh ? null : reviewProv;
      if (!list) {
        const fetched = await fetchReviews(!!opts.refresh);
        list = fetched.list;
        prov = fetched.prov;
      }
      if (!list.length) {
        setErrorKey({ key, message: "No real reviews available for this product yet. Leaving it empty." });
        return;
      }
      // Text already used by the OTHER review slots in this section.
      const taken = new Set(
        Object.entries(section.elements)
          .filter(([k, v]) => k !== key && isReviewElement(k) && typeof v === "string" && v.trim())
          .map(([, v]) => (v as string).trim())
      );
      const provFor = (i: number): ReviewProvenance =>
        prov?.[i] ?? { origin: "fetched", fetched_at: new Date().toISOString() };
      const start = (reviewIdxByKey[key] ?? -1) + 1;
      let chosen = -1;
      for (let step = 0; step < list.length; step++) {
        const i = (start + step) % list.length;
        if (!taken.has(fmtReview(list[i]).trim())) { chosen = i; break; }
      }
      if (chosen === -1) {
        // Every cached review is already on screen — pull a fresh page.
        const fresh = await fetchReviews(true);
        const next = fresh.list.findIndex((r) => !taken.has(fmtReview(r).trim()));
        if (next === -1) {
          setErrorKey({ key, message: "No other distinct review available for this product." });
          return;
        }
        setReviewIdxByKey((m) => ({ ...m, [key]: next }));
        setUndo({ key, value: section.elements[key] ?? "", provenance: section.review_provenance?.[key] });
        applyReview(key, fmtReview(fresh.list[next]), fresh.prov[next] ?? { origin: "fetched", fetched_at: new Date().toISOString() });
        return;
      }
      setReviewIdxByKey((m) => ({ ...m, [key]: chosen }));
      setUndo({ key, value: section.elements[key] ?? "", provenance: section.review_provenance?.[key] });
      applyReview(key, fmtReview(list[chosen]), provFor(chosen));
    } catch {
      setErrorKey({ key, message: "Couldn't reach the review service. The current review is unchanged." });
    } finally { setBusyKey(null); }
  };

  // ---- per-element regenerate / delete / add --------------------------------

  const runRegenerateElement = async (key: string, steering?: string, tone?: number) => {
    // A Review is never model-written: the control maps to "another real review".
    if (isReviewElement(key)) { await cycleReview(key); return; }
    if (!onRegenerateElement || busyKey) return;
    setBusyKey(key);
    setErrorKey(null);
    try {
      const result = await onRegenerateElement(key, steering, tone);
      if (!result || (!result.value && !result.variants?.length)) {
        setErrorKey({ key, message: "Nothing came back. Try again or add steering." });
        return;
      }
      setUndo({
        key,
        value: section.elements[key] ?? "",
        variants: section.subheader_variants,
        selected: section.subheader_selected,
        headlineVariants: section.headline_variants,
        headlineSelected: section.headline_selected,
        tagline: section.elements["Tagline"],
      });
      if (key === "Subheader" && result.variants?.length) {
        onChange({
          ...section,
          subheader_variants: result.variants,
          subheader_selected: 0,
          elements: { ...section.elements, Subheader: result.variants[0] },
        });
      } else if (key === "Headline" && result.headline_variants?.length) {
        const first = result.headline_variants[0];
        const elements: GeneratedSection["elements"] = { ...section.elements, Headline: first.text };
        if (first.tagline && section.elements["Tagline"] !== undefined) elements["Tagline"] = first.tagline;
        onChange({ ...section, headline_variants: result.headline_variants, headline_selected: 0, elements });
      } else if (result.value !== undefined) {
        updateElement(key, result.value);
      }
    } catch {
      setErrorKey({ key, message: "Regeneration failed. The current text is unchanged." });
    } finally { setBusyKey(null); }
  };

  const revertUndo = () => {
    if (!undo) return;
    const next: GeneratedSection = {
      ...section,
      elements: { ...section.elements, [undo.key]: undo.value },
    };
    if (undo.key === "Subheader") {
      if (undo.variants) { next.subheader_variants = undo.variants; next.subheader_selected = undo.selected ?? 0; }
      else { delete next.subheader_variants; delete next.subheader_selected; }
    }
    if (isReviewElement(undo.key)) {
      // Put the provenance back with the text; dropping it would leave a real
      // review looking unverified and blocking the save.
      const provenance = { ...(section.review_provenance ?? {}) };
      if (undo.provenance) provenance[undo.key] = undo.provenance;
      else delete provenance[undo.key];
      next.review_provenance = provenance;
    }
    if (undo.key === "Headline") {
      if (undo.headlineVariants) {
        next.headline_variants = undo.headlineVariants;
        next.headline_selected = undo.headlineSelected ?? 0;
      } else {
        delete next.headline_variants;
        delete next.headline_selected;
      }
      // The pair moves together, so a headline revert has to put its tagline back.
      if (undo.tagline !== undefined) next.elements = { ...next.elements, Tagline: undo.tagline };
    }
    onChange(next);
    setUndo(null);
  };

  const handleDeleteElement = (key: string) => {
    const check = canDeleteElement(section, section.type, key, catalogue);
    if (!check.ok) {
      if (check.lastElement) { setConfirmLast(key); return; }
      setErrorKey({ key, message: check.reason });
      return;
    }
    const { section: next, renames } = deleteElement(section, key, catalogue);
    if (Object.keys(renames).length) onRenameFlags?.(section.id, renames);
    if (undo?.key === key) setUndo(null);
    if (errorKey?.key === key) setErrorKey(null);
    onChange(next);
  };

  const handleAddElement = (key: string) => {
    onChange(addElement(section, key, catalogue));
    setAddOpen(false);
  };

  // ---- Slate pickers -------------------------------------------------------
  // Two elements arrive as a slate of candidates: Subheader (3 option strings) and
  // Headline (4 pattern-labelled candidates, each carrying its paired tagline).
  // elements.<key> always mirrors the selection so downstream consumers see plain
  // strings; for the headline that means mirroring the TAGLINE too, because the
  // pair is one thought (data/copy-system.md craft rule 8).
  const subheaderVariants = section.subheader_variants ?? [];
  const headlineVariants = section.headline_variants ?? [];

  const selectSubheader = (i: number) => {
    onChange({
      ...section,
      subheader_selected: i,
      elements: { ...section.elements, Subheader: subheaderVariants[i] ?? "" },
    });
  };
  const editSelectedSubheader = (text: string) => {
    const selected = section.subheader_selected ?? 0;
    const variants = [...subheaderVariants];
    variants[selected] = text;
    onChange({
      ...section,
      subheader_variants: variants,
      elements: { ...section.elements, Subheader: text },
    });
  };

  const selectHeadline = (i: number) => {
    const pick = headlineVariants[i];
    if (!pick) return;
    const elements: GeneratedSection["elements"] = { ...section.elements, Headline: pick.text };
    // Only move the Tagline when this section HAS one and the candidate carries
    // one — never invent a tagline field a section did not ask for.
    if (pick.tagline && section.elements["Tagline"] !== undefined) elements["Tagline"] = pick.tagline;
    onChange({ ...section, headline_selected: i, elements });
  };
  const editSelectedHeadline = (text: string) => {
    const selected = section.headline_selected ?? 0;
    const variants = headlineVariants.map((v, i) => (i === selected ? { ...v, text } : v));
    onChange({
      ...section,
      headline_variants: variants,
      elements: { ...section.elements, Headline: text },
    });
  };

  /** One radio row per candidate. `label` is the pattern name for a headline
   * slate; subheaders have no pattern, so it stays blank. */
  const renderSlate = (
    variants: { text: string; label?: string; sub?: string }[],
    selected: number,
    onSelect: (i: number) => void,
    onEdit: (text: string) => void,
  ) => (
    <div className="space-y-1">
      {variants.map((v, i) => {
        const isSelected = i === selected;
        return (
          <div
            key={i}
            onClick={() => { if (!isSelected) onSelect(i); }}
            className={`flex items-start gap-2 rounded border transition-colors ${
              isSelected
                ? "border-line-strong bg-sunken"
                : "border-transparent hover:border-line hover:bg-sunken/60 cursor-pointer"
            }`}
          >
            <span
              className={`mt-2.5 ml-2 w-3 h-3 shrink-0 rounded-full border ${
                isSelected ? "border-ink-secondary bg-ink-secondary" : "border-line-strong bg-white"
              }`}
            />
            <div className="flex-1 min-w-0">
              {v.label && (
                <div className="t-label text-action-600 normal-case tracking-normal pt-1.5 px-2">
                  {v.label.replace(/_/g, " ")}
                </div>
              )}
              {isSelected ? (
                <EditableField value={v.text} onChange={onEdit} multiline={false} />
              ) : (
                <div className="text-sm text-ink-tertiary px-2 py-1.5 leading-relaxed">{v.text}</div>
              )}
              {v.sub && (
                <div className="text-xs text-ink-muted px-2 pb-1.5 leading-relaxed">{v.sub}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderSubheaderVariants = () => renderSlate(
    subheaderVariants.map((text) => ({ text })),
    section.subheader_selected ?? 0,
    selectSubheader,
    editSelectedSubheader,
  );

  const renderHeadlineVariants = () => renderSlate(
    headlineVariants.map((v) => ({
      text: v.text,
      label: v.pattern && v.pattern !== "unclassified" ? v.pattern : undefined,
      // The tagline is shown under its headline so the pair reads as one thought
      // while the writer is choosing. It stays editable in its own Tagline field.
      sub: v.tagline ? `\u21b3 ${v.tagline}` : undefined,
    })),
    section.headline_selected ?? 0,
    selectHeadline,
    editSelectedHeadline,
  );

  const renderElement = (key: string, value: string | ProductInGrid[], placeholder?: string) => {
    if (key === "Products" && Array.isArray(value)) {
      const cols = gridCols ?? 1;
      return (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {value.map((p, i) => (
            <div
              key={i}
              draggable
              onDragStart={() => setDraggingProduct(i)}
              onDragOver={(e) => { e.preventDefault(); setDragOverProduct(i); }}
              onDrop={() => {
                if (draggingProduct === null || draggingProduct === i) return;
                const updated = [...value];
                [updated[draggingProduct], updated[i]] = [updated[i], updated[draggingProduct]];
                updateElement(key, updated);
                setDraggingProduct(null);
                setDragOverProduct(null);
              }}
              onDragEnd={() => { setDraggingProduct(null); setDragOverProduct(null); }}
              className={`border rounded-lg p-3 space-y-1.5 transition-all ${
                dragOverProduct === i && draggingProduct !== i
                  ? "border-line-strong bg-sunken scale-[1.02]"
                  : draggingProduct === i
                  ? "border-line-strong opacity-40"
                  : "border-line"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="cursor-grab text-ink-muted hover:text-ink-tertiary select-none text-sm">⠿</span>
              </div>
              <div>
                <span className="t-label">name</span>
                <EditableField
                  value={p.name}
                  onChange={(v) => {
                    const updated = [...value];
                    updated[i] = { ...p, name: v };
                    updateElement(key, updated);
                  }}
                  multiline={false}
                />
              </div>
              <div>
                <span className="t-label">image direction</span>
                <EditableField
                  value={p.image_direction}
                  onChange={(v) => {
                    const updated = [...value];
                    updated[i] = { ...p, image_direction: v };
                    updateElement(key, updated);
                  }}
                />
              </div>
              <div>
                <span className="t-label">one-liner</span>
                {(() => {
                  const flag = flagFor(gridProductKey(section.id, i));
                  return flag ? (
                    <span className="ml-2"><RepetitionChip flag={flag} onDismiss={() => onDismissFlag?.(gridProductKey(section.id, i))} /></span>
                  ) : null;
                })()}
                <EditableField
                  value={p.one_liner}
                  onChange={(v) => {
                    const updated = [...value];
                    updated[i] = { ...p, one_liner: v };
                    updateElement(key, updated);
                  }}
                  multiline={false}
                />
              </div>
              <div>
                <span className="t-label">cta</span>
                <EditableField
                  value={p.cta}
                  onChange={(v) => {
                    const updated = [...value];
                    updated[i] = { ...p, cta: v };
                    updateElement(key, updated);
                  }}
                  multiline={false}
                />
              </div>
            </div>
          ))}
        </div>
      );
    }
    if (Array.isArray(value)) return null;
    return (
      <EditableField
        value={value ?? ""}
        onChange={(v) => updateElement(key, v)}
        placeholder={placeholder}
        multiline={key !== "Headline" && key !== "Tagline" && key !== "CTA" && key !== "Subheader" && key !== "Closing Line"}
      />
    );
  };

  return (
    <div className="relative group section-block" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div className="py-9">
        {/* Section label + controls — float quietly, revealed on hover/focus. */}
        {/* focus-within matters for more than politeness: the drag handle lives in
            here, and @hello-pangea/dnd's keyboard drag (space to lift, arrows to
            move) starts by focusing it — an invisible focused control is unusable. */}
        <div className={`flex items-center justify-between mb-4 transition-opacity focus-within:opacity-100 ${hovered || addOpen ? "opacity-100" : "opacity-0"}`}>
          <span className="t-label">{section.type.replace(/_/g, " ")}</span>
          <div className="flex items-center gap-1">
            {addable.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setAddOpen((o) => !o)}
                  className="text-xs text-ink-tertiary hover:text-ink-secondary px-1.5 py-0.5 rounded hover:bg-sunken transition-colors"
                  title="Add an element to this section"
                >
                  + element
                </button>
                {addOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setAddOpen(false)} />
                    <div className="absolute z-20 right-0 mt-1 bg-white border border-line rounded-md shadow-lg py-1 min-w-[170px]">
                      <div className="t-label px-3 py-1 text-ink-tertiary">Add element…</div>
                      {addable.map((k) => (
                        <button
                          key={k}
                          onClick={() => handleAddElement(k)}
                          className="w-full text-left px-3 py-1.5 text-xs text-ink-secondary hover:bg-sunken transition-colors"
                        >
                          {k}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {dragHandleProps && (
              <span
                {...dragHandleProps}
                role="button"
                aria-label="Drag to reorder section"
                title="Drag to reorder"
                className="text-xs text-ink-tertiary hover:text-ink-secondary px-1.5 py-0.5 rounded hover:bg-sunken transition-colors cursor-grab active:cursor-grabbing select-none"
              >
                ⠿
              </span>
            )}
            {index > 0 && (
              <button onClick={onMoveUp} className="text-xs text-ink-tertiary hover:text-ink-secondary px-1.5 py-0.5 rounded hover:bg-sunken transition-colors" title="Move up">↑</button>
            )}
            {index < total - 1 && (
              <button onClick={onMoveDown} className="text-xs text-ink-tertiary hover:text-ink-secondary px-1.5 py-0.5 rounded hover:bg-sunken transition-colors" title="Move down">↓</button>
            )}
            <button
              onClick={onRegenerate}
              disabled={!!assistsDisabledReason}
              title={assistsDisabledReason || "Rewrite this whole section"}
              className="text-xs text-ink-tertiary hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed px-2 py-0.5 rounded hover:bg-sunken transition-colors"
            >
              ↻ regenerate
            </button>
            <button
              onClick={onDelete}
              className="text-xs text-ink-tertiary hover:text-danger-600 px-1.5 py-0.5 rounded hover:bg-sunken transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Elements */}
        <div className="space-y-4">
          {elementKeys.map((key) => {
            const value = section.elements[key] ?? "";
            const isSubheaderWithVariants = key === "Subheader" && subheaderVariants.length > 1;
            const isHeadlineWithVariants = key === "Headline" && headlineVariants.length > 1;
            const slateCount = isSubheaderWithVariants ? subheaderVariants.length : isHeadlineWithVariants ? headlineVariants.length : 0;
            const flag = flagFor(elementKey(section.id, key));
            const isReview = isReviewElement(key);
            const busy = busyKey === key;
            // A Review's regenerate means "fetch another real one", so it needs a
            // product to pull from; everything else needs the LLM route. When the
            // brief is too thin to compile, the control is shown DISABLED with the
            // reason instead of vanishing (spec 2.3).
            const canRegen = isReview ? !!productSlug : (!!onRegenerateElement || !!assistsDisabledReason);
            const regenBlocked = !isReview && !onRegenerateElement;
            const isArrayValue = Array.isArray(value);
            return (
              <div key={key} className="group/el">
                <div className="t-label mb-1 flex items-center gap-2">
                  {key}
                  {slateCount > 0 && (
                    <span className="text-action-600 normal-case tracking-normal">
                      · {slateCount} {isHeadlineWithVariants ? "patterns" : "options"}, pick one
                    </span>
                  )}
                  {flag && <RepetitionChip flag={flag} onDismiss={() => onDismissFlag?.(elementKey(section.id, key))} />}

                  {/* Per-element controls — quiet until the element is hovered. */}
                  <span className={`ml-auto flex items-center gap-0.5 transition-opacity ${
                    busy || steerKey === key || undo?.key === key ? "opacity-100" : "opacity-0 group-hover/el:opacity-100 focus-within:opacity-100"
                  }`}>
                    {undo?.key === key && !busy && (
                      <button type="button" onClick={revertUndo} title="Put the previous version back"
                        className="normal-case tracking-normal text-xs text-warning-600 hover:text-warning-600 px-1.5 py-0.5 rounded hover:bg-warning-50 transition-colors">
                        revert
                      </button>
                    )}
                    {canRegen && !isArrayValue && (
                      <button type="button" onClick={() => runRegenerateElement(key)} disabled={!!busyKey || regenBlocked}
                        title={regenBlocked ? assistsDisabledReason : isReview ? "Show a different real review" : `Rewrite the ${key}`}
                        className="normal-case tracking-normal text-xs text-ink-tertiary hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed px-1.5 py-0.5 rounded hover:bg-sunken transition-colors inline-flex items-center gap-1">
                        <span className={busy ? "animate-spin inline-block" : "inline-block"}>↻</span>
                        {isReview && <span>another review</span>}
                      </button>
                    )}
                    {canRegen && !isReview && !isArrayValue && (
                      <button type="button" onClick={() => { setSteerKey(steerKey === key ? null : key); setSteerText(""); setSteerTone(defaultTone); }}
                        disabled={!!busyKey || regenBlocked}
                        title={regenBlocked ? assistsDisabledReason : "Rewrite with steering"}
                        className="text-xs text-ink-tertiary hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed px-1.5 py-0.5 rounded hover:bg-sunken transition-colors">
                        ⋯
                      </button>
                    )}
                    <button type="button" onClick={() => handleDeleteElement(key)} disabled={!!busyKey}
                      title={`Remove ${key} from this section`}
                      className="text-xs text-ink-muted hover:text-danger-600 disabled:opacity-40 px-1.5 py-0.5 rounded hover:bg-sunken transition-colors">
                      ✕
                    </button>
                  </span>
                </div>

                {steerKey === key && (
                  <div className="mb-2 border border-line rounded-md bg-sunken p-2 space-y-2">
                    <input
                      type="text" value={steerText} autoFocus
                      onChange={(e) => setSteerText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { setSteerKey(null); runRegenerateElement(key, steerText, steerTone); }
                        if (e.key === "Escape") setSteerKey(null);
                      }}
                      placeholder={`How should this ${key.toLowerCase()} change?`}
                      className="w-full text-xs border border-line rounded px-2 py-1 bg-white focus:outline-none focus:border-line-strong"
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-ink-tertiary shrink-0">tone {steerTone}</span>
                      <input type="range" min={1} max={5} value={steerTone}
                        onChange={(e) => setSteerTone(Number(e.target.value))}
                        className="flex-1 accent-slate-900" />
                      <button type="button" onClick={() => { setSteerKey(null); runRegenerateElement(key, steerText, steerTone); }}
                        className="text-xs bg-ink text-white px-2.5 py-1 rounded hover:bg-ink-secondary transition-colors">
                        Rewrite
                      </button>
                      <button type="button" onClick={() => setSteerKey(null)}
                        className="text-xs text-ink-tertiary px-2 py-1 rounded hover:bg-sunken transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {errorKey?.key === key && (
                  <div className="mb-2 text-xs text-warning-600 bg-warning-50 border border-warning-200 rounded px-2 py-1">
                    {errorKey.message}
                  </div>
                )}

                {isSubheaderWithVariants
                  ? renderSubheaderVariants()
                  : isHeadlineWithVariants
                    ? renderHeadlineVariants()
                    : renderElement(key, value as string | ProductInGrid[], `Write the ${key.toLowerCase()}…`)}

                {/* Where this review came from — visible without clicking, because
                    "is this real?" is the question a writer has about every review. */}
                {isReview && (
                  <ReviewProvenanceLine
                    provenance={section.review_provenance?.[key]}
                    hasText={typeof value === "string" && !!value.trim()}
                    busy={busy}
                    onFetch={productSlug ? () => cycleReview(key) : undefined}
                    onRefresh={productSlug ? () => cycleReview(key, { refresh: true }) : undefined}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Last-element guard: a section can't be emptied, so offer the section
          delete instead of silently refusing. */}
      {confirmLast && (
        <div className="mb-4 text-xs bg-warning-50 border border-warning-200 rounded px-3 py-2 flex items-center gap-3">
          <span className="text-warning-600">
            &ldquo;{confirmLast}&rdquo; is this section&rsquo;s last element. Delete the whole {section.type.replace(/_/g, " ")} section instead?
          </span>
          <button
            type="button"
            onClick={() => { setConfirmLast(null); (onRequestDeleteSection ?? onDelete)(); }}
            className="ml-auto shrink-0 text-danger-600 hover:text-danger-600 font-medium"
          >
            Delete section
          </button>
          <button type="button" onClick={() => setConfirmLast(null)} className="shrink-0 text-ink-tertiary hover:text-ink-secondary">
            Keep it
          </button>
        </div>
      )}

      {/* Insertion is the canvas's job now (it renders a divider at every
          boundary, including above the first section — see InsertDivider). */}
    </div>
  );
}
