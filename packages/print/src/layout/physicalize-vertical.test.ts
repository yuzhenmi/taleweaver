import { describe, it, expect } from "vitest";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import type { WritingMode, Direction } from "@taleweaver/core";
import { computeUsedStyle } from "./used-style";
import {
  type LayoutBox,
  type BlockBox,
  type PageBox,
  createBlockBox,
  createTextRunBox,
} from "./layout-box";
import { createPageBox } from "./page-box";
import { physicalizeVertical } from "./physicalize-vertical";
import type { Style } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createElementBox, createTextBox } from "@taleweaver/core";
import type { ElementBox } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { makeRootContext } from "./layout-context";
import { paginateRoot } from "./paginate";
import { buildBlockFitMetas } from "./build-fit-metas";
import { measurePass } from "./measure-pass";
import { IMPLICIT_SECTION_PLAN } from "./section-plan";
import { makeVirtualLayoutTree } from "./virtual-layout-tree";
import type { PageConfig } from "./page-config";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const cs = INITIAL_COMPUTED_STYLE;
const us = computeUsedStyle(cs, 1000, "indefinite");

/** Convenience block-box builder (children, geometry). */
function block(
  key: string,
  inlineOffset: number,
  blockOffset: number,
  inlineSize: number,
  blockSize: number,
  wm: WritingMode,
  dir: Direction,
  children: readonly LayoutBox[],
  containingInlineSize: number,
): BlockBox {
  return createBlockBox(
    key, inlineOffset, blockOffset, inlineSize, blockSize,
    wm, dir, cs, us, children, containingInlineSize,
  );
}

/** Deep structural equality of the two physical+logical geometry fields of every box. */
function geomTree(box: LayoutBox): unknown {
  const self = {
    key: box.key,
    type: box.type,
    inlineOffset: box.inlineOffset,
    blockOffset: box.blockOffset,
    inlineSize: box.inlineSize,
    blockSize: box.blockSize,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  };
  const kids = "children" in box ? box.children.map(geomTree) : [];
  return { self, kids };
}

describe("physicalizeVertical — no-op for non-vertical-rl", () => {
  it("returns horizontal-tb tree BYTE-IDENTICAL (same reference)", () => {
    const leaf = createTextRunBox(
      "t", 5, 0, 40, 16, "horizontal-tb", "ltr", cs, us, "hi", 2, 100,
    );
    const root = block("b", 0, 0, 100, 16, "horizontal-tb", "ltr", [leaf], 200);
    const out = physicalizeVertical(root, 300);
    // Top-level early-return: the SAME frozen object, not a rebuilt clone.
    expect(out).toBe(root);
  });

  it("returns vertical-lr tree BYTE-IDENTICAL (same reference)", () => {
    const leaf = createTextRunBox(
      "t", 5, 0, 40, 16, "vertical-lr", "ltr", cs, us, "hi", 2, 100,
    );
    const root = block("b", 0, 0, 100, 16, "vertical-lr", "ltr", [leaf], 200);
    const out = physicalizeVertical(root, 300);
    expect(out).toBe(root);
  });
});

