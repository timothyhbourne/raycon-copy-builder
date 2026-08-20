import { describe, it, expect } from "vitest";
import {
  formSignature, formSimilarity, signatureSimilarity, describeSignature,
  FORM_SIMILARITY_THRESHOLD,
} from "./signature";

// The 11 shipped reference headlines (data/copy-system.md) are the calibration
// set: the signature checker has to see them as ELEVEN constructions, not one.
const SHIPPED = [
  "Summer Just Got Louder",
  "Sound Worth Celebrating",
  "Best Part of Working Out",
  "Ready for the Road",
  "Tonight's Your Night",
  "Sound as good as it looks",
  "Great Moms Deserve Great Sound",
  "Motion Never Stops",
  "Open All Summer",
  "Fit That Won't Quit",
];

describe("formSignature", () => {
  it("reads the shape of a negated product-truth declaration", () => {
    const sig = formSignature("Motion Never Stops");
    expect(sig.template).toBe("NOUN + NEG + VERB");
    expect(sig.word_count).toBe(3);
    expect(sig.head_noun).toBe("motion");
    expect(sig.verb_lemma).toBe("stop");
    expect(sig.devices).toContain("negation");
    expect(sig.devices).toContain("declarative");
    expect(sig.opening_pos).toBe("NOUN");
    expect(sig.pattern).toBe("product_truth");
  });

  it("does not mistake a noun+relative-clause opener for an imperative", () => {
    // "Fit" is noun-and-verb; only a negation/auxiliary in front forces the verb
    // reading. Without that rule this parses as "Fit! (imperative)".
    const sig = formSignature("Fit That Won't Quit");
    expect(sig.opening_pos).toBe("NOUN");
    expect(sig.devices).not.toContain("imperative");
    expect(sig.devices).toContain("rhyme");
    expect(sig.pattern).toBe("rhyme");
  });

  it("hears the echo in a parallel construction", () => {
    const sig = formSignature("Great Moms Deserve Great Sound");
    expect(sig.devices).toContain("repetition");
    expect(sig.pattern).toBe("rhyme"); // the "rhyme / parallel" pattern
  });

  it("spots the borrowed-idiom marker", () => {
    expect(formSignature("Summer Just Got Louder").pattern).toBe("idiom_remix");
    expect(formSignature("Open All Summer").pattern).toBe("idiom_remix");
  });

  it("spots a confident superlative", () => {
    expect(formSignature("Best Part of Working Out").pattern).toBe("bold_claim");
    expect(formSignature("Best Part of Working Out").devices).toContain("superlative");
  });

  it("lets the writer's declared pattern win over the classifier", () => {
    expect(formSignature("Tonight's Your Night", "product_truth").pattern).toBe("product_truth");
    expect(formSignature("Tonight's Your Night", "nonsense").pattern).toBe("rhyme");
  });

  it("survives empty and punctuation-only input", () => {
    const sig = formSignature("   ");
    expect(sig.template).toBe("");
    expect(sig.pattern).toBe("unclassified");
    expect(signatureSimilarity(sig, formSignature("Motion Never Stops"))).toBe(0);
  });
});

describe("form similarity", () => {
  // The acceptance criterion from the spec (§4).
  it("flags two headlines with the same construction and no shared words", () => {
    const score = formSimilarity("Motion Never Stops", "Sound Never Quits");
    expect(score).toBeGreaterThanOrEqual(FORM_SIMILARITY_THRESHOLD);
  });

  it("flags a third instance of the same construction", () => {
    expect(formSimilarity("Motion Never Stops", "Comfort Never Fades")).toBeGreaterThanOrEqual(FORM_SIMILARITY_THRESHOLD);
  });

  it("does not flag two different constructions that merely share a device", () => {
    // Both negate. Different pattern, different shape, different length.
    expect(formSimilarity("Fit That Won't Quit", "Motion Never Stops")).toBeLessThan(FORM_SIMILARITY_THRESHOLD);
  });

  it("treats the 11 shipped headlines as distinct constructions", () => {
    const collisions: string[] = [];
    for (let i = 0; i < SHIPPED.length; i++) {
      for (let j = i + 1; j < SHIPPED.length; j++) {
        if (formSimilarity(SHIPPED[i], SHIPPED[j]) >= FORM_SIMILARITY_THRESHOLD) {
          collisions.push(`${SHIPPED[i]} ~ ${SHIPPED[j]}`);
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  it("is symmetric and self-identical", () => {
    const a = "Fit That Won't Quit";
    const b = "Sound Never Quits";
    expect(formSimilarity(a, b)).toBeCloseTo(formSimilarity(b, a));
    expect(formSimilarity(a, a)).toBeCloseTo(1);
  });
});

describe("describeSignature", () => {
  it("describes the shape without quoting the line", () => {
    const text = "Motion Never Stops";
    const desc = describeSignature(formSignature(text));
    expect(desc).toContain("product_truth");
    expect(desc).toContain("3 words");
    expect(desc.toLowerCase()).not.toContain("motion");
  });
});
