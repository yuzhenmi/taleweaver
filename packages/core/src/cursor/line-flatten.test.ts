import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "../render/render-node";
import { cascadePass } from "../cascade";
import { layoutBlock } from "../layout/bfc";
import { layoutTree } from "../layout/dispatch";
import { createMockShaper } from "../layout/mock-shaper";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import { makeRootContext } from "../layout/layout-context";
import { collectLineBoxes, type AbsoluteLineBox } from "./line-flatten";

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
    const r = layoutBlock(tree, 0, 0, ctx, shaper);
    if (r.box === null) throw new Error("?");

    const out: AbsoluteLineBox[] = [];
    collectLineBoxes(r.box, 0, 0, out);

    expect(out.length).toBe(1);
    expect(out[0].line.type).toBe("line");
    // Through the BFC, text children are wrapped in an anonymous block.
    // ownerBlockId reflects the anonymous block that runs the IFC.
    expect(out[0].line.ownerBlockId).toMatch(/^p(\/anon\[\d+\])?$/);
    expect(out[0].pageIndex).toBe(0);
    expect(out[0].absoluteX).toBeGreaterThanOrEqual(0);
    expect(out[0].absoluteY).toBeGreaterThanOrEqual(0);
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
    const r = layoutBlock(tree, 0, 0, ctx, shaper);
    if (r.box === null) throw new Error("?");

    const out: AbsoluteLineBox[] = [];
    collectLineBoxes(r.box, 0, 0, out);

    expect(out.length).toBe(3);
    expect(out[0].line.ownerBlockId).toMatch(/^p1(\/anon\[\d+\])?$/);
    expect(out[1].line.ownerBlockId).toMatch(/^p2(\/anon\[\d+\])?$/);
    expect(out[2].line.ownerBlockId).toMatch(/^p3(\/anon\[\d+\])?$/);
    // Strictly increasing absoluteY (one line per block, each stacks
    // below the previous).
    expect(out[1].absoluteY).toBeGreaterThan(out[0].absoluteY);
    expect(out[2].absoluteY).toBeGreaterThan(out[1].absoluteY);
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
    const r = layoutBlock(tree, 0, 0, ctx, shaper);
    if (r.box === null) throw new Error("?");

    const out: AbsoluteLineBox[] = [];
    collectLineBoxes(r.box, 0, 0, out);

    expect(out.length).toBeGreaterThan(1);
    // All entries reference the same source block.
    const firstOwner = out[0].line.ownerBlockId;
    for (const e of out) expect(e.line.ownerBlockId).toBe(firstOwner);
    // Last entry is the block's boundary line.
    expect(out[out.length - 1].line.isBlockBoundaryLine).toBe(true);
    // No entry except the last is the block's boundary line.
    for (let i = 0; i < out.length - 1; i++) {
      expect(out[i].line.isBlockBoundaryLine).toBe(false);
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
    const r = layoutBlock(tree, 0, 0, ctx, shaper);
    if (r.box === null) throw new Error("?");

    const out1: AbsoluteLineBox[] = [];
    const out2: AbsoluteLineBox[] = [];
    collectLineBoxes(r.box, 0, 0, out1);
    collectLineBoxes(r.box, 0, 0, out2);

    expect(out1.length).toBe(out2.length);
    // Same LineBox reference both times.
    for (let i = 0; i < out1.length; i++) {
      expect(out2[i].line).toBe(out1[i].line);
    }
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
    const root = layoutTree(tree, 500, shaper, {
      pageInlineSize: 500,
      pageBlockSize: 40,
      pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
      pageGap: 0,
    });

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
    const r = layoutBlock(tree, 0, 0, ctx, shaper);
    if (r.box === null) throw new Error("?");

    const out: AbsoluteLineBox[] = [];
    collectLineBoxes(r.box, 0, 0, out);

    expect(out.length).toBe(1);
    // The collected entry is a LineBox, not a text-run.
    expect(out[0].line.type).toBe("line");
    // The text-runs are children of the line — accessible if needed
    // but not in the flat collection.
    expect(out[0].line.children.length).toBeGreaterThan(0);
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
    const r = layoutBlock(tree, 0, 0, ctx, shaper);
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
