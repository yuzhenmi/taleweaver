import { describe, it, expect, vi } from "vitest";
import {
  rewrapIncremental,
  findChangePoint,
  findLineForToken,
  findLineByStartToken,
} from "./wrap-incremental";
import type { IFCState } from "./ifc-state";
import type { Token } from "./ifc";
import type { LineBox } from "./layout-box";

const emptyStyleArray: readonly any[] = [];
const defaultStyle = {} as any;

function makeToken(
  id: string,
  overrides?: Partial<Token>,
): Token {
  return {
    id,
    sourceKey: "src",
    text: id,
    sourceLength: id.length,
    absoluteSourceBase: 0,
    width: 10,
    style: defaultStyle,
    isSpace: false,
    isLineBreak: false,
    inlineAncestors: [],
    inlineAncestorStyles: emptyStyleArray,
    ...overrides,
  };
}

function makeLine(): LineBox {
  return {
    type: "line",
    key: "line",
    inlineOffset: 0,
    blockOffset: 0,
    inlineSize: 100,
    blockSize: 16,
    x: 0,
    y: 0,
    width: 100,
    height: 16,
    writingMode: "horizontal-tb",
    direction: "ltr",
    computedStyle: {} as LineBox["computedStyle"],
    usedStyle: {} as LineBox["usedStyle"],
    children: [],
    baseline: 16,
  } as unknown as LineBox;
}

describe("findChangePoint", () => {
  it("identical token lists → -1", () => {
    const a = [makeToken("a:0"), makeToken("a:1")];
    const b = [makeToken("a:0"), makeToken("a:1")];
    expect(findChangePoint(a, b)).toBe(-1);
  });

  it("differs at index 1", () => {
    const a = [makeToken("a:0"), makeToken("a:1")];
    const b = [makeToken("a:0"), makeToken("a:2")];
    expect(findChangePoint(a, b)).toBe(1);
  });

  it("appended at end", () => {
    const a = [makeToken("a:0")];
    const b = [makeToken("a:0"), makeToken("a:1")];
    expect(findChangePoint(a, b)).toBe(1);
  });

  it("removed from end", () => {
    const a = [makeToken("a:0"), makeToken("a:1")];
    const b = [makeToken("a:0")];
    expect(findChangePoint(a, b)).toBe(1);
  });

  it("empty lists → -1", () => {
    expect(findChangePoint([], [])).toBe(-1);
  });

  it("differs at index 0", () => {
    const a = [makeToken("a:0"), makeToken("a:1")];
    const b = [makeToken("b:0"), makeToken("a:1")];
    expect(findChangePoint(a, b)).toBe(0);
  });

  it("detects same-length text replacement (id same, text differs)", () => {
    // Same id, same width, but text changes — must detect as change.
    // This is the critical bug fix: ID alone is not sufficient.
    const a = makeToken("t:0"); // text is "t:0"
    const a2 = { ...a, text: "different" };
    expect(findChangePoint([a], [a2])).toBe(0);
  });

  it("ignores identical tokens (full reuse case)", () => {
    // Same instance — fast path.
    const a = makeToken("t:0");
    expect(findChangePoint([a], [a])).toBe(-1);
  });

  it("compares inlineAncestors", () => {
    const t1 = { ...makeToken("t:0"), inlineAncestors: ["a", "b"] };
    const t2 = { ...makeToken("t:0"), inlineAncestors: ["a", "c"] };
    expect(findChangePoint([t1], [t2])).toBe(0);
  });

  it("detects isSpace differences", () => {
    const a = { ...makeToken("t:0"), isSpace: false };
    const b = { ...makeToken("t:0"), isSpace: true };
    expect(findChangePoint([a], [b])).toBe(0);
  });

  it("detects width differences", () => {
    const a = { ...makeToken("t:0"), width: 10 };
    const b = { ...makeToken("t:0"), width: 20 };
    expect(findChangePoint([a], [b])).toBe(0);
  });

  it("detects style differences (reference equality)", () => {
    const style1 = {} as any;
    const style2 = {} as any;
    const a = { ...makeToken("t:0"), style: style1 };
    const b = { ...makeToken("t:0"), style: style2 };
    expect(findChangePoint([a], [b])).toBe(0);
  });

  it("tokens differing only in softBreaks are NOT equal (cache key includes derived breaks)", () => {
    const base = makeToken("k:0");
    const a = { ...base, softBreaks: [1] as readonly number[] };
    const b = { ...base, softBreaks: [2] as readonly number[] };
    expect(findChangePoint([a], [b])).toBe(0);
  });

  it("tokens differing only in breakableBefore are NOT equal", () => {
    const base = makeToken("k:0");
    expect(
      findChangePoint(
        [{ ...base, breakableBefore: true }],
        [{ ...base, breakableBefore: false }],
      ),
    ).toBe(0);
  });

  it("identical softBreaks/breakableBefore stay equal (reuse preserved)", () => {
    const t = makeToken("k:0", { softBreaks: [1], breakableBefore: false });
    expect(findChangePoint([t], [{ ...t }])).toBe(-1);
  });
});

