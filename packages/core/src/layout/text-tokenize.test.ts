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

  it("preserves one whitespace token per LEADING and TRAILING char (#308 + existing trailing)", () => {
    // Both ends are mirrored: N leading whitespace chars → N " " tokens, the
    // word, then M trailing whitespace chars → M " " tokens. The IFC's
    // per-line offset cursor must cover EVERY user-typed source char (leading
    // and trailing) — cursors positioned past either side need a non-collapsed
    // offset to anchor on. Without the leading emit, caret at offsets 0..1 of
    // "  hi  " falls past the line and clamps to x=0 (#308).
    expect(tokenize("  hi  ", "normal")).toEqual([" ", " ", "hi", " ", " "]);
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

  it("emits one space token PER LEADING whitespace char before the first word (#308)", () => {
    // Symmetric with the trailing-space handling above. Without this, source
    // offsets in [0, matchStart-of-first-word) are owned by no token and the
    // IFC's cursorOffset accumulator drops them — caret at offsets 0..2 of
    // "   hello" falls past the line and clamps. Each leading whitespace char
    // becomes its own " " token; the second-pass `sourceLength` lookahead in
    // the IFC then attributes one source char per token.
    expect(tokenize("   hello", "normal")).toEqual([" ", " ", " ", "hello"]);
  });

  it("emits leading + trailing space tokens together (#308 + existing trailing)", () => {
    // "  hi  " → 2 leading + "hi" + inter? (no inter — already split by
    // trimmed words) + 2 trailing = [" "," ","hi"," "," "]. Both ends covered.
    expect(tokenize("  hi  ", "normal")).toEqual([" ", " ", "hi", " ", " "]);
  });

  it("emits leading spaces under nowrap (same branch as normal) (#308)", () => {
    expect(tokenize("  hi", "nowrap")).toEqual([" ", " ", "hi"]);
  });

  it("single leading space + word + trailing spaces all emit (#308 boundary case)", () => {
    expect(tokenize(" hi  ", "normal")).toEqual([" ", "hi", " ", " "]);
  });

  it("keeps a leading TAB in the offset accounting (#365)", () => {
    // A leading TAB is whitespace under `normal` (collapsed visually) but its
    // SOURCE offset must still be owned by a token so the IFC's per-line offset
    // cursor advances over it. "\t word" has 2 leading whitespace chars (TAB +
    // space) → 2 orphan " " tokens covering offsets 0 and 1, then "word"
    // covering offsets 2..5. Without the leading-emit, the TAB's offset 0 is
    // unowned and the caret cannot land on/after it (#365). UAX #14 classifies
    // TAB as BA (break-after-allowed); the mandatory-set extension here must
    // not strand its source offset.
    expect(tokenize("\t word", "normal")).toEqual([" ", " ", "word"]);
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
  it("LINE SEPARATOR (U+2028) / PARAGRAPH SEPARATOR (U+2029) are mandatory breaks (UAX #14 LB4)", () => {
    // The mandatory-break set is a superset of `\n`: LS/PS/FF/VT/NEL also force
    // a line break per UAX #14 LB4 (FF/LS/PS hard) and LB5 (CR/LF/NEL hard).
    expect(tokenize("a\u2028b", "pre")).toEqual(["a", LINE_BREAK, "b"]);
    expect(tokenize("a\u2029b", "pre")).toEqual(["a", LINE_BREAK, "b"]);
  });
  it("FF (U+000C) / VT (U+000B) / NEL (U+0085) are mandatory breaks (UAX #14 LB4/LB5)", () => {
    expect(tokenize("a\u000Cb", "pre")).toEqual(["a", LINE_BREAK, "b"]);
    expect(tokenize("a\u000Bb", "pre")).toEqual(["a", LINE_BREAK, "b"]);
    expect(tokenize("a\u0085b", "pre")).toEqual(["a", LINE_BREAK, "b"]);
  });
  it("CRLF (U+000D U+000A) is a SINGLE mandatory break, not two (UAX #14 LB5)", () => {
    // The `\r\n` alternant must lead MANDATORY_BREAK_RE so a CRLF pair yields ONE
    // LINE_BREAK (not CR-break + empty-segment + LF-break). This is the
    // load-bearing reason for the alternation order.
    expect(tokenize("a\r\nb", "pre")).toEqual(["a", LINE_BREAK, "b"]);
    expect(tokenize("a\r\nb", "pre-wrap")).toEqual(["a", LINE_BREAK, "b"]);
    expect(tokenize("a\r\nb", "pre-line")).toEqual(["a", LINE_BREAK, "b"]);
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
  it("LS (U+2028) / PS (U+2029) force a LINE_BREAK under pre-wrap (UAX #14 LB4)", () => {
    // Mandatory-break superset applies to pre-wrap too: LS/PS split segments
    // exactly like `\n`, so they become a LINE_BREAK rather than a wrappable
    // " " space token.
    expect(tokenize("a\u2028b", "pre-wrap")).toEqual(["a", LINE_BREAK, "b"]);
    expect(tokenize("a\u2029b", "pre-wrap")).toEqual(["a", LINE_BREAK, "b"]);
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
  // #366 / #308-part-2: leading whitespace on the FIRST line emits orphan
  // " " tokens (one per ws char) so source offsets in [0, matchStart-of-first-word)
  // are owned. Non-first lines don't need a leading emit — their leading
  // whitespace gets absorbed into the preceding LINE_BREAK's `sourceLength`
  // via the IFC's second-pass lookahead.
  it("first-line leading whitespace emits one orphan-space token per char (#366)", () => {
    expect(tokenize("  a\nb", "pre-line")).toEqual([" ", " ", "a", LINE_BREAK, "b"]);
  });
  it("non-first-line leading whitespace is NOT emitted (absorbed by preceding LINE_BREAK)", () => {
    expect(tokenize("a\n  b", "pre-line")).toEqual(["a", LINE_BREAK, "b"]);
  });
  it("first-line leading + non-first-line leading: only first-line gets orphan tokens (#366)", () => {
    expect(tokenize("  a\n  b", "pre-line")).toEqual([" ", " ", "a", LINE_BREAK, "b"]);
  });
  it("all-whitespace first line emits orphan-space tokens then LINE_BREAK (#366)", () => {
    expect(tokenize("   \nfoo", "pre-line")).toEqual([" ", " ", " ", LINE_BREAK, "foo"]);
  });
  it("single-line all-whitespace under pre-line emits orphan-space tokens", () => {
    // No LINE_BREAK (only one line); the leading-emit fires for the first
    // (and only) line, then `trimmed === ""` skips the parts loop.
    expect(tokenize("   ", "pre-line")).toEqual([" ", " ", " "]);
  });
});
