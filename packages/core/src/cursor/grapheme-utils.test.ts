import { describe, it, expect } from "vitest";
import {
  nextGraphemeBoundary,
  prevGraphemeBoundary,
  nextWordBoundary,
  prevWordBoundary,
  iterateWordSegments,
} from "./grapheme-utils";

describe("nextGraphemeBoundary", () => {
  it("advances by one code unit in ASCII text", () => {
    expect(nextGraphemeBoundary("hello", 0)).toBe(1);
    expect(nextGraphemeBoundary("hello", 4)).toBe(5);
  });

  it("returns text.length at end", () => {
    expect(nextGraphemeBoundary("hello", 5)).toBe(5);
    expect(nextGraphemeBoundary("hello", 99)).toBe(5);
  });

  it("treats a flag emoji (2 code points = 1 grapheme) as one step", () => {
    // 🇺🇸 = U+1F1FA U+1F1F8, each surrogate-paired → 4 UTF-16 code units
    const flag = "🇺🇸";
    expect(flag.length).toBe(4);
    expect(nextGraphemeBoundary(flag, 0)).toBe(4);
  });

  it("returns text.length on empty string", () => {
    expect(nextGraphemeBoundary("", 0)).toBe(0);
  });
});

describe("prevGraphemeBoundary", () => {
  it("retreats by one code unit in ASCII text", () => {
    expect(prevGraphemeBoundary("hello", 5)).toBe(4);
    expect(prevGraphemeBoundary("hello", 1)).toBe(0);
  });

  it("returns 0 at start", () => {
    expect(prevGraphemeBoundary("hello", 0)).toBe(0);
  });

  it("retreats across a multi-code-unit grapheme as one step", () => {
    const flag = "🇺🇸"; // 4 UTF-16 code units
    expect(prevGraphemeBoundary(flag, 4)).toBe(0);
  });
});

describe("nextWordBoundary", () => {
  it("lands at the end of a word", () => {
    // "hello world" — from offset 0, next word ends at 5.
    expect(nextWordBoundary("hello world", 0)).toBe(5);
  });

  it("skips whitespace to the next word's end", () => {
    // From offset 5 (the space), next word "world" ends at 11.
    expect(nextWordBoundary("hello world", 5)).toBe(11);
  });

  it("returns text.length at end-of-text", () => {
    expect(nextWordBoundary("hello", 5)).toBe(5);
  });
});

describe("prevWordBoundary", () => {
  it("lands at the start of the current word when inside it", () => {
    // "hello world", from offset 8 (inside "world"), prev = 6 (word start).
    expect(prevWordBoundary("hello world", 8)).toBe(6);
  });

  it("retreats to the previous word's start when at a word boundary", () => {
    // From offset 11 (end of "world"), prev = 6.
    expect(prevWordBoundary("hello world", 11)).toBe(6);
  });

  it("returns 0 when inside a word starting at index 0", () => {
    // "hello", from offset 3 (inside "hello"), prev = 0 (word start).
    // Exercises the path where the word starts at index 0 — the
    // `seg.index > 0` guard inside prevWordBoundary skips the "inside this word"
    // return, and the function falls through to return lastWordStart = 0.
    expect(prevWordBoundary("hello", 3)).toBe(0);
  });

  it("returns 0 at start", () => {
    expect(prevWordBoundary("hello", 0)).toBe(0);
  });
});

describe("iterateWordSegments", () => {
  it("yields contiguous { start, end, isWordLike } triples covering the input", () => {
    const segs = [...iterateWordSegments("hello world")];
    // Reconstruct the text from the segments to confirm boundary accounting.
    const reconstructed = segs.map((s) => "hello world".slice(s.start, s.end)).join("");
    expect(reconstructed).toBe("hello world");
    // At least one segment is wordLike, at least one is not (the space).
    expect(segs.some((s) => s.isWordLike)).toBe(true);
    expect(segs.some((s) => !s.isWordLike)).toBe(true);
  });

  it("flags both word and non-word segments correctly", () => {
    const segs = [...iterateWordSegments("a b")];
    // "a" wordLike, " " not, "b" wordLike — order checked.
    expect(segs.filter((s) => s.isWordLike).map((s) => s.start)).toEqual([0, 2]);
  });

  it("returns an empty iterator on empty input", () => {
    expect([...iterateWordSegments("")]).toEqual([]);
  });
});
