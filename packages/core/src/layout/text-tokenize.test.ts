import { describe, it, expect } from "vitest";
import { tokenize, LINE_BREAK } from "./text-tokenize";

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

  it("strips leading whitespace but preserves one trailing-whitespace token per char", () => {
    // The trailing tokens are needed so the IFC's per-line offset cursor
    // covers the user-typed trailing spaces — cursors positioned past
    // them (the common "type a space and the cursor should advance"
    // case) need a non-collapsed offset to anchor on.
    expect(tokenize("  hi  ", "normal")).toEqual(["hi", " ", " "]);
  });

  it("preserves trailing-whitespace token even when there's no inter-word space", () => {
    expect(tokenize("abc ", "normal")).toEqual(["abc", " "]);
  });

  it("preserves ONE trailing-whitespace token per trailing-space character", () => {
    // Multi-trailing-space regression: typing space twice must advance
    // the offset cursor by 2 (not stop at 1). Same fix as the single
    // trailing-space case — the cursor at offset 5 of "abc  " must
    // map to x=40, not get clamped to x=32 by line.inlineOffsetEnd=4.
    expect(tokenize("abc  ", "normal")).toEqual(["abc", " ", " "]);
    expect(tokenize("abc   ", "normal")).toEqual(["abc", " ", " ", " "]);
  });

  it("preserves a trailing-whitespace token under nowrap (same branch as normal)", () => {
    // Guards against future branch divergence between "normal" and
    // "nowrap" — both share the same trailing-space preservation.
    expect(tokenize("abc ", "nowrap")).toEqual(["abc", " "]);
  });

  it("emits one space token per char for all-whitespace input (preserves offset)", () => {
    // Defensive: all-whitespace state isn't normally produced by the
    // editor, but the tokenizer must still advance the offset cursor
    // over those characters or downstream consumers see a mismatch.
    expect(tokenize("   ", "normal")).toEqual([" ", " ", " "]);
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

describe("tokenize (whiteSpace: pre)", () => {
  it("preserves leading and trailing whitespace", () => {
    expect(tokenize("  hi  ", "pre")).toEqual(["  hi  "]);
  });
  it("preserves internal whitespace runs", () => {
    expect(tokenize("a   b", "pre")).toEqual(["a   b"]);
  });
  it("emits LINE_BREAK at newline boundaries", () => {
    expect(tokenize("a\nb", "pre")).toEqual(["a", LINE_BREAK, "b"]);
  });
  it("multiple newlines produce multiple LINE_BREAKs", () => {
    expect(tokenize("a\n\nb", "pre")).toEqual(["a", LINE_BREAK, "", LINE_BREAK, "b"]);
  });
  it("empty string returns empty array", () => {
    expect(tokenize("", "pre")).toEqual([]);
  });
});

describe("tokenize (whiteSpace: pre-wrap)", () => {
  it("preserves interior whitespace as one space token per char (wrappable)", () => {
    expect(tokenize("a  b", "pre-wrap")).toEqual(["a", " ", " ", "b"]);
  });
  it("preserves leading whitespace", () => {
    expect(tokenize("  a", "pre-wrap")).toEqual([" ", " ", "a"]);
  });
  it("preserves trailing whitespace", () => {
    expect(tokenize("a  ", "pre-wrap")).toEqual(["a", " ", " "]);
  });
  it("emits LINE_BREAK at newlines", () => {
    expect(tokenize("a\nb", "pre-wrap")).toEqual(["a", LINE_BREAK, "b"]);
  });
  it("interior single space (no leading/trailing) is byte-identical to normal", () => {
    // Scoped parity: matches `normal` ONLY for interior single spaces with no
    // leading/trailing whitespace. Leading/trailing whitespace cases above
    // (e.g. "  a", "a  ") intentionally DIFFER from normal.
    expect(tokenize("a b", "pre-wrap")).toEqual(["a", " ", "b"]);
    expect(tokenize("a b", "normal")).toEqual(["a", " ", "b"]);
  });
  it("preserves leading spaces in a later segment", () => {
    expect(tokenize("x\n  y", "pre-wrap")).toEqual(["x", LINE_BREAK, " ", " ", "y"]);
  });
  it("all-spaces input emits one space token per char", () => {
    expect(tokenize("   ", "pre-wrap")).toEqual([" ", " ", " "]);
  });
  it("empty string returns empty array", () => {
    expect(tokenize("", "pre-wrap")).toEqual([]);
  });
  it("a lone newline emits a single LINE_BREAK (two empty segments)", () => {
    // "\n".split("\n") === ["", ""]: two empty segments produce no word/space
    // tokens, and one LINE_BREAK separates them.
    expect(tokenize("\n", "pre-wrap")).toEqual([LINE_BREAK]);
  });
  it("consecutive newlines produce consecutive LINE_BREAKs (no empty-segment token)", () => {
    // pre-wrap emits NO token for an empty middle segment, so "a\n\nb" yields
    // back-to-back LINE_BREAKs. This DIFFERS from the `pre` branch (which
    // pushes a "" token for the blank middle line) but renders an identical
    // blank line — see the layout-parity test below: the second consecutive
    // LINE_BREAK triggers an empty-units flushLine, so the blank line is
    // present in both modes. (Bug #168: blank lines must render visibly.)
    expect(tokenize("a\n\nb", "pre-wrap")).toEqual(["a", LINE_BREAK, LINE_BREAK, "b"]);
  });
});

describe("tokenize (whiteSpace: break-spaces)", () => {
  // `break-spaces` reuses the `pre-wrap` tokenization verbatim (the modes
  // differ only in the IFC wrap-unit grouper). These cases lock in the
  // fall-through so the union member never silently hits the `default:` throw.
  it("preserves interior spaces (same as pre-wrap)", () => {
    expect(tokenize("a  b", "break-spaces")).toEqual(["a", " ", " ", "b"]);
  });
  it("preserves leading spaces", () => {
    expect(tokenize("  a", "break-spaces")).toEqual([" ", " ", "a"]);
  });
  it("preserves trailing spaces (one token per char)", () => {
    expect(tokenize("a  ", "break-spaces")).toEqual(["a", " ", " "]);
  });
  it("emits LINE_BREAK at newlines", () => {
    expect(tokenize("x\n  y", "break-spaces")).toEqual(["x", LINE_BREAK, " ", " ", "y"]);
  });
  it("matches pre-wrap output exactly for a mixed string", () => {
    const mixed = "  ab cd   \nef ";
    expect(tokenize(mixed, "break-spaces")).toEqual(tokenize(mixed, "pre-wrap"));
  });
});

describe("tokenize (whiteSpace: pre-line)", () => {
  it("collapses whitespace runs to single space", () => {
    expect(tokenize("a   b", "pre-line")).toEqual(["a", " ", "b"]);
  });
  it("emits LINE_BREAK at newlines", () => {
    expect(tokenize("a\nb", "pre-line")).toEqual(["a", LINE_BREAK, "b"]);
  });
  it("collapses whitespace within a line but breaks at newlines", () => {
    expect(tokenize("a   b\nc   d", "pre-line")).toEqual(["a", " ", "b", LINE_BREAK, "c", " ", "d"]);
  });
});