describe("physicalizeVertical — vertical-rl block-axis mirror", () => {
  it("mirrors a single box's physical x against its container block-size", () => {
    // container block-size = 500; box blockOffset 30, blockSize 120
    // expected mirrored x = 500 − 30 − 120 = 350
    const root = block("b", 0, 30, 16, 120, "vertical-rl", "ltr", [], 200);
    // Pre-pass: the factory stored the un-mirrored PENDING x (= blockOffset).
    expect(root.x).toBe(30);
    const out = physicalizeVertical(root, 500);
    expect(out.x).toBe(500 - 30 - 120);
    // Inline-axis (y) is unchanged: vertical LTR ⇒ y = inlineOffset = 0.
    expect(out.y).toBe(0);
    // width/height (block→width, inline→height) are unchanged.
    expect(out.width).toBe(120);
    expect(out.height).toBe(16);
    // Produces a NEW frozen box (no mutation of the frozen input).
    expect(out).not.toBe(root);
    expect(Object.isFrozen(out)).toBe(true);
  });

  it("mirrors each box against ITS OWN container, composing the correct ABS x (nested 2 levels)", () => {
    // Design's worked example: page P, container (b1,s1), grandchild (b2,s2)
    //   grandchild ABS x = P − b1 − b2 − s2
    const P = 500;
    const b1 = 40;
    const s1 = 300;
    const b2 = 25;
    const s2 = 90;
    const grandchild = block("gc", 0, b2, 16, s2, "vertical-rl", "ltr", [], 200);
    const container = block("c", 0, b1, 16, s1, "vertical-rl", "ltr", [grandchild], 200);
    const out = physicalizeVertical(container, P);
    // Container mirrored against the page block-size P.
    expect(out.x).toBe(P - b1 - s1);
    // Grandchild mirrored against ITS container's resolved blockSize (s1).
    const outGc = nth((out as BlockBox).children, 0, "grandchild");
    expect(outGc.x).toBe(s1 - b2 - s2);
    // Composed absolute x (consumer walk: absoluteX += parent.x).
    const absGc = out.x + outGc.x;
    expect(absGc).toBe(P - b1 - b2 - s2);
  });

  it("mirrors deep children (text-run leaves under a vertical-rl block)", () => {
    // line/leaf offsets are block-axis (vertical). leaf at blockOffset 10, blockSize 50.
    const leaf = createTextRunBox(
      "t", 0, 10, 16, 50, "vertical-rl", "ltr", cs, us, "x", 1, 200,
    );
    const root = block("b", 0, 0, 16, 200, "vertical-rl", "ltr", [leaf], 200);
    const out = physicalizeVertical(root, 600);
    // Root mirrored: 600 − 0 − 200 = 400.
    expect(out.x).toBe(400);
    const outLeaf = nth((out as BlockBox).children, 0, "leaf");
    // Leaf mirrored against the root blockSize (200): 200 − 10 − 50 = 140.
    expect(outLeaf.x).toBe(140);
  });

  it("preserves the RTL inline-axis y through the mirror rebuild", () => {
    // vertical-rl + RTL: y = containingInlineSize − inlineOffset − inlineSize.
    // containingInlineSize 200, inlineOffset 30, inlineSize 16 ⇒ y = 154.
    const root = block("b", 30, 0, 16, 100, "vertical-rl", "rtl", [], 200);
    expect(root.y).toBe(200 - 30 - 16);
    const out = physicalizeVertical(root, 500);
    // Block-axis x mirrored.
    expect(out.x).toBe(500 - 0 - 100);
    // Inline-axis y unchanged (the rebuild recovers the same containing inline size).
    expect(out.y).toBe(200 - 30 - 16);
  });
});

describe("physicalizeVertical — PageBox frame vs content", () => {
  function vrlPage(): PageBox {
    // A vertical-rl page. Body BFC child + a named header slot, both v-rl.
    const bodyChild = block("body", 0, 20, 16, 200, "vertical-rl", "ltr", [], 800);
    const header = block("hdr", 0, 0, 16, 60, "vertical-rl", "ltr", [], 800);
    return createPageBox(
      "page-0",
      0, 0, 1000, 1400,
      "vertical-rl", "ltr", cs, us,
      [bodyChild],
      0,
      1000,
      header, null, null,
      40, 40,
    );
  }

  it("does NOT mirror the PageBox frame x (only content)", () => {
    const page = vrlPage();
    const pageContentBlockSize = 800;
    const out = physicalizeVertical(page, pageContentBlockSize) as PageBox;
    // Page frame x stays at its pagination-assigned value (blockOffset 0 → x 0
    // for the page itself; NOT mirrored against any container block-size).
    expect(out.x).toBe(page.x);
    expect(out.x).toBe(0);
    expect(out.blockOffset).toBe(0);
  });

  it("mirrors the page CONTENT child against the page content block-size", () => {
    const page = vrlPage();
    const pageContentBlockSize = 800;
    const out = physicalizeVertical(page, pageContentBlockSize) as PageBox;
    const child = nth(out.children, 0, "body child");
    // body child: 800 − 20 − 200 = 580.
    expect(child.x).toBe(800 - 20 - 200);
  });

  it("mirrors the named header slot (New Hole 4)", () => {
    const page = vrlPage();
    const pageContentBlockSize = 800;
    const out = physicalizeVertical(page, pageContentBlockSize) as PageBox;
    expect(out.headerSlot).not.toBeNull();
    const hdr = out.headerSlot as BlockBox;
    // header slot: 800 − 0 − 60 = 740.
    expect(hdr.x).toBe(800 - 0 - 60);
  });
});

