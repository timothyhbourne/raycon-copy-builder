import type { GeneratedSection, SectionElements, SectionType } from "./schemas";
import { REPEATABLE_ELEMENTS, repeatableFamilyFor } from "./schemas";

/**
 * Canvas-level element add / delete for a generated section — the pure core
 * behind the per-element controls in SectionBlock.
 *
 * THE GOTCHA THIS EXISTS FOR: SectionBlock renders
 * `[...presentKeys, ...missingCatalogue]`, re-appending any catalogue element
 * absent from `elements`. So deleting a key from `elements` alone makes it
 * reappear on the very next render. A deletion only sticks because the key is
 * also recorded in `section.removed_elements`, which is what these helpers
 * maintain (and which persists through the draft store and library snapshot).
 */

/**
 * True for `Review` and any `Review N`. Real customer text: fetched from the
 * storefront and used verbatim, NEVER written by a model. Lives here rather than
 * in the prompt module so client components can import it (the prompt module
 * pulls in the USP banks, which read from disk).
 */
export function isReviewElement(key: string): boolean {
  return key === "Review" || /^Review \d+$/.test(key);
}

/** Subheader is returned as an array of 3 option strings. */
export function elementReturnsVariants(key: string): boolean {
  return key === "Subheader";
}

/** Headline is returned as a slate of 4 pattern-labelled candidates, each with
 * its paired tagline — a different shape from the Subheader's plain strings, so it
 * gets its own predicate rather than overloading the one above
 * (docs/RECURSIVE_LEARNING_FRAMEWORK_SPEC.md §1.3). */
export function elementReturnsHeadlineSlate(key: string): boolean {
  return key === "Headline";
}

/** A `Products[2].one_liner` style key for a single grid-item field. */
export function parseGridItemKey(
  key: string
): { index: number; field: "name" | "image_direction" | "one_liner" | "cta" } | null {
  const m = key.match(/^Products\[(\d+)\]\.(name|image_direction|one_liner|cta)$/);
  if (!m) return null;
  return { index: Number(m[1]), field: m[2] as "name" | "image_direction" | "one_liner" | "cta" };
}

/** "Review 2" → { family: "Review", index: 2 }. Null for a non-member key. */
export function parseFamilyMember(key: string): { family: string; index: number } | null {
  const m = key.match(/^(.+?)\s+(\d+)$/);
  if (!m) return null;
  const index = Number(m[2]);
  if (!Number.isInteger(index) || index < 1) return null;
  return { family: m[1], index };
}

export const memberKey = (family: string, index: number) => `${family} ${index}`;

/** Present members of `family`, in ascending numeric order. */
export function membersOfFamily(keys: string[], family: string): string[] {
  return keys
    .map((k) => ({ k, p: parseFamilyMember(k) }))
    .filter((x): x is { k: string; p: { family: string; index: number } } => x.p?.family === family)
    .sort((a, b) => a.p.index - b.p.index)
    .map((x) => x.k);
}

/**
 * The element keys a section actually shows: its own order first (so generated
 * copy keeps the order it was written in), then catalogue elements still
 * missing, minus anything deleted on the canvas.
 */
export function visibleElementKeys(section: GeneratedSection, catalogue: string[]): string[] {
  const presentKeys = Object.keys(section.elements);
  const missing = catalogue.filter((k) => !presentKeys.includes(k));
  const removed = new Set(section.removed_elements ?? []);
  return [...presentKeys, ...missing].filter((k) => !removed.has(k));
}

/**
 * Where a newly added key belongs in the current key order.
 * A family member lands directly after the last existing member of its family
 * (so Review 4 follows Review 3, not CTA); any other element lands at its
 * catalogue position, after the nearest preceding catalogue element present.
 */
function insertIndexFor(currentKeys: string[], key: string, catalogue: string[]): number {
  const member = parseFamilyMember(key);
  if (member) {
    const siblings = membersOfFamily(currentKeys, member.family);
    if (siblings.length) {
      return currentKeys.indexOf(siblings[siblings.length - 1]) + 1;
    }
  }
  const catIdx = catalogue.indexOf(key);
  if (catIdx > 0) {
    for (let i = catIdx - 1; i >= 0; i--) {
      const pos = currentKeys.indexOf(catalogue[i]);
      if (pos !== -1) return pos + 1;
    }
    return 0; // nothing before it is present — it leads the section
  }
  if (catIdx === 0) return 0;
  return currentKeys.length; // not in the catalogue at all — append
}

/** Rebuild an element map with `key` inserted at `index` (objects keep insertion order). */
function withKeyAt(
  elements: SectionElements,
  key: string,
  index: number,
  value: SectionElements[string]
): SectionElements {
  const entries = Object.entries(elements).filter(([k]) => k !== key);
  entries.splice(index, 0, [key, value]);
  return Object.fromEntries(entries);
}

/**
 * Reconcile a family's removal markers with how many members it now has: any
 * member at or below `count` is un-removed, and every catalogue member above it
 * is marked removed. Without the second half, shrinking a family would let
 * `missingCatalogue` re-append the trailing slots as empty fields.
 */
