import { describe, it, expect } from "vitest";
import {
  parseFamilyMember, membersOfFamily, visibleElementKeys,
  deleteElement, addElement, nextMemberKey, canDeleteElement, addableElements,
} from "./element-families";
import { SECTION_CATALOGUE, sectionElementNames } from "./schemas";
import type { GeneratedSection } from "./schemas";

const reviews = (over: Partial<GeneratedSection> = {}): GeneratedSection => ({
  id: "s1", type: "reviews",
  elements: { Subheader: "What people say", "Review 1": "one", "Review 2": "two", "Review 3": "three" },
  ...over,
});
const REVIEWS_CAT = SECTION_CATALOGUE.reviews;

describe("parseFamilyMember", () => {
  it("splits a member key into family and index", () => {
    expect(parseFamilyMember("Review 2")).toEqual({ family: "Review", index: 2 });
    expect(parseFamilyMember("USP 10")).toEqual({ family: "USP", index: 10 });
  });
  it("returns null for non-member keys", () => {
    for (const k of ["Review", "Subheader", "CTA", "Body Copy", "Review 0", "Review -1"]) {
      expect(parseFamilyMember(k)).toBeNull();
    }
  });
  it("keeps multi-word families intact", () => {
    expect(parseFamilyMember("Add-On 2")).toEqual({ family: "Add-On", index: 2 });
  });
});

describe("membersOfFamily", () => {
  it("returns members in ascending numeric order regardless of key order", () => {
    expect(membersOfFamily(["Review 10", "CTA", "Review 2", "Review 1"], "Review"))
      .toEqual(["Review 1", "Review 2", "Review 10"]);
  });
  it("does not match a different family", () => {
    expect(membersOfFamily(["USP 1", "Review 1"], "Review")).toEqual(["Review 1"]);
  });
});

describe("visibleElementKeys", () => {
  it("re-appends missing catalogue elements (so a blank section is fillable)", () => {
    const s = reviews({ elements: { Subheader: "x" } });
    expect(visibleElementKeys(s, REVIEWS_CAT)).toEqual(["Subheader", "Review 1", "Review 2", "Review 3"]);
  });

  it("hides canvas-removed elements — the gotcha this whole module exists for", () => {
    const s = reviews({ removed_elements: ["Subheader"] });
    expect(visibleElementKeys(s, REVIEWS_CAT)).toEqual(["Review 1", "Review 2", "Review 3"]);
  });

  it("keeps the generated order first, then missing catalogue keys", () => {
    const s = reviews({ elements: { "Review 1": "a", Subheader: "b" } });
    expect(visibleElementKeys(s, REVIEWS_CAT)).toEqual(["Review 1", "Subheader", "Review 2", "Review 3"]);
  });

  it("is unchanged for a section with no removed_elements (backward compatible)", () => {
    expect(visibleElementKeys(reviews(), REVIEWS_CAT))
      .toEqual(["Subheader", "Review 1", "Review 2", "Review 3"]);
  });
});

describe("deleteElement — plain element", () => {
  it("removes it and records the removal so it cannot reappear", () => {
    const { section } = deleteElement(reviews(), "Subheader", REVIEWS_CAT);
    expect(section.elements.Subheader).toBeUndefined();
    expect(section.removed_elements).toContain("Subheader");
    expect(visibleElementKeys(section, REVIEWS_CAT)).not.toContain("Subheader");
  });

  it("clears the subheader variant picker when the Subheader goes", () => {
    const s = reviews({ subheader_variants: ["a", "b", "c"], subheader_selected: 1 });
    const { section } = deleteElement(s, "Subheader", REVIEWS_CAT);
    expect(section.subheader_variants).toBeUndefined();
    expect(section.subheader_selected).toBeUndefined();
  });

  it("leaves other elements untouched", () => {
    const { section } = deleteElement(reviews(), "Subheader", REVIEWS_CAT);
    expect(section.elements).toEqual({ "Review 1": "one", "Review 2": "two", "Review 3": "three" });
  });
});

