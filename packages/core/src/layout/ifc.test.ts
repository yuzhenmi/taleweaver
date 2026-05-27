import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "../render/render-node";
import { cascadePass } from "../cascade";
import { createMockShaper } from "./mock-shaper";
import { layoutInlineContent, collectTokens } from "./ifc";
import { layoutBlock } from "./bfc";
import type { TextShaper, ShapedRun, BreakOpportunity, FontMetrics, Cluster } from "./text-shaper";
import type { ComputedStyle } from "../styles";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import type { Direction } from "../styles/writing-mode";
import { makeRootContext } from "./layout-context";

const shaper = createMockShaper(8, 16);

function ifcOf(text: string, width: number) {
  const tree = cascadePass(
    createElementBox("p", { display: "block" }, [
      createTextBox("t", {}, text),
    ]),
  );
  if (tree.type !== "element") throw new Error("?");
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, width);
  const result = layoutInlineContent(tree, 0, 0, ctx, shaper);
  if (result.box === null) throw new Error("layoutInlineContent returned null box");
  return result.box.children;
}

describe("layoutInlineContent — single line", () => {
  it("single short text fits on one line", () => {
    const lines = ifcOf("hello world", 200);
    expect(lines).toHaveLength(1);
    if (lines[0].type !== "line") throw new Error("?");
    expect(lines[0].width).toBeGreaterThan(0);
    expect(lines[0].height).toBe(16);
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
      expect(lines[i].y).toBeGreaterThan(lines[i - 1].y);
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
    const result = layoutInlineContent(tree, 0, 0, ctx, shaper);
    if (result.box === null) throw new Error("layoutInlineContent returned null box");
    const block = result.box;
    expect(block.children).toHaveLength(1);
    const line = block.children[0];
    if (line.type !== "line") throw new Error("expected line box");
    // Mock shaper's measureHeight returns 16 (lineHeight = 16).
    expect(line.height).toBe(16);
    expect(line.children).toHaveLength(0);
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
    const result = layoutInlineContent(tree, 0, 0, ctx, shaper);
    if (result.box === null) throw new Error("layoutInlineContent returned null box");
    const line = result.box.children[0];
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
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    expect(out.height).toBe(16);
    const lines = out.children.filter(c => c.type === "line");
    expect(lines).toHaveLength(1);
    expect(lines[0].height).toBe(16);
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
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
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
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const blocks = out.children.filter(c => c.type === "block");
    expect(blocks).toHaveLength(3);
    // The empty middle paragraph must be at least one line-height tall.
    expect(blocks[1].height).toBeGreaterThanOrEqual(16);
    // Third paragraph must be below first paragraph + middle paragraph's height.
    expect(blocks[2].y).toBeGreaterThanOrEqual(blocks[0].height + blocks[1].height);
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
    const r1 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 50), shaper);
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
    const r2 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 200), shaper);
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
    const r3 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 30), shaper);
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
      const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 200), shaper);
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
  function textRunLeaves(line: import("./layout-box-v2").LineBox) {
    const out: { x: number; text: string; offsetLength: number }[] = [];
    const walk = (boxes: readonly import("./layout-box-v2").LayoutBox[]) => {
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
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const lines = out.children.filter(c => c.type === "line");
    expect(lines).toHaveLength(1);
    const line = lines[0];
    if (line.type !== "line") throw new Error("?");

    // The line OWNS all 5 state chars (2 leading spaces + "abc"); leading
    // spaces are NOT dropped.
    expect(line.inlineOffsetStart).toBe(0);
    expect(line.inlineOffsetEnd).toBe(5);

    // GEOMETRY: the first leaf renders the leading spaces (starting at x=0),
    // and "abc" starts at x=16 (2 spaces × 8px), not x=0.
    const leaves = textRunLeaves(line);
    // First leaf renders only spaces, anchored at x=0.
    expect(leaves[0].x).toBe(0);
    expect(/^\s+$/.test(leaves[0].text)).toBe(true);
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
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const lines = out.children.filter(c => c.type === "line");
    expect(lines).toHaveLength(1);
    const line = lines[0];
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
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const lines = out.children.filter(c => c.type === "line");
    expect(lines).toHaveLength(2);
    const line1 = lines[0];
    const line2 = lines[1];
    if (line1.type !== "line" || line2.type !== "line") throw new Error("?");

    // Line 1: "x" + the forced break = offsets [0, 2) ("x" + "\n").
    expect(line1.inlineOffsetStart).toBe(0);
    expect(line1.inlineOffsetEnd).toBe(2);

    // Line 2: leading "  " then "y" = offsets [2, 5).
    expect(line2.inlineOffsetStart).toBe(line1.inlineOffsetEnd);
    expect(line2.inlineOffsetEnd).toBe(5);

    // GEOMETRY: "y" starts at x=16 on line 2 (after 2 leading spaces).
    const leaves2 = textRunLeaves(line2);
    expect(leaves2[0].x).toBe(0);
    expect(/^\s+$/.test(leaves2[0].text)).toBe(true);
    const yLeaf = leaves2.find(l => l.text.includes("y"));
    expect(yLeaf).toBeDefined();
    expect(yLeaf?.x).toBe(16);
  });

  it("NO-REGRESSION: '  abc' under white-space:normal STILL drops leading spaces (content starts x=0)", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block", whiteSpace: "normal" }, [
        createTextBox("t", {}, "  abc"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const lines = out.children.filter(c => c.type === "line");
    expect(lines).toHaveLength(1);
    const line = lines[0];
    if (line.type !== "line") throw new Error("?");

    // Under normal, leading spaces collapse away: the first (and only) leaf
    // is "abc" anchored at x=0.
    const leaves = textRunLeaves(line);
    expect(leaves[0].x).toBe(0);
    expect(leaves[0].text).toBe("abc");
    // No leading space-run leaf rendered before "abc".
    expect(leaves.filter(l => /^\s+$/.test(l.text))).toHaveLength(0);
  });
});

