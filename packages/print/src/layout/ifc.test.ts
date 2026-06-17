import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { createMockHyphenator } from "@taleweaver/core";
import { layoutInlineContent, collectTokens, splitSuffixSourceBase, deriveLineSourceRangeU16, SUPERSCRIPT_RAISE_FRACTION, SUBSCRIPT_LOWER_FRACTION } from "./ifc";
import type { LineRangeUnit } from "./ifc";
import type { LayoutBox, LineBox, TextRunBox } from "./layout-box";
import { withBidiLevel } from "./layout-box";
import { layoutBlock } from "./bfc";
import { computeIntrinsicSizes } from "./intrinsic-sizes-pass";
import type { TextShaper, ShapedRun, BreakOpportunity, FontMetrics, Cluster } from "@taleweaver/core";
import type { ComputedStyle } from "@taleweaver/core";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import type { Direction } from "@taleweaver/core";
import { makeRootContext } from "./layout-context";
import { HARD_BREAK_EMBED_TYPE } from "@taleweaver/core";

const shaper = createMockShaper(8, 16);

/**
 * Bounds-checked array access for test assertions: returns `arr[i]` or throws
 * loudly if it is out of range. Under `noUncheckedIndexedAccess` this narrows
 * `T | undefined` → `T` while preserving each assertion's intent — a short or
 * empty result fails with a clear message instead of a vague TypeError.
 */
function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/**
 * Shared hyphen-test shaper: each char is one 10px cluster; a "hyphen"-kind
 * break opportunity is reported after cluster index 5 (prefix [0,5)) for any
 * text ≥ 6 chars. Used by the P4-C.1 split test (the `IFC — hyphen break`
 * describe block defines its own local copy of the same shaper).
 */
function makeHyphenShaper(): TextShaper {
  const fontMetrics: FontMetrics = { ascent: 12, descent: 4, lineGap: 0, capHeight: 11, xHeight: 7 };
  function shape(text: string, style: Readonly<ComputedStyle>, baseDirection: Direction): ShapedRun {
    const clusters: Cluster[] = [];
    for (let i = 0; i < text.length; i++) {
      clusters.push({ start: i, end: i + 1, inlineAdvance: 10, isLigature: false, glyphs: [text.charCodeAt(i)] });
    }
    const breakOpportunities: BreakOpportunity[] = [];
    if (text.length >= 6) breakOpportunities.push({ clusterIndex: 5, kind: "hyphen" });
    return {
      text,
      computedStyle: style,
      clusters,
      ascent: fontMetrics.ascent,
      descent: fontMetrics.descent,
      lineGap: fontMetrics.lineGap,
      minClusterInlineSize: text.length === 0 ? 0 : 10,
      unbreakableRunInlineSize: text.length * 10,
      breakOpportunities,
      bidiLevel: baseDirection === "rtl" ? 1 : 0,
    };
  }
  return { shape, measureFontMetrics: () => fontMetrics };
}

function ifcOf(text: string, width: number) {
  const tree = cascadePass(
    createElementBox("p", { display: "block" }, [
      createTextBox("t", {}, text),
    ]),
  );
  if (tree.type !== "element") throw new Error("?");
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, width);
  const result = layoutInlineContent(tree, 0, 0, ctx, shaper, undefined, 0);
  if (result.box === null) throw new Error("layoutInlineContent returned null box");
  return result.box.children;
}

describe("layoutInlineContent — single line", () => {
  it("single short text fits on one line", () => {
    const lines = ifcOf("hello world", 200);
    expect(lines).toHaveLength(1);
    if (nth(lines, 0, "line").type !== "line") throw new Error("?");
    expect(nth(lines, 0, "line").width).toBeGreaterThan(0);
    expect(nth(lines, 0, "line").height).toBe(16);
  });

  // A multi-word text node (one sourceKey "t") tokenizes into several word-units
  // that all land on the same line. Each text-run box gets a per-line `runKey`
  // of the form `${sourceKey}:${runIdx}`. The runIdx counter must start at 0 for
  // a fresh sourceKey (the `runCounters[sourceKey] ?? 0` fallback) — otherwise
  // the first run reads `undefined` → key "t:undefined", and every later run
  // reads NaN → key "t:NaN" (colliding), breaking DOM reconciliation keys.
  it("multi-word run keys are distinct, sequential, and never NaN/undefined", () => {
    const lines = ifcOf("hello world foo", 200);
    expect(lines).toHaveLength(1);
    const line0 = nth(lines, 0, "line");
    if (line0.type !== "line") throw new Error("?");
    const runKeys: string[] = [];
    const walk = (boxes: readonly { type: string; key: string; children?: readonly unknown[] }[]) => {
      for (const b of boxes) {
        if (b.type === "text-run") runKeys.push(b.key);
        else if (b.type === "inline" && b.children) {
          walk(b.children as readonly { type: string; key: string; children?: readonly unknown[] }[]);
        }
      }
    };
    walk(line0.children as readonly { type: string; key: string; children?: readonly unknown[] }[]);
    // ≥2 word-units sharing the single sourceKey "t".
    expect(runKeys.length).toBeGreaterThanOrEqual(2);
    for (const k of runKeys) {
      expect(k).not.toContain("NaN");
      expect(k).not.toContain("undefined");
    }
    // Sequential per-sourceKey indices starting at 0 ("t:0", "t:1", …).
    expect(runKeys).toEqual(runKeys.map((_, i) => `t:${i}`));
    // All distinct (no "t:NaN" collisions).
    expect(new Set(runKeys).size).toBe(runKeys.length);
  });
});