describe("findLineForToken", () => {
  it("returns line index when token is within range", () => {
    const line0 = makeLine();
    const line1 = makeLine();
    const meta = new WeakMap<LineBox, { startTokenIdx: number; endTokenIdx: number }>();
    meta.set(line0, { startTokenIdx: 0, endTokenIdx: 1 });
    meta.set(line1, { startTokenIdx: 2, endTokenIdx: 3 });
    expect(findLineForToken([line0, line1], 0, meta)).toBe(0);
    expect(findLineForToken([line0, line1], 1, meta)).toBe(0);
    expect(findLineForToken([line0, line1], 2, meta)).toBe(1);
    expect(findLineForToken([line0, line1], 3, meta)).toBe(1);
  });

  it("returns lines.length when token is past the last line", () => {
    const line0 = makeLine();
    const meta = new WeakMap<LineBox, { startTokenIdx: number; endTokenIdx: number }>();
    meta.set(line0, { startTokenIdx: 0, endTokenIdx: 1 });
    expect(findLineForToken([line0], 5, meta)).toBe(1);
  });

  it("skips lines without metadata", () => {
    const line0 = makeLine();
    const line1 = makeLine();
    const meta = new WeakMap<LineBox, { startTokenIdx: number; endTokenIdx: number }>();
    // line0 has no metadata — skip it
    meta.set(line1, { startTokenIdx: 2, endTokenIdx: 3 });
    expect(findLineForToken([line0, line1], 2, meta)).toBe(1);
  });
});

describe("findLineByStartToken", () => {
  it("finds the line that starts at the given token index", () => {
    const line0 = makeLine();
    const line1 = makeLine();
    const meta = new WeakMap<LineBox, { startTokenIdx: number; endTokenIdx: number }>();
    meta.set(line0, { startTokenIdx: 0, endTokenIdx: 1 });
    meta.set(line1, { startTokenIdx: 2, endTokenIdx: 3 });
    expect(findLineByStartToken([line0, line1], 2, meta)).toBe(1);
  });

  it("returns -1 when no line starts at that token index", () => {
    const line0 = makeLine();
    const meta = new WeakMap<LineBox, { startTokenIdx: number; endTokenIdx: number }>();
    meta.set(line0, { startTokenIdx: 0, endTokenIdx: 1 });
    expect(findLineByStartToken([line0], 5, meta)).toBe(-1);
  });
});

