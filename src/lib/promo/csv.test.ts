import { describe, it, expect } from "vitest";
import { parseCsvGrid } from "./csv";

describe("parseCsvGrid", () => {
  it("parses simple rows", () => {
    expect(parseCsvGrid("a,b,c\n1,2,3")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("keeps commas and newlines inside quoted fields as one cell", () => {
    const grid = parseCsvGrid(`name,note\n"E95","line one\nline two, still one"`);
    expect(grid).toEqual([["name", "note"], ["E95", "line one\nline two, still one"]]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsvGrid(`say,"she said ""hi"""`)).toEqual([["say", 'she said "hi"']]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsvGrid("a,b\r\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("flushes a trailing row with no final newline", () => {
    expect(parseCsvGrid("a,b")).toEqual([["a", "b"]]);
  });

  it("never throws on empty input", () => {
    expect(parseCsvGrid("")).toEqual([]);
  });
});
