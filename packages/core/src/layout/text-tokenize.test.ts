import { describe, it, expect } from "vitest";
import { tokenize } from "./text-tokenize";

describe("tokenize (whiteSpace: normal)", () => {
  it("splits text into words and collapses whitespace", () => {
    expect(tokenize("hello world", "normal")).toEqual(["hello", " ", "world"]);
  });

  it("collapses multiple spaces", () => {
    expect(tokenize("a    b", "normal")).toEqual(["a", " ", "b"]);
  });

  it("treats newlines as whitespace", () => {
    expect(tokenize("a\nb", "normal")).toEqual(["a", " ", "b"]);
  });

  it("handles empty input", () => {
    expect(tokenize("", "normal")).toEqual([]);
  });

  it("strips leading/trailing whitespace", () => {
    expect(tokenize("  hi  ", "normal")).toEqual(["hi"]);
  });
});

describe("tokenize (whiteSpace: nowrap)", () => {
  it("collapses whitespace like normal", () => {
    expect(tokenize("hello   world", "nowrap")).toEqual(["hello", " ", "world"]);
  });
  it("treats newlines as whitespace", () => {
    expect(tokenize("a\nb", "nowrap")).toEqual(["a", " ", "b"]);
  });
  it("handles empty input", () => {
    expect(tokenize("", "nowrap")).toEqual([]);
  });
});