describe("IFC — break-spaces (#314, Google-Docs trailing-space wrap)", () => {
  // Collect a line's text-run leaves (recursing into inline boxes) in visual
  // order: { x, width, text, offsetLength }. Under break-spaces text-runs are
  // direct line children (no inline elements in these fixtures), so `x` is
  // line-relative and the line itself is at inlineOffset 0 — so the
  // page-edge check is `x + width <= lineInlineSize`.
  function leavesOf(line: import("./layout-box-v2").LineBox) {
    const out: { x: number; width: number; text: string; offsetLength: number }[] = [];
    const walk = (boxes: readonly import("./layout-box-v2").LayoutBox[]) => {
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
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, width), shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const lines = out.children.filter((c): c is import("./layout-box-v2").LineBox => c.type === "line");
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
    const line1Text = leavesOf(lines[0]).map(l => l.text).join("");
    expect(line1Text.startsWith("ab cd")).toBe(true);
    expect(/ab\s+cd/.test(line1Text)).toBe(true);
    expect(lines[0].inlineOffsetEnd).toBe(13);

    // NOTE: hung spaces may extend past the content edge under P1 — clamping the
    // hung run to the content edge is P2 (#338). No on-page geometry asserted.
  });

  it("word is not split early: 'ab cd   ' at 40px keeps 'ab' and 'cd' on line 1", () => {
    // "ab cd" = 40 fits exactly; "ab cd " = 48 does NOT. Under per-token wrap
    // units "cd" (16px) fits after "ab " (24px) = 40 ≤ 40 and stays; the
    // trailing spaces wrap. Under the OLD slurped ["cd"," "," "," "] unit this
    // overflowed and hopped "cd" to line 2 (the bug).
    const { lines } = linesOf("ab cd   ", 40);
    const line1Text = leavesOf(lines[0]).map(l => l.text).join("");
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
    expect(lines[0].inlineOffsetStart).toBe(0);
    expect(lines[0].inlineOffsetEnd).toBe(20);
    // NOTE: the hung run extends past the content edge under P1 (clamping is P2).
  });

  it("interior single-space wrap is unchanged vs normal word-wrap", () => {
    // "aaaa bbbb cccc" at a 2-word width (~72px fits "aaaa bbbb" = 9×8=72).
    const { lines } = linesOf("aaaa bbbb cccc", 72);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    // Wraps at the interior space: "aaaa bbbb" on line 1, "cccc" on line 2.
    const line1Text = leavesOf(lines[0]).map(l => l.text).join("").trimEnd();
    expect(line1Text).toBe("aaaa bbbb");
    const line2Text = leavesOf(lines[1]).map(l => l.text).join("").trim();
    expect(line2Text).toBe("cccc");
  });

  it("multiple + leading spaces render; line owns all state offsets", () => {
    // "  a   b": 2 leading + "a" + 3 interior + "b" = 7 chars, all rendered.
    const { lines } = linesOf("  a   b", 500);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.inlineOffsetStart).toBe(0);
    expect(line.inlineOffsetEnd).toBe(7);
    const leaves = leavesOf(line);
    // First leaf is the 2 leading spaces, anchored at x=0.
    expect(leaves[0].x).toBe(0);
    expect(/^\s+$/.test(leaves[0].text)).toBe(true);
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
      expect(lines[i].inlineOffsetStart).toBe(lines[i - 1].inlineOffsetEnd);
    }
    // Line 1 owns "ab cd" + 6 hung spaces = 11 chars; line 2 owns "xy" → 13.
    expect(lines[0].inlineOffsetEnd).toBe(11);
    expect(lines[lines.length - 1].inlineOffsetEnd).toBe(13);
  });
});

