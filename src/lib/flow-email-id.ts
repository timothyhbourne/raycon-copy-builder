// Composite ids for flow emails — PURE, and deliberately in its own module.
//
// Every other copy record (SavedCampaign, LibraryCampaign, SmsCampaign) is a
// top-level store entry with its own id, so `loadX(id)` resolves it. A flow email
// is NESTED inside a Flow, so an id-based lookup has nothing to resolve. The
// planner needs one anyway — to link a flow email to a row, to render it in the
// copy viewer, and to hand it to design.
//
// So a flow email is addressed as "<flowId>::<emailId>". Both halves are
// nanoid-safe and the delimiter cannot occur in the existing id format
// (YYYY-MM-DD-slug-nanoid6), which makes a composite id unambiguous: it can only
// be a flow email, and a plain id can never be one. That is what lets the
// planner's resolution order stay simple — try flows first, since the check is
// cheap and a composite id can't be anything else.
//
// This lives apart from lib/flows.ts (the store) because lib/flows.ts imports
// `path` + the storage adapter and can't be bundled into a client component. The
// PLANNER PAGE needs the parse — without it, stale-link healing sees a composite
// id that isn't in its set of known draft/library ids and deletes a perfectly
// valid link. Same split, and same reason, as flow-playbooks.ts vs prompts/flows.ts.

export const FLOW_EMAIL_ID_SEP = "::";

// Matches the isSafeId guards in the stores: slug characters only, so a composite
// id can never smuggle anything odd into a store key.
function isSafeIdPart(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

/** Compose the planner-facing id for one email of one flow. */
export function flowEmailId(flowId: string, emailId: string): string {
  return `${flowId}${FLOW_EMAIL_ID_SEP}${emailId}`;
}

/** Split a composite flow-email id. Returns null for ANYTHING without the
 * delimiter — which is how the other stores stay untouched by this. */
export function parseFlowEmailId(id: string): { flowId: string; emailId: string } | null {
  if (typeof id !== "string") return null;
  const at = id.indexOf(FLOW_EMAIL_ID_SEP);
  if (at <= 0) return null;
  const flowId = id.slice(0, at);
  const emailId = id.slice(at + FLOW_EMAIL_ID_SEP.length);
  if (!isSafeIdPart(flowId) || !isSafeIdPart(emailId)) return null;
  return { flowId, emailId };
}

/** True when this id addresses a flow email rather than a draft/library/SMS copy. */
export function isFlowEmailId(id: string | undefined | null): boolean {
  return !!id && parseFlowEmailId(id) !== null;
}
