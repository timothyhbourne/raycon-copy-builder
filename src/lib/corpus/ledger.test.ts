import { describe, it, expect } from "vitest";
import { evaluateLedger, claimId, suppressedClaimKeys, claimSentence } from "./ledger";
import type { GuidanceLedger } from "./ledger-types";
import { aggregate, type PerformanceRecord } from "../copy-performance";

// A measured send with one angle and one architecture.
function rec(angle: string, rpr: number, recipients = 10_000): PerformanceRecord {
  return {
    row_id: `${angle}-${rpr}-${recipients}`, name: `Send ${angle}`, channel: "email",
    send_date: "2026-08-01", recipients, rpr, revenue: rpr * recipients,
    northbeam_revenue: null, northbeam_rpr: null, open_rate: null, click_rate: null,
    metrics_synced_at: "2026-08-02T00:00:00.000Z", metrics_source: null,
    attributes: { angle, campaign_type: "promo" }, attribution_source: "saved",
  };
}

const OPTS = {
  now: "2026-08-19T00:00:00.000Z",
  range: { start: "2026-02-20", end: "2026-08-19" },
  basis: "platform" as const,
};

// Two tight, well-separated buckets: offer_led clearly ahead of story_led.
const STRONG_OFFER = [
  rec("offer_led", 4.0), rec("offer_led", 4.1), rec("offer_led", 3.9),
  rec("story_led", 1.0), rec("story_led", 1.1), rec("story_led", 0.9),
];
// The same dimension with the order reversed.
const STRONG_STORY = [
  rec("offer_led", 1.0), rec("offer_led", 1.1), rec("offer_led", 0.9),
  rec("story_led", 4.0), rec("story_led", 4.1), rec("story_led", 3.9),
];
// Overlapping buckets: no ranking worth asserting.
const NOISE = [
  rec("offer_led", 0.5), rec("offer_led", 3.5), rec("offer_led", 2.0),
  rec("story_led", 0.4), rec("story_led", 3.6), rec("story_led", 2.0),
];

const EMPTY: GuidanceLedger = { claims: [], evaluated_at: null };
const aggs = (records: PerformanceRecord[]) => aggregate(records, "platform").aggregates;

describe("evaluateLedger — asserting", () => {
  it("asserts a well-evidenced association with its n and date range", () => {
    const ledger = evaluateLedger(EMPTY, aggs(STRONG_OFFER), OPTS);
    const claim = ledger.claims.find((c) => c.id === claimId("angle", "offer_led"));
    expect(claim).toBeDefined();
    expect(claim!.status).toBe("active");
    expect(claim!.n).toBe(3);
    expect(claim!.range).toEqual(OPTS.range);
    expect(claim!.first_asserted).toBe(OPTS.now);
    expect(claim!.history).toHaveLength(1);
    expect(ledger.evaluated_at).toBe(OPTS.now);
  });

  it("asserts nothing when the buckets overlap more than they differ", () => {
    expect(evaluateLedger(EMPTY, aggs(NOISE), OPTS).claims).toEqual([]);
  });

  it("never names a line of copy", () => {
    const sentence = claimSentence("Angle", "offer_led");
    expect(sentence).toContain("offer led");
    expect(sentence).toContain("revenue-per-recipient");
    expect(sentence).not.toMatch(/["“]/);
  });
});

describe("evaluateLedger — re-checking", () => {
  const asserted = evaluateLedger(EMPTY, aggs(STRONG_OFFER), OPTS);
  const later = { ...OPTS, now: "2026-08-26T00:00:00.000Z" };

  it("counts a still-strongest claim as a replication", () => {
    const next = evaluateLedger(asserted, aggs(STRONG_OFFER), later);
    const claim = next.claims.find((c) => c.id === claimId("angle", "offer_led"))!;
    expect(claim.status).toBe("active");
    expect(claim.replications).toBe(2);
    expect(claim.failures).toBe(0);
    expect(claim.history.at(-1)!.outcome).toBe("replicated");
  });

  it("weakens a claim on its first failure, and stops injecting it", () => {
    const next = evaluateLedger(asserted, aggs(STRONG_STORY), later);
    const claim = next.claims.find((c) => c.id === claimId("angle", "offer_led"))!;
    expect(claim.status).toBe("weakened");
    expect(claim.failures).toBe(1);
    expect(suppressedClaimKeys(next).has(claim.id)).toBe(true);
  });

  it("retires a claim on the second consecutive failure, with the date", () => {
    const once = evaluateLedger(asserted, aggs(STRONG_STORY), later);
    const twice = evaluateLedger(once, aggs(STRONG_STORY), { ...OPTS, now: "2026-09-02T00:00:00.000Z" });
    const claim = twice.claims.find((c) => c.id === claimId("angle", "offer_led"))!;
    expect(claim.status).toBe("retired");
    expect(claim.failures).toBe(2);
    expect(claim.last_checked).toBe("2026-09-02T00:00:00.000Z");
    expect(claim.history.filter((h) => h.outcome === "failed")).toHaveLength(2);
  });

  it("does NOT retire on absent evidence — that is not the same as being wrong", () => {
    const next = evaluateLedger(asserted, aggs([]), later);
    const claim = next.claims.find((c) => c.id === claimId("angle", "offer_led"))!;
    expect(claim.status).toBe("active");
    expect(claim.failures).toBe(0);
    expect(claim.history.at(-1)!.outcome).toBe("insufficient_data");
  });

  it("treats a lost spread as unjudgeable, not as a failure", () => {
    const next = evaluateLedger(asserted, aggs(NOISE), later);
    const claim = next.claims.find((c) => c.id === claimId("angle", "offer_led"))!;
    expect(claim.history.at(-1)!.outcome).toBe("insufficient_data");
    expect(claim.history.at(-1)!.note).toMatch(/scatter/);
    expect(claim.status).toBe("active");
  });

  it("revives a weakened claim that starts replicating again", () => {
    const weakened = evaluateLedger(asserted, aggs(STRONG_STORY), later);
    const revived = evaluateLedger(weakened, aggs(STRONG_OFFER), { ...OPTS, now: "2026-09-02T00:00:00.000Z" });
    const claim = revived.claims.find((c) => c.id === claimId("angle", "offer_led"))!;
    expect(claim.status).toBe("active");
    expect(claim.failures).toBe(0);
    expect(suppressedClaimKeys(revived).has(claim.id)).toBe(false);
  });

  it("asserts the new winner alongside the claim it displaced", () => {
    const next = evaluateLedger(asserted, aggs(STRONG_STORY), later);
    expect(next.claims.map((c) => c.id)).toContain(claimId("angle", "story_led"));
    expect(next.claims.find((c) => c.id === claimId("angle", "story_led"))!.status).toBe("active");
  });

  it("never mutates the ledger it was given", () => {
    const before = JSON.stringify(asserted);
    evaluateLedger(asserted, aggs(STRONG_STORY), later);
    expect(JSON.stringify(asserted)).toBe(before);
  });
});