describe("rewrapIncremental", () => {
  it("first-time wrap (no prev) calls wrapAll", () => {
    const tokens = [makeToken("a:0"), makeToken("a:1"), makeToken("a:2")];
    const wrapOneLine = vi.fn((toks: readonly Token[], start: number) => ({
      line: makeLine(),
      startTokenIdx: start,
      endTokenIdx: Math.min(start + 1, toks.length - 1),
      availableInlineSize: 100,
    }));
    const meta = new WeakMap<LineBox, { startTokenIdx: number; endTokenIdx: number }>();
    const lines = rewrapIncremental(null, tokens, 100, wrapOneLine, meta);
    expect(lines.length).toBeGreaterThan(0);
    expect(wrapOneLine).toHaveBeenCalled();
  });

  it("no prev — populates lineMeta for produced lines", () => {
    const tokens = [makeToken("a:0"), makeToken("a:1")];
    const mockLine = makeLine();
    const wrapOneLine = vi.fn(() => ({
      line: mockLine,
      startTokenIdx: 0,
      endTokenIdx: 1,
      availableInlineSize: 100,
    }));
    const meta = new WeakMap<LineBox, { startTokenIdx: number; endTokenIdx: number }>();
    rewrapIncremental(null, tokens, 100, wrapOneLine, meta);
    expect(meta.get(mockLine)).toEqual({ startTokenIdx: 0, endTokenIdx: 1 });
  });

  it("identical tokens + same width → full reuse, wrapOneLine not called", () => {
    const tokens = [makeToken("a:0"), makeToken("a:1")];
    const prevLine = makeLine();
    const meta = new WeakMap<LineBox, { startTokenIdx: number; endTokenIdx: number }>();
    meta.set(prevLine, { startTokenIdx: 0, endTokenIdx: 1 });
    const prev: IFCState = {
      tokens,
      textAlign: "start",
      direction: "ltr",
      lines: [prevLine],
      availableInlineSize: 100,
      textIndent: 0,
      tabStops: [],
      defaultTabStop: 48,
      hasTab: false,
    };
    const wrapOneLine = vi.fn();
    const lines = rewrapIncremental(prev, tokens, 100, wrapOneLine, meta);
    expect(lines).toBe(prev.lines); // exact same array reference
    expect(wrapOneLine).not.toHaveBeenCalled();
  });

  it("width changed → full re-wrap, returns new line", () => {
    const tokens = [makeToken("a:0")];
    const prevLine = makeLine();
    const meta = new WeakMap<LineBox, { startTokenIdx: number; endTokenIdx: number }>();
    meta.set(prevLine, { startTokenIdx: 0, endTokenIdx: 0 });
    const prev: IFCState = {
      tokens,
      textAlign: "start",
      direction: "ltr",
      lines: [prevLine],
      availableInlineSize: 100,
      textIndent: 0,
      tabStops: [],
      defaultTabStop: 48,
      hasTab: false,
    };
    const newLine = makeLine();
    const wrapOneLine = vi.fn(() => ({
      line: newLine,
      startTokenIdx: 0,
      endTokenIdx: 0,
      availableInlineSize: 200,
    }));
    const lines = rewrapIncremental(prev, tokens, 200, wrapOneLine, meta);
    expect(lines[0]).toBe(newLine);
    expect(lines).not.toBe(prev.lines);
    expect(wrapOneLine).toHaveBeenCalled();
  });

  it("null prev → full re-wrap even with empty tokens", () => {
    const wrapOneLine = vi.fn();
    const meta = new WeakMap<LineBox, { startTokenIdx: number; endTokenIdx: number }>();
    const lines = rewrapIncremental(null, [], 100, wrapOneLine, meta);
    expect(lines).toHaveLength(0);
    expect(wrapOneLine).not.toHaveBeenCalled();
  });

  it("token appended at end — head lines reused, new tail line added", () => {
    // Prev: 2 tokens on 1 line [0..1]
    // New: 3 tokens [0..1, 2], change at index 2
    const prevTokens = [makeToken("a:0"), makeToken("a:1")];
    const newTokens = [makeToken("a:0"), makeToken("a:1"), makeToken("a:2")];
    const prevLine = makeLine();
    const meta = new WeakMap<LineBox, { startTokenIdx: number; endTokenIdx: number }>();
    meta.set(prevLine, { startTokenIdx: 0, endTokenIdx: 1 });
    const prev: IFCState = {
      tokens: prevTokens,
      textAlign: "start",
      direction: "ltr",
      lines: [prevLine],
      availableInlineSize: 100,
      textIndent: 0,
      tabStops: [],
      defaultTabStop: 48,
      hasTab: false,
    };
    const newLine = makeLine();
    // Change point is 2 → findLineForToken(2) returns lines.length (1), so no head reuse
    const wrapOneLine = vi.fn((_toks: readonly Token[], start: number) => ({
      line: newLine,
      startTokenIdx: start,
      endTokenIdx: 2,
      availableInlineSize: 100,
    }));
    const lines = rewrapIncremental(prev, newTokens, 100, wrapOneLine, meta);
    // changePoint=2 → startLineIdx = lines.length = 1 → reusedHead = [] (all prev lines)
    // wrapOneLine called starting from token 0 (startMeta undefined → startTokenIdx = changePoint = 2)
    // Actually: startMeta = lineMeta.get(prev.lines[1]) which is undefined, so startTokenIdx = changePoint = 2
    expect(lines).toContain(newLine);
    expect(wrapOneLine).toHaveBeenCalledWith(newTokens, 2);
  });

  it("token changed mid-paragraph — head reused, changed line rewrapped", () => {
    // Prev: 4 tokens on 2 lines [0..1, 2..3]
    // New: same tokens except index 2 changed
    const prevTokens = [
      makeToken("a:0"),
      makeToken("a:1"),
      makeToken("a:2"),
      makeToken("a:3"),
    ];
    const newTokens = [
      makeToken("a:0"),
      makeToken("a:1"),
      makeToken("b:2"), // changed
      makeToken("a:3"),
    ];
    const line0 = makeLine();
    const line1 = makeLine();
    const meta = new WeakMap<LineBox, { startTokenIdx: number; endTokenIdx: number }>();
    meta.set(line0, { startTokenIdx: 0, endTokenIdx: 1 });
    meta.set(line1, { startTokenIdx: 2, endTokenIdx: 3 });
    const prev: IFCState = {
      tokens: prevTokens,
      textAlign: "start",
      direction: "ltr",
      lines: [line0, line1],
      availableInlineSize: 100,
      textIndent: 0,
      tabStops: [],
      defaultTabStop: 48,
      hasTab: false,
    };
    const newLine1 = makeLine();
    const wrapOneLine = vi.fn((_toks: readonly Token[], start: number) => ({
      line: newLine1,
      startTokenIdx: start,
      endTokenIdx: 3,
      availableInlineSize: 100,
    }));
    const lines = rewrapIncremental(prev, newTokens, 100, wrapOneLine, meta);
    // changePoint = 2 → startLineIdx = 1 → reusedHead = [line0]
    // wrapOneLine called from token 2
    expect(lines[0]).toBe(line0); // head reused
    expect(lines[1]).toBe(newLine1); // re-wrapped second line
    expect(wrapOneLine).toHaveBeenCalledOnce();
    expect(wrapOneLine).toHaveBeenCalledWith(newTokens, 2);
  });

  it("convergence: reuses prev tail when re-wrap produces same start token", () => {
    // Prev: 6 tokens on 3 lines [0..1, 2..3, 4..5]
    // New: token 0 changed, but re-wrap from line 0 produces endTokenIdx=1,
    //   so the next token is 2 — which matches the start of prev line 1.
    //   Convergence should reuse prev lines[1..] as the tail.
    const prevTokens = [
      makeToken("a:0"),
      makeToken("a:1"),
      makeToken("a:2"),
      makeToken("a:3"),
      makeToken("a:4"),
      makeToken("a:5"),
    ];
    const newTokens = [
      makeToken("b:0"), // changed
      makeToken("a:1"),
      makeToken("a:2"),
      makeToken("a:3"),
      makeToken("a:4"),
      makeToken("a:5"),
    ];
    const line0 = makeLine();
    const line1 = makeLine();
    const line2 = makeLine();
    const meta = new WeakMap<LineBox, { startTokenIdx: number; endTokenIdx: number }>();
    meta.set(line0, { startTokenIdx: 0, endTokenIdx: 1 });
    meta.set(line1, { startTokenIdx: 2, endTokenIdx: 3 });
    meta.set(line2, { startTokenIdx: 4, endTokenIdx: 5 });
    const prev: IFCState = {
      tokens: prevTokens,
      textAlign: "start",
      direction: "ltr",
      lines: [line0, line1, line2],
      availableInlineSize: 100,
      textIndent: 0,
      tabStops: [],
      defaultTabStop: 48,
      hasTab: false,
    };
    const newLine0 = makeLine();
    // wrapOneLine produces a line covering tokens 0..1, same width → convergence at token 2
    const wrapOneLine = vi.fn((_toks: readonly Token[], start: number) => ({
      line: newLine0,
      startTokenIdx: start,
      endTokenIdx: 1,
      availableInlineSize: 100,
    }));
    const lines = rewrapIncremental(prev, newTokens, 100, wrapOneLine, meta);
    // changePoint=0 → startLineIdx=0 → reusedHead=[]
    // wrapOneLine called for [0..1], next=2 → matchingPrev=1 (line1 starts at 2), width matches → convergence
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(newLine0); // re-wrapped first line
    expect(lines[1]).toBe(line1); // reused via convergence
    expect(lines[2]).toBe(line2); // reused via convergence
    expect(wrapOneLine).toHaveBeenCalledOnce(); // stopped after convergence
  });
});
