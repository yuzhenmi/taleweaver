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
import { computeSelectionRects, computeSelectionRectsAcrossPages, computeSelectionRectsForPage, type SelectionRect } from "./selection-geometry";
import { getObjectBoxes } from "./atomic-box-index";
import { resolvePixelPosition } from "./cursor-position";
import { getBlock, createPosition, createSpan, firstLeafBlock, type BlockId, type EditorAction, type Position } from "@taleweaver/core";
import { makeNavEditor, typeText, dispatch, firstBlockId, layoutOf, setSelection, caretAt, type NavCtx, type MakeNavEditorOptions } from "../nav/nav-test-helpers";

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

// ---------------------------------------------------------------------------
// Range selections covering object blocks (rule / image / table). A range covers
// an object block WHOLE (core `isObjectBlock`; an endpoint on one is
// `(objectId, 0)`), so it paints its text part as before PLUS each covered
// object's box — never the lines inside a covered table (the box carries them).
// Built through the real editor ("abcd" | object | "") + the layout driver.
// ---------------------------------------------------------------------------

type ObjectKind = "rule" | "image" | "table";

function objectAction(kind: ObjectKind, rows = 1): EditorAction {
  if (kind === "rule") return { type: "INSERT_HORIZONTAL_LINE" };
  if (kind === "image") return { type: "INSERT_IMAGE", src: "x.png", width: 50, height: 40 };
  return { type: "INSERT_TABLE", rows, cols: 1 };
}

/** `"abcd" | object | ""` (fresh document per call) and the three body block ids. */
function objectRangeDoc(kind: ObjectKind, opts: MakeNavEditorOptions = {}, rows = 1) {
  let ctx = typeText(makeNavEditor(opts), "abcd");
  ctx = dispatch(ctx, objectAction(kind, rows));
  const st = ctx.editor.document;
  const section = getBlock(st, firstBlockId(ctx))?.parentId ?? null;
  const ids: BlockId[] = [];
  for (let id = section === null ? null : getBlock(st, section)?.firstChildId ?? null; id !== null; id = getBlock(st, id)?.nextSiblingId ?? null) {
    ids.push(id);
  }
  const [text, object, after] = ids;
  if (text === undefined || object === undefined || after === undefined || ids.length !== 3) {
    throw new Error(`expected "abcd" | ${kind} | "" (got ${ids.length} blocks)`);
  }
  return { ctx, text, object, after };
}

function positioned(ctx: NavCtx): LayoutBox {
  const lt = layoutOf(ctx);
  if (lt.type === "virtual-root") throw new Error("expected a non-paginated layout");
  return lt;
}

function rangeRects(ctx: NavCtx, anchor: Position, focus: Position): SelectionRect[] {
  return computeSelectionRects(ctx.editor.document, createSpan(anchor, focus), positioned(ctx), ctx.measurer);
}

/** The object's box fragments on `tree` (the highlight a covered object paints). */
function boxesOf(ctx: NavCtx, tree: LayoutBox, id: BlockId): SelectionRect[] {
  return getObjectBoxes(tree, ctx.editor.document).filter((b) => b.blockId === id).map((b) => ({ ...b.rect }));
}

// "bcd" + the ¶ extension (8px glyphs, 16px lines; "abcd" is the first line).
const BCD_WITH_PILCROW: SelectionRect = { x: 8, y: 0, width: 40, height: 16, pageIndex: 0 };
const BCD: SelectionRect = { x: 8, y: 0, width: 24, height: 16, pageIndex: 0 };
const OBJECT_HEIGHT: Record<ObjectKind, number> = { rule: 16, image: 40, table: 32 };