describe("layoutInlineContent — wrapping", () => {
  it("wraps when text exceeds available width", () => {
    // mockMeasurer: 8px per char. width 50 fits ~6 chars.
    const lines = ifcOf("hello world", 50);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it("each line has y advanced by line height", () => {
    const lines = ifcOf("a b c d e f g h i j", 30);
    for (let i = 1; i < lines.length; i++) {
      expect(nth(lines, i).y).toBeGreaterThan(nth(lines, i - 1).y);
    }
  });
});

describe("layoutInlineContent — empty inline content (strut line)", () => {
  // Empty inline-bearing-leaf blocks (e.g. an empty <p>) must display as one
  // line-height of vertical space, per CSS line-box "strut" semantics — not as
  // zero-height. The IFC emits one empty LineBox carrying the parent block's
  // font line-height so adjacent paragraphs don't visually collapse together.
  it("empty inline-bearing-leaf block layouts to one line-height tall", () => {
    // A block with a single empty TextBox child — this is what the IFC sees
    // when an inline-bearing-leaf component has no inline content items.
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t", {}, ""),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const result = layoutInlineContent(tree, 0, 0, ctx, shaper, undefined, 0);
    if (result.box === null) throw new Error("layoutInlineContent returned null box");
    const block = result.box;
    expect(block.children).toHaveLength(1);
    const line = nth(block.children, 0, "line");
    if (line.type !== "line") throw new Error("expected line box");
    // Mock shaper's measureHeight returns 16 (lineHeight = 16).
    expect(line.height).toBe(16);
    // Under #333 the strut line carries a single zero-width strut child as
    // the empty-line caret anchor (replaces the prior `children: []` shape).
    expect(line.children).toHaveLength(1);
    expect(nth(line.children, 0, "child").type).toBe("text-run");
    expect(nth(line.children, 0, "child").width).toBe(0);
    // Block's total block size = the strut line's height.
    expect(block.height).toBe(16);
  });

  it("strut line has the parent block's font line-height", () => {
    // Same scenario but with explicit per-block style: ensure the strut uses
    // the parent's computed style for line height, not a constant.
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t", {}, ""),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const result = layoutInlineContent(tree, 0, 0, ctx, shaper, undefined, 0);
    if (result.box === null) throw new Error("layoutInlineContent returned null box");
    const line = nth(result.box.children, 0, "child");
    if (line.type !== "line") throw new Error("expected line box");
    expect(line.height).toBeGreaterThan(0);
    expect(line.y).toBe(0); // first line at the block's blockOffset
  });

  it("IFC dispatched on a block with an empty TextBox child emits one strut line", () => {
    // This mirrors the real-world dispatch path: the renderer's
    // expandInlineItems emits a sentinel empty TextBox when a leaf block has
    // no inline items. The resulting ElementBox has one TextBox child with
    // text="", which routes through the BFC → inline-run group → IFC, and
    // the IFC's zero-tokens path emits the strut line.
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("p/inline/0", {}, ""),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    expect(out.height).toBe(16);
    const lines = out.children.filter(c => c.type === "line");
    expect(lines).toHaveLength(1);
    expect(nth(lines, 0, "line").height).toBe(16);
  });

  it("consecutive empty paragraphs each get their own full line-height", () => {
    // Three empty paragraphs stacked. Each must contribute one line-height
    // to the parent's total block size (no collapsing into zero).
    const tree = cascadePass(
      createElementBox("doc", { display: "block" }, [
        createElementBox("p1", { display: "block" }, [createTextBox("t1", {}, "")]),
        createElementBox("p2", { display: "block" }, [createTextBox("t2", {}, "")]),
        createElementBox("p3", { display: "block" }, [createTextBox("t3", {}, "")]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    // Each empty paragraph should contribute >= one line-height (16).
    expect(out.height).toBeGreaterThanOrEqual(48);
  });

  it("empty paragraph between two non-empty paragraphs maintains visible spacing", () => {
    // <p>Welcome</p><p></p><p>Goodbye</p> — the middle empty paragraph must
    // occupy one line-height of space; the third paragraph's y must be at
    // least (first paragraph height + empty line height) below the start.
    const tree = cascadePass(
      createElementBox("doc", { display: "block" }, [
        createElementBox("p1", { display: "block" }, [createTextBox("t1", {}, "Welcome")]),
        createElementBox("p2", { display: "block" }, [createTextBox("t2", {}, "")]),
        createElementBox("p3", { display: "block" }, [createTextBox("t3", {}, "Goodbye")]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const blocks = out.children.filter(c => c.type === "block");
    expect(blocks).toHaveLength(3);
    // The empty middle paragraph must be at least one line-height tall.
    expect(nth(blocks, 1).height).toBeGreaterThanOrEqual(16);
    // Third paragraph must be below first paragraph + middle paragraph's height.
    expect(nth(blocks, 2).y).toBeGreaterThanOrEqual(nth(blocks, 0).height + nth(blocks, 1).height);
  });
});

describe("IFC whiteSpace handling", () => {
  it("nowrap produces a single line even when text exceeds width", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block", whiteSpace: "nowrap" }, [
        createTextBox("t", {}, "this is a long line that would normally wrap"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r1 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 50), shaper, undefined);
    if (r1.box === null) throw new Error("layoutBlock returned null box");
    const out = r1.box;
    if (out.type !== "block") throw new Error("?");
    // Should produce exactly one line
    const lineBoxes = out.children.filter(c => c.type === "line");
    expect(lineBoxes).toHaveLength(1);
  });

  it("pre breaks at LINE_BREAK and never wraps", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block", whiteSpace: "pre" }, [
        createTextBox("t", {}, "line one\nline two"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r2 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 200), shaper, undefined);
    if (r2.box === null) throw new Error("layoutBlock returned null box");
    const out = r2.box;
    if (out.type !== "block") throw new Error("?");
    const lineBoxes = out.children.filter(c => c.type === "line");
    expect(lineBoxes).toHaveLength(2);
  });

  it("pre-wrap wraps at word boundaries AND breaks at LINE_BREAK", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block", whiteSpace: "pre-wrap" }, [
        createTextBox("t", {}, "long text here\nsecond"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r3 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 30), shaper, undefined);
    if (r3.box === null) throw new Error("layoutBlock returned null box");
    const out = r3.box;
    if (out.type !== "block") throw new Error("?");
    const lineBoxes = out.children.filter(c => c.type === "line");
    // Wrap from "long text here" + a hard break + "second" should produce >= 2 lines
    expect(lineBoxes.length).toBeGreaterThanOrEqual(2);
  });

  it("blank middle line renders identically under pre and pre-wrap (#168)", () => {
    // "a\n\nb" has a blank middle line. The `pre` tokenizer emits a "" token
    // for that empty segment; the `pre-wrap` tokenizer emits NO token (just
    // back-to-back LINE_BREAKs). This test proves that difference is invisible
    // at layout: the second consecutive LINE_BREAK triggers an empty-units
    // flushLine, so a blank line box is emitted in BOTH modes. Therefore
    // pre-wrap does NOT need the empty-segment token to render the blank line.
    const lineCount = (ws: "pre" | "pre-wrap"): number => {
      const tree = cascadePass(
        createElementBox("p", { display: "block", whiteSpace: ws }, [
          createTextBox("t", {}, "a\n\nb"),
        ]),
      );
      if (tree.type !== "element") throw new Error("?");
      const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 200), shaper, undefined);
      if (r.box === null) throw new Error("layoutBlock returned null box");
      const out = r.box;
      if (out.type !== "block") throw new Error("?");
      return out.children.filter(c => c.type === "line").length;
    };
    const preLines = lineCount("pre");
    const preWrapLines = lineCount("pre-wrap");
    // Three lines: "a", the blank middle line, and "b".
    expect(preLines).toBe(3);
    expect(preWrapLines).toBe(preLines);
  });
});

describe("IFC — leading/orphan spaces under preserving white-space (#308)", () => {
  // Helper: collect a line's text-run leaves (recursing into inline boxes) in
  // visual order, returning { x, text, offsetLength } for geometry assertions.
  function textRunLeaves(line: import("./layout-box").LineBox) {
    const out: { x: number; text: string; offsetLength: number }[] = [];
    const walk = (boxes: readonly import("./layout-box").LayoutBox[]) => {
      for (const b of boxes) {
        if (b.type === "text-run") out.push({ x: b.x, text: b.text, offsetLength: b.offsetLength });
        else if (b.type === "inline") walk(b.children);
      }
    };
    walk(line.children);
    out.sort((a, b) => a.x - b.x);
    return out;
  }

  it("'  abc' under pre-wrap renders the 2 leading spaces; 'abc' starts at x=16, line owns all 5 chars", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block", whiteSpace: "pre-wrap" }, [
        createTextBox("t", {}, "  abc"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const lines = out.children.filter(c => c.type === "line");
    expect(lines).toHaveLength(1);
    const line = nth(lines, 0, "line");
    if (line.type !== "line") throw new Error("?");

    // The line OWNS all 5 state chars (2 leading spaces + "abc"); leading
    // spaces are NOT dropped.
    expect(line.inlineOffsetStart).toBe(0);
    expect(line.inlineOffsetEnd).toBe(5);

    // GEOMETRY: the first leaf renders the leading spaces (starting at x=0),
    // and "abc" starts at x=16 (2 spaces × 8px), not x=0.
    const leaves = textRunLeaves(line);
    // First leaf renders only spaces, anchored at x=0.
    expect(nth(leaves, 0).x).toBe(0);
    expect(/^\s+$/.test(nth(leaves, 0).text)).toBe(true);
    // The "abc" text run starts at x=16.
    const abcLeaf = leaves.find(l => l.text.includes("abc"));
    expect(abcLeaf).toBeDefined();
    expect(abcLeaf?.x).toBe(16);

    // Sum of offsetLengths across leaves accounts for all 5 chars.
    const totalOffset = leaves.reduce((s, l) => s + l.offsetLength, 0);
    expect(totalOffset).toBe(5);
  });

  it("a paragraph that is ONLY spaces '   ' under pre-wrap owns 3 chars, content width 24px", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block", whiteSpace: "pre-wrap" }, [
        createTextBox("t", {}, "   "),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const lines = out.children.filter(c => c.type === "line");
    expect(lines).toHaveLength(1);
    const line = nth(lines, 0, "line");
    if (line.type !== "line") throw new Error("?");

    // Line owns all 3 space chars.
    expect(line.inlineOffsetStart).toBe(0);
    expect(line.inlineOffsetEnd).toBe(3);

    // Rendered content width = 3 spaces × 8px = 24px.
    const leaves = textRunLeaves(line);
    const contentWidth = leaves.reduce((s, l) => s + l.text.length * 8, 0);
    expect(contentWidth).toBe(24);
    const totalOffset = leaves.reduce((s, l) => s + l.offsetLength, 0);
    expect(totalOffset).toBe(3);
  });

  it("leading spaces after a forced break 'x\\n  y' render on line 2; offsets contiguous across lines", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block", whiteSpace: "pre-wrap" }, [
        createTextBox("t", {}, "x\n  y"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const lines = out.children.filter(c => c.type === "line");
    expect(lines).toHaveLength(2);
    const line1 = nth(lines, 0, "line");
    const line2 = nth(lines, 1, "line");
    if (line1.type !== "line" || line2.type !== "line") throw new Error("?");

    // Line 1: "x" + the forced break = offsets [0, 2) ("x" + "\n").
    expect(line1.inlineOffsetStart).toBe(0);
    expect(line1.inlineOffsetEnd).toBe(2);

    // Line 2: leading "  " then "y" = offsets [2, 5).
    expect(line2.inlineOffsetStart).toBe(line1.inlineOffsetEnd);
    expect(line2.inlineOffsetEnd).toBe(5);

    // GEOMETRY: "y" starts at x=16 on line 2 (after 2 leading spaces).
    const leaves2 = textRunLeaves(line2);
    expect(nth(leaves2, 0).x).toBe(0);
    expect(/^\s+$/.test(nth(leaves2, 0).text)).toBe(true);
    const yLeaf = leaves2.find(l => l.text.includes("y"));
    expect(yLeaf).toBeDefined();
    expect(yLeaf?.x).toBe(16);
  });

  it("#308: '  abc' under white-space:normal — leading spaces collapse VISUALLY but the line owns all 5 source chars", () => {
    // Under collapsing mode the leading spaces produce zero-width text-run
    // leaves at x=0 (no rendered glyph width), so "abc" still starts at x=0.
    // But the line owns ALL 5 source chars so the caret accumulator covers
    // offsets 0..5. Without the fix, the line only owned [2, 5) and caret
    // at offsets 0 and 1 fell past.
    const tree = cascadePass(
      createElementBox("p", { display: "block", whiteSpace: "normal" }, [
        createTextBox("t", {}, "  abc"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const lines = out.children.filter(c => c.type === "line");
    expect(lines).toHaveLength(1);
    const line = nth(lines, 0, "line");
    if (line.type !== "line") throw new Error("?");

    // Line owns all 5 source chars.
    expect(line.inlineOffsetStart).toBe(0);
    expect(line.inlineOffsetEnd).toBe(5);

    // Sum of leaves' offsetLength === 5 (the 2 leading-space leaves carry
    // offsetLength 1 each, "abc" carries 3).
    const leaves = textRunLeaves(line);
    const totalOffset = leaves.reduce((s, l) => s + l.offsetLength, 0);
    expect(totalOffset).toBe(5);

    // The "abc" leaf starts at x=0 (leading spaces collapsed to width=0).
    const abcLeaf = leaves.find(l => l.text === "abc");
    expect(abcLeaf).toBeDefined();
    expect(abcLeaf?.x).toBe(0);
  });

  it("#308: leading spaces inside <em> under white-space:normal — line still owns source offsets", () => {
    // The em's text node starts with whitespace. Under collapsing mode those
    // leading spaces are orphan to the em's sourceKey (no preceding non-space
    // token in the same sourceKey). Today they're dropped — the em's text node
    // ALSO contributes no source-offset coverage. With the fix, the em owns
    // them as zero-width units.
    //
    // Fixture: <em>"   text"</em> (no surrounding text). Total source chars
    // contributed by the em's text node = 7 (3 leading + 4 word).
    const tree = cascadePass(
      createElementBox("p", { display: "block", whiteSpace: "normal" }, [
        createElementBox("em", { display: "inline" }, [
          createTextBox("t", {}, "   text"),
        ]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r.box === null) throw new Error("?");
    if (r.box.type !== "block") throw new Error("?");
    const lines = r.box.children.filter((c): c is import("./layout-box").LineBox => c.type === "line");
    expect(lines).toHaveLength(1);
    const line = nth(lines, 0, "line");
    expect(line.inlineOffsetStart).toBe(0);
    expect(line.inlineOffsetEnd).toBe(7);
  });

  it("NO-REGRESSION: '  abc' under white-space:normal — leading-space LEAVES exist " +
     "but render at width=0 so 'abc' is visually at x=0", () => {
    // Under collapsing mode #308 emits a zero-width text-run leaf per leading
    // whitespace char (carrying offsetLength=1 so the caret accumulator
    // covers the offset) — text="" or " " with width=0. The "abc" leaf still
    // anchors at x=0 because the leading-space leaves contribute zero width
    // to the cursor — the visual rendering is identical to the pre-fix state.
    const tree = cascadePass(
      createElementBox("p", { display: "block", whiteSpace: "normal" }, [
        createTextBox("t", {}, "  abc"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const lines = out.children.filter(c => c.type === "line");
    expect(lines).toHaveLength(1);
    const line = nth(lines, 0, "line");
    if (line.type !== "line") throw new Error("?");

    // "abc" still starts at x=0 — leading-space leaves have width=0 so they
    // don't push it.
    const leaves = textRunLeaves(line);
    const abcLeaf = leaves.find(l => l.text === "abc");
    expect(abcLeaf).toBeDefined();
    expect(abcLeaf?.x).toBe(0);

    // Every whitespace-only leaf renders at width 0 (verified by the
    // text-run's offsetLength being 1 with no visual width contribution; the
    // visual contract is "leading spaces are invisible under collapsing
    // mode").
    const totalLeafWidth = leaves
      .filter(l => /^\s+$/.test(l.text))
      .reduce((s, l) => s + l.text.length * 8, 0);
    // Mock shaper is 8px/char but under collapse the IFC must emit them with
    // 0 unitWidth — we assert the rendered width here via the layout box,
    // not the raw token sum.
    // (Re-fetch leaves with width info from the layout boxes.)
    const widths: number[] = [];
    const walk = (boxes: readonly import("./layout-box").LayoutBox[]) => {
      for (const b of boxes) {
        if (b.type === "text-run" && /^\s+$/.test(b.text)) widths.push(b.width);
        else if (b.type === "inline") walk(b.children);
      }
    };
    walk(line.children);
    for (const w of widths) expect(w).toBe(0);
    expect(totalLeafWidth).toBeGreaterThan(0); // sanity: leaves exist
  });
});

describe("IFC — break-spaces (#314, Google-Docs trailing-space wrap)", () => {
  // Collect a line's text-run leaves (recursing into inline boxes) in visual
  // order: { x, width, text, offsetLength }. Under break-spaces text-runs are
  // direct line children (no inline elements in these fixtures), so `x` is
  // line-relative and the line itself is at inlineOffset 0 — so the
  // page-edge check is `x + width <= lineInlineSize`.
  function leavesOf(line: import("./layout-box").LineBox) {
    const out: { x: number; width: number; text: string; offsetLength: number }[] = [];
    const walk = (boxes: readonly import("./layout-box").LayoutBox[]) => {
      for (const b of boxes) {
        if (b.type === "text-run") out.push({ x: b.x, width: b.width, text: b.text, offsetLength: b.offsetLength });
        else if (b.type === "inline") walk(b.children);
      }
    };
    walk(line.children);
    out.sort((a, b) => a.x - b.x);
    return out;
  }

  function linesOf(text: string, width: number) {
    const tree = cascadePass(
      createElementBox("p", { display: "block", whiteSpace: "break-spaces" }, [
        createTextBox("t", {}, text),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, width), shaper, undefined);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const lines = out.children.filter((c): c is import("./layout-box").LineBox => c.type === "line");
    return { lines, lineInlineSize: width };
  }

  it("trailing spaces HANG (#338 P1, supersedes wrap) and the word is NOT split", () => {
    // "ab cd        " (8 trailing spaces) at 40px. "ab cd" = 5×8 = 40 fits.
    // #338 P1: a space unit never triggers its own wrap, so the 8 trailing
    // spaces HANG on line 1 (Google-Docs trailing-space behavior) — they do NOT
    // wrap to subsequent lines. The whole paragraph is ONE line.
    const { lines } = linesOf("ab cd        ", 40);
    expect(lines).toHaveLength(1);

    // "ab cd" is intact on line 1 (NOT split early), and the line owns the full
    // 13-char source span (5 word/inter-word chars + 8 trailing spaces).
    const line1Text = leavesOf(nth(lines, 0, "line")).map(l => l.text).join("");
    expect(line1Text.startsWith("ab cd")).toBe(true);
    expect(/ab\s+cd/.test(line1Text)).toBe(true);
    expect(nth(lines, 0, "line").inlineOffsetEnd).toBe(13);

    // NOTE: hung spaces may extend past the content edge under P1 — clamping the
    // hung run to the content edge is P2 (#338). No on-page geometry asserted.
  });

  it("word is not split early: 'ab cd   ' at 40px keeps 'ab' and 'cd' on line 1", () => {
    // "ab cd" = 40 fits exactly; "ab cd " = 48 does NOT. Under per-token wrap
    // units "cd" (16px) fits after "ab " (24px) = 40 ≤ 40 and stays; the
    // trailing spaces wrap. Under the OLD slurped ["cd"," "," "," "] unit this
    // overflowed and hopped "cd" to line 2 (the bug).
    const { lines } = linesOf("ab cd   ", 40);
    const line1Text = leavesOf(nth(lines, 0, "line")).map(l => l.text).join("");
    expect(line1Text.includes("ab")).toBe(true);
    expect(line1Text.includes("cd")).toBe(true);
    // Both words on the SAME (first) line.
    expect(/ab\s+cd/.test(line1Text)).toBe(true);
  });

  it("a run of spaces longer than a line all HANGS on one line (#338 P1, supersedes multi-line wrap)", () => {
    // 20 spaces at 40px. #338 P1: a space unit never triggers its own wrap, so
    // the whole run HANGS on a single line (a paragraph that is ONLY spaces has
    // no word unit to wrap; every space is a space unit). All 20 chars are owned
    // by the one line.
    const { lines } = linesOf("                    ", 40);
    expect(lines).toHaveLength(1);
    expect(nth(lines, 0, "line").inlineOffsetStart).toBe(0);
    expect(nth(lines, 0, "line").inlineOffsetEnd).toBe(20);
    // NOTE: the hung run extends past the content edge under P1 (clamping is P2).
  });

  it("interior single-space wrap is unchanged vs normal word-wrap", () => {
    // "aaaa bbbb cccc" at a 2-word width (~72px fits "aaaa bbbb" = 9×8=72).
    const { lines } = linesOf("aaaa bbbb cccc", 72);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    // Wraps at the interior space: "aaaa bbbb" on line 1, "cccc" on line 2.
    const line1Text = leavesOf(nth(lines, 0, "line")).map(l => l.text).join("").trimEnd();
    expect(line1Text).toBe("aaaa bbbb");
    const line2Text = leavesOf(nth(lines, 1, "line")).map(l => l.text).join("").trim();
    expect(line2Text).toBe("cccc");
  });

  it("multiple + leading spaces render; line owns all state offsets", () => {
    // "  a   b": 2 leading + "a" + 3 interior + "b" = 7 chars, all rendered.
    const { lines } = linesOf("  a   b", 500);
    expect(lines).toHaveLength(1);
    const line = nth(lines, 0, "line");
    expect(line.inlineOffsetStart).toBe(0);
    expect(line.inlineOffsetEnd).toBe(7);
    const leaves = leavesOf(line);
    // First leaf is the 2 leading spaces, anchored at x=0.
    expect(nth(leaves, 0).x).toBe(0);
    expect(/^\s+$/.test(nth(leaves, 0).text)).toBe(true);
    // "a" starts at x=16 (after 2 leading spaces).
    const aLeaf = leaves.find(l => l.text.includes("a"));
    expect(aLeaf?.x).toBe(16);
    // Total rendered + offset accounts for all 7 chars.
    const totalOffset = leaves.reduce((s, l) => s + l.offsetLength, 0);
    expect(totalOffset).toBe(7);
  });

  it("offset continuity: nextLine.inlineOffsetStart === prevLine.inlineOffsetEnd across a hung-space-then-word wrap", () => {
    // #338 P1: a trailing run of spaces HANGS on line 1; the FOLLOWING word
    // wraps (it's a word unit) — so the offset boundary lands at the word break,
    // not mid-space-run. Hung spaces stay with the preceding word on line 1.
    // "ab cd      xy" at 40px: "ab cd"=40 + 6 spaces hang on line 1 (offset 11);
    // "xy" wraps to line 2.
    const { lines } = linesOf("ab cd      xy", 40);
    expect(lines).toHaveLength(2);
    for (let i = 1; i < lines.length; i++) {
      expect(nth(lines, i).inlineOffsetStart).toBe(nth(lines, i - 1).inlineOffsetEnd);
    }
    // Line 1 owns "ab cd" + 6 hung spaces = 11 chars; line 2 owns "xy" → 13.
    expect(nth(lines, 0, "line").inlineOffsetEnd).toBe(11);
    expect(nth(lines, lines.length - 1).inlineOffsetEnd).toBe(13);
  });
});

describe("IFC — trailing-space HANG (#338 P1: a space unit never triggers its own wrap)", () => {
  // Local copies of the #314 harness (break-spaces, 8px/char mock shaper).
  function leavesOf(line: import("./layout-box").LineBox) {
    const out: { x: number; width: number; text: string; offsetLength: number }[] = [];
    const walk = (boxes: readonly import("./layout-box").LayoutBox[]) => {
      for (const b of boxes) {
        if (b.type === "text-run") out.push({ x: b.x, width: b.width, text: b.text, offsetLength: b.offsetLength });
        else if (b.type === "inline") walk(b.children);
      }
    };
    walk(line.children);
    out.sort((a, b) => a.x - b.x);
    return out;
  }

  function linesOf(text: string, width: number) {
    const tree = cascadePass(
      createElementBox("p", { display: "block", whiteSpace: "break-spaces" }, [
        createTextBox("t", {}, text),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, width), shaper, undefined);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const lines = out.children.filter((c): c is import("./layout-box").LineBox => c.type === "line");
    return { lines, lineInlineSize: width };
  }

  it("lone trailing space HANGS: 'word ' at 36px keeps both word and space on line 1", () => {
    // "word" = 4×8 = 32 ≤ 36 fits; "word " = 40 > 36 overflows by 8 (one space
    // width). OLD per-token wrap: the overflowing space unit wrapped ALONE to
    // line 2 (the lone-space-jumps bug → 2 lines). NEW: a space unit never
    // triggers its own wrap, so it HANGS on line 1 → 1 line; the word stays put.
    const { lines } = linesOf("word ", 36);
    expect(lines).toHaveLength(1);
    // The line owns all 5 source offsets (4 word chars + 1 trailing space).
    expect(nth(lines, 0, "line").inlineOffsetStart).toBe(0);
    expect(nth(lines, 0, "line").inlineOffsetEnd).toBe(5);
    const line1Text = leavesOf(nth(lines, 0, "line")).map(l => l.text).join("");
    expect(line1Text).toBe("word ");
  });

  it("following word WRAPS, the hung spaces stay: 'word1   word2' wraps word2 to line 2, spaces stay on line 1", () => {
    // "word1" = 5×8 = 40; +3 spaces = 64; "word2" = 40 ⇒ would be 104 total.
    // Width 64 fits "word1   " (8 chars × 8 = 64) exactly; "word2" overflows
    // (64 + 40 > 64) and — being a WORD unit — wraps to line 2. word1 is NOT
    // hopped: it stays on line 1 with its 3 hung spaces.
    const { lines } = linesOf("word1   word2", 64);
    expect(lines).toHaveLength(2);
    const line1Text = leavesOf(nth(lines, 0, "line")).map(l => l.text).join("");
    expect(line1Text).toBe("word1   ");
    const line2Text = leavesOf(nth(lines, 1, "line")).map(l => l.text).join("");
    expect(line2Text).toBe("word2");
  });

  it("interior spaces still wrap the next WORD: 'aaaa   bb' at 52px → 2 lines, all 3 spaces on line 1", () => {
    // The Phase-2-doc discriminating case. "aaaa" = 32; 3 spaces push to 56.
    // At width 52: under OLD per-token wrap the 3rd space (48 + 8 = 56 > 52)
    // wrapped ALONE to line 2, leaving only 2 spaces on line 1 (the lone-space
    // jump). NEW: each space hangs (a space unit never wraps), so all 3 stay on
    // line 1; the WORD "bb" then overflows (currentWidth past the edge) and is
    // the unit that wraps to line 2.
    const { lines } = linesOf("aaaa   bb", 52);
    expect(lines).toHaveLength(2);
    const line1Text = leavesOf(nth(lines, 0, "line")).map(l => l.text).join("");
    expect(line1Text).toBe("aaaa   "); // word + all 3 spaces hang on line 1
    const line2Text = leavesOf(nth(lines, 1, "line")).map(l => l.text).join("");
    expect(line2Text).toBe("bb");
  });

  it("word never HOPS because of a trailing space (regression guard)", () => {
    // A word that fits exactly at line end, then a trailing space that overflows.
    // "abcd" = 32 = width; "abcd " = 40 > 32. The word must NOT move to line 2
    // because of the trailing space — it stays, the space hangs after it.
    const { lines } = linesOf("abcd ", 32);
    expect(lines).toHaveLength(1);
    const line1Text = leavesOf(nth(lines, 0, "line")).map(l => l.text).join("");
    expect(line1Text).toBe("abcd ");
    expect(nth(lines, 0, "line").inlineOffsetEnd).toBe(5);
  });

  it("NO-REGRESSION: a multi-word paragraph wrapping purely on words is unchanged", () => {
    // No trailing-space involvement: "aaaa bbbb cccc" at 72px wraps at the
    // interior space exactly as today ("aaaa bbbb" / "cccc").
    const { lines } = linesOf("aaaa bbbb cccc", 72);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const line1Text = leavesOf(nth(lines, 0, "line")).map(l => l.text).join("").trimEnd();
    expect(line1Text).toBe("aaaa bbbb");
    const line2Text = leavesOf(nth(lines, 1, "line")).map(l => l.text).join("").trim();
    expect(line2Text).toBe("cccc");
  });
});

describe("IFC — hung-space CLAMP (#338 P2: clamp hung-space box geometry to the content edge)", () => {
  // Same break-spaces, 8px/char harness as the P1 hang block. The CLAMP is a
  // physical-geometry clamp applied at box-build time: a SPACE box's
  // inlineOffset is clamped to ≤ lineInlineSize and its width clamped so
  // inlineOffset + width ≤ lineInlineSize (a fully-past-edge space → width 0 at
  // the edge). Word/inline-block boxes are NEVER clamped.
  function leavesOf(line: import("./layout-box").LineBox) {
    const out: { x: number; width: number; text: string; offsetLength: number }[] = [];
    const walk = (boxes: readonly import("./layout-box").LayoutBox[]) => {
      for (const b of boxes) {
        if (b.type === "text-run") out.push({ x: b.x, width: b.width, text: b.text, offsetLength: b.offsetLength });
        else if (b.type === "inline") walk(b.children);
      }
    };
    walk(line.children);
    out.sort((a, b) => a.x - b.x);
    return out;
  }

  function linesOf(text: string, width: number) {
    const tree = cascadePass(
      createElementBox("p", { display: "block", whiteSpace: "break-spaces" }, [
        createTextBox("t", {}, text),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, width), shaper, undefined);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const lines = out.children.filter((c): c is import("./layout-box").LineBox => c.type === "line");
    return { lines, lineInlineSize: width };
  }

  const EPS = 1e-6;

  it("large-N trailing spaces stay on-page: NO space box extends past the content edge", () => {
    // "word" (4×8 = 32) + 40 trailing spaces at width 80. The 40 spaces HANG on
    // one line (P1) but their natural inline positions run far past the 80px
    // content edge. P2 clamps every space box so x + width ≤ 80.
    const N = 40;
    const { lines, lineInlineSize } = linesOf("word" + " ".repeat(N), 80);
    expect(lines).toHaveLength(1);
    const leaves = leavesOf(nth(lines, 0, "line"));

    // The WORD box is unchanged (starts at 0, full 32px width).
    const wordLeaf = leaves.find(l => l.text.includes("word"));
    expect(wordLeaf).toBeDefined();
    expect(wordLeaf?.x).toBe(0);
    expect(wordLeaf?.width).toBe(32);

    // NO space box extends past the content edge (the load-bearing on-page guard).
    const spaceLeaves = leaves.filter(l => /^\s+$/.test(l.text));
    expect(spaceLeaves.length).toBeGreaterThan(0);
    for (const sp of spaceLeaves) {
      expect(sp.x).toBeLessThanOrEqual(lineInlineSize + EPS);
      expect(sp.x + sp.width).toBeLessThanOrEqual(lineInlineSize + EPS);
    }
    // The line still owns all 44 source offsets (caret accounting intact).
    expect(nth(lines, 0, "line").inlineOffsetEnd).toBe(4 + N);
  });

  it("a straddling space renders with partial width up to the edge; fully-past spaces clamp to width 0 at the edge", () => {
    // Width 36. "wor" would be 24; pick "word" (32) + spaces so that the FIRST
    // hung space straddles the edge. "word" ends at 32; space #1 natural span is
    // [32,40) → straddles 36 → clamps to x=32, width=4. Space #2 natural [40,48)
    // → fully past → x=36, width=0. Space #3 [48,56) → x=36, width=0.
    const { lines, lineInlineSize } = linesOf("word   ", 36);
    expect(lines).toHaveLength(1);
    const leaves = leavesOf(nth(lines, 0, "line"));
    const spaceLeaves = leaves.filter(l => /^\s+$/.test(l.text));
    for (const sp of spaceLeaves) {
      expect(sp.x + sp.width).toBeLessThanOrEqual(lineInlineSize + EPS);
    }
    // At least one space straddles (clamped width strictly between 0 and 8).
    const straddling = spaceLeaves.find(sp => sp.width > 0 && sp.width < 8);
    expect(straddling).toBeDefined();
    expect(straddling?.x).toBe(32);
    expect((straddling?.x ?? 0) + (straddling?.width ?? 0)).toBeCloseTo(36, 6);
    // The fully-past spaces clamp to the edge with width 0.
    const atEdge = spaceLeaves.filter(sp => sp.width === 0);
    expect(atEdge.length).toBeGreaterThan(0);
    for (const sp of atEdge) expect(sp.x).toBeCloseTo(36, 6);
  });

  it("a force-placed WORD wider than the line is NOT clamped (CSS overflow)", () => {
    // A single unbreakable word "aaaaaaaaaa" (10×8 = 80) at width 40. It can't
    // wrap (single unit, nothing before it), so it force-places and legitimately
    // overflows. The clamp must NOT clip it — the word box keeps its full width.
    const { lines } = linesOf("aaaaaaaaaa", 40);
    expect(lines).toHaveLength(1);
    const leaves = leavesOf(nth(lines, 0, "line"));
    const wordLeaf = leaves.find(l => l.text.includes("a"));
    expect(wordLeaf).toBeDefined();
    expect(wordLeaf?.x).toBe(0);
    // Word retains its full 80px width (overflows the 40px line — NOT clamped).
    expect(wordLeaf?.width).toBe(80);
  });

  it("following word still wraps after the clamp (P1 no-regression): 'word1   word2' → 2 lines", () => {
    // The fit cursor advances by NATURAL space width even when boxes clamp, so a
    // following word still wraps. (Same case as P1; re-asserted under the clamp.)
    const { lines } = linesOf("word1   word2", 64);
    expect(lines).toHaveLength(2);
    const line1Text = leavesOf(nth(lines, 0, "line")).map(l => l.text).join("");
    expect(line1Text).toBe("word1   ");
    const line2Text = leavesOf(nth(lines, 1, "line")).map(l => l.text).join("");
    expect(line2Text).toBe("word2");
  });

  it("centered line with trailing spaces: spaces clamp to the line content edge, no box off-page", () => {
    // Centered paragraph "hi" + trailing spaces. The clamp composes with
    // centering: line children are LINE-RELATIVE (start at 0), and the clamp edge
    // for the hung spaces is the line's own content right boundary
    // `lineInlineSize` (line-relative), per the plan-review resolution. No space
    // box extends past lineInlineSize; the line is still ONE line; no crash.
    // (The centered SHIFT for multi-space break-spaces is governed by the P3
    // alignment trailing-space exclusion, NOT by this P2 clamp — out of scope
    // here.)
    const W = 80;
    const tree = cascadePass(
      createElementBox("p", { display: "block", whiteSpace: "break-spaces", textAlign: "center" }, [
        createTextBox("t", {}, "hi" + " ".repeat(20)),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, W), shaper, undefined);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const lines = out.children.filter((c): c is import("./layout-box").LineBox => c.type === "line");
    expect(lines).toHaveLength(1);
    const leaves = leavesOf(nth(lines, 0, "line"));
    // Under #333 the alignment offset rides on the children's inlineOffset
    // (the line spans full width). "hi" is centered within the line: x =
    // (W − contentWidth) / 2 = (80 − 16) / 2 = 32.
    const hiLeaf = leaves.find(l => l.text.includes("hi"));
    expect(hiLeaf?.x).toBe((W - 16) / 2);
    // Every space box (line-relative) stays within the line content edge — the
    // hung run clamps to lineInlineSize regardless of alignment.
    const spaceLeaves = leaves.filter(l => /^\s+$/.test(l.text));
    expect(spaceLeaves.length).toBeGreaterThan(0);
    for (const sp of spaceLeaves) {
      expect(sp.x + sp.width).toBeLessThanOrEqual(W + EPS);
    }
  });
});

describe("IFC — hung-space CLAMP inside an INLINE element (#340: clamp the PHYSICAL position, not the inner-relative one)", () => {
  // #338 P2 clamped a hung SPACE box at the TOP inline level using its
  // line-relative `cursorInlineOffset`. A space INSIDE a `display:inline`
  // element (e.g. `<em>bbbb    </em>` at the line edge) is built by a RECURSIVE
  // call that restarts `cursorInlineOffset` at 0, so its clamp compared an
  // INNER-relative offset against `lineInlineSize` and MISSED — the inner space
  // box (and the InlineBox enclosing it) extended physically past the content
  // edge. #340 threads the PHYSICAL origin into the recursion so the clamp uses
  // `originInlineOffset + cursorInlineOffset`.
  //
  // PHYSICAL collector: a nested text-run's `x` is RELATIVE to its parent
  // InlineBox, so the physical line-relative position is the sum of the ancestor
  // InlineBox `x`s plus the leaf `x`. (The flat-line `leavesOf` above reads
  // `b.x` directly, which is only correct when there are no inline ancestors.)
  function physicalLeavesOf(line: import("./layout-box").LineBox) {
    const out: { x: number; width: number; text: string; isSpace: boolean }[] = [];
    const walk = (boxes: readonly import("./layout-box").LayoutBox[], originX: number) => {
      for (const b of boxes) {
        if (b.type === "text-run") {
          out.push({ x: originX + b.x, width: b.width, text: b.text, isSpace: /^\s+$/.test(b.text) });
        } else if (b.type === "inline") {
          walk(b.children, originX + b.x);
        }
      }
    };
    walk(line.children, 0);
    out.sort((a, b) => a.x - b.x);
    return out;
  }

  // Build a paragraph whose inline content is `[text("aaaa"), <inline em>"bbbb…"</inline>]`.
  function inlineWrappedLines(leadWord: string, emText: string, width: number) {
    const tree = cascadePass(
      createElementBox("p", { display: "block", whiteSpace: "break-spaces" }, [
        createTextBox("t1", {}, leadWord),
        createElementBox("em", { display: "inline" }, [
          createTextBox("t2", {}, emText),
        ]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, width), shaper, undefined);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const lines = out.children.filter((c): c is import("./layout-box").LineBox => c.type === "line");
    return { lines, lineInlineSize: width };
  }

  const EPS = 1e-6;

  it("NO inner space box extends physically past the content edge (RED before #340)", () => {
    // "aaaa" (32) + <em>"bbbb" (32) + 4 spaces</em> at width 72. "aaaa"+"bbbb"
    // = 64 fits; the em's first inner space natural [64,72) ends at the edge;
    // spaces #2-#4 are fully past 72. Before the fix the inner recursion clamped
    // using the INNER-relative offset (e.g. space #2 at inner offset 40 vs
    // lineInlineSize 72 → NOT clamped) so its physical box ran to 80/88/96.
    const { lines, lineInlineSize } = inlineWrappedLines("aaaa", "bbbb    ", 72);
    expect(lines).toHaveLength(1);
    const contentEdge = lineInlineSize;

    const leaves = physicalLeavesOf(nth(lines, 0, "line"));
    const spaceLeaves = leaves.filter(l => l.isSpace);
    expect(spaceLeaves.length).toBeGreaterThan(0);
    // The load-bearing guard: no SPACE box's physical right edge passes the line
    // content edge.
    for (const sp of spaceLeaves) {
      expect(sp.x).toBeLessThanOrEqual(contentEdge + EPS);
      expect(sp.x + sp.width).toBeLessThanOrEqual(contentEdge + EPS);
    }
    // The words are unchanged: "aaaa" at physical 0, "bbbb" at physical 32.
    const aaaa = leaves.find(l => l.text === "aaaa");
    expect(aaaa?.x).toBe(0);
    const bbbb = leaves.find(l => l.text === "bbbb");
    expect(bbbb?.x).toBe(32);
  });

  it("the enclosing InlineBox does not extend physically past the content edge", () => {
    const { lines, lineInlineSize } = inlineWrappedLines("aaaa", "bbbb    ", 72);
    expect(lines).toHaveLength(1);
    const contentEdge = lineInlineSize;
    // Find the InlineBox (the <em>) and assert its physical right edge ≤ edge.
    const inlineBox = nth(lines, 0, "line").children.find(c => c.type === "inline");
    expect(inlineBox).toBeDefined();
    if (!inlineBox || inlineBox.type !== "inline") throw new Error("?");
    // The InlineBox's own `x` is line-relative (top level), so its physical right
    // edge is `x + width`.
    expect(inlineBox.x + inlineBox.width).toBeLessThanOrEqual(contentEdge + EPS);
  });

  it("interior inline spaces NOT past the edge keep natural width (not clamped)", () => {
    // "aaaa" (32) + <em>"b c"</em> at a WIDE line (200). The single interior
    // space inside the em is well within the edge → natural width 8, unclamped.
    const { lines } = inlineWrappedLines("aaaa", "b c", 200);
    expect(lines).toHaveLength(1);
    const leaves = physicalLeavesOf(nth(lines, 0, "line"));
    const interiorSpace = leaves.find(l => l.isSpace);
    expect(interiorSpace).toBeDefined();
    expect(interiorSpace?.width).toBe(8); // natural, not clamped to 0
  });

  it("an inline element with NO trailing-edge space is byte-identical (words never clamped)", () => {
    // `<em>bold</em>` mid-line: no space at the edge, so the fix is a no-op here.
    const { lines } = inlineWrappedLines("aaaa", "bold", 200);
    expect(lines).toHaveLength(1);
    const leaves = physicalLeavesOf(nth(lines, 0, "line"));
    expect(leaves.find(l => l.text === "aaaa")?.x).toBe(0);
    const bold = leaves.find(l => l.text === "bold");
    expect(bold?.x).toBe(32);   // physical, right after "aaaa"
    expect(bold?.width).toBe(32);
  });
});

describe("IFC — normal-mode wrap UNAFFECTED by the space-unit hang (#338 P1 no-regression)", () => {
  // Under white-space:normal a trailing space is SLURPED into the preceding
  // word's unit (NOT a standalone space unit), so `isSpaceUnit` is false and the
  // hang gate never fires — words wrap exactly as before.
  it("normal-mode wrapping is byte-identical (trailing-space collapse unchanged)", () => {
    // ifcOf uses white-space:normal (no pin). "hello world" at 50px: "hello"
    // (40) fits, "world" wraps (the slurped "hello " unit + "world" word).
    const lines = ifcOf("hello world", 50);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const line0 = nth(lines, 0, "line");
    if (line0.type !== "line") throw new Error("?");
    if (nth(lines, 1, "line").type !== "line") throw new Error("?");
    const text0: string[] = [];
    const walk = (boxes: readonly import("./layout-box").LayoutBox[]) => {
      for (const b of boxes) {
        if (b.type === "text-run") text0.push(b.text);
        else if (b.type === "inline") walk(b.children);
      }
    };
    walk(line0.children);
    // Collapsing mode: "hello" on line 1 (trailing space collapsed at wrap).
    expect(text0.join("").trim()).toBe("hello");
  });
});

describe("IFC — default pipeline now break-spaces (#314)", () => {
  it("interior spaces still render under the document default", () => {
    // No explicit white-space pin → document root default (now break-spaces).
    const tree = cascadePass(
      createElementBox("doc", { display: "block", whiteSpace: "break-spaces" }, [
        createElementBox("p", { display: "block" }, [
          createTextBox("t", {}, "a  b"),
        ]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    // Find the line within the nested paragraph block.
    const lines: import("./layout-box").LineBox[] = [];
    const collect = (boxes: readonly import("./layout-box").LayoutBox[]) => {
      for (const b of boxes) {
        if (b.type === "line") lines.push(b);
        else if (b.type === "block") collect(b.children);
      }
    };
    collect(out.children);
    expect(lines).toHaveLength(1);
    // "a" + 2 spaces + "b" = 4 chars, all preserved.
    expect(nth(lines, 0, "line").inlineOffsetEnd).toBe(4);
  });
});

describe("IFC — first-class inline boxes", () => {
  it("produces an InlineBox for a display:inline child", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t1", {}, "before "),
        createElementBox("span", { display: "inline", color: "red" }, [
          createTextBox("t2", {}, "middle"),
        ]),
        createTextBox("t3", {}, " after"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r4 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r4.box === null) throw new Error("layoutBlock returned null box");
    const out = r4.box;
    if (out.type !== "block") throw new Error("?");
    const line = nth(out.children, 0, "line");
    if (line.type !== "line") throw new Error("?");

    const inlineBox = line.children.find(c => c.type === "inline");
    expect(inlineBox).toBeDefined();
    if (!inlineBox || inlineBox.type !== "inline") throw new Error("?");
    expect(inlineBox.computedStyle.color).toBe("red");
    // For B.2, fragmentEdge is hardcoded "only"; B.3 fixes cross-line resolution.
    expect(inlineBox.fragmentEdge).toBe("only");
  });

  it("inline children content is inside the InlineBox", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createElementBox("span", { display: "inline" }, [
          createTextBox("t", {}, "hello"),
        ]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r5 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r5.box === null) throw new Error("layoutBlock returned null box");
    const out = r5.box;
    if (out.type !== "block") throw new Error("?");
    const line = nth(out.children, 0, "line");
    if (line.type !== "line") throw new Error("?");
    const inlineBox = line.children.find(c => c.type === "inline");
    expect(inlineBox).toBeDefined();
    if (!inlineBox || inlineBox.type !== "inline") throw new Error("?");
    // The InlineBox should contain the text run for "hello"
    expect(inlineBox.children.length).toBeGreaterThan(0);
    const textRun = inlineBox.children.find(c => c.type === "text-run");
    expect(textRun).toBeDefined();
    if (!textRun || textRun.type !== "text-run") throw new Error("?");
    expect(textRun.text).toBe("hello");
  });
});

describe("IFC — inline-block atomic placement", () => {
  it("places an inline-block as a single atomic box on the line", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t1", {}, "before "),
        createElementBox("ib", { display: "inline-block", inlineSize: 50, blockSize: 30 }, []),
        createTextBox("t2", {}, " after"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r6 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r6.box === null) throw new Error("layoutBlock returned null box");
    const out = r6.box;
    if (out.type !== "block") throw new Error("?");
    const line = nth(out.children, 0, "line");
    if (line.type !== "line") throw new Error("?");
    const ib = line.children.find(c => c.type === "inline-block");
    expect(ib).toBeDefined();
    if (ib?.type !== "inline-block") throw new Error("?");
    expect(ib.width).toBe(50);
    expect(ib.height).toBe(30);
  });

  it("inline-block goes to next line if too wide", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t1", {}, "before "),
        createElementBox("ib", { display: "inline-block", inlineSize: 50, blockSize: 30 }, []),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r7 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 60), shaper, undefined);
    if (r7.box === null) throw new Error("layoutBlock returned null box");
    const out = r7.box;
    if (out.type !== "block") throw new Error("?");
    const lines = out.children.filter(c => c.type === "line");
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it("C-1: same-mode (vertical-lr) inline-block projects child PHYSICAL box onto the PARENT's axes (not raw bfc.width/height)", () => {
    // C-1 regression: the inline-block sizing site fed the PARENT IFC the child's
    // RAW physical bfc.width/bfc.height. For a vertical PARENT that transposes the
    // inline-advance and block-extent. The fix projects the child's physical box
    // onto the parent's inline/block axes via axisMapFor(parentWritingMode, ...).
    //
    // Setup: a vertical-lr paragraph (parent IFC) with an inline-block child that
    // inherits vertical-lr (same-mode). The child uses auto inlineSize + auto
    // blockSize so BOTH final sizes flow from the child's laid-out box — exercising
    // the projection on both axes. Its content "abc" makes the child's physical
    // width (block extent = line-height) differ from its physical height (inline
    // extent = content advance), so a transposition is observable.
    const vlrCs = { ...INITIAL_COMPUTED_STYLE, writingMode: "vertical-lr" as const };

    const tree = cascadePass(
      createElementBox("p", { display: "block", writingMode: "vertical-lr" }, [
        createElementBox("ib", { display: "inline-block" }, [
          createTextBox("ibt", {}, "abc"),
        ]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");

    // Lay out the inline content in a vertical-lr PARENT context (production path).
    const ctx = makeRootContext(vlrCs, 500);
    const res = layoutInlineContent(tree, 0, 0, ctx, shaper, undefined, 0);
    if (res.box === null || res.box.type !== "block") throw new Error("?");
    const line = res.box.children.find(c => c.type === "line");
    if (line === undefined || line.type !== "line") throw new Error("?");
    const ib = line.children.find(c => c.type === "inline-block");
    expect(ib).toBeDefined();
    if (ib?.type !== "inline-block") throw new Error("?");

    // The inline-block child laid out in its OWN (vertical-lr) mode has PHYSICAL
    // extents: width === its block extent (one line-height: mock 16px), height ===
    // its inline extent (content advance: mock 8px × "abc" = 24px). These are the
    // raw bfc.width (16) / bfc.height (24) the buggy code fed straight to the parent.
    const EXPECTED_CONTENT_ADVANCE = 24; // child's own inlineSize  → child physical HEIGHT (bfc.height)
    const EXPECTED_LINE_HEIGHT = 16;     // child's own blockSize   → child physical WIDTH  (bfc.width)
    expect(EXPECTED_CONTENT_ADVANCE).not.toBe(EXPECTED_LINE_HEIGHT); // transposition is observable

    // The inline-block box's LOGICAL inlineSize is the parent inline advance
    // (finalInlineSize); its LOGICAL blockSize is the parent block extent
    // (finalBlockSize). For a vertical-lr PARENT, axisMapFor maps inline→y and
    // block→x, so the CORRECT projection is:
    //   parent inline advance (inlineSize) = child physical HEIGHT = content advance (24)
    //   parent block extent   (blockSize)  = child physical WIDTH  = line-height   (16)
    // The raw bfc.width/bfc.height code transposed these (inlineSize=16, blockSize=24),
    // which this asserts AGAINST.
    expect(ib.inlineSize).toBe(EXPECTED_CONTENT_ADVANCE);
    expect(ib.blockSize).toBe(EXPECTED_LINE_HEIGHT);
    // Explicitly lock the NOT-transposed contract (would have been swapped by the bug).
    expect(ib.inlineSize).not.toBe(EXPECTED_LINE_HEIGHT);
    expect(ib.blockSize).not.toBe(EXPECTED_CONTENT_ADVANCE);
  });
});

describe("IFC — line TextRunBox carries sourceStart + clusterWidths (P4-C bidi-split inputs)", () => {
  // Collect text-run leaves of a line (recursing into inline boxes).
  function textRunLeaves(line: import("./layout-box").LayoutBox): import("./layout-box").TextRunBox[] {
    const out: import("./layout-box").TextRunBox[] = [];
    const walk = (b: import("./layout-box").LayoutBox): void => {
      if (b.type === "text-run") { out.push(b); return; }
      if (b.type === "inline" || b.type === "inline-block") b.children.forEach(walk);
    };
    if (line.type === "line") line.children.forEach(walk);
    return out;
  }

  it("a single-line run starting at source offset 0 has sourceStart 0 and clusterWidths.length === text.length", () => {
    const lines = ifcOf("hello", 500);
    expect(lines).toHaveLength(1);
    const runs = textRunLeaves(nth(lines, 0, "line")).filter(r => r.text.length > 0);
    expect(runs.length).toBeGreaterThanOrEqual(1);
    const run = nth(runs, 0, "run");
    expect(run.sourceStart).toBe(0);
    expect(run.clusterWidths).toBeDefined();
    if (run.clusterWidths === undefined) throw new Error("?");
    expect(run.clusterWidths.length).toBe(run.text.length);
    // Each non-grapheme-interior cluster carries the full advance; sum equals the run's inline advance.
    const sum = run.clusterWidths.reduce((s, w) => s + w, 0);
    expect(sum).toBeCloseTo(run.inlineSize, 5);
  });

  it("a later word's run has sourceStart equal to its absolute source offset", () => {
    // "ab cd": the second word begins at source offset 3.
    const lines = ifcOf("ab cd", 500);
    expect(lines).toHaveLength(1);
    const runs = textRunLeaves(nth(lines, 0, "line"));
    // Find the run whose text starts with the second word.
    const second = runs.find(r => r.text.startsWith("cd"));
    expect(second).toBeDefined();
    if (second === undefined) throw new Error("?");
    expect(second.sourceStart).toBe(3);
    if (second.clusterWidths === undefined) throw new Error("?");
    expect(second.clusterWidths.length).toBe(second.text.length);
  });

  it("a run that absorbs a TRAILING SPACE token synthesizes a clusterWidth for the whitespace (length === text.length)", () => {
    // A merged word+trailing-space run: the wrap unit packs the word and its
    // following space token together, exercising the whitespace-synthesis path
    // (space tokens carry no token-level clusterWidths).
    const lines = ifcOf("foo bar", 500);
    expect(lines).toHaveLength(1);
    const runs = textRunLeaves(nth(lines, 0, "line"));
    // The first wrap unit is "foo " (word + trailing space) — find a run whose
    // text contains a space.
    const spaced = runs.find(r => /\s/.test(r.text));
    expect(spaced).toBeDefined();
    if (spaced === undefined) throw new Error("?");
    expect(spaced.clusterWidths).toBeDefined();
    if (spaced.clusterWidths === undefined) throw new Error("?");
    // Invariant: one entry per DISPLAY code unit of the box text.
    expect(spaced.clusterWidths.length).toBe(spaced.text.length);
    // Sum of synthesized + real cluster widths ≈ the run's inline advance.
    const sum = spaced.clusterWidths.reduce((s, w) => s + w, 0);
    expect(sum).toBeCloseTo(spaced.inlineSize, 5);
  });

  it("an InlineBlockBox carries sourceStart = its OBJECT_REPLACEMENT source offset", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t1", {}, "ab "),
        createElementBox("ib", { display: "inline-block", inlineSize: 50, blockSize: 30 }, []),
        createTextBox("t2", {}, " cd"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r.box === null || r.box.type !== "block") throw new Error("?");
    const line = r.box.children.find(c => c.type === "line");
    if (line === undefined || line.type !== "line") throw new Error("?");
    const ib = line.children.find(c => c.type === "inline-block");
    expect(ib).toBeDefined();
    if (ib?.type !== "inline-block") throw new Error("?");
    // "ab " is source offsets 0..2 (3 chars); the OBJECT_REPLACEMENT char is at offset 3.
    expect(ib.sourceStart).toBe(3);
  });

  it("an InlineBlockBox carries metadata.targetId, surviving a bidi rebuild (#522 PDF /GoTo)", () => {
    // A cross-reference atom renders as an inline-block ElementBox carrying
    // `metadata.targetId` (the destination heading id; stamped by the render
    // cross-ref branch in all ref modes — Task 1). The layout emit site must
    // thread that id onto `InlineBlockBox.targetId` so the PDF exporter can emit
    // an internal /GoTo link, and every rebuild must copy it verbatim.
    const headingId = "heading-7";
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t1", {}, "see "),
        createElementBox(
          "xref",
          { display: "inline-block", inlineSize: 20, blockSize: 16 },
          [],
          { targetId: headingId },
        ),
        createTextBox("t2", {}, " above"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r.box === null || r.box.type !== "block") throw new Error("?");
    const line = r.box.children.find(c => c.type === "line");
    if (line === undefined || line.type !== "line") throw new Error("?");
    const ib = line.children.find(c => c.type === "inline-block");
    expect(ib).toBeDefined();
    if (ib?.type !== "inline-block") throw new Error("?");
    expect(ib.targetId).toBe(headingId);

    // Survives a rebuild: the bidi reorder rebuilds the box via withBidiLevel,
    // which must copy targetId verbatim (per-box identity metadata, opaque to
    // geometry — like sourceStart / inlineMeta).
    const rebuilt = withBidiLevel(ib, 1, ib.inlineSize);
    if (rebuilt.type !== "inline-block") throw new Error("?");
    expect(rebuilt.targetId).toBe(headingId);
  });
});

describe("IFC — fragmentEdge across lines", () => {
  it("first-line fragment has fragmentEdge='first', last-line has 'last'", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createElementBox("span", { display: "inline", backgroundColor: "yellow" }, [
          createTextBox("t", {}, "long content that wraps across at least three lines"),
        ]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r8 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 60), shaper, undefined);
    if (r8.box === null) throw new Error("layoutBlock returned null box");
    const out = r8.box;
    if (out.type !== "block") throw new Error("?");
    const lines = out.children.filter(c => c.type === "line");
    expect(lines.length).toBeGreaterThanOrEqual(2);

    // First line: inline fragment should be "first"
    if (nth(lines, 0, "line").type !== "line") throw new Error("?");
    const firstInline = nth(lines, 0, "line").children.find(c => c.type === "inline");
    expect(firstInline?.type).toBe("inline");
    if (firstInline?.type === "inline") {
      expect(firstInline.fragmentEdge).toBe("first");
    }

    // Last line: inline fragment should be "last"
    const lastLine = nth(lines, lines.length - 1, "line");
    if (lastLine.type !== "line") throw new Error("?");
    const lastInline = lastLine.children.find(c => c.type === "inline");
    expect(lastInline?.type).toBe("inline");
    if (lastInline?.type === "inline") {
      expect(lastInline.fragmentEdge).toBe("last");
    }
  });

  it("inline on a single line has fragmentEdge='only'", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t1", {}, "x "),
        createElementBox("span", { display: "inline" }, [
          createTextBox("t2", {}, "y"),
        ]),
        createTextBox("t3", {}, " z"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r9 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r9.box === null) throw new Error("layoutBlock returned null box");
    const out = r9.box;
    if (out.type !== "block") throw new Error("?");
    const line = nth(out.children, 0, "line");
    if (line.type !== "line") throw new Error("?");
    const inlineBox = line.children.find(c => c.type === "inline");
    if (inlineBox?.type !== "inline") throw new Error("?");
    expect(inlineBox.fragmentEdge).toBe("only");
  });

  // L-C / A3 regression: pre-fix `extractAncestorKey` used
  // `lastIndexOf("-")` on a key like
  // `<parent>-l<i>-i<idx>-<ancestorKey>`. When `ancestorKey` itself
  // contained dashes (compound block / render-node IDs are common —
  // think UUIDs, hyphenated component-type-instance IDs, etc.), the
  // string-derived extraction returned only the trailing segment of
  // `ancestorKey`. Different fragments of the same inline element
  // were assigned different ancestor identifiers and consequently
  // each received `fragmentEdge: "only"` instead of "first"/"last".
  //
  // Post-fix: `InlineBox.ancestorKey` is stored explicitly at
  // construction time, so dashed keys are now handled losslessly.
  it("L-C: dashed ancestor keys group fragments correctly across lines", () => {
    // The span's key contains MULTIPLE dashes — pre-fix the ancestor
    // resolved to "id" (the trailing segment), so two line-fragments
    // wouldn't be recognized as siblings; each would be "only".
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createElementBox("span-with-many-dashes-in-id", { display: "inline" }, [
          createTextBox("t", {}, "long content that wraps across at least three lines"),
        ]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 60), shaper, undefined);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const lines = out.children.filter(c => c.type === "line");
    expect(lines.length).toBeGreaterThanOrEqual(2);

    // First line's inline fragment must be "first" (not "only").
    if (nth(lines, 0, "line").type !== "line") throw new Error("?");
    const firstInline = nth(lines, 0, "line").children.find(c => c.type === "inline");
    if (firstInline?.type !== "inline") throw new Error("?");
    expect(firstInline.fragmentEdge).toBe("first");
    expect(firstInline.ancestorKey).toBe("span-with-many-dashes-in-id");

    // Last line's inline fragment must be "last" (not "only").
    const lastLine = nth(lines, lines.length - 1, "line");
    if (lastLine.type !== "line") throw new Error("?");
    const lastInline = lastLine.children.find(c => c.type === "inline");
    if (lastInline?.type !== "inline") throw new Error("?");
    expect(lastInline.fragmentEdge).toBe("last");
    expect(lastInline.ancestorKey).toBe("span-with-many-dashes-in-id");
  });
});

describe("IFC — verticalAlign", () => {
  it("inline-block with verticalAlign top is at line top", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t", {}, "x"),
        createElementBox("ib", {
          display: "inline-block", inlineSize: 20, blockSize: 50, verticalAlign: "top",
        }, []),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r10 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r10.box === null) throw new Error("layoutBlock returned null box");
    const out = r10.box;
    if (out.type !== "block") throw new Error("?");
    const line = nth(out.children, 0, "line");
    if (line.type !== "line") throw new Error("?");
    const ib = line.children.find(c => c.type === "inline-block");
    if (ib?.type !== "inline-block") throw new Error("?");
    expect(ib.y).toBe(0);
  });

  it("inline-block with verticalAlign bottom is at line bottom", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createElementBox("ib", {
          display: "inline-block", inlineSize: 20, blockSize: 30, verticalAlign: "bottom",
        }, []),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r11 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r11.box === null) throw new Error("layoutBlock returned null box");
    const out = r11.box;
    if (out.type !== "block") throw new Error("?");
    const line = nth(out.children, 0, "line");
    if (line.type !== "line") throw new Error("?");
    const ib = line.children.find(c => c.type === "inline-block");
    if (ib?.type !== "inline-block") throw new Error("?");
    // ib should sit at the bottom of the line
    expect(ib.y).toBe(line.height - ib.height);
  });

  it("inline-block with verticalAlign middle is centered", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createElementBox("ib", {
          display: "inline-block", inlineSize: 20, blockSize: 30, verticalAlign: "middle",
        }, []),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r12 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r12.box === null) throw new Error("layoutBlock returned null box");
    const out = r12.box;
    if (out.type !== "block") throw new Error("?");
    const line = nth(out.children, 0, "line");
    if (line.type !== "line") throw new Error("?");
    const ib = line.children.find(c => c.type === "inline-block");
    if (ib?.type !== "inline-block") throw new Error("?");
    expect(ib.y).toBe((line.height - ib.height) / 2);
  });

  it("L-A: verticalAlign bottom updates BOTH blockOffset and y consistently (no frozen-box invariant violation)", () => {
    // Regression test for the A2 bug: ifc.ts applyVerticalAlign spread-patched
    // `y` while leaving `blockOffset` stale at 0. Cursor / hit-test code that
    // read `blockOffset` saw 0, while painter that read `y` saw the aligned
    // value — different positions for the same box. Both must agree now.
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createElementBox("ib", {
          display: "inline-block", inlineSize: 20, blockSize: 30, verticalAlign: "bottom",
        }, []),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const line = nth(out.children, 0, "line");
    if (line.type !== "line") throw new Error("?");
    const ib = line.children.find(c => c.type === "inline-block");
    if (ib?.type !== "inline-block") throw new Error("?");
    // Expected aligned position: line.height - ib.height. blockOffset is the
    // logical field; under horizontal-tb LTR it equals y.
    const expectedOffset = line.blockSize - ib.blockSize;
    expect(ib.blockOffset).toBe(expectedOffset);
    expect(ib.y).toBe(expectedOffset);
    expect(ib.blockOffset).toBe(ib.y);
  });

  it("L-A: verticalAlign middle updates BOTH blockOffset and y consistently", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createElementBox("ib", {
          display: "inline-block", inlineSize: 20, blockSize: 30, verticalAlign: "middle",
        }, []),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const line = nth(out.children, 0, "line");
    if (line.type !== "line") throw new Error("?");
    const ib = line.children.find(c => c.type === "inline-block");
    if (ib?.type !== "inline-block") throw new Error("?");
    const expectedOffset = (line.blockSize - ib.blockSize) / 2;
    expect(ib.blockOffset).toBe(expectedOffset);
    expect(ib.y).toBe(expectedOffset);
  });

  it("T2: a REPLACED inline-block (metadata.replacedInline) sits its BOTTOM edge on the text baseline (CSS2 §10.8.1); a text-bearing one keeps the *0.8 rule", () => {
    // CSS2 §10.8.1: a replaced inline-block with no in-flow line boxes (an image
    // has no text baseline) aligns its BOTTOM margin edge with the parent's
    // baseline. We approximate the text baseline at lineBlockSize*0.8 (the same
    // anchor `baselineBlockOffset` uses), so the replaced box's blockOffset is
    // `lineBlockSize*0.8 − blockSize` (whole box above the baseline). A
    // text-bearing inline-block (e.g. a footnote marker) keeps the *0.8 content
    // baseline rule (`lineBlockSize*0.8 − blockSize*0.8`) UNCHANGED.
    const replacedBlockSize = 30;
    const textBearingBlockSize = 30;
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        // A short baseline-aligned text run to set the line's text metrics.
        createTextBox("base", {}, "x"),
        // The REPLACED inline-block (an image: no children, replacedInline flag).
        createElementBox(
          "img",
          { display: "inline-block", inlineSize: 20, blockSize: replacedBlockSize },
          [],
          { replacedInline: true },
        ),
        // A text-bearing inline-block WITHOUT the flag (footnote-marker-like).
        createElementBox(
          "marker",
          { display: "inline-block", inlineSize: 20, blockSize: textBearingBlockSize },
          [createTextBox("marker/t", {}, "1")],
        ),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const line = nth(out.children, 0, "line");
    if (line.type !== "line") throw new Error("?");
    const ibs = line.children.filter(c => c.type === "inline-block");
    const replaced = ibs.find(c => c.type === "inline-block" && c.isReplaced === true);
    const textBearing = ibs.find(c => c.type === "inline-block" && c.isReplaced !== true);
    if (replaced?.type !== "inline-block") throw new Error("replaced inline-block not found");
    if (textBearing?.type !== "inline-block") throw new Error("text-bearing inline-block not found");

    // Replaced: bottom-edge baseline → blockOffset = lineBlockSize*0.8 − blockSize.
    expect(replaced.blockOffset).toBe(line.blockSize * 0.8 - replaced.blockSize);
    expect(replaced.blockOffset).toBe(replaced.y);

    // Text-bearing: UNCHANGED *0.8 content-baseline rule.
    expect(textBearing.blockOffset).toBe(line.blockSize * 0.8 - textBearing.blockSize * 0.8);
    expect(textBearing.blockOffset).toBe(textBearing.y);

    // The flag survives a bidi rebuild (per-box identity, like targetId).
    const rebuilt = withBidiLevel(replaced, 1, replaced.inlineSize);
    if (rebuilt.type !== "inline-block") throw new Error("?");
    expect(rebuilt.isReplaced).toBe(true);
  });
});

describe("IFC — verticalAlign super / sub (true superscript / subscript)", () => {
  // Build a paragraph whose single line carries a baseline-aligned run plus a
  // sibling inline span with the given verticalAlign. Returns both line-level
  // boxes so geometry can be compared directly.
  function lineWithAlignedSpan(
    va: "super" | "sub" | "baseline",
    markFontSize?: number,
  ) {
    const markStyle: Parameters<typeof createElementBox>[1] =
      markFontSize === undefined
        ? { display: "inline", verticalAlign: va }
        : { display: "inline", verticalAlign: va, fontSize: markFontSize };
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("base", {}, "x"),
        createElementBox("mark", markStyle, [
          createTextBox("mark/t", {}, "1"),
        ]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const line = nth(out.children, 0, "line");
    if (line.type !== "line") throw new Error("?");
    const baseRun = line.children.find(c => c.type === "text-run");
    const markBox = line.children.find(c => c.type === "inline");
    if (baseRun === undefined) throw new Error("no baseline run");
    if (markBox === undefined) throw new Error("no aligned span box");
    return { line, baseRun, markBox };
  }

  it("super raises the box above the baseline sibling by SUPERSCRIPT_RAISE_FRACTION × font-size", () => {
    const { baseRun, markBox } = lineWithAlignedSpan("super");
    // The marker span shares the body font-size (INITIAL_COMPUTED_STYLE = 16),
    // so its baseline-aligned offset would equal the baseline run's; the super
    // shift is the ONLY difference.
    const fontSize = markBox.computedStyle.fontSize;
    const expected = baseRun.blockOffset - fontSize * SUPERSCRIPT_RAISE_FRACTION;
    expect(markBox.blockOffset).toBeCloseTo(expected, 6);
    // Raised => strictly ABOVE (smaller block-axis offset than) the baseline run.
    expect(markBox.blockOffset).toBeLessThan(baseRun.blockOffset);
    // logical↔physical agree (no frozen-box spread-patch).
    expect(markBox.blockOffset).toBe(markBox.y);
  });

  it("super raise uses the PARENT's font-size, not the child's (CSS Inline 3 — a <sup font-size:smaller> still raises full amount)", () => {
    // The marker span is a smaller font (8px) inside a 16px parent line — the
    // common <sup font-size: smaller> shape. Per CSS Inline 3 the raise is a
    // fraction of the PARENT's used font-size (16), NOT the child's (8). A
    // child-relative bug would raise by only 8 × fraction (half), under-raising
    // the superscript. Assert the raise magnitude is computed against 16.
    const PARENT_FONT_SIZE = 16; // INITIAL_COMPUTED_STYLE
    // The super shift = (the SAME small box's baseline offset) − (its super offset).
    // It must equal PARENT_FONT_SIZE × fraction, independent of the child's 8px.
    const superSmall = lineWithAlignedSpan("super", 8);
    const baselineSmall = lineWithAlignedSpan("baseline", 8);
    const shift = baselineSmall.markBox.blockOffset - superSmall.markBox.blockOffset;
    expect(shift).toBeCloseTo(PARENT_FONT_SIZE * SUPERSCRIPT_RAISE_FRACTION, 6);
    // A child-relative bug would give 8 × fraction (half); assert we're NOT that.
    expect(shift).not.toBeCloseTo(8 * SUPERSCRIPT_RAISE_FRACTION, 6);
  });

  it("sub lowers the box below the baseline sibling by SUBSCRIPT_LOWER_FRACTION × font-size", () => {
    const { baseRun, markBox } = lineWithAlignedSpan("sub");
    const fontSize = markBox.computedStyle.fontSize;
    const expected = baseRun.blockOffset + fontSize * SUBSCRIPT_LOWER_FRACTION;
    expect(markBox.blockOffset).toBeCloseTo(expected, 6);
    // Lowered => strictly BELOW (larger block-axis offset than) the baseline run.
    expect(markBox.blockOffset).toBeGreaterThan(baseRun.blockOffset);
    expect(markBox.blockOffset).toBe(markBox.y);
  });

  it("super / sub shift the baseline only — they do NOT change the box's size", () => {
    const baseline = lineWithAlignedSpan("baseline");
    const sup = lineWithAlignedSpan("super");
    const sub = lineWithAlignedSpan("sub");
    // Same content + same font-size => identical box dimensions; only position
    // differs. (super/sub are a pure block-axis shift, no resize.)
    expect(sup.markBox.inlineSize).toBe(baseline.markBox.inlineSize);
    expect(sup.markBox.blockSize).toBe(baseline.markBox.blockSize);
    expect(sub.markBox.inlineSize).toBe(baseline.markBox.inlineSize);
    expect(sub.markBox.blockSize).toBe(baseline.markBox.blockSize);
    // And the inline (horizontal) position is untouched by the vertical shift.
    expect(sup.markBox.inlineOffset).toBe(baseline.markBox.inlineOffset);
    expect(sub.markBox.inlineOffset).toBe(baseline.markBox.inlineOffset);
  });

  it("a baseline-aligned sibling is unaffected by a super sibling on the same line (regression)", () => {
    const baselineOnly = lineWithAlignedSpan("baseline");
    const withSuper = lineWithAlignedSpan("super");
    // The plain baseline run's position is identical whether its sibling is
    // baseline- or super-aligned.
    expect(withSuper.baseRun.blockOffset).toBe(baselineOnly.baseRun.blockOffset);
    expect(withSuper.baseRun.y).toBe(baselineOnly.baseRun.y);
  });
});

describe("IFC — text wraps around floats", () => {
  it("first lines have reduced width when a left float is active", () => {
    // Pre-populate the root context's float env with one left float.
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 200);
    ctx.floatEnv.placeFloat("inline-start", 0, 100, 50, 200);

    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t", {}, "this text should wrap to the right of the float on the first lines"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");

    const ifcResult = layoutInlineContent(tree, 0, 0, ctx, shaper, undefined, 0);
    if (ifcResult.box === null) throw new Error("layoutInlineContent returned null box");
    const lines = ifcResult.box.children;

    // The first line's content area should start at x=100 (after the float)
    // and have width 100 (200 - 100).
    expect(lines.length).toBeGreaterThan(0);
    if (nth(lines, 0, "line").type === "line") {
      expect(nth(lines, 0, "line").x).toBe(100);
      expect(nth(lines, 0, "line").width).toBe(100);
    }
  });

  it("lines past the float bottom return to full width", () => {
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 200);
    ctx.floatEnv.placeFloat("inline-start", 0, 100, 16, 200);

    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t", {}, "a b c d e f g h i j k l m n o p q r s t"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ifcResult2 = layoutInlineContent(tree, 0, 0, ctx, shaper, undefined, 0);
    if (ifcResult2.box === null) throw new Error("layoutInlineContent returned null box");
    const lines2 = ifcResult2.box.children;

    // Eventually some line is at y >= 16 and uses full width 200.
    const fullWidthLine = lines2.find((l) => l.type === "line" && l.y >= 16 && l.width === 200);
    expect(fullWidthLine).toBeDefined();
  });

  it("line pushes below float when inline-size insufficient for next token", () => {
    // mockShaper: 8px per char.  Text "abc" = 3 chars × 8px = 24px.
    // Float occupies the full 200px inline axis from block 0..50.
    // At block 0, lineInlineSize = 200 - 200 = 0, which is < 24px.
    // The IFC must push lineBlockOffset to 50 (the float's bottom edge).
    // At block 50, the float is gone → lineInlineSize = 200 ≥ 24px.
    // So the first (and only) line should be at y = 50.
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 200);
    ctx.floatEnv.placeFloat("inline-start", 0, 200, 50, 200);

    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t", {}, "abc"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");

    const ifcResult3 = layoutInlineContent(tree, 0, 0, ctx, shaper, undefined, 0);
    if (ifcResult3.box === null) throw new Error("layoutInlineContent returned null box");
    const lines3 = ifcResult3.box.children;

    expect(lines3.length).toBeGreaterThan(0);
    const firstLine = nth(lines3, 0, "line");
    expect(firstLine.y).toBe(50);
    if (firstLine.type === "line") {
      expect(firstLine.width).toBe(200);
    }
  });
});

describe("IFC — RTL bidi reordering", () => {
  it("RTL paragraph: Latin runs stay in logical order but the content block hugs the RIGHT edge (PHYSICAL x)", () => {
    // mockShaper(8, 16): each char is 8px wide.
    // "abc" = 3 chars = 24px; "def" = 3 chars = 24px. Line = 200px.
    // Two LATIN runs in an RTL paragraph resolve to bidi LEVEL 2 (LTR embedded
    // in RTL) — UAX #9 L2 does NOT swap equal-level runs, so logical order
    // [t1, t2] is preserved. The whole content block (48px) then hugs the RIGHT
    // edge of the 200px line. Asserting PHYSICAL x per the P4-C coordinate
    // contract: reordered boxes are ltr-positioned so `x === inlineOffset`.
    //   contentWidth = 48; physicalStart (rtl, start-align) = 200 - 0 - 48 = 152.
    //   t1.x = 152 (left of the block); t2.x = 152 + 24 = 176 (right edge at 200).
    const rtlShaper = createMockShaper(8, 16);
    const tree = cascadePass(
      createElementBox("p", { display: "block", direction: "rtl" }, [
        createTextBox("t1", {}, "abc"),
        createTextBox("t2", {}, "def"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ifcResultRtl = layoutInlineContent(
      tree,
      0, 0,
      makeRootContext({ ...INITIAL_COMPUTED_STYLE, direction: "rtl" }, 200),
      rtlShaper, undefined
    , 0);
    if (ifcResultRtl.box === null) throw new Error("layoutInlineContent returned null box");
    const linesRtl = ifcResultRtl.box.children;

    expect(linesRtl.length).toBeGreaterThan(0);
    const line = nth(linesRtl, 0, "line");
    if (line.type !== "line") throw new Error("expected line box");
    expect(line.children.length).toBeGreaterThanOrEqual(2);

    // Find the two text-run boxes by key prefix (t1 and t2).
    const t1Box = line.children.find(c => c.key.startsWith("t1"));
    const t2Box = line.children.find(c => c.key.startsWith("t2"));
    expect(t1Box).toBeDefined();
    expect(t2Box).toBeDefined();
    if (!t1Box || !t2Box) throw new Error("?");

    // PHYSICAL x: reordered boxes are identity-positioned (x === inlineOffset).
    expect(t1Box.x).toBe(t1Box.inlineOffset);
    expect(t2Box.x).toBe(t2Box.inlineOffset);
    // Logical order preserved (Latin level-2 runs don't swap): t1 left of t2.
    expect(t1Box.x).toBe(152);
    expect(t2Box.x).toBe(176);
    // The content block hugs the RIGHT edge: rightmost box's right edge == line size.
    expect(t2Box.x + t2Box.inlineSize).toBe(200);
    // Leftmost box sits at lineInlineSize − contentWidth.
    expect(t1Box.x).toBe(200 - (t1Box.inlineSize + t2Box.inlineSize));
  });

  it("RTL paragraph with two HEBREW runs: logical-first is RIGHTMOST (level-1 runs swap, PHYSICAL x)", () => {
    // Two real-RTL (Hebrew) runs in an RTL paragraph → both bidi LEVEL 1.
    // UAX #9 L2 reverses equal odd-level runs, so visual order is [t2, t1]:
    // the logically-FIRST run (t1) ends up RIGHTMOST. 8px/char, 3 chars each.
    //   visual pack: t2@0 (24px), t1@24 (24px); contentWidth 48.
    //   physicalStart (rtl) = 200 - 0 - 48 = 152.
    //   t2.x = 152 (left); t1.x = 176 (right edge 200).
    const rtlShaper = createMockShaper(8, 16);
    const tree = cascadePass(
      createElementBox("p", { display: "block", direction: "rtl" }, [
        createTextBox("t1", {}, "אבג"),
        createTextBox("t2", {}, "דהו"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ifcResultRtl = layoutInlineContent(
      tree,
      0, 0,
      makeRootContext({ ...INITIAL_COMPUTED_STYLE, direction: "rtl" }, 200),
      rtlShaper, undefined
    , 0);
    if (ifcResultRtl.box === null) throw new Error("layoutInlineContent returned null box");
    const line = nth(ifcResultRtl.box.children, 0, "line");
    if (line.type !== "line") throw new Error("expected line box");

    const t1Box = line.children.find(c => c.key.startsWith("t1"));
    const t2Box = line.children.find(c => c.key.startsWith("t2"));
    if (!t1Box || !t2Box) throw new Error("?");

    // PHYSICAL identity.
    expect(t1Box.x).toBe(t1Box.inlineOffset);
    expect(t2Box.x).toBe(t2Box.inlineOffset);
    // Level-1 runs SWAP: logical-first (t1) is rightmost.
    expect(t2Box.x).toBe(152);
    expect(t1Box.x).toBe(176);
    expect(t1Box.x + t1Box.inlineSize).toBe(200); // hugs the right edge
  });

  it("LTR paragraph children are not reordered (identity pass)", () => {
    const ltrShaper = createMockShaper(8, 16);
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t1", {}, "abc"),
        createTextBox("t2", {}, "def"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ifcResultLtr = layoutInlineContent(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 200), ltrShaper, undefined, 0);
    if (ifcResultLtr.box === null) throw new Error("layoutInlineContent returned null box");
    const linesLtr = ifcResultLtr.box.children;

    expect(linesLtr.length).toBeGreaterThan(0);
    const line = nth(linesLtr, 0, "line");
    if (line.type !== "line") throw new Error("expected line box");

    const t1Box = line.children.find(c => c.key.startsWith("t1"));
    const t2Box = line.children.find(c => c.key.startsWith("t2"));
    expect(t1Box).toBeDefined();
    expect(t2Box).toBeDefined();
    if (!t1Box || !t2Box) throw new Error("?");

    // LTR: t1 comes before t2 in visual order (smaller inlineOffset).
    expect(t1Box.inlineOffset).toBeLessThan(t2Box.inlineOffset);
  });

  it("mixed LTR-base (Latin + embedded Hebrew): Hebrew run sits AFTER Latin, both at left, PHYSICAL x", () => {
    // LTR paragraph; child t1 = Latin "abc" (level 0), child t2 = Hebrew "אבג"
    // (level 1, a single embedded run). L2 does not move a single embedded run
    // relative to the surrounding level-0 text, so visual order is [Latin,
    // Hebrew]. LTR start-align → physicalStart 0 → content sits at the LEFT.
    //   t1.x = 0 (24px); t2.x = 24 (24px). Hebrew glyphs paint RTL via bidiLevel
    //   (T7); geometry here is the run placement only.
    const rtlShaper = createMockShaper(8, 16);
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t1", {}, "abc"),
        createTextBox("t2", {}, "אבג"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const result = layoutInlineContent(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 200), rtlShaper, undefined, 0);
    if (result.box === null) throw new Error("null box");
    const line = nth(result.box.children, 0, "child");
    if (line.type !== "line") throw new Error("expected line");
    const t1 = line.children.find(c => c.key.startsWith("t1"));
    const t2 = line.children.find(c => c.key.startsWith("t2"));
    if (!t1 || !t2) throw new Error("?");

    expect(t1.x).toBe(t1.inlineOffset);
    expect(t2.x).toBe(t2.inlineOffset);
    expect(t1.x).toBe(0);    // Latin at the left
    expect(t2.x).toBe(24);   // Hebrew right after Latin
    // The run stamped bidiLevel: Latin 0, Hebrew 1 (used by the T7 glyph paint).
    if (t1.type !== "text-run" || t2.type !== "text-run") throw new Error("?");
    expect(t1.bidiLevel).toBe(0);
    expect(t2.bidiLevel).toBe(1);
  });

  it("mixed RTL-base (Hebrew + embedded Latin): the Latin run reorders to the LEFT, content hugs right, PHYSICAL x", () => {
    // RTL paragraph; child t1 = Hebrew "אבג" (level 1), child t2 = Latin "abc"
    // (level 2). UAX #9 L2 over [1,2] reverses the level-2 run then the level-1
    // span → visual order is [Latin, Hebrew] (the Latin embedded run lands to the
    // LEFT of the Hebrew). The 48px block hugs the RIGHT edge.
    //   physicalStart (rtl) = 200 - 0 - 48 = 152.
    //   Latin (t2).x = 152; Hebrew (t1).x = 176 (right edge 200).
    const rtlShaper = createMockShaper(8, 16);
    const tree = cascadePass(
      createElementBox("p", { display: "block", direction: "rtl" }, [
        createTextBox("t1", {}, "אבג"),
        createTextBox("t2", {}, "abc"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const result = layoutInlineContent(
      tree, 0, 0,
      makeRootContext({ ...INITIAL_COMPUTED_STYLE, direction: "rtl" }, 200),
      rtlShaper, undefined
    , 0);
    if (result.box === null) throw new Error("null box");
    const line = nth(result.box.children, 0, "child");
    if (line.type !== "line") throw new Error("expected line");
    const t1 = line.children.find(c => c.key.startsWith("t1"));
    const t2 = line.children.find(c => c.key.startsWith("t2"));
    if (!t1 || !t2) throw new Error("?");

    expect(t1.x).toBe(t1.inlineOffset);
    expect(t2.x).toBe(t2.inlineOffset);
    // Latin (t2) reorders to the LEFT of Hebrew (t1).
    expect(t2.x).toBe(152);
    expect(t1.x).toBe(176);
    expect(t1.x + t1.inlineSize).toBe(200); // content hugs the right edge
    if (t1.type !== "text-run" || t2.type !== "text-run") throw new Error("?");
    expect(t1.bidiLevel).toBe(1); // Hebrew
    expect(t2.bidiLevel).toBe(2); // Latin embedded in RTL
  });

  it("centered RTL line: alignment is applied PHYSICALLY (physicalStart === gap/2), not zeroed nor double-shifted", () => {
    // Centered (text-align:center) RTL paragraph with two Hebrew runs (level 1).
    // contentWidth = 48; gap = 200 - 48 = 152; center alignmentOffset = gap/2 = 76.
    // For center, physicalStart === gap/2 in EITHER direction (the contract's
    // worked example). The first VISUAL box therefore starts at x = 76.
    //   level-1 runs swap → visual [t2, t1]: t2.x = 76, t1.x = 100.
    const rtlShaper = createMockShaper(8, 16);
    const tree = cascadePass(
      createElementBox("p", { display: "block", direction: "rtl", textAlign: "center" }, [
        createTextBox("t1", {}, "אבג"),
        createTextBox("t2", {}, "דהו"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const result = layoutInlineContent(
      tree, 0, 0,
      makeRootContext({ ...INITIAL_COMPUTED_STYLE, direction: "rtl", textAlign: "center" }, 200),
      rtlShaper, undefined
    , 0);
    if (result.box === null) throw new Error("null box");
    const line = nth(result.box.children, 0, "child");
    if (line.type !== "line") throw new Error("expected line");
    const t1 = line.children.find(c => c.key.startsWith("t1"));
    const t2 = line.children.find(c => c.key.startsWith("t2"));
    if (!t1 || !t2) throw new Error("?");

    expect(t1.x).toBe(t1.inlineOffset);
    expect(t2.x).toBe(t2.inlineOffset);
    // The leftmost (visual-first) box starts at gap/2 = 76 — alignment is
    // physical, not zeroed (would be 0) and not double-shifted.
    const leftmost = Math.min(t1.x, t2.x);
    expect(leftmost).toBe(76);
    // level-1 swap: t2 visual-first (left), t1 right.
    expect(t2.x).toBe(76);
    expect(t1.x).toBe(100);
    // The content is centered: equal gap on both sides (76 left, 76 right).
    expect(t1.x + t1.inlineSize).toBe(124);
    expect(200 - (t1.x + t1.inlineSize)).toBe(76);
  });
});

describe("deriveLineSourceRangeU16 (P4-C.1 T3: line's half-open U16 source span)", () => {
  // Build a minimal wrap-unit-shaped object: the helper reads only
  // tokens[].absoluteSourceBase and tokens[].text (the LineRangeUnit shape).
  function unit(...tokens: { absoluteSourceBase: number; text: string }[]): LineRangeUnit {
    return { tokens };
  }

  it("multi-unit line: start = first token base, end = last token base + display length (EXCLUSIVE)", () => {
    // Two units: ["ab"]@0 then ["cd"]@3 → covers [0, 5): one-past the last char.
    const range = deriveLineSourceRangeU16([
      unit({ absoluteSourceBase: 0, text: "ab" }),
      unit({ absoluteSourceBase: 3, text: "cd" }),
    ]);
    expect(range).not.toBeNull();
    expect(range?.startU16).toBe(0);
    // Exclusive end: 3 (last token base) + 2 ("cd".length) = 5, NOT 4 (the last
    // char's index). This is the half-open [start, end) contract.
    expect(range?.endU16).toBe(5);
  });

  it("trailing whitespace extends the EXCLUSIVE end by the space's DISPLAY extent", () => {
    // Source "ab cd " (length 6) — the trailing space is its own unit under a
    // preserving mode. Units: ["ab"]@0, [" "]@2, ["cd"]@3, [" "]@5. The end must
    // include the trailing space's display extent → 5 + 1 = 6 = source.length.
    const range = deriveLineSourceRangeU16([
      unit({ absoluteSourceBase: 0, text: "ab" }),
      unit({ absoluteSourceBase: 2, text: " " }),
      unit({ absoluteSourceBase: 3, text: "cd" }),
      unit({ absoluteSourceBase: 5, text: " " }),
    ]);
    expect(range?.startU16).toBe(0);
    // EXCLUSIVE end includes the trailing whitespace by display extent → for a
    // single-line paragraph this equals source.length ("ab cd ".length === 6).
    expect(range?.endU16).toBe(6);
    expect("ab cd ".length).toBe(6);
  });

  it("empty / strut-only line (no units, or empty-tokens unit) → null", () => {
    expect(deriveLineSourceRangeU16([])).toBeNull();
    // A degenerate empty-tokens unit contributes no real token → still null.
    expect(deriveLineSourceRangeU16([{ tokens: [] }])).toBeNull();
  });

  it("single-line LTR paragraph: end equals the assembled source length (integration)", () => {
    // Lay out a real LTR paragraph WITH a trailing space under break-spaces
    // (preserves the trailing space as its own unit) and assert the derived
    // range spans the whole source. mockShaper(8,16): 8px/char, 500px width →
    // one line. Source "ab cd " has length 6.
    const tree = cascadePass(
      createElementBox("p", { display: "block", whiteSpace: "break-spaces" }, [
        createTextBox("t", {}, "ab cd "),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const tokens = collectTokens(tree, shaper, "ltr", makeRootContext(INITIAL_COMPUTED_STYLE, 500).intrinsicCache);
    // Build one "line" worth of units from the flat tokens (every token on the
    // single line). The derived end must be the source length (6).
    const range = deriveLineSourceRangeU16(tokens.map(t => ({ tokens: [t] })));
    expect(range?.startU16).toBe(0);
    expect(range?.endU16).toBe(6);
  });
});

describe("IFC — P4-C.1 T3 paragraphBidi plumbing (fast path + no behavior change)", () => {
  it("pure-LTR paragraph lays out identically (fast path → identity reorder)", () => {
    // The fast path (LTR paragraph, no RTL codepoint in the line) returns the
    // children unchanged — same geometry as before P4-C plumbing landed.
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t1", {}, "abc"),
        createTextBox("t2", {}, "def"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const result = layoutInlineContent(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 200), shaper, undefined, 0);
    if (result.box === null) throw new Error("null box");
    const line = nth(result.box.children, 0, "child");
    if (line.type !== "line") throw new Error("expected line");
    const t1 = line.children.find(c => c.key.startsWith("t1"));
    const t2 = line.children.find(c => c.key.startsWith("t2"));
    if (!t1 || !t2) throw new Error("?");
    // LTR visual order preserved (identity): t1 before t2.
    expect(t1.inlineOffset).toBeLessThan(t2.inlineOffset);
    // t1 sits at the line start (offset 0) — not mirrored.
    expect(t1.inlineOffset).toBe(0);
  });

  it("RTL (Hebrew) paragraph skips the fast path (odd paragraphLevel) and reorders via the real UAX #9 pass", () => {
    // Hebrew text (real RTL codepoints) under an RTL paragraph base. The
    // paragraphLevel is odd (1) so the LTR fast path is skipped and the real
    // reorder runs. Proves resolveParagraphBidi integration produces PHYSICAL
    // (identity-positioned) geometry: the level-1 runs swap, content hugs right.
    const rtlShaper = createMockShaper(8, 16);
    const tree = cascadePass(
      createElementBox("p", { display: "block", direction: "rtl" }, [
        createTextBox("t1", {}, "אבג"), // אבג
        createTextBox("t2", {}, "דהו"), // דהו
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const result = layoutInlineContent(
      tree, 0, 0,
      makeRootContext({ ...INITIAL_COMPUTED_STYLE, direction: "rtl" }, 200),
      rtlShaper, undefined
    , 0);
    if (result.box === null) throw new Error("null box");
    const line = nth(result.box.children, 0, "child");
    if (line.type !== "line") throw new Error("expected line");
    const t1 = line.children.find(c => c.key.startsWith("t1"));
    const t2 = line.children.find(c => c.key.startsWith("t2"));
    if (!t1 || !t2) throw new Error("?");
    // PHYSICAL identity (reordered boxes are ltr-positioned).
    expect(t1.x).toBe(t1.inlineOffset);
    expect(t2.x).toBe(t2.inlineOffset);
    // Level-1 runs swap: logical-second (t2) is visually first (left); the
    // logically-first (t1) is rightmost, its right edge at the line size.
    expect(t2.x).toBe(152);
    expect(t1.x).toBe(176);
    expect(t1.x + t1.inlineSize).toBe(200);
  });

  it("empty paragraph (no source) lays out a strut without crash (paragraphBidi === null)", () => {
    const tree = cascadePass(createElementBox("p", { display: "block" }, []));
    if (tree.type !== "element") throw new Error("?");
    const result = layoutInlineContent(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 200), shaper, undefined, 0);
    if (result.box === null) throw new Error("null box");
    // One strut line, no crash.
    expect(result.box.children.length).toBe(1);
    expect(nth(result.box.children, 0, "child").type).toBe("line");
  });
});

describe("IFC — hyphen break (kind:hyphen interface reservation)", () => {
  /**
   * Inline shaper for hyphen tests: each char is one cluster, 10px wide.
   * Hard break at \n. Hyphen break after cluster index 5 (i.e. between
   * the 5th and 6th character) when the text is at least 6 chars long.
   */
  function shaperWithHyphen(): TextShaper {
    const fontMetrics: FontMetrics = { ascent: 12, descent: 4, lineGap: 0, capHeight: 11, xHeight: 7 };

    function shape(
      text: string,
      style: Readonly<ComputedStyle>,
      baseDirection: Direction,
    ): ShapedRun {
      const clusters: Cluster[] = [];
      for (let i = 0; i < text.length; i++) {
        clusters.push({
          start: i,
          end: i + 1,
          inlineAdvance: 10,
          isLigature: false,
          glyphs: [text.charCodeAt(i)],
        });
      }
      const breakOpportunities: BreakOpportunity[] = [];
      if (text.length >= 6) {
        // Hyphen break AFTER cluster index 4 (between chars 4 and 5, 0-based).
        // clusterIndex: 5 means "break before cluster 5", i.e. the prefix is [0,5).
        breakOpportunities.push({ clusterIndex: 5, kind: "hyphen" });
      }
      return {
        text,
        computedStyle: style,
        clusters,
        ascent: fontMetrics.ascent,
        descent: fontMetrics.descent,
        lineGap: fontMetrics.lineGap,
        minClusterInlineSize: text.length === 0 ? 0 : 10,
        unbreakableRunInlineSize: text.length * 10,
        breakOpportunities,
        bidiLevel: baseDirection === "rtl" ? 1 : 0,
      };
    }

    function measureFontMetrics(_style: Readonly<ComputedStyle>): FontMetrics {
      return fontMetrics;
    }

    return { shape, measureFontMetrics };
  }

  it("inserts hyphen glyph at break-of-kind-hyphen line end", () => {
    // Text: "abcdefgh" — 8 chars × 10px = 80px total.
    // Line width: 60px. Without hyphen: "abcdefgh" doesn't fit (80 > 60).
    // Hyphen break at cluster index 5 (prefix "abcde" = 50px).
    // Hyphen "-" = 10px. Prefix + hyphen = 60px — fits exactly in 60px line.
    // So the IFC should wrap with "abcde" + "-" on line 1, "fgh" on line 2.
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t", {}, "abcdefgh"),
      ]),
    );
    if (tree.type !== "element") throw new Error("expected element");

    const ifcResultH1 = layoutInlineContent(
      tree, 0, 0,
      makeRootContext(INITIAL_COMPUTED_STYLE, 60),
      shaperWithHyphen(), undefined
    , 0);
    if (ifcResultH1.box === null) throw new Error("layoutInlineContent returned null box");
    const linesH1 = ifcResultH1.box.children;

    // Should produce at least 2 lines (the word was split).
    expect(linesH1.length).toBeGreaterThanOrEqual(2);

    // The first line should end with a "-" text-run box.
    const firstLine = nth(linesH1, 0, "line");
    if (firstLine.type !== "line") throw new Error("expected line box");
    expect(firstLine.children.length).toBeGreaterThan(0);
    const lastChild = nth(firstLine.children, firstLine.children.length - 1, "child");
    expect(lastChild.type).toBe("text-run");
    if (lastChild.type !== "text-run") throw new Error();
    expect(lastChild.text).toBe("-");
  });

  it("second line starts with the remainder after hyphen split", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t", {}, "abcdefgh"),
      ]),
    );
    if (tree.type !== "element") throw new Error("expected element");

    const ifcResultH2 = layoutInlineContent(
      tree, 0, 0,
      makeRootContext(INITIAL_COMPUTED_STYLE, 60),
      shaperWithHyphen(), undefined
    , 0);
    if (ifcResultH2.box === null) throw new Error("layoutInlineContent returned null box");
    const linesH2 = ifcResultH2.box.children;

    expect(linesH2.length).toBeGreaterThanOrEqual(2);
    const secondLine = nth(linesH2, 1);
    if (secondLine.type !== "line") throw new Error("expected line box");
    expect(secondLine.children.length).toBeGreaterThan(0);
    // The first child of line 2 should be the suffix "fgh".
    const firstChild = nth(secondLine.children, 0, "child");
    expect(firstChild.type).toBe("text-run");
    if (firstChild.type !== "text-run") throw new Error();
    expect(firstChild.text).toBe("fgh");
  });

  it("hyphen split of a word adjacent to a collapsed double space keeps the source-length invariant (no NaN)", () => {
    // "abcdefgh  ij": the word "abcdefgh" (8 chars) is immediately followed by
    // a DOUBLE space that collapses to one rendered space under white-space:
    // normal. The word's wrap unit therefore carries a trailing space token
    // whose sourceLength is 2 (it absorbed the collapsed-away char) — so the
    // unit's source span (10) exceeds its rendered text length.
    //
    // At width 60 the hyphen break fires (prefix "abcde-" = 60px fits). The
    // split must satisfy prefixToken.sourceLength + suffixToken.sourceLength
    // === originalToken.sourceLength, where originalToken is the word "abcdefgh"
    // — even though the suffix run "fgh " ends up with sourceLength > its
    // rendered text.length because the absorbed collapsed-space char stays with
    // the suffix's last position. We verify this through the rendered geometry:
    // every offset is finite (never NaN), the lines connect by state offset,
    // and the last line's inlineOffsetEnd reaches the full state length.
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t", {}, "abcdefgh  ij"),
      ]),
    );
    if (tree.type !== "element") throw new Error("expected element");

    const result = layoutInlineContent(
      tree, 0, 0,
      makeRootContext(INITIAL_COMPUTED_STYLE, 60),
      shaperWithHyphen(), undefined
    , 0);
    if (result.box === null) throw new Error("layoutInlineContent returned null box");
    const lines = result.box.children.filter(
      (l): l is import("./layout-box").LineBox => l.type === "line",
    );
    expect(lines.length).toBeGreaterThanOrEqual(2);

    // The word was hyphen-split: line 1 ends with "abcde" + a "-" glyph.
    const line1 = nth(lines, 0, "line");
    const prefixRuns = line1.children.filter(
      (c): c is import("./layout-box").TextRunBox => c.type === "text-run",
    );
    expect(prefixRuns.map(r => r.text)).toContain("abcde");
    expect(prefixRuns.map(r => r.text)).toContain("-");

    // Every line offset is finite (never NaN) — the second-pass sourceLength
    // and the hyphen-split arithmetic both stay numeric across the collapse.
    for (const line of lines) {
      expect(Number.isFinite(line.inlineOffsetStart)).toBe(true);
      expect(Number.isFinite(line.inlineOffsetEnd)).toBe(true);
      for (const run of line.children) {
        if (run.type !== "text-run") continue;
        expect(Number.isNaN(run.offsetLength)).toBe(false);
        expect(Number.isFinite(run.offsetLength)).toBe(true);
      }
    }

    // Lines connect by state offset and the last line covers the full state
    // length (12 = "abcdefgh  ij".length). The hyphen "-" glyph contributes
    // offsetLength 0, so summing rendered-char counts still reaches state
    // length: prefix(5) + suffix-word-remainder(3) + collapsed-space(2 source,
    // 1 rendered absorbed into the suffix run) + "ij"(2) = 12.
    for (let i = 0; i + 1 < lines.length; i++) {
      expect(nth(lines, i + 1).inlineOffsetStart).toBe(nth(lines, i).inlineOffsetEnd);
    }
    expect(nth(lines, lines.length - 1).inlineOffsetEnd).toBe("abcdefgh  ij".length);

    // Algebraic invariant: the prefix run's offsetLength (= prefix token's
    // sourceLength) plus the suffix word-remainder's offsetLength sum to the
    // original word token's source span. The suffix run "fgh " carries the
    // word remainder (3) PLUS the absorbed collapsed space (2) = 5 sourceLength
    // over 4 rendered chars; subtracting the trailing "ij" run isolates the
    // word's contribution. We assert prefix(5) + 5 === word source span (8) +
    // collapsed-space span (2) − is reconstructed exactly by the line offsets.
    const prefixOffsetLen = prefixRuns
      .filter(r => r.text !== "-")
      .reduce((s, r) => s + r.offsetLength, 0);
    const line2 = nth(lines, 1, "line");
    const line2RunOffsetLen = line2.children
      .filter((c): c is import("./layout-box").TextRunBox => c.type === "text-run")
      .reduce((s, r) => s + r.offsetLength, 0);
    // prefix(5) + line-2 runs(5 + 2) = 12 = full state length, all finite.
    expect(prefixOffsetLen + line2RunOffsetLen).toBe("abcdefgh  ij".length);
    expect(Number.isNaN(prefixOffsetLen + line2RunOffsetLen)).toBe(false);
  });
});

describe("Token IDs — stability", () => {
  it("text tokens get id = sourceKey:offset", () => {
    // "abc def" tokenizes to ["abc", " ", "def"].
    // Offsets in the source text: "abc" starts at 0, " " at 3, "def" at 4.
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t", {}, "abc def"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const tokens = collectTokens(tree, shaper, "ltr", ctx.intrinsicCache);

    expect(tokens).toHaveLength(3);
    expect(nth(tokens, 0).id).toBe("t:0");   // "abc" starts at offset 0
    expect(nth(tokens, 1).id).toBe("t:3");   // " " starts at offset 3
    expect(nth(tokens, 2).id).toBe("t:4");   // "def" starts at offset 4
  });

  it("same input produces the same token IDs on repeated calls (stability)", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t", {}, "hello world"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx1 = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const ctx2 = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const tokens1 = collectTokens(tree, shaper, "ltr", ctx1.intrinsicCache);
    const tokens2 = collectTokens(tree, shaper, "ltr", ctx2.intrinsicCache);

    expect(tokens1.map(t => t.id)).toEqual(tokens2.map(t => t.id));
  });

  it("tokens from an unchanged sibling node keep their IDs when another node changes", () => {
    // "t1" is the unchanged node; "t2" would change. We verify t1's tokens
    // have the form "t1:<offset>" regardless of t2's content.
    const treeA = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t1", {}, "foo "),
        createTextBox("t2", {}, "bar"),
      ]),
    );
    const treeB = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t1", {}, "foo "),
        createTextBox("t2", {}, "baz qux"),  // t2 changed
      ]),
    );
    if (treeA.type !== "element" || treeB.type !== "element") throw new Error("?");
    const ctxA = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const ctxB = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const tokensA = collectTokens(treeA, shaper, "ltr", ctxA.intrinsicCache);
    const tokensB = collectTokens(treeB, shaper, "ltr", ctxB.intrinsicCache);

    // Tokens from t1 ("foo" and " ") should have the same IDs in both trees.
    const t1A = tokensA.filter(t => t.sourceKey === "t1");
    const t1B = tokensB.filter(t => t.sourceKey === "t1");
    expect(t1A.map(t => t.id)).toEqual(t1B.map(t => t.id));
  });

  it("inline-block token gets id = sourceKey (no offset)", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createElementBox("ib", { display: "inline-block", inlineSize: 50, blockSize: 30 }, []),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const tokens = collectTokens(tree, shaper, "ltr", ctx.intrinsicCache);

    expect(tokens).toHaveLength(1);
    expect(nth(tokens, 0).id).toBe("ib");
    expect(nth(tokens, 0).inlineBlock).toBeDefined();
  });

  it("text \\n LINE_BREAK token gets id = sourceKey:lb (pre mode)", () => {
    // NOTE: this is the TEXT `\n` line-break path — its token id is `{sourceKey}:lb`.
    // An embed-derived hard-break (`<br>`) token uses `id = {embed key}` (no `:lb`
    // suffix) — see the "IFC — hard-break embed forced line break" describe block.
    const tree = cascadePass(
      createElementBox("p", { display: "block", whiteSpace: "pre" }, [
        createTextBox("t", {}, "line one\nline two"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const tokens = collectTokens(tree, shaper, "ltr", ctx.intrinsicCache);

    const lbToken = tokens.find(t => t.isLineBreak);
    expect(lbToken).toBeDefined();
    expect(lbToken?.id).toBe("t:lb");
  });
});

describe("layoutInlineContent — LineBox-canonical fields (E-E.1)", () => {
  it("single-line block: ownerBlockId, offset range [0, text.length], isBlockBoundaryLine=true", () => {
    const lines = ifcOf("hello world", 200);
    expect(lines).toHaveLength(1);
    const line = nth(lines, 0, "line");
    if (line.type !== "line") throw new Error("expected line");
    expect(line.ownerBlockId).toBe("p");
    expect(line.inlineOffsetStart).toBe(0);
    expect(line.inlineOffsetEnd).toBe("hello world".length);
    expect(line.isBlockBoundaryLine).toBe(true);
  });

  it("multi-line wrapped: lines connect (nextLine.start === currentLine.end), only last has isBlockBoundaryLine", () => {
    const lines = ifcOf("a b c d e f g h i j", 30);
    expect(lines.length).toBeGreaterThan(1);
    for (let i = 0; i + 1 < lines.length; i++) {
      const cur = nth(lines, i, "line");
      const next = nth(lines, i + 1, "line");
      if (cur.type !== "line" || next.type !== "line") throw new Error("expected lines");
      expect(next.inlineOffsetStart).toBe(cur.inlineOffsetEnd);
      // All except the last are NOT block-boundary.
      expect(cur.isBlockBoundaryLine).toBe(false);
    }
    const last = nth(lines, lines.length - 1, "line");
    if (last.type !== "line") throw new Error("expected last line");
    expect(last.isBlockBoundaryLine).toBe(true);
  });

  it("multi-line wrapped: ownerBlockId is the block's key on every line", () => {
    const lines = ifcOf("a b c d e f g h i j", 30);
    for (const line of lines) {
      if (line.type !== "line") continue;
      expect(line.ownerBlockId).toBe("p");
    }
  });

  it("multi-line wrapped: final inlineOffsetEnd equals state-model character count", () => {
    const text = "a b c d e f g h i j";
    const lines = ifcOf(text, 30);
    const last = nth(lines, lines.length - 1, "line");
    if (last.type !== "line") throw new Error("expected last line");
    expect(last.inlineOffsetEnd).toBe(text.length);
  });

  it("empty paragraph: strut line has offsets [0, 0] and isBlockBoundaryLine=true", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t", {}, ""),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const result = layoutInlineContent(tree, 0, 0, ctx, shaper, undefined, 0);
    if (result.box === null) throw new Error("layoutInlineContent returned null box");
    const line = nth(result.box.children, 0, "child");
    if (line.type !== "line") throw new Error("expected line");
    expect(line.ownerBlockId).toBe("p");
    expect(line.inlineOffsetStart).toBe(0);
    expect(line.inlineOffsetEnd).toBe(0);
    expect(line.isBlockBoundaryLine).toBe(true);
  });

  it("IFC cache-hit returns lines with same LineBox-canonical field values as cache-miss", () => {
    // Run layoutInlineContent twice on the same tree with the same ctx so
    // the second call hits the cache.
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t", {}, "hello world"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 200);
    const r1 = layoutInlineContent(tree, 0, 0, ctx, shaper, undefined, 0);
    const r2 = layoutInlineContent(tree, 0, 0, ctx, shaper, undefined, 0);
    if (r1.box === null || r2.box === null) throw new Error("?");
    const l1 = nth(r1.box.children, 0, "line");
    const l2 = nth(r2.box.children, 0, "line");
    if (l1.type !== "line" || l2.type !== "line") throw new Error("expected lines");
    expect(l2.ownerBlockId).toBe(l1.ownerBlockId);
    expect(l2.inlineOffsetStart).toBe(l1.inlineOffsetStart);
    expect(l2.inlineOffsetEnd).toBe(l1.inlineOffsetEnd);
    expect(l2.isBlockBoundaryLine).toBe(l1.isBlockBoundaryLine);
    // Cache hit also gives reference equality on the cached LineBox.
    expect(l2).toBe(l1);
  });

  it("block with embed (inline-block) items: each embed contributes 1 to inlineOffsetEnd (matches state-model embed=1)", () => {
    // Paragraph with text + inline-block + text. The inline-block is
    // a state-model embed item and must count as 1 offset unit, not
    // by its rendered width or by 0.
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t1", { display: "inline" }, "hi"),
        createElementBox("ib", { display: "inline-block", inlineSize: 20, blockSize: 16 }, []),
        createTextBox("t2", { display: "inline" }, "bye"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const result = layoutInlineContent(tree, 0, 0, ctx, shaper, undefined, 0);
    if (result.box === null) throw new Error("layoutInlineContent returned null box");
    const line = nth(result.box.children, 0, "child");
    if (line.type !== "line") throw new Error("expected line");
    expect(line.inlineOffsetStart).toBe(0);
    // "hi" (2 chars) + embed (1) + "bye" (3 chars) = 6
    expect(line.inlineOffsetEnd).toBe(6);
    expect(line.isBlockBoundaryLine).toBe(true);
  });

  it("RTL block: rebuildBoxWithOffsets via reorderLineForBidi preserves the new fields", () => {
    // RTL text triggers reorderLineForBidi → rebuildBoxWithOffsets,
    // which must thread the new fields. If rebuildBoxWithOffsets
    // drops them, the line emerges with `undefined` field values.
    const tree = cascadePass(
      createElementBox("p", { display: "block", direction: "rtl" }, [
        createTextBox("t", { display: "inline" }, "right to left text"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const result = layoutInlineContent(tree, 0, 0, ctx, shaper, undefined, 0);
    if (result.box === null) throw new Error("layoutInlineContent returned null box");
    const line = nth(result.box.children, 0, "child");
    if (line.type !== "line") throw new Error("expected line");
    expect(line.ownerBlockId).toBe("p");
    expect(line.inlineOffsetStart).toBe(0);
    expect(line.inlineOffsetEnd).toBe("right to left text".length);
    expect(line.isBlockBoundaryLine).toBe(true);
  });

  it("fragmented across pages: rebaseLine threads the new fields + offset continuity across fragments", () => {
    // Wrap a paragraph onto many lines, then call layoutInlineContent
    // with a fragmentation context that fits only some of them. The
    // suffix fragment (resumed via resumeFrom) goes through rebaseLine.
    // The placed fragment's lines and the resumed fragment's lines
    // together must cover [0, full text length] with no gaps.
    const text = "a b c d e f g h i j k l m n o p q r s t";
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t", { display: "inline" }, text),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 30);

    // First fragment: limit block size to fit ~2 lines (line height 16
    // → 32 px fits exactly 2 lines).
    const r1 = layoutInlineContent(tree, 0, 0, ctx, shaper, undefined, 0, {
      availableBlockSize: 32,
      resumeFrom: null,
      pageIndex: 0,
    });
    if (r1.box === null) throw new Error("expected partial fragment");
    if (r1.breakToken === null) throw new Error("expected break token");
    const lines1 = r1.box.children.filter((c): c is import("./layout-box").LineBox => c.type === "line");
    expect(lines1.length).toBeGreaterThan(0);

    // Resume from the break token. Big availableBlockSize so it
    // finishes.
    const r2 = layoutInlineContent(tree, 0, 0, ctx, shaper, undefined, 0, {
      availableBlockSize: 10_000,
      resumeFrom: r1.breakToken,
      pageIndex: 1,
    });
    if (r2.box === null) throw new Error("expected resumed fragment box");
    const lines2 = r2.box.children.filter((c): c is import("./layout-box").LineBox => c.type === "line");
    expect(lines2.length).toBeGreaterThan(0);

    // ownerBlockId propagates to every line, including resumed.
    for (const line of [...lines1, ...lines2]) {
      expect(line.ownerBlockId).toBe("p");
    }
    // Offset continuity: lines1 final inlineOffsetEnd === lines2 first inlineOffsetStart.
    expect(nth(lines2, 0).inlineOffsetStart).toBe(nth(lines1, lines1.length - 1).inlineOffsetEnd);
    // Cumulative coverage: lines2 final inlineOffsetEnd === text length.
    expect(nth(lines2, lines2.length - 1).inlineOffsetEnd).toBe(text.length);
    // isBlockBoundaryLine: only the absolutely-last line carries true.
    expect(nth(lines2, lines2.length - 1).isBlockBoundaryLine).toBe(true);
    // Any line before the last on either fragment is NOT a boundary.
    for (let i = 0; i < lines1.length; i++) {
      expect(nth(lines1, i).isBlockBoundaryLine).toBe(false);
    }
    for (let i = 0; i < lines2.length - 1; i++) {
      expect(nth(lines2, i).isBlockBoundaryLine).toBe(false);
    }
  });
});

describe("collectTokens — sourceLength (collapsed-whitespace offset accounting)", () => {
  function tokensOf(text: string, whiteSpace?: ComputedStyle["whiteSpace"]) {
    const tree = cascadePass(
      createElementBox("p", { display: "block", ...(whiteSpace ? { whiteSpace } : {}) }, [
        createTextBox("t", {}, text),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    return collectTokens(tree, shaper, "ltr", ctx.intrinsicCache);
  }

  it("single space: each token's sourceLength === text.length (no collapse, no regression)", () => {
    // "a b" → ["a", " ", "b"]; matchStarts 0,1,2; all sourceLength == text.length.
    const tokens = tokensOf("a b");
    expect(tokens.map(t => t.text)).toEqual(["a", " ", "b"]);
    expect(tokens.map(t => t.sourceLength)).toEqual([1, 1, 1]);
    // Sum of sourceLength === state-char count.
    expect(tokens.reduce((s, t) => s + t.sourceLength, 0)).toBe("a b".length);
  });

  it("double space: the space token absorbs the collapsed-away char (sourceLength 2)", () => {
    // "a  b" tokenizes (white-space:normal) to ["a", " ", "b"]; the single
    // " " token must own BOTH source spaces. matchStarts: a@0, " "@1, b@3.
    // sourceLength: a=1, " "=3-1=2, b=(4-3)=1. Sum = 4 = state length.
    const tokens = tokensOf("a  b");
    expect(tokens.map(t => t.text)).toEqual(["a", " ", "b"]);
    expect(tokens.map(t => t.sourceLength)).toEqual([1, 2, 1]);
    expect(tokens.reduce((s, t) => s + t.sourceLength, 0)).toBe("a  b".length);
  });

  it("triple space: collapse count 2 absorbed into the preceding space token", () => {
    // "a   b" → ["a", " ", "b"]; matchStarts a@0, " "@1, b@4.
    // sourceLength: a=1, " "=4-1=3, b=(5-4)=1. Sum = 5 = state length.
    const tokens = tokensOf("a   b");
    expect(tokens.map(t => t.sourceLength)).toEqual([1, 3, 1]);
    expect(tokens.reduce((s, t) => s + t.sourceLength, 0)).toBe("a   b".length);
  });

  it("LINE_BREAK token gets sourceLength 1 (the source \\n)", () => {
    const tokens = tokensOf("line one\nline two", "pre");
    const lb = tokens.find(t => t.isLineBreak);
    expect(lb).toBeDefined();
    expect(lb?.sourceLength).toBe(1);
  });

  it("inline-block token gets sourceLength 1 (state-model embed = 1 unit)", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createElementBox("ib", { display: "inline-block", inlineSize: 50, blockSize: 30 }, []),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const tokens = collectTokens(tree, shaper, "ltr", ctx.intrinsicCache);
    expect(tokens).toHaveLength(1);
    expect(nth(tokens, 0).inlineBlock).toBeDefined();
    expect(nth(tokens, 0).sourceLength).toBe(1);
  });

  it("pre-wrap: multiple whitespace survives as rendered chars; sourceLength == text.length", () => {
    // Under pre-wrap, "a  b" keeps the double space as a single multi-char
    // segment, so no collapse: sourceLength == text.length for every token.
    const tokens = tokensOf("a  b", "pre-wrap");
    for (const t of tokens) {
      expect(t.sourceLength).toBe(t.text.length);
    }
  });

  it("tab-separated words (white-space:normal) do NOT crash; offsets stay finite (C1 regression lock)", () => {
    // Under "normal", the tokenizer splits "hello\tworld" on /\s+/ and emits a
    // SYNTHETIC literal " " token for the inter-word gap. But the SOURCE
    // separator is a TAB, so `fullText.indexOf(" ", cursor)` returns -1 for
    // that token: the synthetic " " is not a verbatim substring at the gap.
    //
    // The earlier `throw` here crashed the editor on any document with a tab
    // between words (a common real authoring case). The fix falls back to
    // `matchStart = cursor` (best-effort) instead, so layout never crashes and
    // the second-pass sourceLength (next.matchStart − this.matchStart) stays
    // finite. This test FAILS against the throw version and passes after the
    // graceful fallback is restored.
    expect(() => tokensOf("hello\tworld")).not.toThrow();

    const tokens = tokensOf("hello\tworld");
    // We get word + synthetic-space + word tokens (3 total).
    expect(tokens.length).toBe(3);
    expect(tokens.map(t => t.text)).toEqual(["hello", " ", "world"]);

    // "world" resolves to a token with a finite, non-NaN sourceLength. We do
    // NOT over-assert the exact offset — under the tab/best-effort fallback the
    // separator offset is approximate; the contract we lock is "no crash +
    // finite offsets", not byte-exact positions.
    const world = tokens.find(t => t.text === "world");
    expect(world).toBeDefined();
    expect(Number.isFinite(world?.sourceLength)).toBe(true);

    // No token has a NaN sourceLength, and the running sum stays finite.
    for (const t of tokens) {
      expect(Number.isNaN(t.sourceLength)).toBe(false);
    }
    expect(Number.isFinite(tokens.reduce((s, t) => s + t.sourceLength, 0))).toBe(true);
  });

  it("#308: leading whitespace under normal owns its source offsets (one " +
     "sourceLength-1 token per leading char)", () => {
    // "   hello" — 3 leading spaces then "hello". The tokenizer emits 3
    // single-char " " tokens BEFORE "hello"; the lookahead-assigned
    // sourceLength then gives each space 1 source char (next.matchStart=1,2,3)
    // and "hello" gets 5. Sum = 8 = state length. Without the fix the
    // tokenizer dropped the leading spaces and "hello" alone had
    // sourceLength=5 (matchStart=3, lookahead=fullText.length-3=5) — the 3
    // leading offsets were owned by no token.
    const tokens = tokensOf("   hello");
    expect(tokens.map(t => t.text)).toEqual([" ", " ", " ", "hello"]);
    expect(tokens.map(t => t.sourceLength)).toEqual([1, 1, 1, 5]);
    expect(tokens.reduce((s, t) => s + t.sourceLength, 0)).toBe("   hello".length);
  });

  it("#308: all-whitespace under normal — 3 space tokens, each sourceLength 1", () => {
    // "   " — defensive case (editor doesn't normally produce all-whitespace
    // paragraphs, but it must still account for every source char).
    const tokens = tokensOf("   ");
    expect(tokens.map(t => t.text)).toEqual([" ", " ", " "]);
    expect(tokens.map(t => t.sourceLength)).toEqual([1, 1, 1]);
    expect(tokens.reduce((s, t) => s + t.sourceLength, 0)).toBe(3);
  });

  it("#308: leading + trailing whitespace under normal — symmetric coverage", () => {
    // "  hi  " — 2 leading + "hi" + 2 trailing = 6 chars total. Token shape:
    // [" "," ","hi"," "," "] with sourceLengths [1,1,2,1,1] — "hi"@2 absorbs
    // no collapsed neighbor (next token is the first trailing space @4), so
    // its sourceLength is next.matchStart(4) - "hi".matchStart(2) = 2 (matches
    // text.length). Sum = 6.
    const tokens = tokensOf("  hi  ");
    expect(tokens.map(t => t.text)).toEqual([" ", " ", "hi", " ", " "]);
    expect(tokens.map(t => t.sourceLength)).toEqual([1, 1, 2, 1, 1]);
    expect(tokens.reduce((s, t) => s + t.sourceLength, 0)).toBe("  hi  ".length);
  });

  it("#365 / #308-part-3: leading TAB at offset 0 under normal — TAB owned, no source-offset gap", () => {
    // "\t  hello" — leading TAB, then 2 spaces, then "hello" = 8 chars total.
    // Tokenizer's leading-emit loop pushes 3 synthetic " " tokens (one per ws
    // char, regardless of whether it's TAB or literal space), then "hello".
    // Before #365, `indexOf(" ", 0)` in fullText skipped forward past the TAB
    // to the first literal space at index 1, leaving offset 0 (the TAB)
    // unowned: token sourceLengths were [1, 1, 0, 5] = 7, not 8. After #365,
    // synthetic " " tokens at a whitespace cursor use cursor directly as
    // matchStart, so the TAB at offset 0 is correctly claimed.
    const tokens = tokensOf("\t  hello");
    expect(tokens.map(t => t.text)).toEqual([" ", " ", " ", "hello"]);
    expect(tokens.map(t => t.sourceLength)).toEqual([1, 1, 1, 5]);
    expect(tokens.reduce((s, t) => s + t.sourceLength, 0)).toBe("\t  hello".length);
  });

  it("#365 / #308-part-3: leading NBSP followed by literal space under normal — NBSP owned via /\\s/ branch", () => {
    // "  hello" — NBSP at 0, literal space at 1, then "hello" (7 chars).
    // True NBSP regression-guard analog of the TAB case: pre-fix
    // `indexOf(" ", 0)` jumped past the NBSP to the literal space at index 1,
    // leaving offset 0 (the NBSP) unowned (sourceLength sum was 6 ≠ 7).
    // Post-fix the /\s/ branch matches NBSP and uses cursor=0 as matchStart.
    //
    // (Bare leading NBSP " hello" happens to pass pre-fix too: indexOf(" ", 0)
    // returns -1, and the pre-existing -1 fallback covers it via
    // `matchStart = cursor`. A following literal space is what makes pre-fix
    // indexOf skip-forward instead of returning -1 — and exposes the bug.)
    const text = "  hello";
    const tokens = tokensOf(text);
    expect(tokens.map(t => t.text)).toEqual([" ", " ", "hello"]);
    expect(tokens.map(t => t.sourceLength)).toEqual([1, 1, 5]);
    expect(tokens.reduce((s, t) => s + t.sourceLength, 0)).toBe(text.length);
  });
});

describe("collectTokens — absoluteSourceBase (P4-C.1: token's absolute UTF-16 offset into asm.source)", () => {
  it("two adjacent text nodes: each token's absoluteSourceBase = its running UTF-16 offset into the concatenated source", () => {
    // Source assembled as "abc" + "def ghi" = "abcdef ghi". The second node's
    // tokens must be offset by "abc".length (= 3). Expected token shape under
    // white-space:normal: ["abc"]@0, ["def"]@3, [" "]@6, ["ghi"]@7.
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t1", {}, "abc"),
        createTextBox("t2", {}, "def ghi"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const tokens = collectTokens(tree, shaper, "ltr", ctx.intrinsicCache);

    expect(tokens.map(t => t.text)).toEqual(["abc", "def", " ", "ghi"]);
    expect(tokens.map(t => t.absoluteSourceBase)).toEqual([0, 3, 6, 7]);
    // The base of each text token equals the source offset embedded in its id
    // ("{sourceKey}:{offset}" is RELATIVE to the node; base is ABSOLUTE).
    expect(nth(tokens, 0).absoluteSourceBase).toBe(0); // t1 "abc" at node-offset 0, childBase 0
    expect(nth(tokens, 1).absoluteSourceBase).toBe(3); // t2 "def" at node-offset 0, childBase 3
  });

  it("absoluteSourceBase mirrors the parallel asm.tokenBases for every token", () => {
    // The field must equal what the parallel array records — across a mix of
    // text, collapsed whitespace, a hard break, and an inline-block.
    const tree = cascadePass(
      createElementBox("p", { display: "block", whiteSpace: "pre" }, [
        createTextBox("t1", {}, "ab\ncd"),
        createElementBox("ib", { display: "inline-block", inlineSize: 40, blockSize: 20 }, []),
        createTextBox("t2", {}, "ef"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const tokens = collectTokens(tree, shaper, "ltr", ctx.intrinsicCache);

    // Re-derive the expected absolute bases by walking the assembled source:
    // "ab" @0, "\n" (LINE_BREAK) @2, "cd" @3, OBJECT_REPLACEMENT (ib) @5,
    // "ef" @6. (whitespace:pre — no collapse.)
    const expectedBases = [0, 2, 3, 5, 6];
    expect(tokens.map(t => t.absoluteSourceBase)).toEqual(expectedBases);
  });

  it("wrap-time split: suffix absoluteSourceBase = prefix base + prefix DISPLAY length (single-sourced rule)", () => {
    // The production split helpers (`trySoftSplit` / `tryHyphenSplit`) both route
    // the suffix's source-offset derivation through the exported, single-sourced
    // `splitSuffixSourceBase`. We assert that rule against a token whose base is
    // NON-ZERO (a second text node), proving the suffix base reflects BOTH the
    // node offset AND the intra-token split index — not a node-relative reset.
    //
    // Node "pad" = "xy" (childBase 0), node "t" = "abcdefgh" (childBase 2).
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("pad", {}, "xy"),
        createTextBox("t", {}, "abcdefgh"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const tokens = collectTokens(tree, makeHyphenShaper(), "ltr", ctx.intrinsicCache);
    const word = tokens.find(t => t.text === "abcdefgh");
    if (word === undefined) throw new Error("expected the word token");
    // The word starts at absolute base 2 ("xy" precedes it).
    expect(word.absoluteSourceBase).toBe(2);

    // shaperWithHyphen breaks "abcdefgh" at DISPLAY index 5 (prefix "abcde").
    // The single-sourced rule: suffix base = word base + prefix display length.
    const prefixDisplayLen = 5;
    expect(splitSuffixSourceBase(word.absoluteSourceBase, prefixDisplayLen)).toBe(7);

    // And the REAL wrap path actually splits the word at that break (geometry
    // proof the rule is exercised end-to-end): line 1 ends with "abcde" + "-",
    // line 2 starts with the suffix "fgh".
    const result = layoutInlineContent(
      tree, 0, 0,
      // Width that fits "xy" + "abcde-" but not the whole word, forcing a split.
      makeRootContext(INITIAL_COMPUTED_STYLE, 80),
      makeHyphenShaper(), undefined, 0
    );
    if (result.box === null) throw new Error("layoutInlineContent returned null box");
    const lines = result.box.children.filter((c): c is import("./layout-box").LineBox => c.type === "line");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const lastLine = nth(lines, lines.length - 1, "line");
    const firstChildOfLast = nth(lastLine.children, 0, "child");
    expect(firstChildOfLast.type).toBe("text-run");
    if (firstChildOfLast.type !== "text-run") throw new Error();
    expect(firstChildOfLast.text).toBe("fgh");
  });
});

describe("layoutInlineContent — offsetLength (state-correct line offsets across collapse)", () => {
  it("single space 'a b': inlineOffsetEnd === text.length (no regression)", () => {
    const lines = ifcOf("a b", 200);
    const line = nth(lines, 0, "line");
    if (line.type !== "line") throw new Error("expected line");
    expect(line.inlineOffsetEnd).toBe("a b".length);
  });

  it("double space 'a  b': run offsetLengths sum to 4; line inlineOffsetEnd === 4", () => {
    const lines = ifcOf("a  b", 200);
    const line = nth(lines, 0, "line");
    if (line.type !== "line") throw new Error("expected line");
    // The line spans the full state range including the collapsed space.
    expect(line.inlineOffsetEnd).toBe(4);
    // Sum the text-run children's offsetLength → must equal state length.
    const runs = line.children.filter((c): c is import("./layout-box").TextRunBox => c.type === "text-run");
    const total = runs.reduce((s, r) => s + r.offsetLength, 0);
    expect(total).toBe(4);
  });

  it("triple space 'a   b': line inlineOffsetEnd === 5 (collapse count 2 owned by run)", () => {
    const lines = ifcOf("a   b", 200);
    const line = nth(lines, 0, "line");
    if (line.type !== "line") throw new Error("expected line");
    expect(line.inlineOffsetEnd).toBe(5);
  });

  it("soft-wrap with a collapsed trailing space at the break: lines connect by state offset", () => {
    // Force a wrap mid-paragraph; a collapsed double space sits at the wrap.
    // mock shaper 8px/char. "dsajidosja idoajs  dsajiodj saoidj".
    const text = "dsajidosja idoajs  dsajiodj saoidj";
    const lines = ifcOf(text, 150).filter((l): l is import("./layout-box").LineBox => l.type === "line");
    expect(lines.length).toBeGreaterThan(1);
    for (let i = 0; i + 1 < lines.length; i++) {
      expect(nth(lines, i + 1).inlineOffsetStart).toBe(nth(lines, i).inlineOffsetEnd);
    }
    // Cumulative coverage reaches the full state length.
    expect(nth(lines, lines.length - 1).inlineOffsetEnd).toBe(text.length);
  });

  it("#308: leading spaces under normal — line.inlineOffsetEnd covers ALL state chars", () => {
    // "   hello" under normal: leading spaces collapse VISUALLY (text-runs
    // emitted at width 0 at x=0) but the line OWNS all 8 source chars so the
    // caret accumulator advances over offsets 0..8. Without the fix the line
    // only owned offsets [3, 8) and caret at offsets 0..2 fell past and
    // clamped.
    const lines = ifcOf("   hello", 200);
    const line = nth(lines, 0, "line");
    if (line.type !== "line") throw new Error("expected line");
    expect(line.inlineOffsetStart).toBe(0);
    expect(line.inlineOffsetEnd).toBe("   hello".length);
  });

  it("#308: all-whitespace under normal — line owns 3 chars, contentless", () => {
    // "   " under normal: all 3 spaces collapse visually (no rendered glyph
    // width), but the line owns all 3 source chars. Today (before fix) every
    // space is dropped as an "orphan leading space" so the line is a STRUT
    // with inlineOffsetEnd=0 — caret at offset 1, 2, or 3 falls past it.
    const lines = ifcOf("   ", 200);
    const line = nth(lines, 0, "line");
    if (line.type !== "line") throw new Error("expected line");
    expect(line.inlineOffsetStart).toBe(0);
    expect(line.inlineOffsetEnd).toBe(3);
  });

  it("#308: leading + word + trailing under normal — symmetric coverage", () => {
    // "  hi  " → line owns [0, 6).
    const lines = ifcOf("  hi  ", 200);
    const line = nth(lines, 0, "line");
    if (line.type !== "line") throw new Error("expected line");
    expect(line.inlineOffsetStart).toBe(0);
    expect(line.inlineOffsetEnd).toBe("  hi  ".length);
  });
});

describe("IFC — inline-block auto shrink-to-fit clamp (CSS Sizing 3 §10.3.5)", () => {
  // Auto-sized inline-block width = min(maxContent, max(minContent, available)).
  // Shrink to the available IFC content width, but never below min-content
  // (the longest unbreakable run). To make min/max-content DIFFER
  // deterministically we use a word-aware shaper: a run's min-content is the
  // widest whitespace-delimited word; its max-content is the full phrase laid
  // out on one line (no wrap). All widths are 8px/char.
  const CW = 8;
  function wordAwareShaper(): TextShaper {
    const base = createMockShaper(CW, 16);
    return {
      measureFontMetrics: base.measureFontMetrics,
      shape(text: string, style, baseDirection): ShapedRun {
        const run = base.shape(text, style, baseDirection);
        // Longest whitespace-delimited word → min-content input. (The default
        // mock reports a single char; we want a meaningful min floor.)
        const longestWord = text.length === 0
          ? 0
          : Math.max(0, ...text.split(/\s+/).map(w => w.length * CW));
        return {
          ...run,
          minClusterInlineSize: longestWord,
          // unbreakableRunInlineSize stays the full text width = max-content.
        };
      },
    };
  }

  // Phrase "aaaa bb cc": min-content is the widest UNBREAKABLE SEGMENT — the
  // widest run of clusters between two UAX #14 break opportunities. Breaks fall
  // AFTER each space (before the next word), so the first segment is "aaaa "
  // (the word PLUS its trailing space) = 5*8 = 40. (`minClusterInlineSize` is
  // overridden to the longest bare word, 32, but the segment-aware floor 40
  // dominates via `max(minClusterInlineSize, widestSegment)`.) full phrase
  // "aaaa bb cc" = 10*8 = 80 (max-content). So minContent=40 < 80.
  const PHRASE = "aaaa bb cc";
  const MIN_CONTENT = 5 * CW;          // 40 — widest segment "aaaa " (word + trailing space)
  const MAX_CONTENT = PHRASE.length * CW; // 80 — full phrase incl. spaces

  function resolvedInlineBlockWidth(
    containingInlineSize: number,
    inlineSize?: "min-content" | "max-content" | "fit-content" | { unit: "percent"; value: number },
  ): number {
    const shp = wordAwareShaper();
    // inline-block with no explicit inlineSize → auto shrink-to-fit; or an
    // explicit intrinsic-sizing keyword / percent length when provided.
    const ibStyle = inlineSize === undefined
      ? { display: "inline-block" as const, blockSize: 16 }
      : { display: "inline-block" as const, blockSize: 16, inlineSize };
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createElementBox("ib", ibStyle, [
          createTextBox("ibt", {}, PHRASE),
        ]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    // layoutBlock → layoutInlineContent provides a non-null parentCtx to
    // collectInlineTokens (the production path that applies the clamp).
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, containingInlineSize), shp, undefined);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    if (r.box.type !== "block") throw new Error("?");
    const line = r.box.children.find(c => c.type === "line");
    if (line?.type !== "line") throw new Error("no line");
    const ib = line.children.find(c => c.type === "inline-block");
    if (ib?.type !== "inline-block") throw new Error("no inline-block");
    return ib.width;
  }

  // Sanity: confirm the fixture's intrinsic min/max are what we think.
  it("fixture: min-content (widest unbreakable segment) < max-content (full phrase)", () => {
    const shp = wordAwareShaper();
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createElementBox("ib", { display: "inline-block", blockSize: 16 }, [
          createTextBox("ibt", {}, PHRASE),
        ]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const cache = makeRootContext(INITIAL_COMPUTED_STYLE, 500).intrinsicCache;
    const ib = nth(tree.children, 0, "child");
    const sizes = computeIntrinsicSizes(ib, shp, cache);
    expect(sizes.minContent).toBe(MIN_CONTENT);
    expect(sizes.maxContent).toBe(MAX_CONTENT);
    expect(sizes.minContent).toBeLessThan(sizes.maxContent);
  });

  it("1. clamps to available when maxContent > available (the fix)", () => {
    // available between min (40) and max (80) → clamp down to available.
    const available = 56; // MIN_CONTENT < 56 < MAX_CONTENT
    const w = resolvedInlineBlockWidth(available);
    expect(w).toBe(available);            // clamped to available
    expect(w).toBeGreaterThanOrEqual(MIN_CONTENT); // never below min-content
    expect(w).toBeLessThan(MAX_CONTENT);  // strictly narrower than raw max-content
  });

  it("2. keeps max-content when maxContent < available (unchanged)", () => {
    // available wider than max-content → min(maxContent, available) = maxContent.
    const w = resolvedInlineBlockWidth(MAX_CONTENT + 40);
    expect(w).toBe(MAX_CONTENT);
  });

  it("3. floors at min-content when minContent > available (overflow, CSS-correct)", () => {
    // available narrower than min-content → max(minContent, available) = minContent,
    // and min(maxContent, minContent) = minContent. It overflows the IFC; correct.
    const available = MIN_CONTENT - 16; // 24 < MIN_CONTENT (40)
    const w = resolvedInlineBlockWidth(available);
    expect(w).toBe(MIN_CONTENT);   // floored at min-content, NOT clamped to available
    expect(w).toBeGreaterThan(available);
  });

  it("4. explicit numeric inlineSize is unchanged by the clamp", () => {
    const shp = wordAwareShaper();
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        // explicit inlineSize wider than the tiny available width — the clamp
        // must NOT touch the explicit-size arm.
        createElementBox("ib", { display: "inline-block", inlineSize: 70, blockSize: 16 }, [
          createTextBox("ibt", {}, PHRASE),
        ]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 30), shp, undefined);
    if (r.box === null || r.box.type !== "block") throw new Error("?");
    const line = r.box.children.find(c => c.type === "line");
    if (line?.type !== "line") throw new Error("no line");
    const ib = line.children.find(c => c.type === "inline-block");
    if (ib?.type !== "inline-block") throw new Error("no inline-block");
    expect(ib.width).toBe(70);
  });

  it("5. NO-REGRESSION: external collectTokens path (parentCtx null) keeps max-content", () => {
    const shp = wordAwareShaper();
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createElementBox("ib", { display: "inline-block", blockSize: 16 }, [
          createTextBox("ibt", {}, PHRASE),
        ]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    // collectTokens passes parentCtx === null → falls back to max-content,
    // unaffected by available width (no available-width context on this path).
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 40); // narrower than max-content
    const tokens = collectTokens(tree, shp, "ltr", ctx.intrinsicCache);
    const ibTok = tokens.find(t => t.inlineBlock !== undefined);
    expect(ibTok).toBeDefined();
    expect(ibTok?.width).toBe(MAX_CONTENT); // unchanged on the null-ctx path
  });

  // --- Explicit intrinsic-sizing keywords (CSS Sizing 3): the shrink-to-fit
  // clamp must ONLY apply to "auto" and "fit-content". "min-content" resolves
  // to min-content unconditionally; "max-content" to max-content uncond.

  it('6. inlineSize: "max-content" keeps max-content even when available < maxContent (NOT clamped)', () => {
    // available between min (40) and max (80) — the auto/fit-content arm would
    // clamp to available; max-content must ignore available entirely.
    const available = 56; // MIN_CONTENT < 56 < MAX_CONTENT
    const w = resolvedInlineBlockWidth(available, "max-content");
    expect(w).toBe(MAX_CONTENT); // unconditional max-content, NOT clamped to available
  });

  it('6b. inlineSize: "max-content" keeps max-content when available is far below max', () => {
    const available = MIN_CONTENT - 8; // 32 < MIN_CONTENT (40) < MAX_CONTENT
    const w = resolvedInlineBlockWidth(available, "max-content");
    expect(w).toBe(MAX_CONTENT);
  });

  it('7. inlineSize: "min-content" keeps min-content even when available > minContent (NOT grown)', () => {
    // available wider than min-content — the auto/fit-content arm gives
    // max(minContent, available) = available; min-content must ignore available.
    const available = MAX_CONTENT + 40; // far wider than minContent
    const w = resolvedInlineBlockWidth(available, "min-content");
    expect(w).toBe(MIN_CONTENT); // unconditional min-content, NOT grown to available
  });

  it('8. inlineSize: "fit-content" behaves like auto (shrink-to-fit clamp)', () => {
    // available between min and max → min(maxContent, max(minContent, available)) = available.
    const available = 56; // MIN_CONTENT < 56 < MAX_CONTENT
    expect(resolvedInlineBlockWidth(available, "fit-content")).toBe(available);
    // available wider than max → maxContent.
    expect(resolvedInlineBlockWidth(MAX_CONTENT + 40, "fit-content")).toBe(MAX_CONTENT);
    // available narrower than min → floored at min-content.
    expect(resolvedInlineBlockWidth(MIN_CONTENT - 16, "fit-content")).toBe(MIN_CONTENT);
  });

  // --- Percent inlineSize (a DEFINITE size, NOT shrink-to-fit). Percent
  // resolves against the containing block's inline size (the IFC content
  // area = available); it is NOT clamped to max-content and NOT floored at
  // min-content. See used-style.ts percent resolution: (value/100)*available.

  it('9. inlineSize: 50% resolves to a DEFINITE 0.5 * available (NOT shrink-to-fit, NOT clamped to maxContent)', () => {
    const available = 56; // 0.5*56 = 28: differs from maxContent (80) AND the
                          // auto/fit-content clamp result (min(80,max(40,56))=56).
    const w = resolvedInlineBlockWidth(available, { unit: "percent", value: 50 });
    expect(w).toBe(28);                 // definite: 0.5 * available
    expect(w).not.toBe(MAX_CONTENT);    // NOT clamped to max-content
    expect(w).not.toBe(available);      // NOT the shrink-to-fit clamp result
    // 28 < MIN_CONTENT (40): a definite percent size is NOT floored at min-content.
    expect(w).toBeLessThan(MIN_CONTENT);
  });
});

describe("IFC — UAX #14 token annotation (S2.4) + S2.3/S2.4-scaffold negative test", () => {
  function tokensOf(text: string, whiteSpace?: ComputedStyle["whiteSpace"]) {
    const tree = cascadePass(
      createElementBox("p", { display: "block", ...(whiteSpace ? { whiteSpace } : {}) }, [
        createTextBox("t", {}, text),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    return collectTokens(tree, shaper, "ltr", ctx.intrinsicCache);
  }

  it("CJK paragraph WRAPS across lines (the S2.4 win)", () => {
    // 10 ideographs (10×8 = 80px) in a 40px IFC. UAX #14 allows a break between
    // every ideograph (class ID via LB31), so `trySoftSplit` wraps the single
    // run: 5 ideographs (40px) per line → 2 lines. (Before S2.4 wired the wrap
    // loop, this stayed on ONE overflowing line — see git history of this test.)
    const lines = ifcOf("一二三四五六七八九十", 40);
    expect(lines.length).toBe(2);
    for (const ln of lines) {
      if (ln.type !== "line") throw new Error("?");
      expect(ln.width).toBeLessThanOrEqual(40);
    }
  });

  it("NBSP (U+00A0, GL) keeps its neighbours on ONE line even when narrow", () => {
    // "aaaa bbbb" at width 40: a REGULAR space lets "bbbb" wrap → 2 lines.
    expect(ifcOf("aaaa bbbb", 40).length).toBe(2);
    // With a NON-BREAKING space (U+00A0), `breakableBefore:false` on "bbbb"
    // suppresses the flush → both words stay on one (overflowing) line. This is
    // the NBSP fix: the old `/\s/` tokenizer wrongly broke here.
    expect(ifcOf("aaaa\u00A0bbbb", 40).length).toBe(1);
  });

  it("NBSP pins only the BOUNDARY \u2014 an NBSP-joined run still wraps at its INTERIOR breaks", () => {
    // "a\u00A0\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D\u5341": an NBSP glues "a" to a 10-ideograph CJK run.
    // `breakableBefore:false` on the CJK run forbids a break AT the NBSP, but the
    // inter-ideograph soft breaks INSIDE the run are independent UAX #14
    // opportunities, so the run must still wrap across lines (it far exceeds the
    // 40px line). Regression guard: an earlier revision gated the ENTIRE
    // overflow/empty-line wrap branch on `breakableBefore`, which wrongly
    // suppressed `trySoftSplit` too and force-placed the whole run on one
    // overflowing line (length 1). `breakableBefore` must gate ONLY the
    // break-before-the-unit flush, never the interior split.
    const lines = ifcOf("a\u00A0\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D\u5341", 40);
    expect(lines.length).toBeGreaterThan(1);
    for (const ln of lines) {
      if (ln.type !== "line") throw new Error("?");
      // Every line except the one carrying the un-splittable "a\u00A0\u4E00" prefix
      // fits; assert no line runs away unboundedly (the whole 88px run is NOT on
      // one line).
      expect(ln.width).toBeLessThanOrEqual(48);
    }
  });

  it("CJK run: token carries softBreaks at the inter-ideograph offsets", () => {
    // "一二" → one word token (no whitespace). UAX #14 (cjBreakable:true) allows
    // a break between adjacent ideographs → soft offset 1, strictly inside the
    // token's display span (0,2) → token-relative softBreaks [1].
    const tokens = tokensOf("一二");
    expect(tokens.map(t => t.text)).toEqual(["一二"]);
    expect(nth(tokens, 0, "token").softBreaks).toEqual([1]);
    // A longer run carries every interior inter-ideograph offset.
    const five = tokensOf("一二三四五");
    expect(nth(five, 0, "token").softBreaks).toEqual([1, 2, 3, 4]);
  });

  it("NBSP (U+00A0, GL): the spanning space token has NO softBreaks and breakableBefore false", () => {
    // "a b" tokenizes (white-space:normal) to ["a", " ", "b"]; the middle
    // " " token is the NBSP-origin synthetic space. UAX #14 puts NO break
    // opportunity around a GL non-breaking space (LB12/12a), so:
    //  - the space token (whitespace → never carries softBreaks) is breakableBefore:false
    //    (keyed at gapEnd = base + sourceLength, the boundary AFTER the gap — NOT
    //    its base; LB7 forbids breaks before any space, so base would be false for
    //    both NBSP and a regular space — gapEnd is the bit that distinguishes them);
    //  - the trailing "b" token is breakableBefore:false too (no opportunity before it).
    const tokens = tokensOf("a b");
    expect(tokens.map(t => t.text)).toEqual(["a", " ", "b"]);
    const space = nth(tokens, 1, "token");
    expect(space.isSpace).toBe(true);
    expect(space.softBreaks).toBeUndefined();
    expect(space.breakableBefore).toBe(false);
    // "b" at base 2: no opportunity before it across the NBSP.
    expect(nth(tokens, 2, "token").breakableBefore).toBe(false);
  });

  it("regular space: the spanning space token IS breakableBefore (Latin unchanged)", () => {
    // "a b" with an ordinary space (SP) — UAX #14 allows a break before the SP
    // (after "a") AND before "b" (after the SP). The synthetic " " space token's
    // breakableBefore is true (regular space), distinguishing it from the NBSP case.
    const tokens = tokensOf("a b");
    expect(tokens.map(t => t.text)).toEqual(["a", " ", "b"]);
    // breakableBefore is OMITTED when true (default-absent === true) — so the
    // regular-space token has no explicit `false`, unlike the NBSP case above.
    expect(nth(tokens, 1, "token").breakableBefore).not.toBe(false);
    expect(nth(tokens, 2, "token").breakableBefore).not.toBe(false);
  });

  it("plain ASCII word: no softBreaks, breakableBefore omitted (byte-identical common case)", () => {
    // "hello" — no interior UAX #14 opportunities, no leading break → softBreaks
    // and breakableBefore are both omitted, keeping the token byte-identical to
    // the pre-S2.4 shape (cache key default-equal).
    const tokens = tokensOf("hello");
    expect(nth(tokens, 0, "token").softBreaks).toBeUndefined();
    expect(nth(tokens, 0, "token").breakableBefore).toBeUndefined();
  });
});

describe("IFC — hyphens: soft-hyphen break handling (HYPH.S2/S3)", () => {
  const SHY = "­";
  type LineBox = import("./layout-box").LineBox;
  type TextRunBox = import("./layout-box").TextRunBox;
  // SHY is UAX #14 class BA (break-after), so `lineBreakOpportunities` emits a
  // soft break at the index immediately AFTER it. Under ALL three `hyphens`
  // values the glyph-less soft break at a U+00AD is suppressed: `none` removes
  // it entirely (the word stays unbroken — CSS Text 4); `manual`/`auto` MOVE it
  // to a hyphen break that renders a "-" glyph at the line end. Real-space
  // breaks elsewhere are never affected.
  function styledTree(text: string, hyphens?: ComputedStyle["hyphens"]) {
    const tree = cascadePass(
      createElementBox("p", { display: "block", ...(hyphens ? { hyphens } : {}) }, [
        createTextBox("t", {}, text),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    return tree;
  }
  function tokensOf(text: string, hyphens?: ComputedStyle["hyphens"]) {
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    return collectTokens(styledTree(text, hyphens), shaper, "ltr", ctx.intrinsicCache);
  }
  function linesOf(text: string, width: number, hyphens?: ComputedStyle["hyphens"]): LineBox[] {
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, width);
    const result = layoutInlineContent(styledTree(text, hyphens), 0, 0, ctx, shaper, undefined, 0);
    if (result.box === null) throw new Error("layoutInlineContent returned null box");
    return result.box.children.filter((c): c is LineBox => c.type === "line");
  }

  // --- S3: manual producer (soft → hyphen) ---

  it("manual (default): the break MOVES from soft to hyphen on the token", () => {
    // "hy<SHY>phen": SHY at token-relative index 2 → the suffix begins at the
    // char AFTER it, so the hyphen break is at index 3 (prefix = slice(0,3) =
    // "hy<SHY>", keeping the soft hyphen on the prefix where it renders as "-").
    // The glyph-less soft break is REMOVED (moved, not duplicated).
    const tok = nth(tokensOf("hy" + SHY + "phen"), 0, "token");
    expect(tok.hyphenBreaks).toEqual([3]);
    expect(tok.softBreaks).toBeUndefined();
  });

  it("auto ≡ manual: same hyphenBreaks (auto falls back to manual until a dictionary)", () => {
    expect(nth(tokensOf("hy" + SHY + "phen", "auto"), 0, "token").hyphenBreaks).toEqual([3]);
  });

  it("multiple soft hyphens → a hyphenBreaks entry at each i+1, none for a trailing SHY", () => {
    // "a<SHY>b<SHY>c<SHY>": SHY at indices 1, 3, 5. The first two yield interior
    // hyphen breaks at 2 and 4; the TRAILING SHY (index 5, last char) has no
    // suffix to break to → no entry.
    expect(nth(tokensOf("a" + SHY + "b" + SHY + "c" + SHY), 0, "token").hyphenBreaks).toEqual([2, 4]);
  });

  it("none: NO hyphenBreaks are produced (the word is unbreakable at the soft hyphen)", () => {
    const tok = nth(tokensOf("hy" + SHY + "phen", "none"), 0, "token");
    expect(tok.hyphenBreaks).toBeUndefined();
    expect(tok.softBreaks).toBeUndefined();
  });

  it("manual: a soft-hyphenated overflow line ends with a hyphen glyph at the LTR inline-end (HYPH.S4 RTL baseline)", () => {
    // "hy<SHY>phen" = 6 visible letters × 8px = 48px (SHY zero-advance) in a 40px
    // line → wraps at the soft hyphen. Line 1 ends with the synthetic "-" glyph
    // and carries endsWithHyphenContinuation; line 2 is the "phen" suffix.
    const lines = linesOf("hy" + SHY + "phen", 40, "manual");
    expect(lines.length).toBe(2);
    expect(nth(lines, 0, "line").endsWithHyphenContinuation).toBe(true);
    const runs = nth(lines, 0, "line").children.filter((c): c is TextRunBox => c.type === "text-run");
    const hyphen = runs.find((r) => r.text === "-");
    expect(hyphen).toBeDefined();
    // LTR baseline for the named RTL-hyphen-placement follow-up (spec "Out of
    // scope"): the synthetic hyphen sits at the inline-END of the prefix — after
    // "hy<SHY>" (h=8 + y=8 + SHY=0 = 16). On an RTL line the follow-up must move it
    // to the inline-START; this assertion pins the correct LTR position so that
    // work has a baseline.
    expect(hyphen?.inlineOffset).toBe(16);
    // The suffix line carries no hyphen continuation.
    expect(nth(lines, 1, "line").endsWithHyphenContinuation).not.toBe(true);
  });

  it("manual: a soft-hyphenated paragraph survives the live incremental wrap cache (correct geometry reused)", () => {
    // The live IFC incremental path is a full-reuse-or-full-rewrap cache keyed on
    // `findChangePoint` (the partial-rewrap `rewrapIncremental` is P18-deferred and
    // NOT on the live path — so hyphenation can never yield wrong incremental
    // geometry here; the fallback is always a correct full re-wrap). Re-laying the
    // SAME soft-hyphenated paragraph through the SAME ctx hits the cache and reuses
    // the hyphen-split lines verbatim — proving the hyphenated geometry round-trips
    // the cache. Object-IDENTITY of the LineBoxes proves the cache path was taken
    // (a re-wrap would allocate fresh LineBoxes).
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 40);
    const tree = styledTree("hy" + SHY + "phen", "manual");
    const r1 = layoutInlineContent(tree, 0, 0, ctx, shaper, undefined, 0);
    const r2 = layoutInlineContent(tree, 0, 0, ctx, shaper, undefined, 0); // same ctx → cache hit
    if (r1.box === null || r2.box === null) throw new Error("null box");
    expect(r2.box.children.length).toBe(2);
    expect(nth(r2.box.children, 0, "line")).toBe(nth(r1.box.children, 0, "line")); // same LineBox ref → cache reuse
    expect(nth(r2.box.children, 1, "line")).toBe(nth(r1.box.children, 1, "line"));
    const line0 = nth(r2.box.children, 0, "line");
    if (line0.type !== "line") throw new Error("expected line");
    expect(line0.endsWithHyphenContinuation).toBe(true);
    expect(
      line0.children.filter((c): c is TextRunBox => c.type === "text-run").map((r) => r.text),
    ).toContain("-");
  });

  // --- S2: none suppression (still holds) ---

  it("none: a soft-hyphenated word that overflows does NOT break at the soft hyphen", () => {
    // Under `manual` it wraps at the soft hyphen (→ 2 lines); under `none` it
    // stays on ONE overflowing line.
    expect(linesOf("hy" + SHY + "phen", 40, "manual").length).toBe(2);
    expect(linesOf("hy" + SHY + "phen", 40, "none").length).toBe(1);
  });

  it("none: a real-space break is still honored (only the soft-hyphen break is removed)", () => {
    // "hy<SHY>phen aaaa" under `none` at width 40: the in-word soft-hyphen break
    // is gone, but the SPACE break before "aaaa" remains → still wraps to 2 lines.
    expect(linesOf("hy" + SHY + "phen aaaa", 40, "none").length).toBe(2);
  });
});

describe("IFC — hyphens: auto producer (HYPH.S4)", () => {
  // The auto producer asks an injected `Hyphenator` for algorithmic in-word break
  // points under `hyphens: auto` + a resolved content language, filters them by
  // `hyphenate-limit-chars` ([minWord, minBefore, minAfter]), and merges them with
  // soft-hyphen + shaper breaks. With no hyphenator / no language it contributes
  // nothing (auto falls back to manual — the correct CSS UA fallback).
  function styledTree(
    text: string,
    style?: Partial<{
      hyphens: ComputedStyle["hyphens"];
      language: string;
      hyphenateLimitChars: readonly [number, number, number];
      textTransform: ComputedStyle["textTransform"];
    }>,
  ) {
    const tree = cascadePass(
      createElementBox("p", { display: "block", ...(style ?? {}) }, [
        createTextBox("t", {}, text),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    return tree;
  }
  function tokensOf(
    text: string,
    style?: Partial<{
      hyphens: ComputedStyle["hyphens"];
      language: string;
      hyphenateLimitChars: readonly [number, number, number];
      textTransform: ComputedStyle["textTransform"];
    }>,
    hyphenator?: ReturnType<typeof createMockHyphenator>,
  ) {
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    return collectTokens(styledTree(text, style), shaper, "ltr", ctx.intrinsicCache, hyphenator);
  }

  // (a) auto + language + mock → the mock's points filtered by the default [5,2,2].
  it("auto + language + hyphenator → mock points filtered by hyphenate-limit-chars [5,2,2]", () => {
    // "hyphenation" len 11. Mock (every=3) → raw points {3, 6, 9}. Default limits
    // [5,2,2]: minWord 5 (11 ≥ 5 ✓), minBefore 2 (all ≥ 2), minAfter 2 (11-p ≥ 2
    // ⇒ p ≤ 9, so 9 survives). → {3, 6, 9}.
    const tok = nth(tokensOf("hyphenation", { hyphens: "auto", language: "en" }, createMockHyphenator({ every: 3 })), 0, "token");
    expect(tok.hyphenBreaks).toEqual([3, 6, 9]);
  });

  // (b) hyphens:none → no auto breaks (the producer never runs).
  it("none → NO auto breaks even with a hyphenator + language", () => {
    const tok = nth(tokensOf("hyphenation", { hyphens: "none", language: "en" }, createMockHyphenator({ every: 3 })), 0, "token");
    expect(tok.hyphenBreaks).toBeUndefined();
  });

  // (b') hyphens:manual → NO auto breaks even with a hyphenator + language. The
  // auto arm is gated on `=== "auto"`; `manual` honors ONLY authored soft hyphens
  // (none here), so the plain word stays unbroken.
  it("manual → NO auto breaks even with a hyphenator + language", () => {
    const tok = nth(tokensOf("hyphenation", { hyphens: "manual", language: "en" }, createMockHyphenator({ every: 3 })), 0, "token");
    expect(tok.hyphenBreaks).toBeUndefined();
  });

  // (c) empty language → no auto breaks (no language to hyphenate against).
  it("empty language → NO auto breaks", () => {
    const tok = nth(tokensOf("hyphenation", { hyphens: "auto", language: "" }, createMockHyphenator({ every: 3 })), 0, "token");
    expect(tok.hyphenBreaks).toBeUndefined();
  });

  // (d) no hyphenator → no auto breaks (auto falls back to manual; no soft hyphen here).
  it("no hyphenator (undefined) → NO auto breaks", () => {
    const tok = nth(tokensOf("hyphenation", { hyphens: "auto", language: "en" }, undefined), 0, "token");
    expect(tok.hyphenBreaks).toBeUndefined();
  });

  // (e) word shorter than minWord → no auto breaks.
  it("word shorter than minWord → NO auto breaks", () => {
    // "hello" len 5; minWord default 5 ⇒ 5 ≥ 5 so the producer runs. Use a shorter
    // word to land below minWord: "hi" len 2 < 5.
    const tok = nth(tokensOf("hi", { hyphens: "auto", language: "en" }, createMockHyphenator({ every: 1, floor: 1 })), 0, "token");
    expect(tok.hyphenBreaks).toBeUndefined();
  });

  // (f) only points with p>=minBefore && len-p>=minAfter survive (custom limits).
  it("custom hyphenate-limit-chars filters by minBefore / minAfter", () => {
    // "abcdefghij" len 10. Mock every=1 → raw interior points {1..9}. Limits
    // [4, 3, 3]: minWord 4 (10 ≥ 4 ✓), minBefore 3 ⇒ p ≥ 3, minAfter 3 ⇒
    // 10-p ≥ 3 ⇒ p ≤ 7. Survivors: {3, 4, 5, 6, 7}.
    const tok = nth(tokensOf(
      "abcdefghij",
      { hyphens: "auto", language: "en", hyphenateLimitChars: [4, 3, 3] },
      createMockHyphenator({ every: 1, floor: 1 }),
    ), 0, "token");
    expect(tok.hyphenBreaks).toEqual([3, 4, 5, 6, 7]);
  });

  // (g) author soft-hyphen U+00AD AND auto both present → UNION, deduped, sorted.
  it("soft hyphen + auto both present → union, deduped, sorted", () => {
    const SHY = "­";
    // "ab<SHY>cdefgh" — display word "abcdefgh" len 8. The SHY is at source index
    // 2; it yields a synthesized soft-hyphen break at token index 3 (after the SHY,
    // which is index 2; the suffix starts at the char after → 3). The auto mock
    // (every=3) over the 9-code-unit `part` "ab­cdefgh" → raw {3, 6}; default
    // limits [5,2,2] keep both (len 9, p≥2, 9-p≥2 ⇒ p≤7). Union {3, 6} ∪ {3} =
    // {3, 6}, deduped + sorted.
    const tok = nth(tokensOf("ab" + SHY + "cdefgh", { hyphens: "auto", language: "en" }, createMockHyphenator({ every: 3 })), 0, "token");
    expect(tok.hyphenBreaks).toEqual([3, 6]);
  });

  // (h) text-transform GROW token (display ≠ source) → hyphenBreaks cleared.
  it("text-transform grow token (display ≠ source) → hyphenBreaks cleared", () => {
    // "straße" len 6; uppercase → "STRASSE" len 7 (ß→SS grows). The grow path
    // clears hyphenBreaks (source-relative indices become invalid). So even though
    // the auto producer ran on the DISPLAY word, the clear at the text-transform
    // branch nulls it.
    const tok = nth(tokensOf(
      "straße",
      { hyphens: "auto", language: "en", textTransform: "uppercase" },
      createMockHyphenator({ every: 2, floor: 1 }),
    ), 0, "token");
    // Sanity: the grow happened (the test would be vacuous on a 1:1 transform).
    expect(tok.sourceDisplayLengths).toBeDefined();
    expect(tok.hyphenBreaks).toBeUndefined();
  });
});

describe("IFC — overflow-wrap: break-word (OW.S2)", () => {
  // The last-resort within-word break: a word with NO real break opportunity that
  // exceeds the line is broken at a grapheme-cluster boundary under `break-word`
  // (CSS Text 3 §5.1); under `normal` (the initial) it overflows. Ordering is
  // soft → hyphen → emergency, so a real break (space/soft-hyphen) always wins.
  type LineBox = import("./layout-box").LineBox;
  type TextRunBox = import("./layout-box").TextRunBox;
  function styledTree(text: string, overflowWrap?: ComputedStyle["overflowWrap"], hyphens?: ComputedStyle["hyphens"]) {
    const tree = cascadePass(
      createElementBox("p", {
        display: "block",
        ...(overflowWrap ? { overflowWrap } : {}),
        ...(hyphens ? { hyphens } : {}),
      }, [createTextBox("t", {}, text)]),
    );
    if (tree.type !== "element") throw new Error("?");
    return tree;
  }
  function linesOf(text: string, width: number, overflowWrap?: ComputedStyle["overflowWrap"], hyphens?: ComputedStyle["hyphens"]): LineBox[] {
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, width);
    const result = layoutInlineContent(styledTree(text, overflowWrap, hyphens), 0, 0, ctx, shaper, undefined, 0);
    if (result.box === null) throw new Error("null box");
    return result.box.children.filter((c): c is LineBox => c.type === "line");
  }

  it("break-word breaks a long unbreakable word; normal overflows on one line", () => {
    // "aaaaaaaa" = 8 × 8px = 64px in a 40px column. Under break-word it breaks at
    // the widest fitting grapheme boundary ("aaaaa" = 40px) → 2 lines; the first
    // line fits the column. Under `normal` the word overflows on ONE line.
    const bw = linesOf("aaaaaaaa", 40, "break-word");
    expect(bw.length).toBe(2);
    expect(nth(bw, 0).width).toBeLessThanOrEqual(40);
    expect(linesOf("aaaaaaaa", 40, "normal").length).toBe(1);
    // Default (no overflowWrap → `normal` initial) also overflows.
    expect(linesOf("aaaaaaaa", 40).length).toBe(1);
    // `anywhere`'s USED-layout break is IDENTICAL to break-word (CSS Text 3 §5.1):
    // it emergency-breaks the same way — only its intrinsic min-content differs
    // (covered in intrinsic-sizes-pass.test.ts). Same word, same column ⇒ same lines.
    const any = linesOf("aaaaaaaa", 40, "anywhere");
    expect(any.length).toBe(2);
    expect(nth(any, 0).width).toBeLessThanOrEqual(40);
  });

  it("≥1-grapheme progress guarantee: a grapheme wider than the line still places one (no infinite loop)", () => {
    // "abc" with each glyph 8px in a 4px column: no grapheme fits, but break-word
    // must place at least one grapheme per line (CSS §5.1) — "a" | "b" | "c", each
    // overflowing. 3 lines proves progress + termination (the single-grapheme tail
    // "c" cannot split, so it force-places).
    const lines = linesOf("abc", 4, "break-word");
    expect(lines.length).toBe(3);
  });

  it("real breaks win first: a soft hyphen is used before an emergency break", () => {
    // "aa<SHY>aaaa" (6 visible × 8 = 48px) in a 40px column under break-word +
    // default `manual` hyphens. The soft hyphen gives a hyphen break at index 3
    // (prefix "aa<SHY>" + "-" = 24px ≤ 40) — tried BEFORE the emergency break, so
    // line 0 ends with the "-" glyph rather than chopping mid-run at "aaaaa".
    const lines = linesOf("aa" + "­" + "aaaa", 40, "break-word", "manual");
    expect(nth(lines, 0, "line").endsWithHyphenContinuation).toBe(true);
    expect(
      nth(lines, 0, "line").children.filter((c): c is TextRunBox => c.type === "text-run").map((r) => r.text),
    ).toContain("-");
  });

  it("break-word breaks an NBSP-glued overflowing word on a shared line (the breakableBefore===false else-branch)", () => {
    // "word longword": the NBSP (U+00A0) glues "longword" to "word"
    // (breakableBefore===false → it can't move to a fresh line). In an 80px column
    // the run overflows (word 32 + NBSP 8 + longword 64 = 104). Without break-word
    // the glued word force-places + overflows; UNDER break-word it must split in
    // place on the shared line. This is the only path through the shared-line
    // `else` branch (every other OW.S2 test goes via the alone-on-line site).
    const lines = linesOf("word longword", 80, "break-word");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(nth(lines, 0, "line").width).toBeLessThanOrEqual(80); // broken, not force-placed past the column
    // Sanity: under `normal` the glued word force-places on ONE overflowing line.
    expect(linesOf("word longword", 80, "normal").length).toBe(1);
  });

  it("break-word prefix/suffix re-sum to the original word (no dropped chars / NaN)", () => {
    const lines = linesOf("aaaaaaaa", 40, "break-word");
    const text = lines
      .flatMap((l) => l.children.filter((c): c is TextRunBox => c.type === "text-run"))
      .map((r) => r.text)
      .join("");
    expect(text).toBe("aaaaaaaa");
    for (const l of lines) {
      expect(Number.isFinite(l.inlineOffsetStart)).toBe(true);
      expect(Number.isFinite(l.inlineOffsetEnd)).toBe(true);
    }
  });
});

describe("IFC — hard-break embed forced line break", () => {
  // A `<br>` decodes to a hard-break embed, which render-core emits as a
  // zero-width, child-less inline-block ElementBox carrying
  // `metadata.embedType === HARD_BREAK_EMBED_TYPE`. The IFC must turn that into
  // a FORCED line break (isLineBreak unit) — mirroring the `\n` LINE_BREAK and
  // the `tab` embed metadata recognition — NOT an ordinary atomic token.

  // Build an inline-block hard-break embed exactly the way render-core does:
  // display:inline-block, inlineSize 0, no children, embedType metadata.
  function hardBreak(key: string) {
    return createElementBox(
      key,
      { display: "inline-block", inlineSize: 0 },
      [],
      { embedType: HARD_BREAK_EMBED_TYPE },
    );
  }

  function lineText(line: import("./layout-box").LineBox): string {
    const out: { x: number; text: string }[] = [];
    const walk = (boxes: readonly import("./layout-box").LayoutBox[]) => {
      for (const b of boxes) {
        if (b.type === "text-run") out.push({ x: b.x, text: b.text });
        else if (b.type === "inline") walk(b.children);
      }
    };
    walk(line.children);
    out.sort((a, b) => a.x - b.x);
    return out.map((l) => l.text).join("");
  }

  function linesOfChildren(children: readonly import("@taleweaver/core").RenderNode[]) {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, children),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    return out.children.filter((c): c is import("./layout-box").LineBox => c.type === "line");
  }

  it("A<br>B lays out as TWO lines: A on line 0, B on line 1", () => {
    const lines = linesOfChildren([
      createTextBox("ta", {}, "A"),
      hardBreak("br"),
      createTextBox("tb", {}, "B"),
    ]);
    expect(lines).toHaveLength(2);
    const l0 = lineText(nth(lines, 0, "line"));
    const l1 = lineText(nth(lines, 1, "line"));
    expect(l0).toContain("A");
    expect(l0).not.toContain("B");
    expect(l1).toContain("B");
  });

  it("A<br><br>B lays out as THREE lines (A, empty, B) with offset continuity", () => {
    const lines = linesOfChildren([
      createTextBox("ta", {}, "A"),
      hardBreak("br1"),
      hardBreak("br2"),
      createTextBox("tb", {}, "B"),
    ]);
    expect(lines).toHaveLength(3);
    // Offset continuity across all lines (each line resumes where the last ended).
    for (let i = 1; i < lines.length; i++) {
      expect(nth(lines, i).inlineOffsetStart).toBe(nth(lines, i - 1).inlineOffsetEnd);
    }
    // Total source length: A=1, br=1, br=1, B=1 ⇒ 4.
    expect(nth(lines, 0, "line").inlineOffsetStart).toBe(0);
    expect(nth(lines, lines.length - 1).inlineOffsetEnd).toBe(4);
  });

  it("a lone hard-break embed still forces a second line (2 line boxes)", () => {
    const lines = linesOfChildren([hardBreak("br")]);
    expect(lines).toHaveLength(2);
  });

  // #504: real dialogue authored with `<br>` between call-and-response lines used
  // to glue into long runs that broke mid-word under `overflow-wrap: break-word`
  // in narrow (2-column) tracks. With the hard-break honored, each segment is
  // short and wraps only at spaces — no emergency mid-word break.
  function linesOfChildrenNarrow(
    children: readonly import("@taleweaver/core").RenderNode[],
    width: number,
  ) {
    const tree = cascadePass(
      // overflowWrap is inherited, so setting it on the paragraph root cascades
      // to the text children (mirrors the example seed inheriting it from the
      // document root).
      createElementBox("p", { display: "block", overflowWrap: "break-word" }, children),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, width), shaper, undefined);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    return out.children.filter((c): c is import("./layout-box").LineBox => c.type === "line");
  }

  it("real <br>-separated dialogue never breaks mid-word in a narrow break-word track (#504)", () => {
    // The actual Little-Red-Riding-Hood call-and-response from the seed, modeled
    // as text runs SEPARATED BY hard-break embeds (NOT glued plain text).
    const lines = linesOfChildrenNarrow(
      [
        createTextBox("t0", {}, '"Oh, grandmother, what big ears you have!"'),
        hardBreak("br0"),
        createTextBox("t1", {}, '"All the better to hear you with, my child."'),
        hardBreak("br1"),
        createTextBox("t2", {}, '"But, grandmother, what big eyes you have!"'),
        hardBreak("br2"),
        createTextBox("t3", {}, '"All the better to see you with."'),
        hardBreak("br3"),
        createTextBox("t4", {}, '"But, grandmother, what big teeth you have!"'),
        hardBreak("br4"),
        createTextBox("t5", {}, '"All the better to eat you with!"'),
      ],
      // ~180px column track: at 8px/char each segment wraps over a couple of
      // lines at spaces, but no single word (longest "grandmother," = 12 chars
      // = 96px) ever needs an emergency mid-word break.
      184,
    );

    // The breaks fired AND the segments wrapped: 6 segments forced onto their own
    // line-groups, each wrapping over >1 line ⇒ well more than 6 lines. Guards
    // against a vacuously-green single-line layout.
    expect(lines.length).toBeGreaterThan(6);

    // A line is split mid-word when its raw (UN-trimmed) text does not end in
    // whitespace, ends in a letter, AND the next line starts with a letter — a
    // word cut between two letters. The hard-break fix means this never happens.
    const raw = lines.map((l) => lineText(l));
    const midWordSplit = (texts: readonly string[]): boolean => {
      for (let i = 0; i < texts.length - 1; i++) {
        const cur = nth(texts, i, "text");
        const next = nth(texts, i + 1, "text");
        if (cur.length === 0 || next.length === 0) continue;
        const endsInWhitespace = /\s$/.test(cur);
        const endsInLetter = /[A-Za-z]$/.test(cur);
        const nextStartsLetter = /^[A-Za-z]/.test(next);
        if (!endsInWhitespace && endsInLetter && nextStartsLetter) return true;
      }
      return false;
    };
    expect(midWordSplit(raw)).toBe(false);

    // Positive: a segment's opening quote stays attached to its first word at the
    // start of that segment's first line (never split off) — '"But,' survives.
    expect(raw.some((t) => t.startsWith('"But,'))).toBe(true);
  });

  it("pre-line 'A\\n' (text LINE_BREAK, no trailing empty token) also opens a trailing empty line", () => {
    // The trailing-empty-line flag mechanism that the hard-break embed relies on
    // ALSO drives the `pre-line` text path: `tokenize("A\n", "pre-line")` yields
    // ["A", LINE_BREAK] with NO trailing "" segment, so the post-loop flag flush
    // is what opens the empty second line (the caret-after-the-break needs it).
    // (`pre`/`pre-wrap` get this from the tokenizer's trailing "" token instead.)
    const tree = cascadePass(
      createElementBox("p", { display: "block", whiteSpace: "pre-line" }, [
        createTextBox("t", {}, "A\n"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r.box === null || r.box.type !== "block") throw new Error("?");
    const lines = r.box.children.filter(
      (c): c is import("./layout-box").LineBox => c.type === "line",
    );
    expect(lines).toHaveLength(2);
    expect(lineText(nth(lines, 0, "line"))).toContain("A");
    // The trailing empty line carries no glyphs and resumes at the prior end.
    expect(lineText(nth(lines, 1, "line"))).toBe("");
    expect(nth(lines, 1, "line").inlineOffsetStart).toBe(nth(lines, 0, "line").inlineOffsetEnd);
  });
});

// #521 PDF /Link foundation — `TextRunBox.link` must survive every text-run
// re-emit path (layout stamp, soft-wrap, hyphen-split). The bidi-reorder SPLIT
// path is covered by a direct `splitTextRunBoxAtOffset` unit test in
// `ifc-bidi-reorder.test.ts` (the fourth survival path).
describe("TextRunBox.link — PDF /Link foundation", () => {
  /** Recursively collect every text-run leaf under a line tree (descends InlineBoxes). */
  function collectTextRuns(
    boxes: readonly LayoutBox[],
  ): TextRunBox[] {
    const out: TextRunBox[] = [];
    for (const b of boxes) {
      if (b.type === "text-run") out.push(b);
      else if (b.type === "inline" || b.type === "line") out.push(...collectTextRuns(b.children));
    }
    return out;
  }

  function linkedIfc(text: string, width: number, link?: string): TextRunBox[] {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t", {}, text, link),
      ]),
    );
    if (tree.type !== "element") throw new Error("expected element");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, width);
    const result = layoutInlineContent(tree, 0, 0, ctx, shaper, undefined, 0);
    if (result.box === null) throw new Error("layoutInlineContent returned null box");
    return collectTextRuns(result.box.children);
  }

  it("stamps link on the laid-out text run (and leaves an unlinked run undefined)", () => {
    const runs = linkedIfc("click", 200, "https://x.com");
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) expect(run.link).toBe("https://x.com");

    const plain = linkedIfc("click", 200);
    expect(plain.length).toBeGreaterThan(0);
    for (const run of plain) expect(run.link).toBeUndefined();
  });

  it("preserves link across a soft-wrap split (both line fragments)", () => {
    // 8px/char (the shared mock shaper). Width 50 fits ~6 chars per line, so a
    // long linked phrase wraps to ≥2 lines; the link must ride EVERY line's run.
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t", {}, "alpha bravo charlie delta", "https://x.com"),
      ]),
    );
    if (tree.type !== "element") throw new Error("expected element");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 50);
    const result = layoutInlineContent(tree, 0, 0, ctx, shaper, undefined, 0);
    if (result.box === null) throw new Error("layoutInlineContent returned null box");
    const lines = result.box.children.filter((c): c is LineBox => c.type === "line");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    // Every text-run on every line carries the link (this is the
    // withPhysicalInlineOffset / rebuildBoxWithOffsets reposition path too).
    for (const line of lines) {
      const runs = collectTextRuns(line.children);
      expect(runs.length).toBeGreaterThan(0);
      for (const run of runs) expect(run.link).toBe("https://x.com");
    }
  });

  it("the synthetic hyphen run inherits the parent word's link", () => {
    // Reuse the kind:hyphen mock: "abcdefgh" hyphen-splits after 5 chars at
    // width 60 → line 1 ends with the synthetic "-" run, which must carry the
    // SAME link as the word it terminates.
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t", {}, "abcdefgh", "https://x.com"),
      ]),
    );
    if (tree.type !== "element") throw new Error("expected element");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 60);
    const result = layoutInlineContent(tree, 0, 0, ctx, makeHyphenShaper(), undefined, 0);
    if (result.box === null) throw new Error("layoutInlineContent returned null box");
    const lines = result.box.children.filter((c): c is LineBox => c.type === "line");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const firstLine = nth(lines, 0, "line");
    const runs = collectTextRuns(firstLine.children);
    const hyphen = runs.find((r) => r.text === "-");
    if (hyphen === undefined) throw new Error("expected a synthetic hyphen run on line 1");
    expect(hyphen.link).toBe("https://x.com");
    // The split word's prefix run also carries the link.
    for (const run of runs) expect(run.link).toBe("https://x.com");
  });

  it("preserves link across an INTERIOR soft-split (trySoftSplit, both fragments)", () => {
    // CJK ideographs carry interior UAX #14 soft breaks between every character
    // (lineBreakOpportunities cjBreakable). A single linked CJK "word" (no spaces,
    // so it is one wrap unit) that overflows a narrow line therefore splits via
    // `trySoftSplit` (NOT tryHyphenSplit — no hyphen opportunity, no synthetic
    // glyph). Six ideographs at 8px = 48px; width 20 forces an interior break, so
    // the run lands on ≥2 lines and the link must ride BOTH fragments.
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t", {}, "日本語中文字", "https://x.com"),
      ]),
    );
    if (tree.type !== "element") throw new Error("expected element");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 20);
    const result = layoutInlineContent(tree, 0, 0, ctx, shaper, undefined, 0);
    if (result.box === null) throw new Error("layoutInlineContent returned null box");
    const lines = result.box.children.filter((c): c is LineBox => c.type === "line");
    // ≥2 lines proves the single CJK unit was interior-split (no spaces to wrap at).
    expect(lines.length).toBeGreaterThanOrEqual(2);
    // Every text-run on every fragment (prefix on line 1, suffix on line 2+) carries
    // the link.
    for (const line of lines) {
      const runs = collectTextRuns(line.children);
      expect(runs.length).toBeGreaterThan(0);
      for (const run of runs) expect(run.link).toBe("https://x.com");
    }
  });

  it("link does not bleed across units: an adjacent unlinked run stays undefined", () => {
    // A LINKED run immediately followed by an UNLINKED run on the SAME (wide) line.
    // The link is a per-token property, so it must NOT leak onto the neighbouring
    // run that has no link.
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("a", {}, "click", "https://x.com"),
        createTextBox("b", {}, " plain"),
      ]),
    );
    if (tree.type !== "element") throw new Error("expected element");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 200);
    const result = layoutInlineContent(tree, 0, 0, ctx, shaper, undefined, 0);
    if (result.box === null) throw new Error("layoutInlineContent returned null box");
    const runs = collectTextRuns(result.box.children);
    const linked = runs.filter((r) => r.text.includes("click"));
    const plain = runs.filter((r) => r.text.includes("plain"));
    expect(linked.length).toBeGreaterThan(0);
    expect(plain.length).toBeGreaterThan(0);
    for (const run of linked) expect(run.link).toBe("https://x.com");
    for (const run of plain) expect(run.link).toBeUndefined();
  });
});
