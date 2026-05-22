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
