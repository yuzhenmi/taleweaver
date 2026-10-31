/**
 * Change-tracking boundary glyphs in the print backend:
 *  - the suggested paragraph-break ¶: a glyph box the BFC places at the caret paint
 *    position of `(E, len)`, taking no line space and no offset, hanging past the
 *    content edge and clipped by its cell / column gap / page / float;
 *  - a tracked section-end item: the same box with a section
 *    kind — Word's "Section Break" label over the line remainder (caret → line
 *    end, at least one ¶ glyph), taking no line space.
 * Suggestions are made through the real editor reducer in suggesting mode (or a
 * JSON fixture where no editing gesture produces the shape).
 */
import { describe, it, expect } from "vitest";
import {
  buildBlock,
  buildState,
  buildAccessibilityTree,
  createDecorationSet,
  createDefaultAttrRegistry,
  createDefaultComponentRegistry,
  createEditorStateFromState,
  createJsonDocumentSerializer,
  createMockShaper,
  createPosition,
  createSpan,
  createTestAllocator,
  getBlock,
  getSuggestions,
  inlineContent,
  inlineContentLength,
  setBlockAttrs,
  paragraphComponent,
  reduceEditor,
  render,
  suggestionHighlightDecorations,
  text,
  type BlockId,
  type EditorAction,
  type EditorConfig,
  type EditorState,
  type PageConfig,
  type State,
  type TextShaper,
} from "@taleweaver/core";
import { layoutTree } from "./layout/dispatch";
import { positionTreeForTest } from "./test-utils/position-tree";
import { resolvePixelPosition } from "./cursor/cursor-position";
import { resolveHitPosition } from "./test-utils/hit-position";
import { computeSelectionRects } from "./cursor/selection-geometry";
import { getSuggestionRangeRects } from "./cursor/suggestion-rects";
import { getBoundaryMarkIndex, getBoundaryMarksByBlock, type BoundaryMarkRect } from "./cursor/boundary-mark-index";
import { getLineIndex, type AbsoluteLineBox } from "./cursor/line-flatten";
import { computeDecorationRects } from "./decoration-geometry";
import { paintCanvas } from "./canvas-renderer";
import { buildDomMirror } from "./dom-mirror";
import type { LayoutBox } from "./layout/layout-node";
import type { PageBox } from "./layout/page-box";
import { makeNavEditorFromState, layoutOf, nav, type NavCtx } from "./nav/nav-test-helpers";

const componentRegistry = createDefaultComponentRegistry();
/** The document model authors no paragraph base direction; an `rtl` attr routes it to the cascade here. */
const rtlRegistry = createDefaultComponentRegistry();
const rtlParagraph: typeof paragraphComponent = {
  ...paragraphComponent,
  render: (view, ctx, inline) => {
    const el = paragraphComponent.render(view, ctx, inline);
    if (el.type !== "element") return el;
    if (view.attrs.rtl === true) return { ...el, style: { ...el.style, direction: "rtl" } };
    if (view.attrs.shift === true) return { ...el, style: { ...el.style, transform: [{ fn: "translateX", tx: 40 }] } };
    return el;
  },
};
rtlRegistry.register(rtlParagraph);
const attrRegistry = createDefaultAttrRegistry();
const WIDTH = 400;
const base: EditorConfig = { componentRegistry, attrRegistry, containerWidth: WIDTH };
const alice: EditorConfig = { ...base, suggestingAuthor: "alice", now: () => 1 };
const shaper = createMockShaper(8, 16);
/** One label line (16) + 2 × 4 padding. */

const caret = (b: BlockId, o: number): EditorAction => ({ type: "SET_SELECTION", selection: createSpan(createPosition(b, o), createPosition(b, o)) });
const id = (s: string): BlockId => s as BlockId;

/** doc > p0..pn (one paragraph per text), with optional paragraph + document attrs. */
function doc(texts: readonly string[], attrs?: Record<string, unknown>): State {
  const ids = texts.map((_, i) => `p${i}`);
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", attrs, firstChildId: ids[0] ?? null, lastChildId: ids[ids.length - 1] ?? null }),
      ...texts.map((t, i) =>
        buildBlock({
          id: `p${i}`,
          type: "paragraph",
          parentId: "doc",
          attrs,
          prevSiblingId: ids[i - 1] ?? null,
          nextSiblingId: ids[i + 1] ?? null,
          inlineContent: inlineContent([text(t)]),
        }),
      ),
    ],
  });
}

/** A JSON-fixture document (for shapes no single editing gesture produces). */
function fromJson(children: readonly unknown[], suggestions: Record<string, unknown>, rootAttrs?: Record<string, unknown>): State {
  const ser = createJsonDocumentSerializer({ allocator: createTestAllocator("j"), blockKindResolver: componentRegistry });
  return ser.decode(JSON.stringify({ format: "taleweaver-json", version: 1, root: { id: "doc", type: "document", ...(rootAttrs !== undefined ? { attrs: rootAttrs } : {}), children }, suggestions }));
}
const record = (kind: "insertion" | "deletion"): Record<string, unknown> => ({ kind, author: "alice", createdAt: 1, order: 1 });
const para = (pid: string, t: string, key?: Record<string, string>): Record<string, unknown> => ({
  id: pid,
  type: "paragraph",
  content: [{ text: t }],
  ...(key !== undefined ? { breakSuggestion: key } : {}),
});

/** Run `actions` (caret at `(b, o)` first) against `state` with `config`. */
function run(state: State, b: BlockId, o: number, config: EditorConfig, ...actions: EditorAction[]): EditorState {
  let e = createEditorStateFromState(state, createSpan(createPosition(b, o), createPosition(b, o)), config);
  for (const a of actions) e = reduceEditor(e, a);
  return e;
}