describe("IFC — trailing-space HANG (#338 P1: a space unit never triggers its own wrap)", () => {
  // Local copies of the #314 harness (break-spaces, 8px/char mock shaper).
  function leavesOf(line: import("./layout-box-v2").LineBox) {
    const out: { x: number; width: number; text: string; offsetLength: number }[] = [];
    const walk = (boxes: readonly import("./layout-box-v2").LayoutBox[]) => {
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
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, width), shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const lines = out.children.filter((c): c is import("./layout-box-v2").LineBox => c.type === "line");
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
    expect(lines[0].inlineOffsetStart).toBe(0);
    expect(lines[0].inlineOffsetEnd).toBe(5);
    const line1Text = leavesOf(lines[0]).map(l => l.text).join("");
    expect(line1Text).toBe("word ");
  });

  it("following word WRAPS, the hung spaces stay: 'word1   word2' wraps word2 to line 2, spaces stay on line 1", () => {
    // "word1" = 5×8 = 40; +3 spaces = 64; "word2" = 40 ⇒ would be 104 total.
    // Width 64 fits "word1   " (8 chars × 8 = 64) exactly; "word2" overflows
    // (64 + 40 > 64) and — being a WORD unit — wraps to line 2. word1 is NOT
    // hopped: it stays on line 1 with its 3 hung spaces.
    const { lines } = linesOf("word1   word2", 64);
    expect(lines).toHaveLength(2);
    const line1Text = leavesOf(lines[0]).map(l => l.text).join("");
    expect(line1Text).toBe("word1   ");
    const line2Text = leavesOf(lines[1]).map(l => l.text).join("");
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
    const line1Text = leavesOf(lines[0]).map(l => l.text).join("");
    expect(line1Text).toBe("aaaa   "); // word + all 3 spaces hang on line 1
    const line2Text = leavesOf(lines[1]).map(l => l.text).join("");
    expect(line2Text).toBe("bb");
  });

  it("word never HOPS because of a trailing space (regression guard)", () => {
    // A word that fits exactly at line end, then a trailing space that overflows.
    // "abcd" = 32 = width; "abcd " = 40 > 32. The word must NOT move to line 2
    // because of the trailing space — it stays, the space hangs after it.
    const { lines } = linesOf("abcd ", 32);
    expect(lines).toHaveLength(1);
    const line1Text = leavesOf(lines[0]).map(l => l.text).join("");
    expect(line1Text).toBe("abcd ");
    expect(lines[0].inlineOffsetEnd).toBe(5);
  });

  it("NO-REGRESSION: a multi-word paragraph wrapping purely on words is unchanged", () => {
    // No trailing-space involvement: "aaaa bbbb cccc" at 72px wraps at the
    // interior space exactly as today ("aaaa bbbb" / "cccc").
    const { lines } = linesOf("aaaa bbbb cccc", 72);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const line1Text = leavesOf(lines[0]).map(l => l.text).join("").trimEnd();
    expect(line1Text).toBe("aaaa bbbb");
    const line2Text = leavesOf(lines[1]).map(l => l.text).join("").trim();
    expect(line2Text).toBe("cccc");
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
    if (lines[0].type !== "line") throw new Error("?");
    if (lines[1].type !== "line") throw new Error("?");
    const text0: string[] = [];
    const walk = (boxes: readonly import("./layout-box-v2").LayoutBox[]) => {
      for (const b of boxes) {
        if (b.type === "text-run") text0.push(b.text);
        else if (b.type === "inline") walk(b.children);
      }
    };
    walk(lines[0].children);
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
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    // Find the line within the nested paragraph block.
    const lines: import("./layout-box-v2").LineBox[] = [];
    const collect = (boxes: readonly import("./layout-box-v2").LayoutBox[]) => {
      for (const b of boxes) {
        if (b.type === "line") lines.push(b);
        else if (b.type === "block") collect(b.children);
      }
    };
    collect(out.children);
    expect(lines).toHaveLength(1);
    // "a" + 2 spaces + "b" = 4 chars, all preserved.
    expect(lines[0].inlineOffsetEnd).toBe(4);
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
    const r4 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r4.box === null) throw new Error("layoutBlock returned null box");
    const out = r4.box;
    if (out.type !== "block") throw new Error("?");
    if (out.children[0].type !== "line") throw new Error("?");
    const line = out.children[0];

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
    const r5 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r5.box === null) throw new Error("layoutBlock returned null box");
    const out = r5.box;
    if (out.type !== "block") throw new Error("?");
    if (out.children[0].type !== "line") throw new Error("?");
    const line = out.children[0];
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
    const r6 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r6.box === null) throw new Error("layoutBlock returned null box");
    const out = r6.box;
    if (out.type !== "block") throw new Error("?");
    if (out.children[0].type !== "line") throw new Error("?");
    const ib = out.children[0].children.find(c => c.type === "inline-block");
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
    const r7 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 60), shaper);
    if (r7.box === null) throw new Error("layoutBlock returned null box");
    const out = r7.box;
    if (out.type !== "block") throw new Error("?");
    const lines = out.children.filter(c => c.type === "line");
    expect(lines.length).toBeGreaterThanOrEqual(2);
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
    const r8 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 60), shaper);
    if (r8.box === null) throw new Error("layoutBlock returned null box");
    const out = r8.box;
    if (out.type !== "block") throw new Error("?");
    const lines = out.children.filter(c => c.type === "line");
    expect(lines.length).toBeGreaterThanOrEqual(2);

    // First line: inline fragment should be "first"
    if (lines[0].type !== "line") throw new Error("?");
    const firstInline = lines[0].children.find(c => c.type === "inline");
    expect(firstInline?.type).toBe("inline");
    if (firstInline?.type === "inline") {
      expect(firstInline.fragmentEdge).toBe("first");
    }

    // Last line: inline fragment should be "last"
    const lastLine = lines[lines.length - 1];
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
    const r9 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r9.box === null) throw new Error("layoutBlock returned null box");
    const out = r9.box;
    if (out.type !== "block") throw new Error("?");
    if (out.children[0].type !== "line") throw new Error("?");
    const inlineBox = out.children[0].children.find(c => c.type === "inline");
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
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 60), shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const lines = out.children.filter(c => c.type === "line");
    expect(lines.length).toBeGreaterThanOrEqual(2);

    // First line's inline fragment must be "first" (not "only").
    if (lines[0].type !== "line") throw new Error("?");
    const firstInline = lines[0].children.find(c => c.type === "inline");
    if (firstInline?.type !== "inline") throw new Error("?");
    expect(firstInline.fragmentEdge).toBe("first");
    expect(firstInline.ancestorKey).toBe("span-with-many-dashes-in-id");

    // Last line's inline fragment must be "last" (not "only").
    const lastLine = lines[lines.length - 1];
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
    const r10 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r10.box === null) throw new Error("layoutBlock returned null box");
    const out = r10.box;
    if (out.type !== "block") throw new Error("?");
    if (out.children[0].type !== "line") throw new Error("?");
    const ib = out.children[0].children.find(c => c.type === "inline-block");
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
    const r11 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r11.box === null) throw new Error("layoutBlock returned null box");
    const out = r11.box;
    if (out.type !== "block") throw new Error("?");
    if (out.children[0].type !== "line") throw new Error("?");
    const line = out.children[0];
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
    const r12 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r12.box === null) throw new Error("layoutBlock returned null box");
    const out = r12.box;
    if (out.type !== "block") throw new Error("?");
    if (out.children[0].type !== "line") throw new Error("?");
    const line = out.children[0];
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
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    if (out.children[0].type !== "line") throw new Error("?");
    const line = out.children[0];
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
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    if (out.children[0].type !== "line") throw new Error("?");
    const line = out.children[0];
    const ib = line.children.find(c => c.type === "inline-block");
    if (ib?.type !== "inline-block") throw new Error("?");
    const expectedOffset = (line.blockSize - ib.blockSize) / 2;
    expect(ib.blockOffset).toBe(expectedOffset);
    expect(ib.y).toBe(expectedOffset);
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

    const ifcResult = layoutInlineContent(tree, 0, 0, ctx, shaper);
    if (ifcResult.box === null) throw new Error("layoutInlineContent returned null box");
    const lines = ifcResult.box.children;

    // The first line's content area should start at x=100 (after the float)
    // and have width 100 (200 - 100).
    expect(lines.length).toBeGreaterThan(0);
    if (lines[0].type === "line") {
      expect(lines[0].x).toBe(100);
      expect(lines[0].width).toBe(100);
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
    const ifcResult2 = layoutInlineContent(tree, 0, 0, ctx, shaper);
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

    const ifcResult3 = layoutInlineContent(tree, 0, 0, ctx, shaper);
    if (ifcResult3.box === null) throw new Error("layoutInlineContent returned null box");
    const lines3 = ifcResult3.box.children;

    expect(lines3.length).toBeGreaterThan(0);
    const firstLine = lines3[0];
    expect(firstLine.y).toBe(50);
    if (firstLine.type === "line") {
      expect(firstLine.width).toBe(200);
    }
  });
});

