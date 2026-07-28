import type {
  BriefInput, ExpandedBrief, Conceit, GeneratedCampaign,
  LibraryCampaign, SavedCampaign, SectionSpec,
} from "@/lib/schemas";

// Pure helpers + shared types for the Copy Builder page, split out of page.tsx
// (mirrors the dashboard's types.ts / format.ts split) so the page component
// carries state + wiring only.

export const LS_DRAFT = "raycon_canvas_draft";

export type Stage = "form" | "canvas";

// Where the current canvas content came from.
export type CanvasSource = "new" | "draft" | "library";

// Planner handoff context, needed for write-back on save. Persisted alongside
// the canvas draft so it survives the generate -> save cycle and a refresh.
export interface PlannerLinkContext { rowId: string; name: string; channel: string }

export type StepKey = "form" | "canvas";
export const STEP_ORDER: Record<StepKey, number> = { form: 0, canvas: 1 };

export type LibraryMeta = Omit<LibraryCampaign, "body">;
export type SavedMeta = Omit<SavedCampaign, "campaign" | "expanded_brief" | "section_structure">;

export function makeSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function resetState(setters: {
  setStage: (s: Stage) => void;
  setCampaign: (c: GeneratedCampaign | null) => void;
  setExpandedBrief: (e: ExpandedBrief | null) => void;
  setChosenConceit: (c: Conceit | null) => void;
  setSectionStructure: (s: SectionSpec[]) => void;
  setCurrentBriefInput: (b: BriefInput | null) => void;
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
  setters.setCanvasSource("new");
  setters.setCurrentDraftId(null);
  setters.setCurrentLibraryId(null);
  localStorage.removeItem(LS_DRAFT);
}