/** alice's Backspace at the start of `p1` → a pending join drawn at the end of `p0`. */
function joined(texts: readonly string[], attrs?: Record<string, unknown>, width = WIDTH): { state: State; tree: LayoutBox } {
  const state = run(doc(texts, attrs), id("p1"), 0, alice, { type: "DELETE_BACKWARD" }).document;
  return { state, tree: lay(state, width) };
}

/** alice's suggested section break at `(p<k>, 0)` → a tracked section-end item (an empty ¶ before `p<k>`). */
function sectioned(texts: readonly string[], k: number, attrs?: Record<string, unknown>): State {
  return run(doc(texts, attrs), id(`p${k}`), 0, alice, { type: "SECTION_BREAK" }).document;
}

function lay(state: State, width = WIDTH, s: TextShaper = shaper): LayoutBox {
  return positionTreeForTest(layoutTree(render(state, rtlRegistry, attrRegistry).root, width, s));
}

function pages(state: State, pageConfig: PageConfig, s: TextShaper = shaper): PageBox[] {
  const lt = layoutTree(render(state, rtlRegistry, attrRegistry).root, pageConfig.pageInlineSize, s, pageConfig);
  if (lt.type !== "virtual-root") throw new Error("expected a paginated tree");
  // Materializing every page runs the measure↔materialize agreement gate (dev mode).
  return lt.getPages(0, lt.plan.entries.length - 1);
}

const page = (inline: number, block: number, margin = 0): PageConfig => ({
  pageInlineSize: inline,
  pageBlockSize: block,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: margin, inlineEnd: margin },
  pageGap: 10,
});

function markOf(tree: LayoutBox, b: BlockId): BoundaryMarkRect {
  const m = getBoundaryMarkIndex(tree).find((r) => r.box.boundaryMark.blockId === b);
  if (m === undefined) throw new Error(`no ¶ on ${b}`);
  return m;
}

/** The paragraph before `b` — the head a split of `b` creates (the head takes the new id). */
function headOf(state: State, b: BlockId): BlockId {
  const h = getBlock(state, b)?.prevSiblingId;
  if (h === null || h === undefined) throw new Error(`no paragraph before ${b}`);
  return h;
}

/** The one tracked section-end item's box on `tree`. */
function sectionMarkOf(tree: LayoutBox): BoundaryMarkRect {
  const m = getBoundaryMarkIndex(tree).find((r) => r.box.boundaryMark.mark.kind.startsWith("section"));
  if (m === undefined) throw new Error("no section mark");
  return m;
}

function linesOf(tree: LayoutBox, b: BlockId): readonly AbsoluteLineBox[] {
  return getLineIndex(tree).byBlock.get(b) ?? [];
}

function caretOf(state: State, tree: LayoutBox, b: BlockId, o: number): { x: number; y: number; height: number } {
  const p = resolvePixelPosition(state, createPosition(b, o), tree, shaper);
  if (p === null) throw new Error("caret");
  return p;
}

/** Text-direction-agnostic: the ¶ stands at the caret and advances along the inline axis. */
function expectAtCaret(state: State, tree: LayoutBox, b: BlockId, o: number): BoundaryMarkRect {
  const m = markOf(tree, b);
  const c = caretOf(state, tree, b, o);
  expect([m.x, m.y, m.height]).toEqual([c.x, c.y, c.height]);
  return m;
}

/** Absolute rects of every box of `type` in a positioned tree (page slots at the page origin). */
function boxesOf(tree: LayoutBox, type: LayoutBox["type"]): { x: number; y: number; width: number; height: number }[] {
  const out: { x: number; y: number; width: number; height: number }[] = [];
  const walk = (box: LayoutBox, px: number, py: number): void => {
    if (box.type === "page") {
      for (const c of box.children) walk(c, 0, 0);
      return;
    }
    const x = px + box.x;
    const y = py + box.y;
    if (box.type === type) out.push({ x, y, width: box.width, height: box.height });
    if (box.type === "multicolumn") for (const c of box.columns) walk(c, x, y);
    else if ("children" in box) for (const c of box.children) walk(c, x, y);
  };
  walk(tree, 0, 0);
  return out;
}

const contains = (outer: { x: number; y: number; width: number; height: number }, inner: { x: number; y: number; width: number; height: number }): boolean =>
  outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;

/** A canvas recording fill ops. */
function recorder(): { ctx: CanvasRenderingContext2D; ops: { op: string; x: number; y: number; w?: number; fill: string; text?: string }[] } {
  const ops: { op: string; x: number; y: number; w?: number; fill: string; text?: string }[] = [];
  const ctx = {
    canvas: { width: 600, height: 800 },
    font: "",
    fillStyle: "",
    textBaseline: "alphabetic",
    fillRect(this: { fillStyle: string }, x: number, y: number, w: number) { ops.push({ op: "rect", x, y, w, fill: this.fillStyle }); },
    fillText(this: { fillStyle: string }, t: string, x: number, y: number) { ops.push({ op: "text", x, y, fill: this.fillStyle, text: t }); },
    measureText: (t: string) => ({ width: t.length * 8 }),
    rect(x: number, y: number, w: number) { ops.push({ op: "clip-rect", x, y, w, fill: "" }); },
    clearRect() {}, save() {}, restore() {}, setTransform() {}, scale() {}, translate() {}, rotate() {}, beginPath() {}, clip() {},
  } as unknown as CanvasRenderingContext2D;
  return { ctx, ops };
}