describe("IFC — RTL bidi reordering", () => {
  it("reorders clusters for RTL paragraph: logical-second child has smaller inlineOffset than logical-first", () => {
    // mockShaper(8, 16): each char is 8px wide.
    // "abc" = 3 chars = 24px wide; "def" = 3 chars = 24px wide.
    // Line available = 200px — both fit on one line.
    // Logical order: text1("abc") then text2("def").
    // After RTL reorder: text2 appears visually first (smaller inlineOffset),
    // text1 appears visually second (larger inlineOffset).
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
      rtlShaper,
    );
    if (ifcResultRtl.box === null) throw new Error("layoutInlineContent returned null box");
    const linesRtl = ifcResultRtl.box.children;

    expect(linesRtl.length).toBeGreaterThan(0);
    const line = linesRtl[0];
    if (line.type !== "line") throw new Error("expected line box");
    expect(line.children.length).toBeGreaterThanOrEqual(2);

    // Find the two text-run boxes by key prefix (t1 and t2).
    const t1Box = line.children.find(c => c.key.startsWith("t1"));
    const t2Box = line.children.find(c => c.key.startsWith("t2"));
    expect(t1Box).toBeDefined();
    expect(t2Box).toBeDefined();
    if (!t1Box || !t2Box) throw new Error("?");

    // After RTL reorder, the logical-second child (t2) should appear visually
    // before the logical-first child (t1): t2.inlineOffset < t1.inlineOffset.
    expect(t2Box.inlineOffset).toBeLessThan(t1Box.inlineOffset);

    // Also verify the rightmost child (t1, logical-first) sits at the right edge.
    // For a 200px line with t1=24px at the visual end:
    //   t1.inlineOffset = 200 - 0 - 24 = 176 (it was originally at offset 0, size 24)
    // Wait: logical order places t1 at offset 0, size 24.
    // Reorder: newInlineOffset = 200 - 0 - 24 = 176.
    expect(t1Box.inlineOffset).toBe(200 - t1Box.inlineSize);
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
    const ifcResultLtr = layoutInlineContent(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 200), ltrShaper);
    if (ifcResultLtr.box === null) throw new Error("layoutInlineContent returned null box");
    const linesLtr = ifcResultLtr.box.children;

    expect(linesLtr.length).toBeGreaterThan(0);
    const line = linesLtr[0];
    if (line.type !== "line") throw new Error("expected line box");

    const t1Box = line.children.find(c => c.key.startsWith("t1"));
    const t2Box = line.children.find(c => c.key.startsWith("t2"));
    expect(t1Box).toBeDefined();
    expect(t2Box).toBeDefined();
    if (!t1Box || !t2Box) throw new Error("?");

    // LTR: t1 comes before t2 in visual order (smaller inlineOffset).
    expect(t1Box.inlineOffset).toBeLessThan(t2Box.inlineOffset);
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
      shaperWithHyphen(),
    );
    if (ifcResultH1.box === null) throw new Error("layoutInlineContent returned null box");
    const linesH1 = ifcResultH1.box.children;

    // Should produce at least 2 lines (the word was split).
    expect(linesH1.length).toBeGreaterThanOrEqual(2);

    // The first line should end with a "-" text-run box.
    const firstLine = linesH1[0];
    if (firstLine.type !== "line") throw new Error("expected line box");
    expect(firstLine.children.length).toBeGreaterThan(0);
    const lastChild = firstLine.children[firstLine.children.length - 1];
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
      shaperWithHyphen(),
    );
    if (ifcResultH2.box === null) throw new Error("layoutInlineContent returned null box");
    const linesH2 = ifcResultH2.box.children;

    expect(linesH2.length).toBeGreaterThanOrEqual(2);
    const secondLine = linesH2[1];
    if (secondLine.type !== "line") throw new Error("expected line box");
    expect(secondLine.children.length).toBeGreaterThan(0);
    // The first child of line 2 should be the suffix "fgh".
    const firstChild = secondLine.children[0];
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
      shaperWithHyphen(),
    );
    if (result.box === null) throw new Error("layoutInlineContent returned null box");
    const lines = result.box.children.filter(
      (l): l is import("./layout-box-v2").LineBox => l.type === "line",
    );
    expect(lines.length).toBeGreaterThanOrEqual(2);

    // The word was hyphen-split: line 1 ends with "abcde" + a "-" glyph.
    const line1 = lines[0];
    const prefixRuns = line1.children.filter(
      (c): c is import("./layout-box-v2").TextRunBox => c.type === "text-run",
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
      expect(lines[i + 1].inlineOffsetStart).toBe(lines[i].inlineOffsetEnd);
    }
    expect(lines[lines.length - 1].inlineOffsetEnd).toBe("abcdefgh  ij".length);

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
    const line2 = lines[1];
    const line2RunOffsetLen = line2.children
      .filter((c): c is import("./layout-box-v2").TextRunBox => c.type === "text-run")
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
    expect(tokens[0].id).toBe("t:0");   // "abc" starts at offset 0
    expect(tokens[1].id).toBe("t:3");   // " " starts at offset 3
    expect(tokens[2].id).toBe("t:4");   // "def" starts at offset 4
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
    expect(tokens[0].id).toBe("ib");
    expect(tokens[0].inlineBlock).toBeDefined();
  });

  it("hard-break token gets id = sourceKey:lb", () => {
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
    const line = lines[0];
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
      const cur = lines[i];
      const next = lines[i + 1];
      if (cur.type !== "line" || next.type !== "line") throw new Error("expected lines");
      expect(next.inlineOffsetStart).toBe(cur.inlineOffsetEnd);
      // All except the last are NOT block-boundary.
      expect(cur.isBlockBoundaryLine).toBe(false);
    }
    const last = lines[lines.length - 1];
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
    const last = lines[lines.length - 1];
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
    const result = layoutInlineContent(tree, 0, 0, ctx, shaper);
    if (result.box === null) throw new Error("layoutInlineContent returned null box");
    const line = result.box.children[0];
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
    const r1 = layoutInlineContent(tree, 0, 0, ctx, shaper);
    const r2 = layoutInlineContent(tree, 0, 0, ctx, shaper);
    if (r1.box === null || r2.box === null) throw new Error("?");
    const l1 = r1.box.children[0];
    const l2 = r2.box.children[0];
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
    const result = layoutInlineContent(tree, 0, 0, ctx, shaper);
    if (result.box === null) throw new Error("layoutInlineContent returned null box");
    const line = result.box.children[0];
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
    const result = layoutInlineContent(tree, 0, 0, ctx, shaper);
    if (result.box === null) throw new Error("layoutInlineContent returned null box");
    const line = result.box.children[0];
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
    const r1 = layoutInlineContent(tree, 0, 0, ctx, shaper, {
      availableBlockSize: 32,
      resumeFrom: null,
      pageIndex: 0,
    });
    if (r1.box === null) throw new Error("expected partial fragment");
    if (r1.breakToken === null) throw new Error("expected break token");
    const lines1 = r1.box.children.filter((c): c is import("./layout-box-v2").LineBox => c.type === "line");
    expect(lines1.length).toBeGreaterThan(0);

    // Resume from the break token. Big availableBlockSize so it
    // finishes.
    const r2 = layoutInlineContent(tree, 0, 0, ctx, shaper, {
      availableBlockSize: 10_000,
      resumeFrom: r1.breakToken,
      pageIndex: 1,
    });
    if (r2.box === null) throw new Error("expected resumed fragment box");
    const lines2 = r2.box.children.filter((c): c is import("./layout-box-v2").LineBox => c.type === "line");
    expect(lines2.length).toBeGreaterThan(0);

    // ownerBlockId propagates to every line, including resumed.
    for (const line of [...lines1, ...lines2]) {
      expect(line.ownerBlockId).toBe("p");
    }
    // Offset continuity: lines1 final inlineOffsetEnd === lines2 first inlineOffsetStart.
    expect(lines2[0].inlineOffsetStart).toBe(lines1[lines1.length - 1].inlineOffsetEnd);
    // Cumulative coverage: lines2 final inlineOffsetEnd === text length.
    expect(lines2[lines2.length - 1].inlineOffsetEnd).toBe(text.length);
    // isBlockBoundaryLine: only the absolutely-last line carries true.
    expect(lines2[lines2.length - 1].isBlockBoundaryLine).toBe(true);
    // Any line before the last on either fragment is NOT a boundary.
    for (let i = 0; i < lines1.length; i++) {
      expect(lines1[i].isBlockBoundaryLine).toBe(false);
    }
    for (let i = 0; i < lines2.length - 1; i++) {
      expect(lines2[i].isBlockBoundaryLine).toBe(false);
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
    expect(tokens[0].inlineBlock).toBeDefined();
    expect(tokens[0].sourceLength).toBe(1);
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
});

