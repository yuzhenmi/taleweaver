/**
 * Object-selection geometry (#525, Task 4). `computeObjectSelectionRect` returns
 * the `SelectionRect` (absolute physical bbox) for an atomic-leaf block — the
 * geometry the host paints as the "this image is selected" outline. An object
 * selection is collapsed-on-atomic, so `computeSelectionRects` early-returns `[]`
 * for it; this function exists precisely to serve that case.
 *
 * Fixture mirrors `hit-test-object.test.ts` (buildState → render → layoutTree →
 * getPage(0)) with a FLOATED image and wrapped paragraph text beside it.
 */
import { describe, it, expect } from "vitest";
import { render } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { layoutTree } from "../layout/dispatch";
import { createMockShaper } from "@taleweaver/core";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "@taleweaver/core";
import { asBlockId } from "@taleweaver/core";
import type { State } from "@taleweaver/core";
import type { PageBox } from "../layout/page-box";
import type { LayoutBox } from "../layout/layout-box";
import { computeObjectSelectionRect } from "./selection-geometry";
import { computeSelectionRects } from "./selection-geometry";

const SHAPER_CHAR_W = 8;
const SHAPER_LINE_H = 16;

const FLOAT_IMG_ID = asBlockId("float-img");
const PARA_ID = asBlockId("para");

const IMG_W = 100;
const IMG_H = 60;

function pageConfig() {
  return {
    pageInlineSize: 500,
    pageBlockSize: 600,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };
}

function docWithFloatImage(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        firstChildId: "float-img",
        lastChildId: "plain",
      }),
      buildBlock({
        id: "float-img",
        type: "image",
        parentId: "doc",
        nextSiblingId: "para",
        attrs: { src: "float.png", width: IMG_W, height: IMG_H, wrap: "left" },
      }),
      buildBlock({
        id: "para",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "float-img",
        nextSiblingId: "plain",
        inlineContent: inlineContent([
          text("the quick brown fox jumps over the lazy dog again and again"),
        ]),
      }),
      buildBlock({
        id: "plain",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "para",
        inlineContent: inlineContent([text("plain paragraph text here")]),
      }),
    ],
  });
}

interface Built {
  state: State;
  page0: PageBox;
}

function build(): Built {
  const state = docWithFloatImage();
  const root = render(
    state,
    createDefaultComponentRegistry(),
    createDefaultAttrRegistry(),
  ).root;
  const shaper = createMockShaper(SHAPER_CHAR_W, SHAPER_LINE_H);
  const cfg = pageConfig();
  const lt = layoutTree(root, cfg.pageInlineSize, shaper, cfg);
  if (lt.type !== "virtual-root") {
    throw new Error("expected a VirtualLayoutTree (paginated supported doc)");
  }
  return { state, page0: lt.getPage(0) };
}

/**
 * Walk a positioned page box, accumulating physical (x, y), and return the
 * absolute physical rect of the BlockBox whose key === targetKey. Independent of
 * the index — a fixture-geometry cross-check.
 */
function absRectOf(
  box: LayoutBox,
  targetKey: string,
  absX: number,
  absY: number,
  pageIndex: number,
): { x: number; y: number; width: number; height: number; pageIndex: number } | null {
  if (box.type === "page") {
    for (const child of box.children) {
      const r = absRectOf(child, targetKey, 0, 0, box.pageIndex);
      if (r !== null) return r;
    }
    return null;
  }
  if (box.type === "text-run" || box.type === "marker") return null;
  const x = absX + box.x;
  const y = absY + box.y;
  if (box.type === "block" && box.key === targetKey) {
    return { x, y, width: box.width, height: box.height, pageIndex };
  }
  if (box.type === "multicolumn") {
    for (const col of box.columns) {
      const r = absRectOf(col, targetKey, x, y, pageIndex);
      if (r !== null) return r;
    }
  } else if ("children" in box) {
    for (const child of box.children) {
      const r = absRectOf(child, targetKey, x, y, pageIndex);
      if (r !== null) return r;
    }
  }
  if (box.absoluteChildren !== undefined) {
    for (const absChild of box.absoluteChildren) {
      const r = absRectOf(absChild, targetKey, x, y, pageIndex);
      if (r !== null) return r;
    }
  }
  return null;
}

describe("computeObjectSelectionRect (#525)", () => {
  it("returns the atomic image's absolute bbox as a SelectionRect", () => {
    const { state, page0 } = build();
    const resolver = createDefaultComponentRegistry();

    const rect = computeObjectSelectionRect(state, FLOAT_IMG_ID, page0, resolver);
    expect(rect).not.toBeNull();
    if (rect === null) throw new Error("expected an object-selection rect");

    // Cross-check against an INDEPENDENT geometry walk of the page (not the index).
    const fixture = absRectOf(page0, "float-img", 0, 0, 0);
    expect(fixture).not.toBeNull();
    if (fixture === null) throw new Error("fixture geometry missing");

    expect(rect).toEqual({
      x: fixture.x,
      y: fixture.y,
      width: fixture.width,
      height: fixture.height,
      pageIndex: fixture.pageIndex,
    });
    // And the image's known fixture dimensions.
    expect(rect.width).toBe(IMG_W);
    expect(rect.height).toBe(IMG_H);
  });

  it("returns null for a non-atomic block (a paragraph)", () => {
    const { state, page0 } = build();
    const resolver = createDefaultComponentRegistry();
    expect(computeObjectSelectionRect(state, PARA_ID, page0, resolver)).toBeNull();
  });

  it("returns null for a blockId absent from the layout", () => {
    const { state, page0 } = build();
    const resolver = createDefaultComponentRegistry();
    expect(
      computeObjectSelectionRect(state, asBlockId("gone"), page0, resolver),
    ).toBeNull();
  });

  it("computeSelectionRects on the same collapsed-on-atomic span returns [] (why a separate fn is needed)", () => {
    const { state, page0 } = build();
    const shaper = createMockShaper(SHAPER_CHAR_W, SHAPER_LINE_H);
    const pos = { blockId: FLOAT_IMG_ID, offset: 0 };
    const span = { anchor: pos, focus: pos };
    expect(computeSelectionRects(state, span, page0, shaper)).toEqual([]);
  });
});