describe("physicalizeVertical — both layout seams mirror a real vertical-rl doc", () => {
  function cascadeRoot(rootStyle: Style, children: readonly ElementBox[]): ElementBox {
    const root = createElementBox("root", rootStyle, children);
    const cascaded = cascadePass(root);
    if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
    return cascaded;
  }

  function fixedBlock(key: string, blockSize: number): ElementBox {
    return createElementBox(key, { display: "block", blockSize } as Style, [
      createTextBox(`${key}-t`, {}, "x"),
    ]);
  }

  const pageConfig: PageConfig = {
    pageInlineSize: 600,
    pageBlockSize: 400,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 20,
  };
  // vertical-rl, single page: one fixed block (blockOffset 0, blockSize 100).
  // Page content block-size = 400 (no margins). Expected mirrored x of the BFC
  // body box = 400 − 0 − 100 = 300.
  const vrlRoot = (): ElementBox =>
    cascadeRoot({ display: "block", writingMode: "vertical-rl" } as Style, [
      fixedBlock("b0", 100),
    ]);

  function bfcBodyOf(page: PageBox): BlockBox {
    // paginate/materialize wrap the BFC body BlockBox as the single page child.
    const child = nth(page.children, 0, "body child");
    if (child.type !== "block") throw new Error("expected a block body child");
    return child;
  }

  // The page content block-size (no margins) is the size the page's body BFC box
  // is mirrored against.
  const pageContentBlockSize = pageConfig.pageBlockSize; // margins are 0

  it("non-virtual paginateRoot mirrors the BFC body box (and its children)", () => {
    const root = vrlRoot();
    const ctx = makeRootContext(root.computedStyle ?? INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
    const result = paginateRoot(root, ctx, createMockShaper(8, 16), undefined, pageConfig);
    const page = nth(result.children, 0, "page");
    if (page.type !== "page") throw new Error("expected page");
    expect(page.writingMode).toBe("vertical-rl");
    // Page FRAME is NOT mirrored (page placement at blockOffset 0 → x 0).
    expect(page.x).toBe(0);
    // The body BFC box's x is the block-axis mirror against the page content
    // block-size (proves the pass ran on this seam). We assert the RELATIONSHIP,
    // not a hardcoded pixel, since the BFC's own block-sizing is out of scope.
    const body = bfcBodyOf(page);
    expect(body.x).toBe(pageContentBlockSize - body.blockOffset - body.blockSize);
    // And the body's child is mirrored against ITS container (the body) blockSize.
    const inner = nth(body.children, 0, "inner");
    expect(inner.x).toBe(body.blockSize - inner.blockOffset - inner.blockSize);
  });

  it("virtual makeVirtualLayoutTree.getPage mirrors the BFC body box (and its children)", () => {
    const root = vrlRoot();
    const pageContentInlineSize =
      pageConfig.pageInlineSize - pageConfig.pageMargins.inlineStart - pageConfig.pageMargins.inlineEnd;
    const metas = buildBlockFitMetas(root, createMockShaper(8, 16), undefined, pageContentInlineSize);
    const plan = measurePass(metas, pageConfig, IMPLICIT_SECTION_PLAN, root.children);
    const ctx = makeRootContext(root.computedStyle ?? INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
    const tree = makeVirtualLayoutTree(plan, root, ctx, createMockShaper(8, 16), pageConfig);
    const page = tree.getPage(0);
    expect(page.writingMode).toBe("vertical-rl");
    expect(page.x).toBe(0);
    const body = bfcBodyOf(page);
    expect(body.x).toBe(pageContentBlockSize - body.blockOffset - body.blockSize);
    const inner = nth(body.children, 0, "inner");
    expect(inner.x).toBe(body.blockSize - inner.blockOffset - inner.blockSize);
  });
});

describe("physicalizeVertical — both seams mirror against the FULL page block-size under NON-ZERO margins (C-1)", () => {
  // Regression for review C-1: the vertical-rl block-axis mirror container at the
  // pagination seams must be the FULL page block-size, NOT the content block-size
  // (pageBlockSize − blockStart − blockEnd). The box handed to physicalizeVertical
  // has a PAGE-RELATIVE blockOffset (the BFC body box sits at `blockStart`/
  // `effTopInset` from the page's block-start edge), so the coordinate-system
  // parent is the whole page. The earlier zero-margin tests masked this because
  // content size == page size when margins are 0.
  function cascadeRoot(rootStyle: Style, children: readonly ElementBox[]): ElementBox {
    const root = createElementBox("root", rootStyle, children);
    const cascaded = cascadePass(root);
    if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
    return cascaded;
  }
  function fixedBlock(key: string, blockSize: number): ElementBox {
    return createElementBox(key, { display: "block", blockSize } as Style, [
      createTextBox(`${key}-t`, {}, "x"),
    ]);
  }

  const BLOCK_START = 40;
  const BLOCK_END = 40;
  const PAGE_BLOCK_SIZE = 400;
  const pageConfig: PageConfig = {
    pageInlineSize: 600,
    pageBlockSize: PAGE_BLOCK_SIZE,
    pageMargins: { blockStart: BLOCK_START, blockEnd: BLOCK_END, inlineStart: 30, inlineEnd: 30 },
    pageGap: 20,
  };
  // Content block-size = 400 − 40 − 40 = 320. The mirror MUST use 400, not 320.
  const CONTENT_BLOCK_SIZE =
    PAGE_BLOCK_SIZE - BLOCK_START - BLOCK_END;

  const vrlRoot = (): ElementBox =>
    cascadeRoot({ display: "block", writingMode: "vertical-rl" } as Style, [
      fixedBlock("b0", 100),
    ]);

  function bfcBodyOf(page: PageBox): BlockBox {
    const child = nth(page.children, 0, "body child");
    if (child.type !== "block") throw new Error("expected a block body child");
    return child;
  }

  it("non-virtual paginateRoot: body box mirrors against the FULL page block-size", () => {
    const root = vrlRoot();
    const ctx = makeRootContext(root.computedStyle ?? INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
    const result = paginateRoot(root, ctx, createMockShaper(8, 16), undefined, pageConfig);
    const page = nth(result.children, 0, "page");
    if (page.type !== "page") throw new Error("expected page");
    const body = bfcBodyOf(page);
    // Body sits at blockOffset = blockStart = 40 (page-relative). Correct mirror:
    //   x = FULL pageBlockSize − blockOffset − blockSize = 400 − 40 − blockSize.
    expect(body.blockOffset).toBe(BLOCK_START);
    expect(body.x).toBe(PAGE_BLOCK_SIZE - body.blockOffset - body.blockSize);
    // Sanity: the buggy content-size mirror (320) would have produced a DIFFERENT,
    // smaller x. Prove the two differ so this test genuinely catches C-1.
    expect(PAGE_BLOCK_SIZE - body.blockOffset - body.blockSize).not.toBe(
      CONTENT_BLOCK_SIZE - body.blockOffset - body.blockSize,
    );
  });

  it("virtual getPage: body box mirrors against the FULL page block-size", () => {
    const root = vrlRoot();
    const pageContentInlineSize =
      pageConfig.pageInlineSize - pageConfig.pageMargins.inlineStart - pageConfig.pageMargins.inlineEnd;
    const metas = buildBlockFitMetas(root, createMockShaper(8, 16), undefined, pageContentInlineSize);
    const plan = measurePass(metas, pageConfig, IMPLICIT_SECTION_PLAN, root.children);
    const ctx = makeRootContext(root.computedStyle ?? INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
    const tree = makeVirtualLayoutTree(plan, root, ctx, createMockShaper(8, 16), pageConfig);
    const page = tree.getPage(0);
    const body = bfcBodyOf(page);
    expect(body.blockOffset).toBe(BLOCK_START);
    expect(body.x).toBe(PAGE_BLOCK_SIZE - body.blockOffset - body.blockSize);
    expect(PAGE_BLOCK_SIZE - body.blockOffset - body.blockSize).not.toBe(
      CONTENT_BLOCK_SIZE - body.blockOffset - body.blockSize,
    );
  });
});

describe("physicalizeVertical — equivalence (geometry round-trip for non-vrl)", () => {
  it("h-tb tree geometry is identical before/after", () => {
    const leaf = createTextRunBox(
      "t", 5, 4, 40, 16, "horizontal-tb", "ltr", cs, us, "hi", 2, 100,
    );
    const root = block("b", 2, 3, 100, 16, "horizontal-tb", "ltr", [leaf], 200);
    const before = geomTree(root);
    const after = geomTree(physicalizeVertical(root, 999));
    expect(after).toEqual(before);
  });
});