describe("print ¶ — placement", () => {
  it("LTR join: the ¶ sits at the caret of (E, len), struck in the author colour; no IFC token, identical lines", () => {
    const { state, tree } = joined(["Anna", "Rosa"]);
    const m = expectAtCaret(state, tree, id("p0"), 4);
    expect(m.box.text).toBe("¶");
    expect(m.width).toBe(8);
    expect(m.box.boundaryMark).toMatchObject({ offset: 4 });
    expect(m.box.boundaryMark.labelInlineSize).toBeUndefined();
    expect(m.box.computedStyle.lineThrough).toBe(true);
    expect(m.box.computedStyle.underline).toBe(false);
    const color = m.box.boundaryMark.mark.color;
    expect(color).not.toBeNull();
    expect(m.box.computedStyle.color).toBe(color);
    // No IFC token, no reflow: the lines are identical with and without the tag.
    const geometry = (t: LayoutBox): unknown[] => linesOf(t, id("p0")).map((l) => [l.absoluteX, l.absoluteY, l.line.width, l.line.height, l.line.inlineOffsetEnd]);
    expect(geometry(tree)).toEqual(geometry(lay(doc(["Anna", "Rosa"]))));
    expect(linesOf(tree, id("p0")).map((l) => l.line.inlineOffsetEnd)).toEqual([4]);
  });

  it("RTL: the ¶'s inline-end edge is the caret (it advances leftward)", () => {
    const { state, tree } = joined(["שלום", "עולם"], { rtl: true });
    const m = markOf(tree, id("p0"));
    const c = caretOf(state, tree, id("p0"), 4);
    expect([m.x + m.width, m.y]).toEqual([c.x, c.y]);
    expect(c.x).toBeLessThan(WIDTH - 4 * 8 + 1); // the caret is at the text's (left) end, not the line start
  });

  it("mixed bidi (RTL run ending an LTR paragraph): the ¶ is at the caret of (E, len)", () => {
    const { state, tree } = joined(["ab שלום", "x"]);
    expectAtCaret(state, tree, id("p0"), 7);
  });

  it("a full line with clamped trailing spaces: the ¶ sits at the clamped caret and hangs past the content edge", () => {
    const { state, tree } = joined(["aaaa    ", "b"], undefined, 40);
    const m = expectAtCaret(state, tree, id("p0"), 8);
    expect(m.x).toBe(40); // the content edge (the hung spaces are clamped)
    expect(m.width).toBe(8); // hangs, unclipped on the single canvas; takes no line space
    expect(linesOf(tree, id("p0")).length).toBe(1);
  });

  it("vertical-rl: the ¶ runs down the line from the caret", () => {
    const { state, tree } = joined(["abc", "d"], { writingMode: "vertical-rl" });
    const m = markOf(tree, id("p0"));
    const c = caretOf(state, tree, id("p0"), 3);
    // Vertical: the caret's inline coord is physical y, its block band is along x.
    expect([m.y, m.x, m.width, m.height]).toEqual([c.x, c.y, c.height, 8]);
  });

  it("Enter at offset 0: the new empty head above draws its keyed underlined ¶ at its line start", () => {
    const e = run(doc(["Hello"]), id("p0"), 0, alice, { type: "SPLIT_NODE" });
    const h = headOf(e.document, id("p0"));
    const tree = lay(e.document);
    expect(getBoundaryMarkIndex(tree).map((r) => r.box.boundaryMark.blockId)).toEqual([h]);
    const m = expectAtCaret(e.document, tree, h, 0);
    expect(m.x).toBe(0);
    expect(m.box.computedStyle.underline).toBe(true);
    expect(m.box.computedStyle.lineThrough).toBe(false);
  });

  it("paginated body: the ¶ hangs into the page margin and is clipped by the page box", () => {
    // Content 40 wide; "aaaaa" fills the line, so the ¶ starts at the content edge.
    const state = run(doc(["aaaaa", "b"]), id("p1"), 0, alice, { type: "DELETE_BACKWARD" }).document;
    const wide = markOf(pages(state, page(60, 200, 10))[0] ?? lay(state), id("p0"));
    expect([wide.glyphX, wide.x, wide.width]).toEqual([50, 50, 8]); // inside the 10px margin
    const narrow = markOf(pages(state, page(46, 200, 3))[0] ?? lay(state), id("p0"));
    expect([narrow.glyphX, narrow.x, narrow.width]).toEqual([43, 43, 3]); // clipped at the page edge
  });

  it("a full line in a narrow table cell: hangs into the cell padding / border, clipped at the cell border box", () => {
    const wideGlyph = createMockShaper(12, 16);
    let e = run(doc(["A", "B"]), id("p1"), 0, base, { type: "INSERT_TABLE", rows: 1, cols: 2 });
    const cellPara = e.selection.focus.blockId;
    e = reduceEditor(e, { type: "INSERT_TEXT", text: `a${" ".repeat(60)}` });
    e = reduceEditor({ ...e, config: alice }, { type: "SPLIT_NODE" });
    const cellHead = headOf(e.document, cellPara); // Enter at the end — the head holds the text
    const tree = lay(e.document, WIDTH, wideGlyph);
    const m = getBoundaryMarkIndex(tree).find((r) => r.box.boundaryMark.blockId === cellHead);
    if (m === undefined) throw new Error("no ¶ in the cell");
    const [cell, neighbour] = boxesOf(tree, "table-cell").sort((a, b) => a.x - b.x);
    if (cell === undefined || neighbour === undefined) throw new Error("cells");
    const line = linesOf(tree, cellHead)[0];
    if (line === undefined) throw new Error("line");
    expect(m.glyphX).toBe(line.absoluteX + line.line.width); // at the content edge (the spaces clamp)
    expect(m.box.width).toBe(12);
    expect(m.x + m.width).toBe(cell.x + cell.width); // clipped exactly at the border box
    expect(m.width).toBeLessThan(12);
    expect(m.x + m.width).toBeLessThanOrEqual(neighbour.x);
  });

  it("multi-column: the ¶ hangs freely into the column gap, never over the next column", () => {
    const state = (gap: number): State =>
      fromJson(
        [{ id: "s", type: "section", attrs: { columnCount: 2, columnGap: gap }, children: [para("p0", "aaaa        ", { deletionId: "j" }), para("p1", "b")] }],
        { j: record("deletion") },
      );
    for (const [gap, visible] of [[20, 8], [4, 4]] as const) {
      const p0 = pages(state(gap), page(100, 200))[0];
      if (p0 === undefined) throw new Error("page");
      const m = markOf(p0, id("p0"));
      const cols = boxesOf(p0, "block").filter((b) => b.width === (100 - gap) / 2);
      const line = linesOf(p0, id("p0"))[0];
      if (line === undefined) throw new Error("line");
      expect(m.glyphX).toBe(line.absoluteX + line.line.width); // the column's content edge
      expect(m.width).toBe(visible);
      expect(cols.length).toBeGreaterThan(0);
      expect(m.x + m.width).toBeLessThanOrEqual(m.glyphX + gap);
    }
  });

  it("next to an inline-end float: the ¶ is clipped at the float's margin box (never painted over it)", () => {
    const state = fromJson(
      [
        { id: "im", type: "image", attrs: { src: "x.png", width: 40, height: 40, wrap: "right" } },
        para("p0", "aaa", { deletionId: "j" }),
        para("p1", "b"),
      ],
      { j: record("deletion") },
    );
    const tree = lay(state, 70); // the line beside the float is 30 wide; "aaa" ends at 24
    const m = markOf(tree, id("p0"));
    expect([m.glyphX, m.box.width, m.x + m.width]).toEqual([24, 8, 30]);
    const float = boxesOf(tree, "block").find((b) => b.width === 40 && b.height === 40);
    expect(float?.x).toBe(30);
    // Painted clipped to the visible rect.
    const { ctx, ops } = recorder();
    paintCanvas(ctx, tree, [], [], { x: 0, y: 0, height: 0 }, "hidden", 600, 800, 0, 800);
    expect(ops.some((o) => o.op === "clip-rect" && o.x === 24 && o.w === 6)).toBe(true);
    // The line knows it ends at the float (the one source of the rule), and a selection
    // covering the ¶ stops at the float's edge too — tracked or not.
    expect(linesOf(tree, id("p0"))[0]?.line.endsAtFloat).toBe(true);
    // Paginated: a float taller than the page still shortens the ¶'s lines resumed on the
    // next page (rebased by the IFC's resume, repositioned onto the page).
    const tall = fromJson([{ id: "im", type: "image", attrs: { src: "x.png", width: 40, height: 100, wrap: "right" } }, para("p0", "aaa bbb ccc ddd eee fff"), para("p1", "b")], {});
    const resumed = pages(tall, page(70, 48)).map((pg) => linesOf(pg, id("p0")).map((l) => [l.line.inlineOffsetStart, l.line.endsAtFloat]));
    expect(resumed.slice(0, 2)).toEqual([
      [[0, true], [4, true], [8, true]],
      [[12, true], [16, true], [20, true]],
    ]);
    // vertical-rl, paginated: the line is rebuilt with its block-axis mirror and keeps the flag.
    const vertical = fromJson([{ id: "im", type: "image", attrs: { src: "x.png", width: 40, height: 40, wrap: "right" } }, para("p0", "aaa"), para("p1", "b")], {}, { writingMode: "vertical-rl" });
    const [vp] = pages(vertical, page(70, 400));
    expect(vp === undefined ? null : linesOf(vp, id("p0")).map((l) => [l.absoluteX, l.line.height, l.line.endsAtFloat])).toEqual([[384, 30, true]]);
    const plain = fromJson([{ id: "im", type: "image", attrs: { src: "x.png", width: 40, height: 40, wrap: "right" } }, para("p0", "aaa"), para("p1", "b")], {});
    for (const [st, t] of [[state, tree], [plain, lay(plain, 70)]] as const) {
      const p0 = linesOf(t, id("p0"))[0];
      if (p0 === undefined) throw new Error("line");
      const onP0 = computeSelectionRects(st, createSpan(createPosition(id("p0"), 0), createPosition(id("p1"), 1)), t, shaper).filter(
        (r) => r.y === p0.absoluteY,
      );
      expect(onP0.map((r) => [r.x, r.x + r.width])).toEqual([[0, 30]]);
    }
    // The selection's ¶ extension stops at the float in vertical-rl too (the inline axis is y).
    if (vp === undefined) throw new Error("page");
    const vl = linesOf(vp, id("p0"))[0];
    const onV = computeSelectionRects(vertical, createSpan(createPosition(id("p0"), 0), createPosition(id("p1"), 1)), vp, shaper).filter((r) => r.x === vl?.absoluteX);
    expect(onV.map((r) => [r.y, r.y + r.height])).toEqual([[0, 30]]);
  });
});

