import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { layoutBlock } from "../layout/bfc";
import { layoutTree } from "../layout/dispatch";
import { positionTreeForTest } from "../test-utils/position-tree";
import { createMockShaper } from "@taleweaver/core";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { computeUsedStyle } from "../layout/used-style";
import { createLineBox, createTextRunBox, createBlockBox, createMultiColumnBox } from "../layout/layout-box";
import { makeRootContext } from "../layout/layout-context";
import { createPosition } from "@taleweaver/core";
import type { BlockId } from "@taleweaver/core";
import { collectLineBoxes, collectLineLeaves, findLineForPosition, getLineIndex, type AbsoluteLineBox } from "./line-flatten";
import { resolvePositionFromPixel } from "./hit-test";
import { buildState, buildBlock, inlineContent, text } from "@taleweaver/core";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const shaper = createMockShaper(8, 16);

describe("collectLineBoxes", () => {
  it("collects a single block's lines with absolute coordinates", () => {
    const tree = cascadePass(
      createElementBox("doc", { display: "block" }, [
        createElementBox("p", { display: "block" }, [
          createTextBox("t", {}, "hello world"),
        ]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const r = layoutBlock(tree, 0, 0, ctx, shaper, undefined);
    if (r.box === null) throw new Error("?");

    const out: AbsoluteLineBox[] = [];
    collectLineBoxes(r.box, 0, 0, out);

    expect(out.length).toBe(1);
    expect(nth(out, 0, "out").line.type).toBe("line");
    // Through the BFC, text children are wrapped in an anonymous block.
    // ownerBlockId reflects the anonymous block that runs the IFC.
    expect(nth(out, 0, "out").line.ownerBlockId).toMatch(/^p(\/anon\[\d+\])?$/);
    expect(nth(out, 0, "out").pageIndex).toBe(0);
    expect(nth(out, 0, "out").absoluteX).toBeGreaterThanOrEqual(0);
    expect(nth(out, 0, "out").absoluteY).toBeGreaterThanOrEqual(0);
  });

  it("collects lines from multiple sibling blocks in document order", () => {
    const tree = cascadePass(
      createElementBox("doc", { display: "block" }, [
        createElementBox("p1", { display: "block" }, [createTextBox("t1", {}, "first paragraph")]),
        createElementBox("p2", { display: "block" }, [createTextBox("t2", {}, "second paragraph")]),
        createElementBox("p3", { display: "block" }, [createTextBox("t3", {}, "third paragraph")]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const r = layoutBlock(tree, 0, 0, ctx, shaper, undefined);
    if (r.box === null) throw new Error("?");

    const out: AbsoluteLineBox[] = [];
    collectLineBoxes(r.box, 0, 0, out);

    expect(out.length).toBe(3);
    expect(nth(out, 0, "out").line.ownerBlockId).toMatch(/^p1(\/anon\[\d+\])?$/);
    expect(nth(out, 1, "out").line.ownerBlockId).toMatch(/^p2(\/anon\[\d+\])?$/);
    expect(nth(out, 2, "out").line.ownerBlockId).toMatch(/^p3(\/anon\[\d+\])?$/);
    // Strictly increasing absoluteY (one line per block, each stacks
    // below the previous).
    expect(nth(out, 1, "out").absoluteY).toBeGreaterThan(nth(out, 0, "out").absoluteY);
    expect(nth(out, 2, "out").absoluteY).toBeGreaterThan(nth(out, 1, "out").absoluteY);
  });

  it("collects lines from a wrapped paragraph (one entry per visual line)", () => {
    const tree = cascadePass(
      createElementBox("doc", { display: "block" }, [
        createElementBox("p", { display: "block" }, [
          createTextBox("t", {}, "a b c d e f g h i j"),
        ]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 30);
    const r = layoutBlock(tree, 0, 0, ctx, shaper, undefined);
    if (r.box === null) throw new Error("?");

    const out: AbsoluteLineBox[] = [];
    collectLineBoxes(r.box, 0, 0, out);

    expect(out.length).toBeGreaterThan(1);
    // All entries reference the same source block.
    const firstOwner = nth(out, 0, "out").line.ownerBlockId;
    for (const e of out) expect(e.line.ownerBlockId).toBe(firstOwner);
    // Last entry is the block's boundary line.
    expect(nth(out, out.length - 1, "out").line.isBlockBoundaryLine).toBe(true);
    // No entry except the last is the block's boundary line.
    for (let i = 0; i < out.length - 1; i++) {
      expect(nth(out, i, "out").line.isBlockBoundaryLine).toBe(false);
    }
  });

  it("uses LineBox reference identity (two collections of the same tree return same line refs)", () => {
    const tree = cascadePass(
      createElementBox("doc", { display: "block" }, [
        createElementBox("p", { display: "block" }, [createTextBox("t", {}, "hello")]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const r = layoutBlock(tree, 0, 0, ctx, shaper, undefined);
    if (r.box === null) throw new Error("?");

    const out1: AbsoluteLineBox[] = [];
    const out2: AbsoluteLineBox[] = [];
    collectLineBoxes(r.box, 0, 0, out1);
    collectLineBoxes(r.box, 0, 0, out2);

    expect(out1.length).toBe(out2.length);
    // Same LineBox reference both times.
    for (let i = 0; i < out1.length; i++) {
      expect(nth(out2, i, "out2").line).toBe(nth(out1, i, "out1").line);
    }
  });

  it("multicolumn: emits lines in column order (col0 then col1)", () => {
    // Multi-column slice 2 — the VISUAL-ORDER GUARANTEE. Hand-build a
    // MultiColumnBox nested under a body block. col0 holds two paragraph blocks
    // (each one line); col1 holds one. A depth-first walk descending `columns`
    // left-to-right must emit col0's two lines BEFORE col1's one — visual reading
    // order. Which column each line belongs to is recoverable geometrically (its
    // absoluteX within the column box's inline range), as asserted below.
    const mcCs = INITIAL_COMPUTED_STYLE;
    const mcUs = computeUsedStyle(mcCs, 240, "indefinite");
    const blockId = "b" as BlockId;
    // A single-line paragraph block at the given block-offset inside a 240px column.
    const para = (key: string, blockOffset: number): ReturnType<typeof createBlockBox> => {
      const run = createTextRunBox(
        `${key}-run`, 0, 0, 40, 16, "horizontal-tb", "ltr", mcCs, mcUs, "x", 1, 240,
      );
      const line = createLineBox(
        `${key}-line`, 0, 0, 240, 16, "horizontal-tb", "ltr", mcCs, mcUs, [run],
        16, 240, blockId, 0, 1, true,
      );
      return createBlockBox(key, 0, blockOffset, 240, 16, "horizontal-tb", "ltr", mcCs, mcUs, [line], 240);
    };
    // col0: two stacked paragraphs; col1: one. Columns sit side by side.
    const col0 = createBlockBox(
      "col0", 0, 0, 240, 400, "horizontal-tb", "ltr", mcCs, mcUs,
      [para("c0p0", 0), para("c0p1", 20)], 500,
    );
    const col1 = createBlockBox(
      "col1", 260, 0, 240, 400, "horizontal-tb", "ltr", mcCs, mcUs,
      [para("c1p0", 0)], 500,
    );
    const mc = createMultiColumnBox(
      "mc", 0, 0, 500, 400, "horizontal-tb", "ltr", mcCs, mcUs, [col0, col1], null, 500,
    );
    const body = createBlockBox("body", 0, 0, 500, 400, "horizontal-tb", "ltr", mcCs, mcUs, [mc], 500);

    const out: AbsoluteLineBox[] = [];
    collectLineBoxes(body, 0, 0, out);

    // Three lines total, in column order: col0's two, then col1's one.
    expect(out.map((e) => e.line.key)).toEqual(["c0p0-line", "c0p1-line", "c1p0-line"]);
    // Column membership is recoverable geometrically: col0's two lines sit at the
    // col0 track origin (x=0) and col1's line at the col1 track origin (x=260).
    expect(nth(out, 0, "out").absoluteX).toBe(0);
    expect(nth(out, 1, "out").absoluteX).toBe(0);
    expect(nth(out, 2, "out").absoluteX).toBe(260);
    // col1 sits to the RIGHT of col0 (visual side-by-side), even though it comes
    // LATER in the flat (reading) order — the visual-order proof's premise.
    expect(nth(out, 2, "out").absoluteX).toBeGreaterThan(nth(out, 0, "out").absoluteX);
  });

  it("handles paginated trees: pageIndex propagates to children, coordinates page-relative", () => {
    // Stack of paragraphs that need pagination at a small page height.
    const tree = cascadePass(
      createElementBox("doc", { display: "block" }, [
        createElementBox("p1", { display: "block" }, [createTextBox("t1", {}, "first")]),
        createElementBox("p2", { display: "block" }, [createTextBox("t2", {}, "second")]),
        createElementBox("p3", { display: "block" }, [createTextBox("t3", {}, "third")]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    // Page large enough for ~1 paragraph (16px) plus margins.
    const root = positionTreeForTest(layoutTree(tree, 500, shaper, {
      pageInlineSize: 500,
      pageBlockSize: 40,
      pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
      pageGap: 0,
    }));

    const out: AbsoluteLineBox[] = [];
    collectLineBoxes(root, 0, 0, out);

    expect(out.length).toBe(3);
    // Lines distributed across pages.
    const pageIndexes = new Set(out.map(e => e.pageIndex));
    expect(pageIndexes.size).toBeGreaterThan(1);
    // Every line's pageIndex is consistent with what layoutTree produced.
    for (const e of out) {
      expect(e.pageIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it("emits only LineBoxes — text-runs and markers are not in the output (even though within-line descent occurs for inline-block-nested lines)", () => {
    const tree = cascadePass(
      createElementBox("doc", { display: "block" }, [
        createElementBox("p", { display: "block" }, [createTextBox("t", {}, "abc")]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const r = layoutBlock(tree, 0, 0, ctx, shaper, undefined);
    if (r.box === null) throw new Error("?");

    const out: AbsoluteLineBox[] = [];
    collectLineBoxes(r.box, 0, 0, out);

    expect(out.length).toBe(1);
    // The collected entry is a LineBox, not a text-run.
    expect(nth(out, 0, "out").line.type).toBe("line");
    // The text-runs are children of the line — accessible if needed
    // but not in the flat collection.
    expect(nth(out, 0, "out").line.children.length).toBeGreaterThan(0);
  });

  it("collects lines from nested inline-blocks' own IFCs", () => {
    // An inline-block creates its own BlockBox / IFC. Lines inside
    // the inline-block should also be collected.
    const tree = cascadePass(
      createElementBox("doc", { display: "block" }, [
        createElementBox("p", { display: "block" }, [
          createTextBox("t1", { display: "inline" }, "outer "),
          createElementBox("ib", { display: "inline-block", inlineSize: 60, blockSize: 32 }, [
            createElementBox("ib-p", { display: "block" }, [createTextBox("ib-t", {}, "inner")]),
          ]),
          createTextBox("t2", { display: "inline" }, " after"),
        ]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const r = layoutBlock(tree, 0, 0, ctx, shaper, undefined);
    if (r.box === null) throw new Error("?");

    const out: AbsoluteLineBox[] = [];
    collectLineBoxes(r.box, 0, 0, out);

    // At least the outer paragraph's line + the inline-block's inner line.
    expect(out.length).toBeGreaterThanOrEqual(2);
    const ownerIds = new Set(out.map(e => e.line.ownerBlockId));
    // Both the outer block and the inline-block's inner block appear
    // as owners.
    // Through the BFC, both the outer and inner blocks wrap their text
    // children in anonymous blocks. ownerBlockId reflects the actual
    // IFC-runner block (which may be the anonymous wrap).
    expect([...ownerIds].some(id => /^p(\/anon\[\d+\])?$/.test(id))).toBe(true);
    expect([...ownerIds].some(id => /^ib-p(\/anon\[\d+\])?$/.test(id))).toBe(true);
  });
});

// POSITIONING slice 3 (LOAD-BEARING, design-review C3) — `collectLineBoxes` MUST
// descend `absoluteChildren`. Abs-pos content is reachable ONLY via that field; if
// the walk skipped it, lines inside an abs-pos subtree would be ABSENT from
// `getLineIndex().all` → invisible to hit-test / cursor / selection / line-nav. These
// tests prove the abs paragraph's line enters the flat index AND that a click inside
// it resolves to the correct caret offset.
describe("collectLineBoxes — descends absoluteChildren (slice 3)", () => {
  // A relative root with one normal paragraph + one abs paragraph (offset down so
  // its line sits at a known y). `position`/`inset*` are real Style fields (slice 1),
  // so cascadePass composes them — no attr interpreter needed. The abs paragraph's
  // text is DIRECT inline content so the IFC stamps `ownerBlockId === "pabs"` (the
  // source block), matching the State below for the hit-test.
  function relativeRootWithAbs() {
    const tree = cascadePass(
      createElementBox("doc", { display: "block", position: "relative" }, [
        createElementBox("pnorm", { display: "block" }, [createTextBox("tn", {}, "normal text")]),
        createElementBox("pabs", { display: "block", position: "absolute", insetInlineStart: 30, insetBlockStart: 100 }, [
          createTextBox("ta", {}, "absolute text"),
        ]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const r = layoutBlock(tree, 0, 0, ctx, shaper, undefined);
    if (r.box === null) throw new Error("?");
    return r.box;
  }

  it("the abs paragraph's line IS present in getLineIndex().all at its resolved abs coords", () => {
    const root = relativeRootWithAbs();
    const all = getLineIndex(root).all;
    // Both the normal line and the abs line are present (2 lines).
    const absLine = all.find((al) => al.line.ownerBlockId === "pabs");
    expect(absLine).toBeDefined();
    if (absLine === undefined) throw new Error("abs line missing from LineIndex");
    // The abs line sits at the resolved inset position: inset-inline-start 30 → x≈30,
    // inset-block-start 100 → y≈100. (Exact x may include the line's own inset; assert
    // the resolved offset is reflected, proving the absoluteChildren walk carried the
    // establishing box's origin.)
    expect(absLine.absoluteX).toBe(30);
    expect(absLine.absoluteY).toBe(100);
  });

  it("a click inside the abs paragraph resolves to the correct caret offset (reachability)", () => {
    const root = relativeRootWithAbs();
    // State whose `pabs` block carries the same text, so the picked line's
    // ownerBlockId resolves to a real block and the within-line offset maps to a
    // Position. (Mirror of the layout: a document root + two paragraphs.)
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "pnorm", lastChildId: "pabs" }),
        buildBlock({ id: "pnorm", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("normal text")]) }),
        buildBlock({ id: "pabs", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("absolute text")]) }),
      ],
    });
    // Click ~3 chars into the abs line (each glyph 8px; line baseline at y≈100..116).
    // x = 30 (line start) + 3*8 + 1 = 55 lands in the 4th char's cell → offset 3.
    const hit = resolvePositionFromPixel(state, root, shaper, 55, 108);
    expect(hit).not.toBeNull();
    if (hit === null) throw new Error("hit-test returned null inside abs paragraph");
    expect(hit.position.blockId).toBe("pabs" as BlockId);
    expect(hit.position.offset).toBe(3);
  });
});

describe("getLineIndex (L-PERF-D)", () => {
  function buildLayoutTree(): import("../layout/layout-node").LayoutBox {
    const tree = cascadePass(
      createElementBox("doc", { display: "block" }, [
        createElementBox("p1", { display: "block" }, [createTextBox("t1", {}, "hello")]),
        createElementBox("p2", { display: "block" }, [createTextBox("t2", {}, "world")]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const r = layoutBlock(tree, 0, 0, ctx, shaper, undefined);
    if (r.box === null) throw new Error("?");
    return r.box;
  }

  it("byBlock returns the lines owned by the given BlockId", () => {
    const root = buildLayoutTree();
    const index = getLineIndex(root);
    const p1Lines = index.byBlock.get("p1" as BlockId);
    const p2Lines = index.byBlock.get("p2" as BlockId);
    expect(p1Lines?.length).toBeGreaterThan(0);
    expect(p2Lines?.length).toBeGreaterThan(0);
    expect(p1Lines?.every((al: AbsoluteLineBox) => al.line.ownerBlockId === "p1")).toBe(true);
    expect(p2Lines?.every((al: AbsoluteLineBox) => al.line.ownerBlockId === "p2")).toBe(true);
  });

  it("all is the same flat list collectLineBoxes would produce", () => {
    const root = buildLayoutTree();
    const indexAll = getLineIndex(root).all;
    const direct: AbsoluteLineBox[] = [];
    collectLineBoxes(root, 0, 0, direct);
    expect(indexAll.length).toBe(direct.length);
    for (let i = 0; i < direct.length; i++) {
      // Same LineBox references in the same order.
      expect(nth(indexAll, i, "indexAll").line).toBe(nth(direct, i, "direct").line);
    }
  });

  it("returns the SAME index instance for repeated calls on the same root (WeakMap cache)", () => {
    const root = buildLayoutTree();
    const a = getLineIndex(root);
    const b = getLineIndex(root);
    expect(a).toBe(b);
    expect(a.all).toBe(b.all);
    expect(a.byBlock).toBe(b.byBlock);
  });

  it("byBlock.get for an unknown BlockId returns undefined (caller falls back to [])", () => {
    const root = buildLayoutTree();
    const index = getLineIndex(root);
    expect(index.byBlock.get("nope" as BlockId)).toBeUndefined();
  });

  it("returns a DIFFERENT index instance for a different root (cache miss across layout cycles)", () => {
    // Each call to buildLayoutTree allocates a fresh LayoutBox root —
    // simulating two layout cycles producing different root references.
    // The WeakMap-keyed cache must miss for the new root so we don't
    // serve stale geometry after a re-layout.
    const root1 = buildLayoutTree();
    const root2 = buildLayoutTree();
    expect(root1).not.toBe(root2);
    const a = getLineIndex(root1);
    const b = getLineIndex(root2);
    expect(a).not.toBe(b);
  });

  it("byBlock partitions outer-block and inline-block-internal lines into separate buckets", () => {
    // When a block contains an inline-block with its own nested
    // LineBoxes, byBlock must keep those inner lines under the inner
    // block's ownerBlockId — not leak them into the outer block's
    // bucket. Guards against an IFC change that loses the
    // anonymous-wrap stripping.
    const tree = cascadePass(
      createElementBox("doc", { display: "block" }, [
        createElementBox("p", { display: "block" }, [
          createTextBox("t1", { display: "inline" }, "outer "),
          createElementBox(
            "ib",
            { display: "inline-block", inlineSize: 60, blockSize: 32 },
            [
              createElementBox("ib-p", { display: "block" }, [
                createTextBox("ib-t", {}, "inner"),
              ]),
            ],
          ),
        ]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const r = layoutBlock(tree, 0, 0, ctx, shaper, undefined);
    if (r.box === null) throw new Error("?");
    const index = getLineIndex(r.box);
    // Every line in every bucket is owned by that bucket's key.
    for (const [blockId, lines] of index.byBlock) {
      for (const al of lines) {
        expect(al.line.ownerBlockId).toBe(blockId);
      }
    }
    // Both outer and inner blocks have at least one line. (The IFC
    // wraps inline-bearing blocks in anonymous wrappers keyed
    // "X/anon[N]"; ownerBlockId is the same as the inline-runner key.)
    const ownerKeys = [...index.byBlock.keys()];
    expect(ownerKeys.some(id => /^p(\/anon\[\d+\])?$/.test(id))).toBe(true);
    expect(ownerKeys.some(id => /^ib-p(\/anon\[\d+\])?$/.test(id))).toBe(true);
  });
});

describe("findLineForPosition", () => {
  function singleLineFixture(): AbsoluteLineBox[] {
    const tree = cascadePass(
      createElementBox("doc", { display: "block" }, [
        createElementBox("p", { display: "block" }, [createTextBox("t", {}, "hello")]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const r = layoutBlock(tree, 0, 0, ctx, shaper, undefined);
    if (r.box === null) throw new Error("?");
    const out: AbsoluteLineBox[] = [];
    collectLineBoxes(r.box, 0, 0, out);
    return out;
  }

  function multiLineFixture(): { lines: AbsoluteLineBox[]; ownerId: string } {
    const tree = cascadePass(
      createElementBox("doc", { display: "block" }, [
        createElementBox("p", { display: "block" }, [createTextBox("t", {}, "a b c d e f g h i j")]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 30);
    const r = layoutBlock(tree, 0, 0, ctx, shaper, undefined);
    if (r.box === null) throw new Error("?");
    const out: AbsoluteLineBox[] = [];
    collectLineBoxes(r.box, 0, 0, out);
    return { lines: out, ownerId: nth(out, 0, "out").line.ownerBlockId };
  }

  it("returns index of line containing position in a single-line block", () => {
    const lines = singleLineFixture();
    const owner = nth(lines, 0, "lines").line.ownerBlockId;
    const idx = findLineForPosition(lines, createPosition(owner as BlockId, 2));
    expect(idx).toBe(0);
  });

  it("returns -1 for an unknown blockId", () => {
    const lines = singleLineFixture();
    const idx = findLineForPosition(lines, createPosition("not-a-block" as BlockId, 0));
    expect(idx).toBe(-1);
  });

  it("returns the last same-block candidate for offset past block end", () => {
    const { lines, ownerId } = multiLineFixture();
    expect(lines.length).toBeGreaterThan(1);
    // Offset far past block end → clamps to last line.
    const idx = findLineForPosition(lines, createPosition(ownerId as BlockId, 9999));
    expect(idx).toBe(lines.length - 1);
  });

  it("at soft-wrap boundary, prefers the next same-block line", () => {
    const { lines, ownerId } = multiLineFixture();
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const line0End = nth(lines, 0, "lines").line.inlineOffsetEnd;
    // At exact end of line 0, prefer line 1.
    const idx = findLineForPosition(lines, createPosition(ownerId as BlockId, line0End));
    expect(idx).toBe(1);
  });

  it("with inline-block-interleaved lines, walks past foreign lines to find later same-block lines", () => {
    // Outer paragraph wraps; on one of its lines is an inline-block
    // whose nested IFC produces its own LineBoxes. These appear
    // interleaved in `collectLineBoxes` output. A position past the
    // inline-block, on a subsequent outer-paragraph wrap line, must
    // still resolve to the outer paragraph's line — not be cut off
    // by the early-return on foreign blockId.
    const tree = cascadePass(
      createElementBox("doc", { display: "block" }, [
        createElementBox("p", { display: "block" }, [
          createTextBox("t1", { display: "inline" }, "a "),
          createElementBox("ib", { display: "inline-block", inlineSize: 20, blockSize: 16 }, [
            createElementBox("ib-p", { display: "block" }, [createTextBox("ib-t", {}, "x")]),
          ]),
          createTextBox("t2", { display: "inline" }, " b c d e f g h i j k l m n o p"),
        ]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 40);
    const r = layoutBlock(tree, 0, 0, ctx, shaper, undefined);
    if (r.box === null) throw new Error("?");
    const lines: AbsoluteLineBox[] = [];
    collectLineBoxes(r.box, 0, 0, lines);
    // Find outer-paragraph lines.
    const outerOwner = lines.find(l => /^p(\/anon\[\d+\])?$/.test(l.line.ownerBlockId))?.line.ownerBlockId;
    expect(outerOwner).toBeDefined();
    if (outerOwner === undefined) return;
    const outerLines = lines.filter(l => l.line.ownerBlockId === outerOwner);
    expect(outerLines.length).toBeGreaterThan(1);
    const lastOuter = nth(outerLines, outerLines.length - 1, "outer line");
    // Position past the end of the last outer line should resolve to it.
    const idx = findLineForPosition(lines, createPosition(outerOwner as BlockId, 9999));
    expect(nth(lines, idx, "lines").line).toBe(lastOuter.line);
  });
});

describe("collectLineLeaves — offsetContribution = state span (collapsed whitespace)", () => {
  it("text-run leaf offsetContribution equals the run's offsetLength, not rendered text.length", () => {
    // "a  b" (double space) → run "a " owns 2 source chars (rendered "a "
    // is 2ch — coincidentally; the discriminating case is the inter-word
    // collapse). Use "idoajs  dsajiodj" so the "idoajs " run owns the
    // collapsed double space: rendered "idoajs " = 7ch, offsetLength = 8.
    const tree = cascadePass(
      createElementBox("doc", { display: "block" }, [
        createElementBox("p", { display: "block" }, [
          createTextBox("t", {}, "idoajs  dsajiodj"),
        ]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 800);
    const r = layoutBlock(tree, 0, 0, ctx, shaper, undefined);
    if (r.box === null) throw new Error("?");
    const lines: AbsoluteLineBox[] = [];
    collectLineBoxes(r.box, 0, 0, lines);
    expect(lines.length).toBe(1);

    const leaves = collectLineLeaves(nth(lines, 0, "lines").line, nth(lines, 0, "lines").absoluteX, nth(lines, 0, "lines").absoluteY);
    const textLeaves = leaves.filter(l => l.kind === "text-run");
    // The "idoajs " run: rendered text length 7, offsetContribution 8.
    const idoajs = textLeaves.find(l => l.kind === "text-run" && l.box.text === "idoajs ");
    expect(idoajs).toBeDefined();
    if (idoajs === undefined || idoajs.kind !== "text-run") return;
    expect(idoajs.box.text.length).toBe(7);
    expect(idoajs.box.offsetLength).toBe(8);
    expect(idoajs.offsetContribution).toBe(8);

    // Sum of contributions equals the line's state span.
    const total = leaves.reduce((s, l) => s + l.offsetContribution, 0);
    expect(total).toBe(nth(lines, 0, "lines").line.inlineOffsetEnd - nth(lines, 0, "lines").line.inlineOffsetStart);
    expect(total).toBe("idoajs  dsajiodj".length);
  });
});

describe("collectLineLeaves — no double-count of the line's own x (alignment offset)", () => {
  const cs = INITIAL_COMPUTED_STYLE;
  const us = computeUsedStyle(cs, 200, "indefinite");

  /**
   * Build a LineBox whose own physical `x` is `lineX` (e.g. an alignment
   * offset for a centered/right line) holding text-run children at the given
   * relative inline offsets. For `horizontal-tb`/`ltr` the physical `x` equals
   * the logical `inlineOffset`, so passing `inlineOffset = lineX` produces
   * `line.x === lineX` and a child with `inlineOffset = relX` has `child.x ===
   * relX`. The line's ABSOLUTE x (what `collectLineLeaves` is GIVEN) is `lineX`
   * itself in these fixtures (the line's parent block sits at document x 0).
   */
  function buildLine(
    lineX: number,
    children: ReadonlyArray<{ key: string; relX: number; width: number; text: string }>,
  ) {
    const runs = children.map((c) =>
      createTextRunBox(c.key, c.relX, 0, c.width, 16, "horizontal-tb", "ltr", cs, us, c.text, c.text.length, 200),
    );
    // line spans the full container width; its own physical x is `lineX`.
    return createLineBox(
      "line", lineX, 0, 200 - lineX, 16, "horizontal-tb", "ltr", cs, us,
      runs, 16, 200, "owner" as BlockId, 0,
      children.reduce((s, c) => s + c.text.length, 0), true,
    );
  }

  it("nonzero line.x: leaves resolve to lineAbsX + childRelX, NOT lineAbsX + line.x + childRelX", () => {
    // A centered/aligned line: its own physical x is 50. The caller passes the
    // line's ABSOLUTE x (= 50, block at doc x 0). The first child sits at
    // relative x 0 (width 40), the second at relative x 40.
    const line = buildLine(50, [
      { key: "a", relX: 0, width: 40, text: "abcde" },
      { key: "b", relX: 40, width: 40, text: "fghij" },
    ]);
    expect(line.x).toBe(50); // physical x === alignment offset

    const leaves = collectLineLeaves(line, 50, 0);
    expect(leaves).toHaveLength(2);
    // First child: lineAbsX + relX = 50 + 0 = 50. BUG returned 100 (50 + 50 + 0).
    expect(nth(leaves, 0, "leaves").absoluteX).toBe(50);
    // Second child: 50 + 40 = 90. BUG returned 140 (50 + 50 + 40).
    expect(nth(leaves, 1, "leaves").absoluteX).toBe(90);
  });

  it("line.x === 0 (start-aligned): leaves resolve to the passed lineAbsX (no-regression guard)", () => {
    // Start-aligned line: own x is 0. The double-count is masked here
    // (lineAbsX + 0 === lineAbsX) — assert it stays byte-identical.
    const line = buildLine(0, [
      { key: "a", relX: 0, width: 40, text: "abcde" },
      { key: "b", relX: 40, width: 40, text: "fghij" },
    ]);
    expect(line.x).toBe(0);

    const leaves = collectLineLeaves(line, 0, 0);
    expect(leaves).toHaveLength(2);
    expect(nth(leaves, 0, "leaves").absoluteX).toBe(0);
    expect(nth(leaves, 1, "leaves").absoluteX).toBe(40);
  });

  it("nonzero line.x with a nonzero block origin: leaves track lineAbsX (not lineAbsX + line.x)", () => {
    // Generalize: the line's parent block is NOT at doc x 0. The caller still
    // passes the line's ABSOLUTE x (block origin + line.x). Here line.x is the
    // alignment offset 30; the absolute x the caller passes is 130 (block at
    // doc x 100). Leaves must land at 130 / 170, never +30 again.
    const line = buildLine(30, [
      { key: "a", relX: 0, width: 40, text: "abcde" },
      { key: "b", relX: 40, width: 40, text: "fghij" },
    ]);
    expect(line.x).toBe(30);

    const lineAbsX = 130; // block at doc x 100, line.x 30
    const leaves = collectLineLeaves(line, lineAbsX, 0);
    expect(nth(leaves, 0, "leaves").absoluteX).toBe(130);
    expect(nth(leaves, 1, "leaves").absoluteX).toBe(170);
  });
});
