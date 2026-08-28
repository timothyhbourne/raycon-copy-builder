import { describe, it, expect } from "vitest";
import { audienceKey, compareAudiences } from "./audience-match";
import type { AudienceRef } from "./planner-types";

const seg = (id: string, name: string): AudienceRef => ({ id, name, type: "segment" });
const list = (id: string, name: string): AudienceRef => ({ id, name, type: "list" });

describe("audienceKey", () => {
  it("compares by Klaviyo id — the real basis", () => {
    expect(audienceKey(seg("Abc123", "US Subscribers"))).toBe("id:Abc123");
  });

  it("treats the same id under a RENAMED audience as the same audience", () => {
    // A segment renamed in Klaviyo must not read as "missing + extra".
    expect(audienceKey(seg("Abc123", "US Subs L30D"))).toBe(audienceKey(seg("Abc123", "US Subscribers")));
  });

  it("falls back to a normalised name for a legacy hand-typed entry with no id", () => {
    expect(audienceKey({ id: "", name: "  US Subscribers ", type: "segment" })).toBe("name:us subscribers");
    expect(audienceKey({ id: "", name: "us subscribers", type: "segment" }))
      .toBe(audienceKey({ id: "", name: "US Subscribers", type: "segment" }));
  });
});

describe("compareAudiences — unknown, not a false all-clear", () => {
  it("is unknown when no campaign is linked (no actual to compare)", () => {
    const r = compareAudiences({ included: [seg("a", "A")], excluded: [] }, null);
    expect(r.verdict).toBe("unknown");
    expect(r.summary).toBe("");
  });

  it("is unknown when there is no brief — silence must not read as approval", () => {
    // Reporting "match" for an unwritten brief would be the worst outcome: it
    // would look like the audience was checked when nothing was stated.
    const r = compareAudiences({ included: [], excluded: [] }, { included: [seg("a", "A")], excluded: [] });
    expect(r.verdict).toBe("unknown");
  });

  it("is unknown when both sides are entirely empty", () => {
    expect(compareAudiences({ included: [], excluded: [] }, { included: [], excluded: [] }).verdict).toBe("unknown");
  });
});

describe("compareAudiences — match", () => {
  it("matches identical sets", () => {
    const p = { included: [seg("a", "A"), list("b", "B")], excluded: [seg("x", "X")] };
    const r = compareAudiences(p, { included: [list("b", "B"), seg("a", "A")], excluded: [seg("x", "X")] });
    expect(r.verdict).toBe("match");
    expect(r.summary).toBe("");
  });

  it("ignores ORDER", () => {
    const r = compareAudiences(
      { included: [seg("a", "A"), seg("b", "B")], excluded: [] },
      { included: [seg("b", "B"), seg("a", "A")], excluded: [] },
    );
    expect(r.verdict).toBe("match");
  });

  it("matches when a segment was renamed in Klaviyo but is the same id", () => {
    const r = compareAudiences(
      { included: [seg("Abc123", "US Subscribers")], excluded: [] },
      { included: [seg("Abc123", "US Subscribers (renamed)")], excluded: [] },
    );
    expect(r.verdict).toBe("match");
  });

  it("matches a brief with only exclusions honoured", () => {
    const r = compareAudiences(
      { included: [], excluded: [seg("x", "Purchasers")] },
      { included: [], excluded: [seg("x", "Purchasers")] },
    );
    expect(r.verdict).toBe("match");
  });
});

describe("compareAudiences — differs, named precisely", () => {
  it("names the wrong segment on both sides, the spec's own example", () => {
    const r = compareAudiences(
      { included: [seg("l30", "US Subscribers L30D")], excluded: [seg("p30", "Purchasers Last 30 Days")] },
      { included: [seg("l90", "US Subscribers L90D")], excluded: [] },
    );
    expect(r.verdict).toBe("differs");
    expect(r.missing_included.map((a) => a.name)).toEqual(["US Subscribers L30D"]);
    expect(r.extra_included.map((a) => a.name)).toEqual(["US Subscribers L90D"]);
    expect(r.missing_excluded.map((a) => a.name)).toEqual(["Purchasers Last 30 Days"]);
    expect(r.summary).toContain("missing exclusion: Purchasers Last 30 Days");
    expect(r.summary).toContain("US Subscribers L30D");
    expect(r.summary).toContain("US Subscribers L90D");
  });

  it("leads with a MISSED EXCLUSION — the one that mails the wrong people", () => {
    const r = compareAudiences(
      { included: [seg("a", "A")], excluded: [seg("x", "Unsubscribed Recently")] },
      { included: [seg("a", "A"), seg("b", "B")], excluded: [] },
    );
    expect(r.summary.startsWith("missing exclusion: Unsubscribed Recently")).toBe(true);
  });

  it("reports an audience built that nobody asked for", () => {
    const r = compareAudiences(
      { included: [seg("a", "A")], excluded: [] },
      { included: [seg("a", "A"), seg("b", "Everyone")], excluded: [] },
    );
    expect(r.verdict).toBe("differs");
    expect(r.extra_included.map((a) => a.name)).toEqual(["Everyone"]);
    expect(r.summary).toContain("built with Everyone, not in the brief");
  });

  it("reports an extra exclusion as a difference, not an error", () => {
    const r = compareAudiences(
      { included: [seg("a", "A")], excluded: [] },
      { included: [seg("a", "A")], excluded: [seg("x", "Suppressed")] },
    );
    expect(r.verdict).toBe("differs");
    expect(r.summary).toContain("also excluded Suppressed");
  });

  it("detects a brief that was built with nothing at all", () => {
    const r = compareAudiences({ included: [seg("a", "A")], excluded: [] }, { included: [], excluded: [] });
    expect(r.verdict).toBe("differs");
    expect(r.missing_included).toHaveLength(1);
  });

  it("does not double-report a duplicated entry", () => {
    const r = compareAudiences(
      { included: [seg("a", "A"), seg("a", "A")], excluded: [] },
      { included: [], excluded: [] },
    );
    expect(r.missing_included).toHaveLength(1);
  });

  it("compares a legacy no-id brief against an id-carrying build by name", () => {
    const r = compareAudiences(
      { included: [{ id: "", name: "US Subscribers", type: "segment" }], excluded: [] },
      { included: [seg("Abc123", "US Subscribers")], excluded: [] },
    );
    // No shared basis: the names can't be matched to ids, so it reports a
    // difference rather than pretending to have verified it.
    expect(r.verdict).toBe("differs");
  });

  it("ends the summary with a full stop and never leaves it empty when differing", () => {
    const r = compareAudiences({ included: [seg("a", "A")], excluded: [] }, { included: [], excluded: [] });
    expect(r.summary.endsWith(".")).toBe(true);
    expect(r.summary.length).toBeGreaterThan(0);
  });
});

describe("compareAudiences — never mutates its inputs", () => {
  it("leaves both arguments untouched", () => {
    const p = { included: [seg("a", "A")], excluded: [seg("x", "X")] };
    const a = { included: [seg("b", "B")], excluded: [] };
    const before = JSON.stringify([p, a]);
    compareAudiences(p, a);
    expect(JSON.stringify([p, a])).toBe(before);
  });
});