describe("deleteElement — family renumbering", () => {
  it("closes the gap: deleting Review 2 of three leaves Review 1, Review 2", () => {
    const { section } = deleteElement(reviews(), "Review 2", REVIEWS_CAT);
    expect(Object.keys(section.elements)).toEqual(["Subheader", "Review 1", "Review 2"]);
    // Values follow their element, so old Review 3's text is now Review 2.
    expect(section.elements["Review 1"]).toBe("one");
    expect(section.elements["Review 2"]).toBe("three");
  });

  it("reports the old→new renames so flag keys can be migrated", () => {
    const { renames } = deleteElement(reviews(), "Review 2", REVIEWS_CAT);
    expect(renames).toEqual({ "Review 3": "Review 2" });
  });

  it("marks the freed trailing catalogue slot removed so it is not re-appended", () => {
    const { section } = deleteElement(reviews(), "Review 2", REVIEWS_CAT);
    expect(section.removed_elements).toContain("Review 3");
    expect(visibleElementKeys(section, REVIEWS_CAT)).toEqual(["Subheader", "Review 1", "Review 2"]);
  });

  it("renumbers correctly when the deleted member is the first", () => {
    const { section, renames } = deleteElement(reviews(), "Review 1", REVIEWS_CAT);
    expect(section.elements["Review 1"]).toBe("two");
    expect(section.elements["Review 2"]).toBe("three");
    expect(renames).toEqual({ "Review 2": "Review 1", "Review 3": "Review 2" });
  });

  it("needs no renames when the deleted member is the last", () => {
    const { section, renames } = deleteElement(reviews(), "Review 3", REVIEWS_CAT);
    expect(Object.keys(section.elements)).toEqual(["Subheader", "Review 1", "Review 2"]);
    expect(renames).toEqual({});
  });

  it("handles a family grown beyond the catalogue", () => {
    const s = reviews({ elements: { "Review 1": "a", "Review 2": "b", "Review 3": "c", "Review 4": "d" } });
    const { section } = deleteElement(s, "Review 2", REVIEWS_CAT);
    expect(Object.keys(section.elements)).toEqual(["Review 1", "Review 2", "Review 3"]);
    expect(section.elements["Review 3"]).toBe("d");
  });
});

describe("addElement — ordering", () => {
  it("inserts a new family member right after the last existing one, not at the end", () => {
    const s = reviews({ elements: { Subheader: "x", "Review 1": "a", "Review 2": "b", "Review 3": "c", CTA: "go" } });
    const out = addElement(s, "Review 4", REVIEWS_CAT);
    expect(Object.keys(out.elements)).toEqual(["Subheader", "Review 1", "Review 2", "Review 3", "Review 4", "CTA"]);
    expect(out.elements["Review 4"]).toBe("");
  });

  it("re-adds a removed element at its catalogue position", () => {
    const s = reviews({ elements: { "Review 1": "a", "Review 2": "b", "Review 3": "c" }, removed_elements: ["Subheader"] });
    const out = addElement(s, "Subheader", REVIEWS_CAT);
    expect(Object.keys(out.elements)).toEqual(["Subheader", "Review 1", "Review 2", "Review 3"]);
    expect(out.removed_elements).toBeUndefined();
  });

  it("un-removes a family slot so it becomes visible again", () => {
    const { section } = deleteElement(reviews(), "Review 3", REVIEWS_CAT);
    expect(section.removed_elements).toContain("Review 3");
    const back = addElement(section, "Review 3", REVIEWS_CAT);
    expect(visibleElementKeys(back, REVIEWS_CAT)).toEqual(["Subheader", "Review 1", "Review 2", "Review 3"]);
    expect(back.removed_elements ?? []).not.toContain("Review 3");
  });

  it("is a no-op on a key that is already present", () => {
    const s = reviews();
    expect(addElement(s, "Review 1", REVIEWS_CAT).elements).toEqual(s.elements);
  });

  it("puts a catalogue element first when nothing precedes it", () => {
    const s = reviews({ elements: { "Review 1": "a" }, removed_elements: ["Subheader"] });
    expect(Object.keys(addElement(s, "Subheader", REVIEWS_CAT).elements)).toEqual(["Subheader", "Review 1"]);
  });

  it("appends an element that is not in the catalogue at all", () => {
    const s: GeneratedSection = { id: "h", type: "header", elements: { Headline: "a", Tagline: "b", CTA: "c" } };
    expect(Object.keys(addElement(s, "Sub-Tagline", SECTION_CATALOGUE.header).elements))
      .toEqual(["Headline", "Tagline", "CTA", "Sub-Tagline"]);
  });
});

describe("delete then add round-trips", () => {
  it("restores the original shape after deleting and re-adding a family member", () => {
    const original = reviews();
    const { section: afterDelete } = deleteElement(original, "Review 3", REVIEWS_CAT);
    const restored = addElement(afterDelete, "Review 3", REVIEWS_CAT);
    expect(visibleElementKeys(restored, REVIEWS_CAT)).toEqual(visibleElementKeys(original, REVIEWS_CAT));
  });
});

describe("nextMemberKey", () => {
  it("returns the next slot for a repeatable family", () => {
    expect(nextMemberKey(reviews(), "reviews", "Review")).toBe("Review 4");
  });
  it("returns null at the family maximum", () => {
    const s = reviews({ elements: Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [`Review ${i + 1}`, "x"])
    ) });
    expect(nextMemberKey(s, "reviews", "Review")).toBeNull();
  });
  it("returns null for a family the section type does not repeat", () => {
    const s: GeneratedSection = { id: "p", type: "product_card_review", elements: { Review: "r" } };
    expect(nextMemberKey(s, "product_card_review", "Review")).toBeNull();
  });
});

