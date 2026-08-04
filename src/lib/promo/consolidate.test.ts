import { describe, it, expect } from "vitest";
import { parseMoney, parsePercent, parseDate } from "./consolidate";

describe("parseMoney", () => {
  it("strips $ , and whitespace", () => {
    expect(parseMoney("$1,299.00")).toBe(1299);
    expect(parseMoney(" 49 ")).toBe(49);
  });
  it("blank / non-numeric → undefined", () => {
    expect(parseMoney("")).toBeUndefined();
    expect(parseMoney(undefined)).toBeUndefined();
    expect(parseMoney("n/a")).toBeUndefined();
  });
});

describe("parsePercent", () => {
  it("returns the positive magnitude, dropping % and sign", () => {
    expect(parsePercent("20%")).toBe(20);
    expect(parsePercent("-20%")).toBe(20);
  });
  it("blank → undefined", () => {
    expect(parsePercent("")).toBeUndefined();
    expect(parsePercent(undefined)).toBeUndefined();
  });
});

describe("parseDate", () => {
  it("parses m/d/yy, expanding the 2-digit year", () => {
    expect(parseDate("1/3/21")).toBe("2021-01-03");
  });
  it("parses m/d/yyyy and strips a leading weekday word", () => {
    expect(parseDate("12/27/2022")).toBe("2022-12-27");
    expect(parseDate("Tue 12/27/22")).toBe("2022-12-27");
  });
  it("rejects impossible calendar dates", () => {
    expect(parseDate("2/30/22")).toBeNull();
    expect(parseDate("13/1/22")).toBeNull();
  });
  it("blank / unparseable → null", () => {
    expect(parseDate("")).toBeNull();
    expect(parseDate("someday")).toBeNull();
  });
});