describe("layoutInlineContent — offsetLength (state-correct line offsets across collapse)", () => {
  it("single space 'a b': inlineOffsetEnd === text.length (no regression)", () => {
    const lines = ifcOf("a b", 200);
    const line = lines[0];
    if (line.type !== "line") throw new Error("expected line");
    expect(line.inlineOffsetEnd).toBe("a b".length);
  });

  it("double space 'a  b': run offsetLengths sum to 4; line inlineOffsetEnd === 4", () => {
    const lines = ifcOf("a  b", 200);
    const line = lines[0];
    if (line.type !== "line") throw new Error("expected line");
    // The line spans the full state range including the collapsed space.
    expect(line.inlineOffsetEnd).toBe(4);
    // Sum the text-run children's offsetLength → must equal state length.
    const runs = line.children.filter((c): c is import("./layout-box-v2").TextRunBox => c.type === "text-run");
    const total = runs.reduce((s, r) => s + r.offsetLength, 0);
    expect(total).toBe(4);
  });

  it("triple space 'a   b': line inlineOffsetEnd === 5 (collapse count 2 owned by run)", () => {
    const lines = ifcOf("a   b", 200);
    const line = lines[0];
    if (line.type !== "line") throw new Error("expected line");
    expect(line.inlineOffsetEnd).toBe(5);
  });

  it("soft-wrap with a collapsed trailing space at the break: lines connect by state offset", () => {
    // Force a wrap mid-paragraph; a collapsed double space sits at the wrap.
    // mock shaper 8px/char. "dsajidosja idoajs  dsajiodj saoidj".
    const text = "dsajidosja idoajs  dsajiodj saoidj";
    const lines = ifcOf(text, 150).filter((l): l is import("./layout-box-v2").LineBox => l.type === "line");
    expect(lines.length).toBeGreaterThan(1);
    for (let i = 0; i + 1 < lines.length; i++) {
      expect(lines[i + 1].inlineOffsetStart).toBe(lines[i].inlineOffsetEnd);
    }
    // Cumulative coverage reaches the full state length.
    expect(lines[lines.length - 1].inlineOffsetEnd).toBe(text.length);
  });
});
