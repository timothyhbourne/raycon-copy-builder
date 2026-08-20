import type {
  BriefInput, ExpandedBrief, Conceit, GeneratedCampaign,
  LibraryCampaign, SavedCampaign, SectionSpec,
} from "@/lib/schemas";
import { DEFAULT_TONE_DIAL } from "@/lib/schemas";

// Pure helpers + shared types for the Copy Builder page, split out of page.tsx
// (mirrors the dashboard's types.ts / format.ts split) so the page component
// carries state + wiring only.

export const LS_DRAFT = "raycon_canvas_draft";

export type Stage = "form" | "canvas";

// Where the current canvas content came from. "scratch" is a hand-written canvas
// that has never been saved — it behaves exactly like "draft" for autosave and
// persistence, and is distinguished only so the UI can offer the editable
// minimum-viable brief instead of a compiled conceit (spec 2.2).
export type CanvasSource = "new" | "draft" | "library" | "scratch";

/** An empty campaign for a hand-written canvas: three blank subject/preview slots
 * (so the MetaBlock renders its three lanes and the writer can fill them in) and
 * no sections at all. */
export function blankCampaign(): GeneratedCampaign {
  return {
    meta: { subject_lines: ["", "", ""], preview_texts: ["", "", ""] },
    sections: [],
  };
}

/** The minimum viable brief a scratch canvas starts from. compileBrief() needs a
 * name and an offer to produce anything useful; everything else has a default. */
export function blankBriefInput(): BriefInput {
  return {
    campaign_name: "",
    campaign_type: "promo",
    offer: "",
    audience: "all",
    angle: "offer_led",
    products_featured: [],
    section_structure: [],
    tone_dial: DEFAULT_TONE_DIAL,
  };
}

/** A scratch canvas can compile a brief (and therefore run the AI assists) once it
 * has a name and an offer. Anything less and compileBrief has nothing to say. */
export function scratchBriefReady(brief: Pick<BriefInput, "campaign_name" | "offer"> | null): boolean {
  return !!brief?.campaign_name.trim() && !!brief?.offer.trim();
}

export const SCRATCH_ASSISTS_DISABLED_REASON = "Add a campaign name and offer to enable rewrites.";

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