describe("print ¶ — incremental + paginated layout", () => {
  it("the driver's incremental rebuild adds the ¶ on the suggestion and drops it on undo (paginated)", () => {
    const pageConfig = page(200, 400);
    let ctx: NavCtx = makeNavEditorFromState(doc(["Anna", "Rosa"]), { pageConfig });
    const marks = (): readonly BoundaryMarkRect[] => {
      const lt = layoutOf(ctx);
      if (lt.type !== "virtual-root") throw new Error("expected a paginated tree");
      return getBoundaryMarkIndex(lt.getPage(0));
    };
    expect(marks()).toEqual([]); // warm the layout cache
    const suggesting = { ...ctx.config, suggestingAuthor: "alice" };
    ctx = { ...ctx, editor: reduceEditor(reduceEditor({ ...ctx.editor, config: suggesting }, caret(id("p1"), 0)), { type: "DELETE_BACKWARD" }) };
    expect(marks().map((m) => [m.box.boundaryMark.blockId, m.box.boundaryMark.offset, m.x, m.pageIndex])).toEqual([[id("p0"), 4, 32, 0]]);
    ctx = { ...ctx, editor: reduceEditor({ ...ctx.editor, config: ctx.config }, { type: "UNDO" }) };
    expect(marks()).toEqual([]);
  });

  it("a block split across pages carries its ¶ on the last fragment only", () => {
    const state = run(doc(["aaaa bbbb cccc dddd eeee ffff gggg hhhh", "x"]), id("p1"), 0, alice, { type: "DELETE_BACKWARD" }).document;
    const [first, second] = pages(state, page(80, 32));
    if (first === undefined || second === undefined) throw new Error("pages");
    expect(getBoundaryMarkIndex(first)).toEqual([]);
    const m = getBoundaryMarkIndex(second).find((r) => r.box.boundaryMark.blockId === id("p0"));
    expect(m?.box.boundaryMark).toMatchObject({ offset: 39 });
    expect(m?.pageIndex).toBe(1);
  });
});

