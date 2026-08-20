import { describe, it, expect } from "vitest";
import { verifyExtractedQuotes } from "./url";

// The verbatim check is what makes an LLM safe on the generic-URL path: the model
// LOCATES customer text, it never writes it, and anything it returns that isn't
// actually on the page is dropped. Spec §4.1, tier 3.
const PAGE = [
  "Raycon Everyday Earbuds review",
  "We tested these for a month. Here is what buyers say.",
  '"I wear these on every run and they have never once fallen out of my ears." — Dani',
  "“The battery genuinely lasts all week, which I did not expect at this price.”",
  "Published by Some Blog, 2026.",
].join("\n");

describe("verifyExtractedQuotes", () => {
  it("keeps a quote that appears verbatim on the page", () => {
    const out = verifyExtractedQuotes(
      [{ text: "I wear these on every run and they have never once fallen out of my ears.", author: "Dani" }],
      PAGE,
    );
    expect(out).toHaveLength(1);
    expect(out[0].author).toBe("Dani");
  });

  it("DROPS a fabricated quote outright", () => {
    const out = verifyExtractedQuotes(
      [{ text: "These are hands down the best earbuds I have ever owned in my entire life." }],
      PAGE,
    );
    expect(out).toEqual([]);
  });

  it("drops a real quote the model 'improved' — a tidied review is treated as invented", () => {
    // One word changed. Erring toward dropping is the correct side here.
    const out = verifyExtractedQuotes(
      [{ text: "I wear these on every run and they have never once slipped out of my ears." }],
      PAGE,
    );
    expect(out).toEqual([]);
  });

  it("tolerates curly quotes and dash style, which are not differences in what was said", () => {
    const out = verifyExtractedQuotes(
      [{ text: 'The battery genuinely lasts all week, which I did not expect at this price.' }],
      PAGE,
    );
    expect(out).toHaveLength(1);
  });

  it("tolerates whitespace and line-break differences", () => {
    const out = verifyExtractedQuotes(
      [{ text: "I wear these on every run   and they have never\n once fallen out of my ears." }],
      PAGE,
    );
    expect(out).toHaveLength(1);
  });

  it("rejects a too-short fragment that would match almost any page", () => {
    expect(verifyExtractedQuotes([{ text: "these" }], PAGE)).toEqual([]);
    expect(verifyExtractedQuotes([{ text: "the battery" }], PAGE)).toEqual([]);
  });

  it("keeps only the ratings the page actually stated, and sanitises the name", () => {
    const out = verifyExtractedQuotes(
      [{ text: "I wear these on every run and they have never once fallen out of my ears.", author: "Danielle Fitzgerald-Smythe", rating: 9 }],
      PAGE,
    );
    expect(out[0].rating).toBeUndefined();      // 9 is not a star rating
    expect(out[0].author).toBe("Danielle F.");  // surname stripped (PII)
  });

  it("returns nothing for an empty page or empty candidates", () => {
    expect(verifyExtractedQuotes([{ text: "anything at all goes here" }], "")).toEqual([]);
    expect(verifyExtractedQuotes([], PAGE)).toEqual([]);
  });

  it("ignores malformed candidates instead of throwing", () => {
    expect(verifyExtractedQuotes(
      [{ text: null }, { text: 42 }, {}, { text: "   " }] as never,
      PAGE,
    )).toEqual([]);
  });
});
