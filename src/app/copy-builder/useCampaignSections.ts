"use client";
import { useCallback } from "react";
import type { GeneratedCampaign, GeneratedSection, SectionSpec, SectionType } from "@/lib/schemas";
import * as sections from "@/lib/campaign-sections";

// Canvas section mutations, bound to the page's campaign + sectionStructure state.
// Spec §4 (the two arrays must move together) and §7 (extract the canvas-mutation
// logic into a hook without attempting the full page decomposition).
//
// The pair of setters is the whole point. CampaignCanvas used to own insert /
// delete / move itself, but it is only handed `sectionStructure` as a read-only
// prop — so it had no way to keep the structure in step, which is precisely how
// the index-drift bug arose. Mutations live here, where both setters are in reach,
// and the canvas receives them as callbacks.
//
// The logic itself is pure and unit-tested in src/lib/campaign-sections.ts; this
// is only the state binding.

export interface CampaignSectionsApi {
  /** Insert at an absolute index. 0 = above the first section, length = append. */
  insertAt: (index: number, type: SectionType, specPatch?: Partial<SectionSpec>) => void;
  /** Append to the end — the toolbar button and ⌘⇧A path. */
  append: (type: SectionType, specPatch?: Partial<SectionSpec>) => void;
  insertAfter: (afterId: string, type: SectionType, specPatch?: Partial<SectionSpec>) => void;
  deleteSection: (id: string) => void;
  moveSection: (id: string, dir: "up" | "down") => void;
  /** Drag-and-drop reorder by index. */
  reorder: (from: number, to: number) => void;
  patchSpec: (id: string, patch: Partial<SectionSpec>) => void;
  updateSection: (id: string, next: GeneratedSection) => void;
}

export function useCampaignSections({
  campaign,
  sectionStructure,
  setCampaign,
  setSectionStructure,
  onInserted,
}: {
  campaign: GeneratedCampaign | null;
  sectionStructure: SectionSpec[];
  setCampaign: (c: GeneratedCampaign) => void;
  setSectionStructure: (s: SectionSpec[]) => void;
  /** Fired with the new section's id, so the canvas can scroll it into view. */
  onInserted?: (id: string) => void;
}): CampaignSectionsApi {
  // Commit both halves of a mutation in one call. Writing the structure
  // unconditionally (even when unchanged) keeps this a single obvious path.
  const commit = useCallback((next: sections.CanvasSections) => {
    setCampaign(next.campaign);
    setSectionStructure(next.sectionStructure);
  }, [setCampaign, setSectionStructure]);

  const state = useCallback((): sections.CanvasSections | null => {
    if (!campaign) return null;
    return { campaign, sectionStructure };
  }, [campaign, sectionStructure]);

  const insertAt = useCallback((index: number, type: SectionType, specPatch: Partial<SectionSpec> = {}) => {
    const current = state();
    if (!current) return;
    const next = sections.insertAt(current, index, type, specPatch);
    commit(next);
    onInserted?.(next.insertedId);
  }, [state, commit, onInserted]);

  const append = useCallback((type: SectionType, specPatch: Partial<SectionSpec> = {}) => {
    const current = state();
    if (!current) return;
    insertAt(current.campaign.sections.length, type, specPatch);
  }, [state, insertAt]);

  const insertAfter = useCallback((afterId: string, type: SectionType, specPatch: Partial<SectionSpec> = {}) => {
    const current = state();
    if (!current) return;
    const next = sections.insertAfterId(current, afterId, type, specPatch);
    commit(next);
    onInserted?.(next.insertedId);
  }, [state, commit, onInserted]);

  const deleteSection = useCallback((id: string) => {
    const current = state();
    if (current) commit(sections.removeSection(current, id));
  }, [state, commit]);

  const moveSection = useCallback((id: string, dir: "up" | "down") => {
    const current = state();
    if (current) commit(sections.moveSection(current, id, dir));
  }, [state, commit]);

  const reorder = useCallback((from: number, to: number) => {
    const current = state();
    if (current) commit(sections.reorderSections(current, from, to));
  }, [state, commit]);

  const patchSpec = useCallback((id: string, patch: Partial<SectionSpec>) => {
    const current = state();
    if (current) setSectionStructure(sections.patchSpec(current, id, patch).sectionStructure);
  }, [state, setSectionStructure]);

  const updateSection = useCallback((id: string, next: GeneratedSection) => {
    const current = state();
    if (current) setCampaign(sections.updateSection(current, id, next).campaign);
  }, [state, setCampaign]);

  return { insertAt, append, insertAfter, deleteSection, moveSection, reorder, patchSpec, updateSection };
}