describe("print ¶ — interaction", () => {
  it("a click on the ¶ resolves to (E, len); the per-block lookup is memoized by tree", () => {
    const { state, tree } = joined(["Anna", "Rosa"]);
    const m = markOf(tree, id("p0"));
    expect(resolveHitPosition(state, tree, shaper, m.x + m.width / 2, m.y + m.height / 2)).toEqual(createPosition(id("p0"), 4));
    expect(getBoundaryMarksByBlock(tree)).toBe(getBoundaryMarksByBlock(tree));
    expect(getBoundaryMarksByBlock(tree).get(id("p0"))).toEqual([m]);
  });

  it("caret: (E, len) paints at the ¶ origin (before it); ArrowRight crosses to (N, 0) in one step; End lands on (E, len)", () => {
    const { state, tree } = joined(["Anna", "Rosa"]);
    expectAtCaret(state, tree, id("p0"), 4);
    let ctx: NavCtx = makeNavEditorFromState(state, { suggestingAuthor: "alice" });
    ctx = { ...ctx, editor: reduceEditor(ctx.editor, caret(id("p0"), 0)) };
    ctx = nav(ctx, { type: "MOVE_LINE_BOUNDARY", boundary: "end" });
    expect(ctx.editor.selection.focus).toEqual(createPosition(id("p0"), 4));
    ctx = nav(ctx, { type: "MOVE_CURSOR", direction: "forward" });
    expect(ctx.editor.selection.focus).toEqual(createPosition(id("p1"), 0));
  });

  it("the selection covers the ¶ iff it covers its step", () => {
    const { state, tree } = joined(["Anna", "Rosa"]);
    const m = markOf(tree, id("p0"));
    const covers = (a: [string, number], b: [string, number]): boolean =>
      computeSelectionRects(state, createSpan(createPosition(id(a[0]), a[1]), createPosition(id(b[0]), b[1])), tree, shaper).some((r) => contains(r, m));
    expect(covers(["p0", 2], ["p1", 2])).toBe(true);
    expect(covers(["p0", 4], ["p1", 0])).toBe(true);
    expect(covers(["p0", 0], ["p0", 4])).toBe(false); // ends at (E, len)
    expect(covers(["p1", 0], ["p1", 2])).toBe(false); // starts at (N, 0)
  });

  it("an RTL selection spanning the step covers the (leftward) ¶", () => {
    const { state, tree } = joined(["שלום", "עולם"], { rtl: true });
    const rects = computeSelectionRects(state, createSpan(createPosition(id("p0"), 2), createPosition(id("p1"), 2)), tree, shaper);
    expect(rects.some((r) => contains(r, markOf(tree, id("p0"))))).toBe(true);
  });

  it("the DOM mirror carries no break offset: the joined block mirrors its text only", () => {
    const { state } = joined(["Anna", "Rosa"]);
    const el = buildDomMirror(buildAccessibilityTree(state)).querySelector('[data-block-id="p0"]');
    expect(el?.textContent).toBe("Anna");
    const ends = Array.from(el?.querySelectorAll("[data-offset-end]") ?? []).map((r) => Number(r.getAttribute("data-offset-end")));
    expect(Math.max(...ends)).toBe(4);
  });

  it("getSuggestionRangeRects = the ¶ rect (+ tagged chars), no duplicates, no empty slices", () => {
    const { state, tree } = joined(["Anna", "Rosa"]);
    const sid = getSuggestions(state)[0]?.id;
    if (sid === undefined) throw new Error("no suggestion");
    const m = markOf(tree, id("p0"));
    const rects = getSuggestionRangeRects(state, tree, shaper, sid);
    expect(rects.filter((r) => contains(r, m))).toHaveLength(1);
    expect(rects.every((r) => r.width > 0 && r.height > 0)).toBe(true);
  });

  it("a transformed paragraph in a table cell: the cell clip applies in the cell's frame (hit-test, canvas)", () => {
    const wideGlyph = createMockShaper(12, 16);
    let e = run(doc(["A", "B"]), id("p1"), 0, base, { type: "INSERT_TABLE", rows: 1, cols: 2 });
    const cellPara = e.selection.focus.blockId;
    e = reduceEditor(e, { type: "INSERT_TEXT", text: `a${" ".repeat(60)}` });
    e = reduceEditor({ ...e, config: alice }, { type: "SPLIT_NODE" });
    const cellHead = headOf(e.document, cellPara); // the head holds the text and the keyed ¶
    const state = setBlockAttrs(e.document, cellHead, { shift: true }).state;
    const tree = lay(state, WIDTH, wideGlyph);
    const m = getBoundaryMarkIndex(tree).find((r) => r.box.boundaryMark.blockId === cellHead);
    if (m === undefined) throw new Error("no ¶ in the cell");
    const [cell] = boxesOf(tree, "table-cell").sort((a, b) => a.x - b.x);
    if (cell === undefined) throw new Error("cell");
    // Pre-transform the ¶ hangs at the cell's edge; drawn 40px right it lies wholly past
    // the cell's border box (over the neighbour cell), so the cell clips it away.
    expect(m.glyphX + 40).toBeGreaterThanOrEqual(cell.x + cell.width);
    const at = createPosition(cellPara, inlineContentLength(getBlock(state, cellPara)?.inlineContent ?? { items: [] }));
    expect(resolveHitPosition(state, tree, wideGlyph, m.glyphX + 41, m.y + m.height / 2)).not.toEqual(at);
    // Canvas: the cell clip is set in the cell's (untransformed) frame before the glyph's own clip.
    const transforms: number[][] = [];
    const { ctx, ops } = recorder();
    Object.assign(ctx, {
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 40, f: 0 }),
      setTransform: (...a: number[]) => transforms.push(a),
      transform: () => undefined,
    });
    paintCanvas(ctx, tree, [], [], { x: 0, y: 0, height: 0 }, "hidden", 600, 800, 0, 800);
    expect(ops.some((o) => o.op === "clip-rect" && o.x === cell.x && o.w === cell.width)).toBe(true);
    expect(transforms).toContainEqual([1, 0, 0, 1, 0, 0]);
  });

  it("a ¶ inside a transformed block: hit-test maps the click through the block's transform", () => {
    const { state, tree } = joined(["Anna", "Rosa"], { shift: true });
    const m = markOf(tree, id("p0"));
    // Visually the ¶ is 40px right of its pre-transform rect; the pre-transform rect is over text.
    expect(resolveHitPosition(state, tree, shaper, m.x + 40 + m.width / 2, m.y + m.height / 2)).toEqual(createPosition(id("p0"), 4));
    expect(resolveHitPosition(state, tree, shaper, m.x + 2, m.y + m.height / 2)).not.toEqual(createPosition(id("p0"), 4));
  });

  it("a suggestion highlight tints the ¶ once (under the glyph); the fragment reports the suggestion id", () => {
    const { state, tree } = joined(["Anna", "Rosa"]);
    const sid = getSuggestions(state)[0]?.id;
    if (sid === undefined) throw new Error("no suggestion");
    const set = createDecorationSet(state, suggestionHighlightDecorations(state, [{ suggestionId: sid, active: false }]));
    const rects = computeDecorationRects({ state, decorations: set, root: tree, pageIndex: null, measurer: shaper, pageSpanOf: () => null, resolve: () => null });
    const m = markOf(tree, id("p0"));
    // Exactly the ¶: the zero-length segments at (p0, 4) / (p1, 0) draw nothing else.
    expect(rects.map((r) => [r.x, r.y, r.width, r.height])).toEqual([[m.x, m.y, m.width, m.height]]);
    // The pointer reports the decoration under it — the one naming the suggestion.
    expect(rects[0]?.decoration.data).toMatchObject({ suggestionId: sid });
    const fill = rects[0]?.backgroundColor;
    const { ctx, ops } = recorder();
    paintCanvas(ctx, tree, [], rects, { x: 0, y: 0, height: 0 }, "hidden", 600, 800, 0, 800);
    const isTint = (o: { op: string; x: number; fill: string }): boolean => o.op === "rect" && o.fill === fill && o.x === m.x;
    expect(ops.filter(isTint)).toHaveLength(1);
    const tint = ops.findIndex(isTint);
    const glyph = ops.findIndex((o) => o.op === "text" && o.text === "¶");
    expect(glyph).toBeGreaterThan(tint);
    expect(ops[glyph]?.fill).toBe(m.box.boundaryMark.mark.color);
    // The strike rule over the glyph.
    expect(ops.some((o, i) => i > glyph && o.op === "rect" && o.x === m.x && o.fill === m.box.boundaryMark.mark.color)).toBe(true);
  });

  it("list item: the marker and the ¶ never collide, and a marker click is unchanged", () => {
    const listed = run(doc(["one", "two"]), id("p0"), 0, base, caret(id("p0"), 0), { type: "SET_SELECTION", selection: createSpan(createPosition(id("p0"), 0), createPosition(id("p1"), 3)) }, { type: "TOGGLE_LIST", listType: "ordered" });
    const plain = lay(listed.document);
    const e = run(listed.document, id("p0"), 3, alice, { type: "SPLIT_NODE" });
    const tree = lay(e.document);
    const m = markOf(tree, headOf(e.document, id("p0"))); // the head takes the new id
    const markers = boxesOf(tree, "marker").filter((r) => !(r.x === m.glyphX && r.y === m.glyphY));
    expect(markers.length).toBeGreaterThan(0);
    for (const k of markers) expect(k.x + k.width <= m.x || m.x + m.width <= k.x || k.y + k.height <= m.y || m.y + m.height <= k.y).toBe(true);
    const first = boxesOf(plain, "marker")[0];
    if (first === undefined) throw new Error("no list marker");
    const click = (t: LayoutBox, s: State) => resolveHitPosition(s, t, shaper, first.x + 1, first.y + first.height / 2);
    // The first item's start (the split head carries "one").
    expect(click(plain, listed.document)).toEqual(createPosition(id("p0"), 0));
    expect(click(tree, e.document)).toEqual(createPosition(headOf(e.document, id("p0")), 0));
  });
});

