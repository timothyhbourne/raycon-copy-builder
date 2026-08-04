import { describe, it, expect } from "vitest";
import { deriveSendStage, deadlineLanguage, cleanCampaignName } from "./compile";
import type { Promotion } from "../promo/consolidate";

// Minimal Promotion for the date-driven logic under test.
const promo = (startDate?: string, endDate?: string): Promotion => ({
  id: "p", year: 2026, month: "July", sale: "s", promotion: "p",
  startDate, endDate, products: [],
});
const at = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

describe("deriveSendStage", () => {
  it("no promotion / no dates → launch", () => {
    expect(deriveSendStage(undefined, at("2026-07-10"))).toBe("launch");
    expect(deriveSendStage(promo(), at("2026-07-10"))).toBe("launch");
  });

  it("within ~1 day of start → launch", () => {
    expect(deriveSendStage(promo("2026-07-10", "2026-07-20"), at("2026-07-10"))).toBe("launch");
  });

  it("a one-day flash sale on its only day is last_call, never launch", () => {
    expect(deriveSendStage(promo("2026-07-10", "2026-07-10"), at("2026-07-10"))).toBe("last_call");
  });

  it("mid-window (before 70% elapsed) → reminder", () => {
    // 10-day window, day 3 (~22% elapsed).
    expect(deriveSendStage(promo("2026-07-10", "2026-07-20"), at("2026-07-13"))).toBe("reminder");
  });

  it("final day / ≥70% elapsed → last_call", () => {
    expect(deriveSendStage(promo("2026-07-10", "2026-07-20"), at("2026-07-20"))).toBe("last_call");
    expect(deriveSendStage(promo("2026-07-10", "2026-07-20"), at("2026-07-18"))).toBe("last_call");
  });

  it("started, past launch, no end date → reminder", () => {
    expect(deriveSendStage(promo("2026-07-01"), at("2026-07-10"))).toBe("reminder");
  });
});

describe("deadlineLanguage", () => {
  it("send day IS the last day → tonight, urgency 3", () => {
    expect(deadlineLanguage("2026-07-10", "2026-07-10")).toEqual({ phrase: "tonight", urgency: 3 });
  });
  it("one day out → tomorrow night, urgency 3", () => {
    expect(deadlineLanguage("2026-07-10", "2026-07-11")).toEqual({ phrase: "tomorrow night", urgency: 3 });
  });
  it("two days out → in 48 hours, urgency 2", () => {
    expect(deadlineLanguage("2026-07-10", "2026-07-12")).toEqual({ phrase: "in 48 hours", urgency: 2 });
  });
  it("3+ days out → names the real weekday, urgency 2", () => {
    const r = deadlineLanguage("2026-07-10", "2026-07-17");
    expect(r.urgency).toBe(2);
    expect(r.phrase).toMatch(/Friday, Jul 17/);
  });
});

describe("cleanCampaignName", () => {
  it("strips SKUs, percentages, ops prefixes, and urgency tags", () => {
    expect(cleanCampaignName("FS - 30% OFF E95 + H20 + H10 - LAST CALL")).toBe("");
  });
  it("keeps a genuine two-word idea", () => {
    expect(cleanCampaignName("Summer Roadtrip Sale")).toMatch(/Summer Roadtrip/);
  });
  it("empty / undefined → empty string", () => {
    expect(cleanCampaignName(undefined)).toBe("");
    expect(cleanCampaignName("")).toBe("");
  });
});