function syncFamilyRemovals(
  removed: Set<string>,
  family: string,
  count: number,
  catalogue: string[]
): void {
  for (const key of catalogue) {
    const p = parseFamilyMember(key);
    if (p?.family !== family) continue;
    if (p.index <= count) removed.delete(key);
    else removed.add(key);
  }
  // Also clear markers above the catalogue's own range (a family grown past it).
  for (const key of [...removed]) {
    const p = parseFamilyMember(key);
    if (p?.family === family && p.index <= count) removed.delete(key);
  }
}

/**
 * Delete one element from a section.
 *
 * Deleting a family member RENUMBERS the survivors so there is never a gap
 * (Review 1, Review 3 → Review 1, Review 2). `renames` reports the old→new key
 * mapping so the caller can migrate repetition-flag keys, which are keyed by
 * element name.
 */
export function deleteElement(
  section: GeneratedSection,
  key: string,
  catalogue: string[]
): { section: GeneratedSection; renames: Record<string, string> } {
  const removed = new Set(section.removed_elements ?? []);
  const renames: Record<string, string> = {};
  let elements: SectionElements = Object.fromEntries(
    Object.entries(section.elements).filter(([k]) => k !== key)
  );

  const member = parseFamilyMember(key);
  if (member) {
    // Renumber survivors to close the gap. Each entry keeps ITS OWN value and is
    // simply re-keyed via this lookup, so the result is correct even if the
    // members aren't in ascending order in the element map.
    const survivors = membersOfFamily(Object.keys(elements), member.family);
    const newKeyFor = new Map<string, string>();
    survivors.forEach((k, i) => newKeyFor.set(k, memberKey(member.family, i + 1)));
    const renumbered: [string, SectionElements[string]][] = Object.entries(elements).map(([k, v]) => {
      const nextKey = newKeyFor.get(k);
      if (nextKey && nextKey !== k) renames[k] = nextKey;
      return [nextKey ?? k, v];
    });
    elements = Object.fromEntries(renumbered);
    removed.delete(key);
    syncFamilyRemovals(removed, member.family, survivors.length, catalogue);
  } else {
    removed.add(key);
  }

  const next: GeneratedSection = { ...section, elements };
  if (removed.size) next.removed_elements = [...removed];
  else delete next.removed_elements;

  // A deleted Subheader must not leave its variant picker behind.
  if (key === "Subheader") {
    delete next.subheader_variants;
    delete next.subheader_selected;
  }
  return { section: next, renames };
}

/** Add (or re-add) one element, empty, at its correct position. */
export function addElement(
  section: GeneratedSection,
  key: string,
  catalogue: string[]
): GeneratedSection {
  const removed = new Set(section.removed_elements ?? []);
  removed.delete(key);

  const currentKeys = Object.keys(section.elements);
  const elements = currentKeys.includes(key)
    ? section.elements
    : withKeyAt(section.elements, key, insertIndexFor(currentKeys, key, catalogue), "");

  const member = parseFamilyMember(key);
  if (member) {
    syncFamilyRemovals(removed, member.family, membersOfFamily(Object.keys(elements), member.family).length, catalogue);
  }

  const next: GeneratedSection = { ...section, elements };
  if (removed.size) next.removed_elements = [...removed];
  else delete next.removed_elements;
  return next;
}

/** The next member key for a family ("Review 4"), or null at the max. */
export function nextMemberKey(
  section: GeneratedSection,
  type: SectionType,
  family: string
): string | null {
  const rule = (REPEATABLE_ELEMENTS[type] ?? []).find((f) => f.family === family);
  if (!rule) return null;
  const visible = membersOfFamily(visibleElementKeys(section, []), family);
  if (visible.length >= rule.max) return null;
  return memberKey(family, visible.length + 1);
}

/**
 * Whether `key` may be deleted: a section must keep at least one element, and a
 * repeatable family must keep its minimum. The reason is returned so the UI can
 * explain the block (and offer "delete the section instead").
 */
export function canDeleteElement(
  section: GeneratedSection,
  type: SectionType,
  key: string,
  catalogue: string[]
): { ok: true } | { ok: false; reason: string; lastElement?: boolean } {
  const visible = visibleElementKeys(section, catalogue);
  if (visible.length <= 1) {
    return { ok: false, reason: "This is the section's last element.", lastElement: true };
  }
  const rule = repeatableFamilyFor(type, key);
  if (rule) {
    const count = membersOfFamily(visible, rule.family).length;
    if (count <= rule.min) {
      return { ok: false, reason: `A ${type} section keeps at least ${rule.min} ${rule.family}${rule.min === 1 ? "" : "s"}.` };
    }
  }
  return { ok: true };
}

/**
 * What the "+ add element" menu should offer: catalogue elements currently
 * absent (including ones deleted on the canvas), opted-in optional elements
 * still missing, and the next member of each repeatable family.
 */
export function addableElements(
  section: GeneratedSection,
  type: SectionType,
  catalogue: string[],
  optional: string[] = []
): string[] {
  const visible = new Set(visibleElementKeys(section, catalogue));
  const out: string[] = [];
  for (const key of [...catalogue, ...optional]) {
    if (!visible.has(key) && !out.includes(key)) out.push(key);
  }
  for (const rule of REPEATABLE_ELEMENTS[type] ?? []) {
    const next = nextMemberKey(section, type, rule.family);
    if (next && !visible.has(next) && !out.includes(next)) out.push(next);
  }
  return out;
}