describe("print — selection ¶ extension: anchored at the caret of (P, len), along the base direction", () => {
  const sel = (state: State, tree: LayoutBox, a: [string, number], z: [string, number]) =>
    computeSelectionRects(state, createSpan(createPosition(id(a[0]), a[1]), createPosition(id(z[0]), z[1])), tree, shaper);
  const EXT = 16; // the two-space indicator (mock 8px glyphs)

  it("LTR: runs rightward from the caret; an uncovered ¶ paints none", () => {
    const state = doc(["Ab", "Cd"]);
    const tree = lay(state);
    const c = caretOf(state, tree, id("p0"), 2);
    expect(sel(state, tree, ["p0", 1], ["p1", 1]).some((r) => r.y === c.y && r.x + r.width === c.x + EXT)).toBe(true);
    expect(sel(state, tree, ["p0", 1], ["p0", 2]).some((r) => r.x + r.width > c.x)).toBe(false);
  });

  it("RTL: runs LEFTWARD from the caret of (P, len) (the text's left end), never past the line's right edge", () => {
    const state = doc(["שלום", "עולם"], { rtl: true });
    const tree = lay(state);
    const c = caretOf(state, tree, id("p0"), 4);
    const rects = sel(state, tree, ["p0", 2], ["p1", 2]);
    expect(rects.some((r) => r.y === c.y && r.x === c.x - EXT)).toBe(true);
    expect(rects.every((r) => r.x + r.width <= WIDTH)).toBe(true);
  });

  it("vertical-rl: runs down the line from the caret", () => {
    const state = doc(["abc", "d"], { writingMode: "vertical-rl" });
    const tree = lay(state);
    const c = caretOf(state, tree, id("p0"), 3);
    // Vertical: the caret's inline coord (x) is physical y.
    expect(sel(state, tree, ["p0", 1], ["p1", 1]).some((r) => r.y + r.height === c.x + EXT)).toBe(true);
  });

  /** A 1×2 table whose first cell holds `text` + a full line of spaces, then a second paragraph; `attrs` on the first. */
  function cellDoc(text: string, attrs?: Record<string, unknown>): { state: State; head: BlockId; tail: BlockId } {
    let e = run(doc(["A", "B"]), id("p1"), 0, base, { type: "INSERT_TABLE", rows: 1, cols: 2 });
    const tail = e.selection.focus.blockId;
    e = reduceEditor(e, { type: "INSERT_TEXT", text: `${text}${" ".repeat(60)}` });
    e = reduceEditor(e, { type: "SPLIT_NODE" });
    const head = headOf(e.document, tail); // Enter at the end — the head holds the text
    return { state: attrs === undefined ? e.document : setBlockAttrs(e.document, head, attrs).state, head, tail };
  }
  const firstCell = (tree: LayoutBox): { x: number; width: number } => {
    const [cell] = boxesOf(tree, "table-cell").sort((a, b) => a.x - b.x);
    if (cell === undefined) throw new Error("cell");
    return cell;
  };

  it("in a table cell: clipped at the cell's border box, as the ¶ glyph is (LTR → its right edge)", () => {
    const { state, head, tail } = cellDoc("a");
    const tree = lay(state);
    const cell = firstCell(tree);
    const c = caretOf(state, tree, head, 61);
    expect(c.x + EXT).toBeGreaterThan(cell.x + cell.width); // unclipped it would cross into the next cell
    const onLine = sel(state, tree, [head, 0], [tail, 0]).filter((r) => r.y === c.y);
    expect(Math.max(...onLine.map((r) => r.x + r.width))).toBe(cell.x + cell.width);
  });

  it("in an RTL table cell: clipped at the cell's LEFT border edge", () => {
    const { state, head, tail } = cellDoc("ש", { rtl: true });
    const tree = lay(state);
    const cell = firstCell(tree);
    const c = caretOf(state, tree, head, 61);
    expect(c.x - EXT).toBeLessThan(cell.x);
    const onLine = sel(state, tree, [head, 0], [tail, 0]).filter((r) => r.y === c.y);
    // Nothing past the cell's left edge but the line's own (hanging trailing-space) content.
    expect(Math.min(...onLine.map((r) => r.x))).toBe(Math.min(c.x, cell.x));
  });

  it("a transformed paragraph in a table cell: the cell clip (an outer clip) applies in the cell's frame", () => {
    // Drawn 40px right, the extension at the cell edge lies wholly past the cell's border box.
    const { state, head, tail } = cellDoc("a", { shift: true });
    const tree = lay(state);
    const c = caretOf(state, tree, head, 61);
    const line = linesOf(tree, head)[0];
    expect(line?.ancestorClip?.outer.length).toBe(1);
    const onLine = sel(state, tree, [head, 0], [tail, 0]).filter((r) => r.y === c.y);
    expect(onLine.length).toBeGreaterThan(0);
    expect(Math.max(...onLine.map((r) => r.x + r.width))).toBeLessThanOrEqual(c.x);
  });

  it("an empty paragraph's line paints the extension at its start", () => {
    const state = doc(["A", "", "B"]);
    const tree = lay(state);
    const c = caretOf(state, tree, id("p1"), 0);
    expect(sel(state, tree, ["p0", 0], ["p2", 1])).toContainEqual({ x: c.x, y: c.y, width: EXT, height: c.height, pageIndex: 0 });
  });
});

