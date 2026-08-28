import { describe, it, expect } from "vitest";
import {
  deriveCampaignName, displayTitle, resolveCampaignName, tidyName, MAX_DERIVED_NAME, UNTITLED_LABEL,
} from "./campaign-name";
import type { GeneratedCampaign, GeneratedSection } from "./schemas";

const section = (over: Partial<GeneratedSection> = {}): GeneratedSection => ({
  id: "s1", type: "header", elements: {}, ...over,
});
const campaign = (over: Partial<GeneratedCampaign> = {}): GeneratedCampaign => ({
  meta: { subject_lines: [], preview_texts: [] }, sections: [], ...over,
});

const TODAY = "2026-08-26";

describe("deriveCampaignName", () => {
  it("prefers the Headline — it identifies the campaign better than anything else", () => {
    const c = campaign({
      meta: { subject_lines: ["A subject line"], preview_texts: [] },
      sections: [section({ elements: { Headline: "Sound that keeps up" } })],
    });
    expect(deriveCampaignName(c, TODAY)).toBe("Sound that keeps up");
  });

  it("takes the SELECTED headline candidate, never a rejected one", () => {
    const c = campaign({
      sections: [section({
        elements: { Headline: "stale mirror value" },
        headline_variants: [
          { pattern: "idiom_remix", text: "Not this one" },
          { pattern: "bold_claim", text: "The chosen headline" },
        ],
        headline_selected: 1,
      })],
    });
    expect(deriveCampaignName(c, TODAY)).toBe("The chosen headline");
  });

  it("defaults to slate candidate 0 when no selection was recorded", () => {
    const c = campaign({
      sections: [section({
        elements: {},
        headline_variants: [{ pattern: "rhyme", text: "First candidate" }, { pattern: "rhyme", text: "Second" }],
      })],
    });
    expect(deriveCampaignName(c, TODAY)).toBe("First candidate");
  });

  it("falls through to the first NON-EMPTY subject line", () => {
    const c = campaign({
      meta: { subject_lines: ["", "   ", "The real subject"], preview_texts: [] },
      sections: [section({ elements: { "Body Copy": "no headline here" } })],
    });
    expect(deriveCampaignName(c, TODAY)).toBe("The real subject");
  });

  it("skips sections with a blank Headline rather than naming the campaign empty", () => {
    const c = campaign({
      sections: [section({ elements: { Headline: "   " } }), section({ elements: { Headline: "Second section wins" } })],
    });
    expect(deriveCampaignName(c, TODAY)).toBe("Second section wins");
  });

  it("falls back to a DATED name, so it always returns something usable", () => {
    // Returning "" here would just move the blank-row bug rather than fix it.
    expect(deriveCampaignName(campaign(), TODAY)).toBe("Untitled — 2026-08-26");
    expect(deriveCampaignName(null, TODAY)).toBe("Untitled — 2026-08-26");
    expect(deriveCampaignName(campaign({ sections: [section()] }), TODAY)).toBe("Untitled — 2026-08-26");
  });

  it("never returns an empty string, whatever it is given", () => {
    for (const c of [null, undefined, campaign(), campaign({ sections: [section({ elements: { Headline: "" } })] })]) {
      expect(deriveCampaignName(c, TODAY).length).toBeGreaterThan(0);
    }
  });
});

describe("tidyName", () => {
  it("collapses whitespace and newlines", () => {
    expect(tidyName("  Sound   that\nkeeps  up ")).toBe("Sound that keeps up");
  });

  it("caps the length", () => {
    const long = "word ".repeat(40);
    expect(tidyName(long).length).toBeLessThanOrEqual(MAX_DERIVED_NAME);
  });

  it("breaks on a word boundary rather than mid-word", () => {
    const s = "Pocket sized buds with a marathon sized battery that simply refuses to quit on you";
    const out = tidyName(s);
    expect(out.length).toBeLessThanOrEqual(MAX_DERIVED_NAME);
    expect(s.startsWith(out)).toBe(true);
    expect(out.endsWith(" ")).toBe(false);
    // The cut landed between words, so the tail is a whole word.
    expect(s[out.length]).toBe(" ");
  });

  it("hard-cuts a single very long token instead of returning almost nothing", () => {
    const out = tidyName("A" + "b".repeat(200));
    expect(out.length).toBe(MAX_DERIVED_NAME);
  });

  it("derived names respect the cap", () => {
    const c = campaign({ sections: [{ id: "s", type: "header", elements: { Headline: "x".repeat(200) } }] });
    expect(deriveCampaignName(c, TODAY).length).toBeLessThanOrEqual(MAX_DERIVED_NAME);
  });
});

describe("resolveCampaignName", () => {
  const c = campaign({ sections: [section({ elements: { Headline: "Derived headline" } })] });

  it("keeps the writer's own name untouched", () => {
    expect(resolveCampaignName("August Flash Sale", c, TODAY)).toBe("August Flash Sale");
  });

  it("derives only when the name is empty or whitespace", () => {
    expect(resolveCampaignName("", c, TODAY)).toBe("Derived headline");
    expect(resolveCampaignName("   ", c, TODAY)).toBe("Derived headline");
    expect(resolveCampaignName(null, c, TODAY)).toBe("Derived headline");
    expect(resolveCampaignName(undefined, c, TODAY)).toBe("Derived headline");
  });

  it("does NOT trim or reformat a name the writer typed", () => {
    // Only leading/trailing space is ignored for the emptiness test; a real name
    // with internal spacing is theirs, not ours to tidy.
    expect(resolveCampaignName("  Keep   This  ", c, TODAY)).toBe("Keep   This");
  });
});

describe("displayTitle", () => {
  it("marks an empty title as a fallback so the UI can style it differently", () => {
    expect(displayTitle("")).toEqual({ text: UNTITLED_LABEL, isFallback: true });
    expect(displayTitle("   ")).toEqual({ text: UNTITLED_LABEL, isFallback: true });
    expect(displayTitle(null)).toEqual({ text: UNTITLED_LABEL, isFallback: true });
    expect(displayTitle(undefined)).toEqual({ text: UNTITLED_LABEL, isFallback: true });
  });

  it("passes a real title through as not-a-fallback", () => {
    expect(displayTitle("August Flash Sale")).toEqual({ text: "August Flash Sale", isFallback: false });
  });
});