describe("range selections paint covered object blocks whole", () => {
  for (const kind of ["rule", "image", "table"] as const) {
    it(`${kind}: across / starting on / ending on it (either direction)`, () => {
      const { ctx, text, object, after } = objectRangeDoc(kind);
      const obj = boxesOf(ctx, positioned(ctx), object);
      expect(obj).toEqual([{ x: 0, y: 24, width: 800, height: OBJECT_HEIGHT[kind], pageIndex: 0 }]);
      const p = createPosition;
      // Across: the text lines exactly as for a text-only range, plus the object.
      expect(rangeRects(ctx, p(text, 1), p(after, 0))).toEqual([BCD_WITH_PILCROW, ...obj]);
      // Starting on it: the object alone (the empty paragraph's start adds nothing).
      expect(rangeRects(ctx, p(object, 0), p(after, 0))).toEqual(obj);
      expect(rangeRects(ctx, p(after, 0), p(object, 0))).toEqual(obj);
      // Ending on it: the text up to its block's end (that ¶ survives a delete), plus the object.
      expect(rangeRects(ctx, p(text, 1), p(object, 0))).toEqual([BCD, ...obj]);
      expect(rangeRects(ctx, p(object, 0), p(text, 1))).toEqual([BCD, ...obj]);
    });
  }

  it("a drag from text into a table cell paints the whole table (core lifts the endpoint)", () => {
    const { ctx, text, object } = objectRangeDoc("table");
    const cell = firstLeafBlock(ctx.editor.document, object);
    if (cell === null) throw new Error("expected a cell paragraph");
    const dragged = setSelection(ctx, createSpan(createPosition(text, 1), createPosition(cell, 0)));
    expect(dragged.editor.selection.focus).toEqual(createPosition(object, 0));
    const tree = positioned(dragged);
    expect(computeSelectionRects(dragged.editor.document, dragged.editor.selection, tree, dragged.measurer))
      .toEqual([BCD, ...boxesOf(dragged, tree, object)]);
  });

  it("a range inside one table's cells does not highlight the table", () => {
    let { ctx, object } = objectRangeDoc("table");
    const cell = firstLeafBlock(ctx.editor.document, object);
    if (cell === null) throw new Error("expected a cell paragraph");
    ctx = typeText(caretAt(ctx, cell, 0), "xy");
    const tree = positioned(ctx);
    const rects = computeSelectionRects(ctx.editor.document, createSpan(createPosition(cell, 0), createPosition(cell, 2)), tree, ctx.measurer);
    expect(rects).toHaveLength(1);
    expect(rects[0]?.width).toBe(16);
  });

  it("a table split across pages is highlighted on every page it spans", () => {
    // 96px pages: the 8-row table (32px rows) spans several pages.
    const pageConfig = { pageInlineSize: 320, pageBlockSize: 96, pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 }, pageGap: 24 };
    const { ctx, text, object, after } = objectRangeDoc("table", { pageConfig, containerWidth: 320 }, 8);
    const tree = layoutOf(ctx);
    if (tree.type !== "virtual-root") throw new Error("expected a paginated layout");
    const span = tree.plan.pageSpanOfBlock(object);
    if (span === null || span.first === span.last) throw new Error("expected the table to span pages");
    const st = ctx.editor.document;
    const fragments: SelectionRect[] = [];
    for (let i = span.first; i <= span.last; i++) fragments.push(...boxesOf(ctx, tree.getPage(i), object));
    expect(new Set(fragments.map((r) => r.pageIndex)).size).toBe(span.last - span.first + 1);
    const p = createPosition;
    // Ending / starting on the spanning table: the controller's spanning fallback.
    const toTable = computeSelectionRectsAcrossPages(st, createSpan(p(text, 1), p(object, 0)), tree, ctx.measurer);
    expect(toTable).toEqual([BCD, ...fragments]);
    expect(computeSelectionRectsAcrossPages(st, createSpan(p(object, 0), p(after, 0)), tree, ctx.measurer)).toEqual(fragments);
    // Across it (text endpoints): the controller's per-page path over every page in
    // the range — the cells' lines stay unpainted under the table's box.
    const startPos = resolvePixelPosition(st, p(text, 1), tree, ctx.measurer);
    const endPos = resolvePixelPosition(st, p(after, 0), tree, ctx.measurer);
    if (startPos === null || endPos === null) throw new Error("unresolved endpoints");
    const across: SelectionRect[] = [];
    for (let i = startPos.pageIndex; i <= endPos.pageIndex; i++) {
      across.push(...computeSelectionRectsForPage(st, createSpan(p(text, 1), p(after, 0)), tree.getPage(i), i, startPos, endPos, ctx.measurer));
    }
    expect(across).toEqual([BCD_WITH_PILCROW, ...fragments]);
  });
});