describe("canDeleteElement", () => {
  it("allows a normal delete", () => {
    expect(canDeleteElement(reviews(), "reviews", "Subheader", REVIEWS_CAT)).toEqual({ ok: true });
  });

  it("blocks emptying a section and flags it as the last element", () => {
    const s = reviews({ elements: { Subheader: "only" }, removed_elements: ["Review 1", "Review 2", "Review 3"] });
    const res = canDeleteElement(s, "reviews", "Subheader", REVIEWS_CAT);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.lastElement).toBe(true);
  });

  it("blocks dropping a family below its minimum", () => {
    // usps keeps at least 2 USPs. The bound is on VISIBLE fields, so the
    // catalogue must also be a 2-slot one — a 3-slot catalogue would re-append an
    // empty "USP 3" field and there would legitimately be 3 to delete from.
    const catalogue = sectionElementNames({
      type: "usps",
      usp_slots: [{ source: "product" }, { source: "product" }],
    });
    expect(catalogue).toEqual(["Subheader", "USP 1", "USP 2", "CTA"]);
    const s: GeneratedSection = { id: "u", type: "usps", elements: { "USP 1": "a", "USP 2": "b", CTA: "go" } };
    const res = canDeleteElement(s, "usps", "USP 2", catalogue);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/at least 2 USP/);
  });

  it("allows deleting a USP above the minimum", () => {
    const s: GeneratedSection = { id: "u", type: "usps", elements: { "USP 1": "a", "USP 2": "b", "USP 3": "c" } };
    expect(canDeleteElement(s, "usps", "USP 3", sectionElementNames({ type: "usps" })).ok).toBe(true);
  });

  it("allows deleting the single Review of a product_card_review (not a family)", () => {
    const s: GeneratedSection = { id: "p", type: "product_card_review", elements: { "Product Name": "n", Review: "r", CTA: "c" } };
    expect(canDeleteElement(s, "product_card_review", "Review", SECTION_CATALOGUE.product_card_review).ok).toBe(true);
  });
});

describe("addableElements", () => {
  it("offers the next family member", () => {
    expect(addableElements(reviews(), "reviews", REVIEWS_CAT)).toContain("Review 4");
  });
  it("offers a previously deleted element back", () => {
    const { section } = deleteElement(reviews(), "Subheader", REVIEWS_CAT);
    expect(addableElements(section, "reviews", REVIEWS_CAT)).toContain("Subheader");
  });
  it("offers optional elements for the type", () => {
    const s: GeneratedSection = { id: "h", type: "header", elements: { Headline: "a", Tagline: "b", CTA: "c" } };
    expect(addableElements(s, "header", SECTION_CATALOGUE.header, ["Sub-Tagline"])).toEqual(["Sub-Tagline"]);
  });
  it("does not offer something already visible", () => {
    expect(addableElements(reviews(), "reviews", REVIEWS_CAT)).not.toContain("Review 1");
  });
  it("does not offer past the family maximum", () => {
    const s = reviews({ elements: Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [`Review ${i + 1}`, "x"])
    ) });
    expect(addableElements(s, "reviews", REVIEWS_CAT).filter((k) => k.startsWith("Review"))).toEqual([]);
  });
});

describe("interaction with sectionElementNames (spec-level removals)", () => {
  it("a spec-level removal and a canvas removal compose without resurrecting either", () => {
    // Spec says "don't generate a Subheader"; the canvas then deletes USP 3.
    const catalogue = sectionElementNames({ type: "usps", removed_elements: ["Subheader"] });
    expect(catalogue).toEqual(["USP 1", "USP 2", "USP 3", "CTA"]);
    const s: GeneratedSection = { id: "u", type: "usps", elements: { "USP 1": "a", "USP 2": "b", "USP 3": "c", CTA: "go" } };
    const { section } = deleteElement(s, "USP 3", catalogue);
    expect(visibleElementKeys(section, catalogue)).toEqual(["USP 1", "USP 2", "CTA"]);
    expect(visibleElementKeys(section, catalogue)).not.toContain("Subheader");
  });

  it("respects a 5-slot USP catalogue when adding", () => {
    const catalogue = sectionElementNames({
      type: "usps",
      usp_slots: Array.from({ length: 5 }, () => ({ source: "product" as const })),
    });
    const s: GeneratedSection = { id: "u", type: "usps", elements: { "USP 1": "a", "USP 2": "b" } };
    expect(visibleElementKeys(s, catalogue)).toEqual(["USP 1", "USP 2", "Subheader", "USP 3", "USP 4", "USP 5", "CTA"]);
  });
});