describe("print section-break label (a tracked section-end item)", () => {
  it("fills the line remainder from the caret of (B, len): Word's label, underlined, author colour, no line space", () => {
    const state = sectioned(["A", "B"], 1);
    const tree = lay(state);
    const m = sectionMarkOf(tree);
    const b = m.box.boundaryMark.blockId;
    expect(b).not.toBe(id("p0"));
    expect(b).not.toBe(id("p1"));
    expect(m.box.boundaryMark.mark.kind).toBe("section-insert");
    // The empty ¶ carrying the section end: its caret is the line start.
    const c = caretOf(state, tree, b, 0);
    expect([m.x, m.y, m.height]).toEqual([c.x, c.y, c.height]);
    expect(m.width).toBe(WIDTH - c.x);
    expect(m.box.text).toBe("Section Break");
    expect(m.box.boundaryMark.labelInlineSize).toBe(13 * 8);
    expect(m.box.computedStyle.underline).toBe(true);
    expect(m.box.computedStyle.lineThrough).toBe(false);
    expect(m.box.computedStyle.color).toBe(m.box.boundaryMark.mark.color);
    // No line space: the next paragraph sits where it would without the suggestion.
    const plain = lay(run(doc(["A", "B"]), id("p1"), 0, base, { type: "SECTION_BREAK" }).document);
    expect(linesOf(tree, id("p1")).map((l) => l.absoluteY)).toEqual(linesOf(plain, id("p1")).map((l) => l.absoluteY));
    expect(getBoundaryMarkIndex(plain)).toEqual([]);
  });

  it("after text it starts at the text's end; on a full line it is one ¶ glyph wide", () => {
    const split = run(doc(["Alpha", "B"]), id("p0"), 5, alice, { type: "SECTION_BREAK" });
    const tree = lay(split.document);
    const m = sectionMarkOf(tree);
    expect(m.box.boundaryMark.offset).toBe(5); // the head holding "Alpha" ends the section
    expect(caretOf(split.document, tree, m.box.boundaryMark.blockId, 5).x).toBe(40);
    expect([m.x, m.width]).toEqual([40, WIDTH - 40]);
    const full = lay(run(doc(["aaaaa", "B"]), id("p0"), 5, alice, { type: "SECTION_BREAK" }).document, 40);
    expect(sectionMarkOf(full).width).toBe(8);
  });

  it("section-join: struck; vertical-rl: the label runs down the line from the caret", () => {
    const split = run(doc(["A", "B"]), id("p1"), 0, base, { type: "SECTION_BREAK" });
    const j = reduceEditor(reduceEditor({ ...split, config: alice }, caret(id("p1"), 0)), { type: "DELETE_BACKWARD" });
    const jm = sectionMarkOf(lay(j.document));
    expect(jm.box.boundaryMark.mark.kind).toBe("section-join");
    expect(jm.box.computedStyle.lineThrough).toBe(true);
    expect(jm.box.computedStyle.underline).toBe(false);

    const v = run(doc(["abc", "d"], { writingMode: "vertical-rl" }), id("p0"), 3, alice, { type: "SECTION_BREAK" }).document;
    const vt = lay(v);
    const vm = sectionMarkOf(vt);
    const c = caretOf(v, vt, vm.box.boundaryMark.blockId, 3);
    expect([vm.y, vm.x, vm.width]).toEqual([c.x, c.y, c.height]);
    expect(vm.height).toBe(WIDTH - 24);
  });

  it("a click on the label → (B, len); a selection covering the section end covers the label; painted centred between dotted rules", () => {
    const state = run(doc(["Alpha", "Beta"]), id("p1"), 0, alice, { type: "SECTION_BREAK" }).document;
    const tree = lay(state);
    const m = sectionMarkOf(tree);
    const h = m.box.boundaryMark.blockId; // the empty ¶ ending the first section
    expect(resolveHitPosition(state, tree, shaper, m.x + m.width - 4, m.y + 4)).toEqual(createPosition(h, 0));
    const covers = (a: [string, number], z: [string, number]): boolean =>
      computeSelectionRects(state, createSpan(createPosition(id(a[0]), a[1]), createPosition(id(z[0]), z[1])), tree, shaper).some((r) => contains(r, m));
    expect(covers(["p0", 2], ["p1", 1])).toBe(true);
    expect(covers([h, 0], ["p1", 0])).toBe(true);
    expect(covers(["p0", 0], [h, 0])).toBe(false);
    const { ctx, ops } = recorder();
    paintCanvas(ctx, tree, [], [], { x: 0, y: 0, height: 0 }, "hidden", 600, 800, 0, 800);
    const label = ops.find((o) => o.op === "text" && o.text === "Section Break");
    expect(label?.x).toBe(m.x + (m.width - 13 * 8) / 2);
    expect(label?.fill).toBe(m.box.boundaryMark.mark.color);
    // The double dotted rule either side of the label.
    const dots = ops.filter((o) => o.op === "rect" && o.fill === m.box.boundaryMark.mark.color && o.w === 2);
    expect(new Set(dots.map((o) => o.y)).size).toBe(2);
    expect(dots.some((o) => o.x < (label?.x ?? 0)) && dots.some((o) => o.x > (label?.x ?? 0) + 13 * 8)).toBe(true);
  });

  it("reflow: the incremental rebuild adds the label on the suggestion and removes it on undo (paginated)", () => {
    let ctx: NavCtx = makeNavEditorFromState(doc(["A", "B"]), { pageConfig: page(200, 400) });
    const view = (): { marks: number; p1: number | undefined } => {
      const lt = layoutOf(ctx);
      if (lt.type !== "virtual-root") throw new Error("expected a paginated tree");
      const all = lt.getPages(0, lt.plan.entries.length - 1);
      return { marks: all.flatMap((p) => getBoundaryMarkIndex(p)).length, p1: all.flatMap((p) => linesOf(p, id("p1")))[0]?.pageIndex };
    };
    expect(view()).toEqual({ marks: 0, p1: 0 });
    const suggesting = { ...ctx.config, suggestingAuthor: "alice" };
    ctx = { ...ctx, editor: reduceEditor(reduceEditor({ ...ctx.editor, config: suggesting }, caret(id("p1"), 0)), { type: "SECTION_BREAK" }) };
    expect(view()).toEqual({ marks: 1, p1: 1 });
    ctx = { ...ctx, editor: reduceEditor({ ...ctx.editor, config: ctx.config }, { type: "UNDO" }) };
    expect(view()).toEqual({ marks: 0, p1: 0 });
  });
});
