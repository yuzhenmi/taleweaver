/**
 * Decorations on the PRINT backend, driven through the REAL
 * controller + real renderer + a spy canvas (behavior-level). Covers: host inline
 * bands + underline styles, block backgrounds, layer order over the built-in
 * highlights, mapping through edits, per-page repaint isolation, pointer
 * enter/leave/click (paint fragments + widget overlays), and widget overlays
 * (placement at the caret rect, attribute filtering, absent from copy).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as core from "@taleweaver/core";
import { createEditorController, paintCanvas, type DecorationRect, type EditorController, type LayoutBox, type PrintDecorationPointerEvent } from "./index";
import type { ImageCache } from "./image-cache";
import { computeDecorationRects } from "./decoration-geometry";

type Op =
  | { kind: "fillRect"; x: number; y: number; w: number; h: number; fillStyle: string }
  | { kind: "fillText"; text: string; x: number; y: number; fillStyle: string }
  | { kind: "clearRect"; x: number; y: number; w: number; h: number }
  | { kind: "moveTo"; x: number; y: number }
  | { kind: "lineTo"; x: number; y: number }
  | { kind: "stroke"; strokeStyle: string; lineJoin: string }
  | { kind: "drawImage" }
  | { kind: "save" }
  | { kind: "restore" };

interface SpyCtx extends CanvasRenderingContext2D {
  _ops: Op[];
}

function createSpyCtx(): SpyCtx {
  const ops: Op[] = [];
  const ctx = {
    _ops: ops,
    canvas: { width: 600, height: 800 },
    font: "",
    textBaseline: "alphabetic",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    clearRect(x: number, y: number, w: number, h: number) {
      ops.push({ kind: "clearRect", x, y, w, h });
    },
    fillRect(this: { fillStyle: string }, x: number, y: number, w: number, h: number) {
      ops.push({ kind: "fillRect", x, y, w, h, fillStyle: this.fillStyle });
    },
    fillText(this: { fillStyle: string }, text: string, x: number, y: number) {
      ops.push({ kind: "fillText", text, x, y, fillStyle: this.fillStyle });
    },
    moveTo(x: number, y: number) {
      ops.push({ kind: "moveTo", x, y });
    },
    lineTo(x: number, y: number) {
      ops.push({ kind: "lineTo", x, y });
    },
    stroke(this: { strokeStyle: string; lineJoin: string }) {
      ops.push({ kind: "stroke", strokeStyle: this.strokeStyle, lineJoin: this.lineJoin });
    },
    drawImage() {
      ops.push({ kind: "drawImage" });
    },
    lineJoin: "miter",
    measureText: (t: string) => ({ width: t.length * 8 }),
    setTransform() {},
    save() {
      ops.push({ kind: "save" });
    },
    restore() {
      ops.push({ kind: "restore" });
    },
    scale() {},
    beginPath() {},
    closePath() {},
    arc() {},
    rect() {},
    clip() {},
    fill() {},
    strokeRect() {},
    setLineDash() {},
  };
  return ctx as unknown as SpyCtx;
}

const measurer: core.TextMeasurer = core.createMockMeasurer(8, 16);
const BAND = "rgb(1, 2, 3)";

const canvasCtx = new WeakMap<HTMLCanvasElement, SpyCtx>();
let originalGetContext: PropertyDescriptor | undefined;
let originalIO: typeof IntersectionObserver | undefined;
/** Page indices the stubbed IntersectionObserver reports as visible. */
let visiblePages: (idx: number) => boolean = () => true;
const containers: HTMLElement[] = [];

beforeEach(() => {
  originalGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    value: function (this: HTMLCanvasElement) {
      let ctx = canvasCtx.get(this);
      if (ctx === undefined) {
        ctx = createSpyCtx();
        canvasCtx.set(this, ctx);
      }
      return ctx;
    },
    writable: true,
    configurable: true,
  });
  originalIO = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = vi.fn().mockImplementation((cb: IntersectionObserverCallback) => ({
    observe: (el: Element) => {
      const idx = Number((el as HTMLElement).dataset.pageIndex);
      cb([{ target: el, isIntersecting: visiblePages(idx) } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    },
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })) as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  if (originalGetContext !== undefined) Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalGetContext);
  if (originalIO !== undefined) globalThis.IntersectionObserver = originalIO;
  for (const c of containers) c.remove();
  containers.length = 0;
  visiblePages = () => true;
});

function config(pageConfig?: core.PageConfig): core.EditorConfig {
  return {
    componentRegistry: core.createDefaultComponentRegistry(),
    attrRegistry: core.createDefaultAttrRegistry(),
    containerWidth: 600,
    ...(pageConfig !== undefined ? { pageConfig } : {}),
  };
}

function seeded(texts: readonly string[], cfg: core.EditorConfig): { editor: core.EditorState; ids: core.BlockId[] } {
  const root: core.ContainerBlockNode = {
    type: "document",
    children: texts.map((text) => ({ type: "paragraph", inlineContent: { items: [{ kind: "text" as const, text, attrs: {} }] } })),
  };
  const state = core.buildDocumentFromTree(root, {}, core.createTestAllocator());
  const ids: core.BlockId[] = [];
  for (let id = core.getBlock(state, state.rootId)?.firstChildId ?? null; id !== null; id = core.getBlock(state, id)?.nextSiblingId ?? null) ids.push(id);
  return { editor: core.createEditorStateFromState(state, core.initialSelectionForState(state), cfg), ids };
}

function mount(
  onDecorationPointer?: (e: PrintDecorationPointerEvent) => void,
  pageConfig?: core.PageConfig,
  dispatch: (a: core.EditorAction) => void = vi.fn(),
): { container: HTMLElement; controller: EditorController } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const controller = createEditorController(container, {
    measurer,
    dispatch,
    ...(pageConfig !== undefined ? { pageConfig, pageHeight: pageConfig.pageBlockSize, pageGap: pageConfig.pageGap } : {}),
    ...(onDecorationPointer !== undefined ? { onDecorationPointer } : {}),
  });
  return { container, controller };
}

/** The spy ctx of the single canvas, or of page `idx`'s canvas. */
function ctxOf(container: HTMLElement, idx?: number): SpyCtx {
  const canvas = container.querySelector(idx === undefined ? "canvas" : `canvas[data-page-index="${idx}"]`);
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no canvas");
  const ctx = canvasCtx.get(canvas);
  if (ctx === undefined) throw new Error("canvas never painted");
  return ctx;
}

const fills = (ctx: SpyCtx, style: string) =>
  ctx._ops.filter((o): o is Extract<Op, { kind: "fillRect" }> => o.kind === "fillRect" && o.fillStyle === style);
const glyph = (ctx: SpyCtx, text: string) => {
  const g = ctx._ops.find((o): o is Extract<Op, { kind: "fillText" }> => o.kind === "fillText" && o.text === text);
  if (g === undefined) throw new Error(`no glyph ${text}`);
  return g;
};

function inline(id: string, blockId: core.BlockId, from: number, to: number, style: core.DecorationStyle): core.InlineDecoration {
  return { kind: "inline", id, from: core.createPosition(blockId, from), to: core.createPosition(blockId, to), style, data: { ref: id } };
}

describe("print decorations — paint", () => {
  it("a host inline decoration paints a band over exactly its glyphs, under the text", () => {
    const cfg = config();
    const { editor, ids } = seeded(["hello world foo"], cfg);
    const p = ids[0];
    if (p === undefined) throw new Error("setup");
    const { container, controller } = mount();
    controller.update(editor);
    ctxOf(container)._ops.length = 0;
    controller.setDecorations([inline("e1", p, 6, 11, { backgroundColor: BAND })]);

    const ctx = ctxOf(container);
    const bands = fills(ctx, BAND);
    expect(bands).toHaveLength(1);
    const band = bands[0];
    if (band === undefined) throw new Error("unreachable");
    expect(band.x).toBe(glyph(ctx, "w").x);
    expect(band.w).toBe(5 * 8);
    // Under the text: the band precedes the glyphs it covers.
    expect(ctx._ops.indexOf(band)).toBeLessThan(ctx._ops.indexOf(glyph(ctx, "w")));
    expect(controller.decorations.decorations.map((d) => d.id)).toEqual(["e1"]);
    controller.destroy();
  });

  it("paints solid / dotted / dashed / wavy underlines under the range's baseline", () => {
    const cfg = config();
    const { editor, ids } = seeded(["hello world foo"], cfg);
    const p = ids[0];
    if (p === undefined) throw new Error("setup");
    const { container, controller } = mount();
    controller.update(editor);
    const draw = (style: "solid" | "dotted" | "dashed" | "wavy", color: string) => {
      ctxOf(container)._ops.length = 0;
      controller.setDecorations([inline("u", p, 6, 11, { underline: { color, style } })]);
      return ctxOf(container);
    };
    const wY = () => glyph(ctxOf(container), "w").y;

    const solid = fills(draw("solid", "red"), "red");
    expect(solid).toHaveLength(1);
    expect(solid[0]?.w).toBe(40);
    expect(solid[0]?.h).toBe(1);
    expect(solid[0]?.y ?? 0).toBeGreaterThan(wY());

    const dotted = fills(draw("dotted", "blue"), "blue");
    expect(dotted.length).toBe(20);
    expect(dotted.every((d) => d.w === 1)).toBe(true);

    const dashed = fills(draw("dashed", "green"), "green");
    expect(dashed.length).toBe(8);
    expect(dashed.every((d) => d.w === 3)).toBe(true);

    const wavyCtx = draw("wavy", "purple");
    expect(wavyCtx._ops.some((o) => o.kind === "stroke" && o.strokeStyle === "purple")).toBe(true);
    const ys = new Set(wavyCtx._ops.filter((o): o is Extract<Op, { kind: "lineTo" }> => o.kind === "lineTo").map((o) => o.y));
    expect(ys.size).toBe(2); // a zig-zag between two heights
    controller.destroy();
  });

  it("a block decoration paints a background behind the block box, below inline bands", () => {
    const cfg = config();
    const { editor, ids } = seeded(["first", "second"], cfg);
    const [a, b] = ids;
    if (a === undefined || b === undefined) throw new Error("setup");
    const { container, controller } = mount();
    controller.update(editor);
    ctxOf(container)._ops.length = 0;
    controller.setDecorations([
      inline("i", b, 0, 3, { backgroundColor: BAND }),
      { kind: "block", id: "blk", blockId: b, style: { backgroundColor: "rgb(9, 9, 9)" } },
    ]);
    const ctx = ctxOf(container);
    const block = fills(ctx, "rgb(9, 9, 9)");
    expect(block).toHaveLength(1);
    const blockRect = block[0];
    const band = fills(ctx, BAND)[0];
    if (blockRect === undefined || band === undefined) throw new Error("unreachable");
    // Covers the second paragraph only (its glyphs, not the first's).
    expect(blockRect.y).toBeLessThanOrEqual(glyph(ctx, "c").y);
    expect(blockRect.y).toBeGreaterThan(glyph(ctx, "f").y);
    expect(blockRect.w).toBeGreaterThan(band.w);
    expect(ctx._ops.indexOf(blockRect)).toBeLessThan(ctx._ops.indexOf(band));
    controller.destroy();
  });

  it("host decorations paint ABOVE the built-in highlight layers (one mechanism, layer order)", () => {
    const cfg = config();
    const { editor, ids } = seeded(["foo bar foo"], cfg);
    const p = ids[0];
    if (p === undefined) throw new Error("setup");
    const { container, controller } = mount();
    controller.update(editor);
    controller.setDecorations([inline("h", p, 0, 3, { backgroundColor: BAND })]);
    ctxOf(container)._ops.length = 0;
    controller.setFindHighlights(core.findMatches(editor.state, "foo"), 0);
    const ctx = ctxOf(container);
    const find = fills(ctx, core.ACTIVE_FIND_HIGHLIGHT_FILL)[0];
    const host = fills(ctx, BAND)[0];
    if (find === undefined || host === undefined) throw new Error("expected both bands");
    expect(ctx._ops.indexOf(find)).toBeLessThan(ctx._ops.indexOf(host));
    expect(fills(ctx, core.FIND_HIGHLIGHT_FILL)).toHaveLength(1);
    controller.destroy();
  });
});

describe("print decorations — mapping through edits", () => {
  it("typing before a decoration shifts it; deleting its range removes it", () => {
    const cfg = config();
    const { editor, ids } = seeded(["hello world foo"], cfg);
    const p = ids[0];
    if (p === undefined) throw new Error("setup");
    const { container, controller } = mount();
    controller.update(editor);
    controller.setDecorations([inline("e1", p, 6, 11, { backgroundColor: BAND })]);
    const before = fills(ctxOf(container), BAND)[0]?.x ?? NaN;

    const at0 = core.reduceEditor(editor, { type: "SET_SELECTION", selection: core.createSpan(core.createPosition(p, 0), core.createPosition(p, 0)) }, cfg);
    controller.update(at0);
    const typed = core.reduceEditor(at0, { type: "INSERT_TEXT", text: "XX" }, cfg);
    ctxOf(container)._ops.length = 0;
    controller.update(typed);
    const d = controller.decorations.decorations[0];
    expect(d?.kind === "inline" ? [d.from.offset, d.to.offset] : null).toEqual([8, 13]);
    const shifted = fills(ctxOf(container), BAND)[0];
    expect(shifted?.x).toBe(before + 16);
    expect(shifted?.w).toBe(40);

    const sel = core.reduceEditor(typed, { type: "SET_SELECTION", selection: core.createSpan(core.createPosition(p, 7), core.createPosition(p, 14)) }, cfg);
    controller.update(sel);
    const deleted = core.reduceEditor(sel, { type: "DELETE_BACKWARD" }, cfg);
    ctxOf(container)._ops.length = 0;
    controller.update(deleted);
    expect(controller.decorations.decorations).toHaveLength(0);
    expect(fills(ctxOf(container), BAND)).toHaveLength(0);
    controller.destroy();
  });
});

/** Two short pages: each paragraph lands on its own page. */
const TWO_PAGES: core.PageConfig = {
  pageInlineSize: 600,
  pageBlockSize: 20,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 24,
};

describe("print decorations — paginated", () => {
  it("changing one decoration repaints only the page it is on", () => {
    const cfg = config(TWO_PAGES);
    const { editor, ids } = seeded(["alpha", "bravo"], cfg);
    const [a, b] = ids;
    if (a === undefined || b === undefined) throw new Error("setup");
    const { container, controller } = mount(undefined, TWO_PAGES);
    controller.update(editor);
    const decos = [inline("a", a, 0, 5, { backgroundColor: BAND }), inline("b", b, 0, 5, { backgroundColor: BAND })];
    controller.setDecorations(decos);
    expect(fills(ctxOf(container, 0), BAND)).toHaveLength(1);
    expect(fills(ctxOf(container, 1), BAND)).toHaveLength(1);

    ctxOf(container, 0)._ops.length = 0;
    ctxOf(container, 1)._ops.length = 0;
    controller.setDecorations([inline("a", a, 0, 5, { backgroundColor: BAND }), inline("b", b, 0, 5, { backgroundColor: "rgb(7, 7, 7)" })]);
    expect(ctxOf(container, 0)._ops).toHaveLength(0); // untouched page: no repaint at all
    expect(fills(ctxOf(container, 1), "rgb(7, 7, 7)")).toHaveLength(1);
    controller.destroy();
  });

  it("pointer enter / leave / click report the live decoration and its viewport rects", () => {
    const cfg = config(TWO_PAGES);
    const { editor, ids } = seeded(["alpha", "bravo"], cfg);
    const b = ids[1];
    if (b === undefined) throw new Error("setup");
    const events: PrintDecorationPointerEvent[] = [];
    const { container, controller } = mount((e) => events.push(e), TWO_PAGES);
    controller.update(editor);
    controller.setDecorations([inline("m1", b, 1, 4, { backgroundColor: BAND })]);
    const page1 = container.querySelector('canvas[data-page-index="1"]');
    if (!(page1 instanceof HTMLCanvasElement)) throw new Error("no page-1 canvas");
    const band = fills(ctxOf(container, 1), BAND)[0];
    if (band === undefined) throw new Error("no band");
    const inside = { clientX: band.x + 4, clientY: band.y + 4, bubbles: true };

    page1.dispatchEvent(new MouseEvent("mousemove", inside));
    expect(events.map((e) => e.type)).toEqual(["enter"]);
    const enter = events[0];
    if (enter === undefined) throw new Error("unreachable");
    expect(enter.decoration.id).toBe("m1");
    expect(enter.decoration.data).toEqual({ ref: "m1" });
    // Viewport rect = container origin (0,0 in jsdom) + page-1 slot top + page-local rect.
    const slotTop = 20 + 24;
    expect(enter.rect.left).toBe(band.x);
    expect(enter.rect.top).toBe(slotTop + band.y);
    expect(enter.rect.width).toBe(3 * 8);
    expect(enter.rects).toHaveLength(1);

    page1.dispatchEvent(new MouseEvent("mousemove", inside)); // still inside: no event
    page1.dispatchEvent(new MouseEvent("mousemove", { clientX: band.x + band.w + 50, clientY: band.y + 4, bubbles: true }));
    expect(events.map((e) => e.type)).toEqual(["enter", "leave"]);

    page1.dispatchEvent(new MouseEvent("click", inside));
    expect(events.at(-1)?.type).toBe("click");
    expect(events.at(-1)?.decoration.id).toBe("m1");
    controller.destroy();
  });

  it("built-in highlights report pointer events too (ids prefixed tw-)", () => {
    const cfg = config(TWO_PAGES);
    const { editor } = seeded(["alpha", "bravo"], cfg);
    const events: PrintDecorationPointerEvent[] = [];
    const { container, controller } = mount((e) => events.push(e), TWO_PAGES);
    controller.update(editor);
    controller.setFindHighlights(core.findMatches(editor.state, "alpha"), 0);
    const band = fills(ctxOf(container, 0), core.ACTIVE_FIND_HIGHLIGHT_FILL)[0];
    const page0 = container.querySelector('canvas[data-page-index="0"]');
    if (band === undefined || !(page0 instanceof HTMLCanvasElement)) throw new Error("setup");
    page0.dispatchEvent(new MouseEvent("click", { clientX: band.x + 1, clientY: band.y + 1, bubbles: true }));
    expect(events.map((e) => e.type)).toEqual(["click"]);
    expect(events[0]?.decoration.id.startsWith("tw-find:")).toBe(true);
    controller.destroy();
  });
});

describe("print decorations — widgets", () => {
  it("renders a widget as an overlay at its caret rect, filtered attrs, never copied", () => {
    const cfg = config(TWO_PAGES);
    const { editor, ids } = seeded(["alpha", "bravo"], cfg);
    const b = ids[1];
    if (b === undefined) throw new Error("setup");
    const events: PrintDecorationPointerEvent[] = [];
    const { container, controller } = mount((e) => events.push(e), TWO_PAGES);
    controller.update(editor);
    const at = core.createPosition(b, 2);
    controller.setDecorations([
      {
        kind: "widget",
        id: "ghost",
        at,
        text: "GHOST",
        class: "ghost-text",
        attributes: { "data-x": "1", onclick: "alert(1)", "data-tw-deco": "hijack", style: "color: red" },
      },
    ]);
    const el = container.querySelector('[data-tw-widget][data-tw-deco="ghost"]');
    if (!(el instanceof HTMLElement)) throw new Error("no widget overlay");
    expect(el.textContent).toBe("GHOST");
    expect(el.classList.contains("ghost-text")).toBe(true);
    expect(el.getAttribute("data-x")).toBe("1");
    expect(el.hasAttribute("onclick")).toBe(false);
    expect(el.style.color).toBe("");
    // At the caret rect of its anchor (container origin is 0,0 in jsdom).
    const caret = controller.getCaretRect(at);
    if (caret === null) throw new Error("no caret rect");
    expect(el.style.left).toBe(`${caret.left}px`);
    expect(el.style.top).toBe(`${caret.top}px`);
    expect(el.style.display).toBe("");

    // Typing before the anchor moves the overlay with the text.
    const before = core.reduceEditor(editor, { type: "SET_SELECTION", selection: core.createSpan(core.createPosition(b, 0), core.createPosition(b, 0)) }, cfg);
    controller.update(before);
    const typed = core.reduceEditor(before, { type: "INSERT_TEXT", text: "Z" }, cfg);
    controller.update(typed);
    expect(el.isConnected).toBe(true); // same look → element reused
    expect(el.style.left).toBe(`${(controller.getCaretRect(core.createPosition(b, 3))?.left ?? NaN)}px`);

    // Hovering the overlay reports the widget.
    el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    expect(events.map((e) => [e.type, e.decoration.id])).toEqual([["enter", "ghost"]]);

    // Copy over the anchor never includes widget text.
    const all = core.reduceEditor(typed, { type: "SET_SELECTION", selection: core.createSpan(core.createPosition(b, 0), core.createPosition(b, 6)) }, cfg);
    controller.update(all);
    const setData = vi.fn();
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copy, "clipboardData", { value: { setData } });
    container.querySelector("textarea")?.dispatchEvent(copy);
    expect(setData).toHaveBeenCalledWith("text/plain", "Zbravo");

    controller.setDecorations([]);
    expect(container.querySelector("[data-tw-widget]")).toBeNull();
    controller.destroy();
  });
});

// ── Paint order: decorations are CSS backgrounds (under content) ─────────────

const BASE_CS = {
  backgroundColor: "transparent", color: "black", fontFamily: "sans-serif", fontSize: 16,
  fontWeight: "normal", fontStyle: "normal", underline: false, lineThrough: false, direction: "ltr",
  transform: [], opacity: 1,
};
const BASE_US = {
  paddingBlockStart: 0, paddingBlockEnd: 0, paddingInlineStart: 0, paddingInlineEnd: 0,
  borderBlockStartWidth: 0, borderBlockEndWidth: 0, borderInlineStartWidth: 0, borderInlineEndWidth: 0,
  borderBlockStartStyle: "none", borderBlockEndStyle: "none", borderInlineStartStyle: "none", borderInlineEndStyle: "none",
  borderBlockStartColor: "black", borderBlockEndColor: "black", borderInlineStartColor: "black", borderInlineEndColor: "black",
  direction: "ltr", lineHeight: 16, writingMode: "horizontal-tb",
};

function box(type: string, key: string, rect: { x: number; y: number; w: number; h: number }, extra: Record<string, unknown> = {}): LayoutBox {
  return {
    type, key, inlineOffset: rect.x, blockOffset: rect.y, inlineSize: rect.w, blockSize: rect.h,
    x: rect.x, y: rect.y, width: rect.w, height: rect.h, writingMode: "horizontal-tb", direction: "ltr",
    computedStyle: { ...BASE_CS }, usedStyle: { ...BASE_US }, ...extra,
  } as unknown as LayoutBox;
}

function blockFragment(blockId: string, color: string, r: { x: number; y: number; w: number; h: number }): DecorationRect {
  return {
    x: r.x, y: r.y, width: r.w, height: r.h, pageIndex: 0, kind: "block", vertical: false, backgroundColor: color,
    decoration: { kind: "block", id: `b:${blockId}`, blockId: core.asBlockId(blockId) },
  };
}
function inlineFragment(color: string, r: { x: number; y: number; w: number; h: number }): DecorationRect {
  const at = core.createPosition(core.asBlockId("p"), 0);
  return { x: r.x, y: r.y, width: r.w, height: r.h, pageIndex: 0, kind: "inline", vertical: false, backgroundColor: color, decoration: { kind: "inline", id: "i", from: at, to: at } };
}

describe("print decorations — paint order under content", () => {
  const OPAQUE = "rgb(200, 0, 0)";
  const paint = (root: LayoutBox, decos: DecorationRect[]): SpyCtx => {
    const ctx = createSpyCtx();
    paintCanvas(ctx, root, [], decos, { x: 0, y: 0, height: 0 }, "hidden", 600, 800, 0, 800, { get: () => null } as unknown as ImageCache);
    return ctx;
  };
  const idx = (ctx: SpyCtx, pred: (o: Op) => boolean): number => ctx._ops.findIndex(pred);

  it("an opaque block decoration on an image block paints UNDER the image", () => {
    const img = box("block", "img", { x: 0, y: 0, w: 100, h: 50 }, { children: [], metadata: { image: { src: "x.png", width: 100, height: 50 } } });
    const ctx = paint(img, [blockFragment("img", OPAQUE, { x: 0, y: 0, w: 100, h: 50 })]);
    const deco = idx(ctx, (o) => o.kind === "fillRect" && o.fillStyle === OPAQUE);
    const image = idx(ctx, (o) => o.kind === "fillRect" && o.fillStyle === "#f0f0f0"); // image placeholder
    expect(deco).toBeGreaterThanOrEqual(0);
    expect(deco).toBeLessThan(image);
  });

  it("a block decoration on a bordered cell paints under the borders; a table decoration under the cell background", () => {
    const run = box("text-run", "r", { x: 0, y: 0, w: 24, h: 16 }, { text: "abc", offsetLength: 3 });
    const line = box("line", "l", { x: 0, y: 0, w: 100, h: 16 }, { children: [run], baseline: 12, ownerBlockId: "p", inlineOffsetStart: 0, inlineOffsetEnd: 3, isBlockBoundaryLine: true });
    const para = box("block", "p", { x: 0, y: 0, w: 100, h: 16 }, { children: [line] });
    const cell = box("table-cell", "cell", { x: 0, y: 0, w: 100, h: 16 }, {
      children: [para], rowIndex: 0, colIndex: 0, rowSpan: 1, colSpan: 1,
      computedStyle: { ...BASE_CS, backgroundColor: "rgb(0, 0, 255)", borderBlockStartStyle: "solid", borderBlockStartColor: "rgb(0, 255, 0)" },
      usedStyle: { ...BASE_US, borderBlockStartWidth: 2, borderBlockStartStyle: "solid", borderBlockStartColor: "rgb(0, 255, 0)" },
    });
    const row = box("table-row", "row", { x: 0, y: 0, w: 100, h: 16 }, { children: [cell] });
    const table = box("table", "tbl", { x: 0, y: 0, w: 100, h: 16 }, { children: [row], columnPxWidths: [100] });
    const ctx = paint(table, [
      blockFragment("tbl", "rgb(1, 1, 1)", { x: 0, y: 0, w: 100, h: 16 }),
      blockFragment("cell", OPAQUE, { x: 0, y: 0, w: 100, h: 16 }),
      inlineFragment("rgb(9, 9, 9)", { x: 0, y: 0, w: 16, h: 16 }),
    ]);
    const tableDeco = idx(ctx, (o) => o.kind === "fillRect" && o.fillStyle === "rgb(1, 1, 1)");
    const cellBg = idx(ctx, (o) => o.kind === "fillRect" && o.fillStyle === "rgb(0, 0, 255)");
    const cellDeco = idx(ctx, (o) => o.kind === "fillRect" && o.fillStyle === OPAQUE);
    const border = idx(ctx, (o) => o.kind === "fillRect" && o.fillStyle === "rgb(0, 255, 0)");
    const band = idx(ctx, (o) => o.kind === "fillRect" && o.fillStyle === "rgb(9, 9, 9)");
    const text = idx(ctx, (o) => o.kind === "fillText");
    expect([tableDeco, cellBg, cellDeco, border, band, text].every((i) => i >= 0)).toBe(true);
    // table decoration < cell background < cell decoration < cell border < inline band < glyphs
    expect(tableDeco).toBeLessThan(cellBg);
    expect(cellBg).toBeLessThan(cellDeco);
    expect(cellDeco).toBeLessThan(border);
    expect(border).toBeLessThan(band);
    expect(band).toBeLessThan(text);
    // The inline band is clipped to the run it decorates (16px of the 24px run).
    const b = ctx._ops[band];
    expect(b?.kind === "fillRect" ? [b.x, b.w] : null).toEqual([0, 16]);
  });
});

describe("print decorations — colours", () => {
  it("skips an invalid colour (never reusing the previous fillStyle) and resolves var()", () => {
    const cfg = config();
    const { editor, ids } = seeded(["hello world foo"], cfg);
    const p = ids[0];
    if (p === undefined) throw new Error("setup");
    const { container, controller } = mount();
    container.style.setProperty("--mark", "rgb(4, 5, 6)");
    controller.update(editor);
    ctxOf(container)._ops.length = 0;
    controller.setDecorations([
      inline("ok", p, 0, 5, { backgroundColor: BAND }),
      inline("bad", p, 6, 11, { backgroundColor: "not-a-colour" }),
    ]);
    const ctx = ctxOf(container);
    // Exactly one band: the invalid one draws nothing (no BAND-coloured fill over "world").
    expect(fills(ctx, BAND)).toHaveLength(1);
    expect(fills(ctx, BAND)[0]?.x).toBe(glyph(ctx, "h").x);
    expect(ctx._ops.some((o) => o.kind === "fillRect" && o.fillStyle === "not-a-colour")).toBe(false);

    ctx._ops.length = 0;
    controller.setDecorations([inline("var", p, 0, 5, { backgroundColor: "var(--mark)" })]);
    // The custom property resolves through the editor's cascade.
    expect(fills(ctx, "rgb(4, 5, 6)")).toHaveLength(1);
    expect(ctx._ops.some((o) => o.kind === "fillRect" && o.fillStyle.includes("var("))).toBe(false);
    controller.destroy();
  });

  it("an unset var() resolves like CSS does for that property (browser engine)", () => {
    const cfg = config();
    const { editor, ids } = seeded(["hello world foo"], cfg);
    const p = ids[0];
    if (p === undefined) throw new Error("setup");
    // Emulate a real browser: an unset custom property makes the declaration invalid at
    // computed-value time, so background-color falls back to transparent and
    // text-decoration-color to currentcolor (jsdom would leave var() unresolved instead).
    const real = window.getComputedStyle;
    const spy = vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
      const cs = real(el, pseudo);
      return new Proxy(cs, {
        get(target, prop) {
          if (prop === "getPropertyValue") {
            return (name: string) => {
              const raw = (el as HTMLElement).style?.getPropertyValue(name) ?? "";
              if (name === "color" && raw.includes("var(--missing")) return "rgb(9, 9, 9)";
              if (raw.includes("var(--missing")) {
                if (name === "background-color") return "rgba(0, 0, 0, 0)";
                if (name === "text-decoration-color") return (el as HTMLElement).style.getPropertyValue("color");
              }
              return target.getPropertyValue(name);
            };
          }
          // `color` is inherited: an invalid-at-computed-time var() yields the parent's colour.
          if (prop === "color" && ((el as HTMLElement).style?.getPropertyValue("color") ?? "").includes("var(--missing")) {
            return "rgb(9, 9, 9)";
          }
          const v: unknown = Reflect.get(target, prop);
          return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      });
    });
    try {
      const { container, controller } = mount();
      controller.update(editor);
      ctxOf(container)._ops.length = 0;
      controller.setDecorations([
        inline("bg", p, 0, 5, { backgroundColor: "var(--missing)" }),
        inline("u", p, 6, 11, { underline: { style: "solid", color: "var(--missing)" } }),
      ]);
      const ctx = ctxOf(container);
      // No band in an inherited colour (digital's transparent fallback shows nothing either)…
      const textColor = glyph(ctx, "h").fillStyle;
      expect(ctx._ops.some((o) => o.kind === "fillRect" && o.h > 1 && (o.fillStyle === textColor || o.fillStyle === "rgb(9, 9, 9)"))).toBe(false);
      // …and the underline falls back to the run's text colour, like CSS currentcolor.
      const strokes = ctx._ops.filter((o): o is Extract<Op, { kind: "fillRect" }> => o.kind === "fillRect" && o.h === 1);
      expect(strokes.map((o) => o.fillStyle)).toEqual([textColor]);
      controller.destroy();
    } finally {
      spy.mockRestore();
    }
  });

  it("an underline without a colour uses the decorated run's text colour", () => {
    const cfg = config();
    const { editor, ids } = seeded(["hello world foo"], cfg);
    const p = ids[0];
    if (p === undefined) throw new Error("setup");
    const { container, controller } = mount();
    controller.update(editor);
    ctxOf(container)._ops.length = 0;
    controller.setDecorations([inline("u", p, 0, 5, { underline: { style: "solid" } })]);
    const ctx = ctxOf(container);
    const textColor = glyph(ctx, "h").fillStyle;
    const strokes = ctx._ops.filter((o): o is Extract<Op, { kind: "fillRect" }> => o.kind === "fillRect" && o.h === 1 && o.w === 40);
    expect(strokes).toHaveLength(1);
    expect(strokes[0]?.fillStyle).toBe(textColor);
    expect(textColor).not.toBe("currentColor");
    controller.destroy();
  });

  it("a wavy underline joins round, ends exactly at the range end, stays inside its band and restores the context", () => {
    const cfg = config();
    const { editor, ids } = seeded(["hello world foo"], cfg);
    const p = ids[0];
    if (p === undefined) throw new Error("setup");
    const { container, controller } = mount();
    controller.update(editor);
    ctxOf(container)._ops.length = 0;
    controller.setDecorations([inline("w", p, 6, 11, { underline: { style: "wavy", color: "purple" } })]);
    const ctx = ctxOf(container);
    const s = ctx._ops.findIndex((o) => o.kind === "stroke");
    const stroke = ctx._ops[s];
    expect(stroke?.kind === "stroke" ? [stroke.strokeStyle, stroke.lineJoin] : null).toEqual(["purple", "round"]);
    const path = ctx._ops.slice(0, s).filter((o): o is Extract<Op, { kind: "moveTo" | "lineTo" }> => o.kind === "moveTo" || o.kind === "lineTo");
    const start = path.map((o) => o.kind).lastIndexOf("moveTo");
    const pts = path.slice(start);
    const w = glyph(ctx, "w");
    expect(pts[0]?.x).toBe(w.x);
    expect(pts.at(-1)?.x).toBe(w.x + 40);
    // Inside the 16px line band (glyph top = band top for the mock 16px line).
    for (const q of pts) {
      expect(q.y).toBeGreaterThanOrEqual(w.y);
      expect(q.y).toBeLessThanOrEqual(w.y + 16);
    }
    expect(ctx._ops[s - (ctx._ops.slice(0, s).reverse().findIndex((o) => o.kind === "save") + 1)]?.kind).toBe("save");
    expect(ctx._ops.slice(s).some((o) => o.kind === "restore")).toBe(true);
    controller.destroy();
  });
});

// ── Pointer: resting pointer + removal / reflow ──────────────────────────────

describe("print decorations — pointer sync", () => {
  it("a decoration removed or reflowed out from under a resting pointer emits leave (with the decoration as last seen)", () => {
    const cfg = config(TWO_PAGES);
    const { editor, ids } = seeded(["alpha", "bravo"], cfg);
    const b = ids[1];
    if (b === undefined) throw new Error("setup");
    const events: PrintDecorationPointerEvent[] = [];
    const { container, controller } = mount((e) => events.push(e), TWO_PAGES);
    controller.update(editor);
    const deco = inline("m1", b, 0, 2, { backgroundColor: BAND });
    controller.setDecorations([deco]);
    const page1 = container.querySelector('canvas[data-page-index="1"]');
    const band = fills(ctxOf(container, 1), BAND)[0];
    if (!(page1 instanceof HTMLCanvasElement) || band === undefined) throw new Error("setup");
    const at = { clientX: band.x + 2, clientY: band.y + 4, bubbles: true };

    // Removal under a resting pointer.
    page1.dispatchEvent(new MouseEvent("mousemove", at));
    controller.setDecorations([]);
    expect(events.map((e) => [e.type, e.decoration.id])).toEqual([["enter", "m1"], ["leave", "m1"]]);
    expect(events[1]?.decoration).toBe(deco);

    // Reflow under a resting pointer: typing before the range pushes it away.
    events.length = 0;
    controller.setDecorations([deco]);
    page1.dispatchEvent(new MouseEvent("mousemove", at));
    expect(events.map((e) => e.type)).toEqual(["enter"]);
    const at0 = core.reduceEditor(editor, { type: "SET_SELECTION", selection: core.createSpan(core.createPosition(b, 0), core.createPosition(b, 0)) }, cfg);
    controller.update(at0);
    controller.update(core.reduceEditor(at0, { type: "INSERT_TEXT", text: "zzzz" }, cfg));
    expect(events.map((e) => e.type)).toEqual(["enter", "leave"]);
    controller.destroy();
  });
});

// ── Find highlights without a session follow edits ───────────────────────────

describe("print decorations — find highlights through edits", () => {
  it("session-less setFindHighlights bands follow the text when typing before them", () => {
    const cfg = config();
    const { editor, ids } = seeded(["foo bar foo"], cfg);
    const p = ids[0];
    if (p === undefined) throw new Error("setup");
    const { container, controller } = mount();
    controller.update(editor);
    controller.setFindHighlights(core.findMatches(editor.state, "foo"), 0);
    const before = fills(ctxOf(container), core.FIND_HIGHLIGHT_FILL).at(-1)?.x ?? NaN;
    const at0 = core.reduceEditor(editor, { type: "SET_SELECTION", selection: core.createSpan(core.createPosition(p, 0), core.createPosition(p, 0)) }, cfg);
    controller.update(at0);
    ctxOf(container)._ops.length = 0;
    controller.update(core.reduceEditor(at0, { type: "INSERT_TEXT", text: "XY" }, cfg));
    expect(fills(ctxOf(container), core.FIND_HIGHLIGHT_FILL).at(-1)?.x).toBe(before + 16);
    // No session: navigation has nothing to act on.
    expect(controller.findStatus()).toEqual({ total: 0, activeIndex: -1 });
    controller.destroy();
  });

  it("a find session refreshes on edits, so next / replace use the current offsets", () => {
    const cfg = config();
    const { editor, ids } = seeded(["foo bar foo"], cfg);
    const p = ids[0];
    if (p === undefined) throw new Error("setup");
    const dispatch = vi.fn();
    const { controller } = mount(undefined, undefined, dispatch);
    const at0 = core.reduceEditor(editor, { type: "SET_SELECTION", selection: core.createSpan(core.createPosition(p, 0), core.createPosition(p, 0)) }, cfg);
    controller.update(at0);
    expect(controller.findStart("foo")).toEqual({ total: 2, activeIndex: 0 });
    controller.update(core.reduceEditor(at0, { type: "INSERT_TEXT", text: "XY" }, cfg));
    expect(controller.findNext()).toEqual({ total: 2, activeIndex: 1 });
    controller.replaceActive("baz");
    const action = dispatch.mock.calls.at(-1)?.[0] as core.EditorAction | undefined;
    expect(action?.type === "REPLACE_MATCH" ? [action.match.start, action.match.end] : null).toEqual([10, 13]);
    controller.destroy();
  });
});

// ── Pages, slots, tables, writing modes ──────────────────────────────────────

/** A narrow paragraph (two 4-letter words per line) on two-line pages. */
const NARROW: core.PageConfig = {
  pageInlineSize: 80,
  pageBlockSize: 40,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 24,
};

describe("print decorations — geometry across pages and regions", () => {
  it("an inline decoration in a block straddling a page break paints on both pages", () => {
    const cfg = { ...config(NARROW), containerWidth: 80 };
    const { editor, ids } = seeded(["aaaa bbbb cccc dddd eeee ffff gggg hhhh"], cfg);
    const p = ids[0];
    if (p === undefined) throw new Error("setup");
    const { container, controller } = mount(undefined, NARROW);
    controller.update(editor);
    // "cccc dddd" is line 2 (page 0); "eeee ffff" line 3 (page 1).
    controller.setDecorations([inline("all", p, 12, 27, { backgroundColor: BAND }), inline("tail", p, 30, 34, { backgroundColor: "rgb(5, 5, 5)" })]);
    expect(fills(ctxOf(container, 0), BAND).length).toBeGreaterThan(0);
    expect(fills(ctxOf(container, 1), BAND).length).toBeGreaterThan(0);
    // A range wholly on the second line paints only there.
    expect(fills(ctxOf(container, 0), "rgb(5, 5, 5)")).toHaveLength(0);
    expect(fills(ctxOf(container, 1), "rgb(5, 5, 5)")).toHaveLength(1);
    controller.destroy();
  });

  const SLOTTED: core.PageConfig = {
    pageInlineSize: 320,
    pageBlockSize: 120,
    pageMargins: { blockStart: 40, blockEnd: 40, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };

  const TALL: core.PageConfig = { ...SLOTTED, pageBlockSize: 400 };

  /** Insert a header (or footnote) with `text`; returns the editor + its body block. */
  function withRegion(kind: "INSERT_HEADER" | "INSERT_FOOTER" | "INSERT_FOOTNOTE", body: readonly string[], text: string): { editor: core.EditorState; region: core.BlockId; cfg: core.EditorConfig } {
    const cfg = { ...config(kind === "INSERT_FOOTNOTE" ? TALL : SLOTTED), containerWidth: 320 };
    let { editor } = seeded(body, cfg);
    editor = core.reduceEditor(editor, { type: kind }, cfg);
    editor = core.reduceEditor(editor, { type: "INSERT_TEXT", text }, cfg);
    return { editor, region: editor.selection.focus.blockId, cfg };
  }

  for (const kind of ["INSERT_HEADER", "INSERT_FOOTER", "INSERT_FOOTNOTE"] as const) {
    it(`inline + block decorations paint inside a ${kind.slice(7).toLowerCase()} body`, () => {
      const { editor, region } = withRegion(kind, ["body text"], "REGION");
      const { container, controller } = mount(undefined, kind === "INSERT_FOOTNOTE" ? TALL : SLOTTED);
      controller.update(editor);
      controller.setDecorations([
        inline("r", region, 0, 3, { backgroundColor: BAND }),
        { kind: "block", id: "rb", blockId: region, style: { backgroundColor: "rgb(6, 6, 6)" } },
      ]);
      const ctx = ctxOf(container, 0);
      const band = fills(ctx, BAND)[0];
      const blk = fills(ctx, "rgb(6, 6, 6)")[0];
      if (band === undefined || blk === undefined) throw new Error(`no ${kind} decoration painted`);
      expect(band.x).toBe(glyph(ctx, "R").x);
      expect(band.w).toBe(24);
      expect(ctx._ops.indexOf(blk)).toBeLessThan(ctx._ops.indexOf(band));
      controller.destroy();
    });
  }

  it("a header widget renders one overlay per visible page showing the header", () => {
    const { editor, region } = withRegion("INSERT_HEADER", ["one", "two", "three", "four", "five", "six", "seven", "eight"], "HDR");
    const { container, controller } = mount(undefined, SLOTTED);
    controller.update(editor);
    const pages = container.querySelectorAll("canvas[data-page-index]").length;
    expect(pages).toBeGreaterThan(1);
    controller.setDecorations([{ kind: "widget", id: "hw", at: core.createPosition(region, 1), text: "*" }]);
    const els = Array.from(container.querySelectorAll<HTMLElement>('[data-tw-widget][data-tw-deco="hw"]'));
    expect(els).toHaveLength(pages);
    expect(new Set(els.map((e) => e.style.top)).size).toBe(pages); // one per page slot
    controller.destroy();
  });

  it("block decorations on a table, a cell, and the paragraph inside it paint table < cell < paragraph < text", () => {
    const cfg = config(SLOTTED);
    let { editor } = seeded(["x"], cfg);
    editor = core.reduceEditor(editor, { type: "INSERT_TABLE", rows: 1, cols: 1 }, cfg);
    editor = core.reduceEditor(editor, { type: "INSERT_TEXT", text: "cell" }, cfg);
    const para = editor.selection.focus.blockId;
    const cell = core.getBlock(editor.state, para)?.parentId ?? null;
    let table: core.BlockId | null = cell;
    while (table !== null && core.getBlock(editor.state, table)?.type !== "table") table = core.getBlock(editor.state, table)?.parentId ?? null;
    if (cell === null || table === null) throw new Error("no table");
    const { container, controller } = mount(undefined, SLOTTED);
    controller.update(editor);
    ctxOf(container, 0)._ops.length = 0;
    controller.setDecorations([
      { kind: "block", id: "t", blockId: table, style: { backgroundColor: "rgb(1, 0, 0)" } },
      { kind: "block", id: "c", blockId: cell, style: { backgroundColor: "rgb(2, 0, 0)" } },
      { kind: "block", id: "p", blockId: para, style: { backgroundColor: "rgb(3, 0, 0)" } },
    ]);
    const ctx = ctxOf(container, 0);
    const order = ["rgb(1, 0, 0)", "rgb(2, 0, 0)", "rgb(3, 0, 0)"].map((c) => {
      const f = fills(ctx, c)[0];
      if (f === undefined) throw new Error(`no fill ${c}`);
      return ctx._ops.indexOf(f);
    });
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order[2] ?? Infinity).toBeLessThan(ctx._ops.indexOf(glyph(ctx, "c")));
    controller.destroy();
  });

  it("RTL text: the band and underline cover exactly the decorated (visually reordered) glyphs", () => {
    const cfg = config();
    const { editor, ids } = seeded(["אבג דהו"], cfg);
    const p = ids[0];
    if (p === undefined) throw new Error("setup");
    const { container, controller } = mount();
    controller.update(editor);
    ctxOf(container)._ops.length = 0;
    controller.setDecorations([inline("rtl", p, 0, 3, { backgroundColor: BAND, underline: { color: "red", style: "solid" } })]);
    const ctx = ctxOf(container);
    const band = fills(ctx, BAND)[0];
    const ul = fills(ctx, "red")[0];
    if (band === undefined || ul === undefined) throw new Error("nothing painted");
    // The logically-first word sits on the RIGHT in an RTL paragraph.
    const xs = ["א", "ב", "ג"].map((g) => glyph(ctx, g).x);
    expect(band.x).toBeLessThanOrEqual(Math.min(...xs));
    expect(band.x + band.w).toBeGreaterThanOrEqual(Math.max(...xs) + 8);
    expect(band.w).toBe(24);
    expect([ul.x, ul.w, ul.h]).toEqual([band.x, band.w, 1]);
    expect(ul.y).toBeGreaterThan(band.y);
    expect(ul.y + ul.h).toBeLessThanOrEqual(band.y + band.h);
    controller.destroy();
  });

  it("vertical-rl text: the underline is a vertical stroke on the line-right side, inside the band", () => {
    const cfg = config();
    const root: core.ContainerBlockNode = {
      type: "document",
      attrs: { writingMode: "vertical-rl" },
      children: [{ type: "paragraph", attrs: { writingMode: "vertical-rl" }, inlineContent: { items: [{ kind: "text", text: "abc def", attrs: {} }] } }],
    };
    const state = core.buildDocumentFromTree(root, {}, core.createTestAllocator());
    const p = core.getBlock(state, state.rootId)?.firstChildId ?? null;
    if (p === null) throw new Error("setup");
    const { container, controller } = mount();
    controller.update(core.createEditorStateFromState(state, core.initialSelectionForState(state), cfg));
    ctxOf(container)._ops.length = 0;
    controller.setDecorations([inline("v", p, 0, 3, { backgroundColor: BAND, underline: { color: "red", style: "solid" } })]);
    const ctx = ctxOf(container);
    const band = fills(ctx, BAND)[0];
    const ul = fills(ctx, "red")[0];
    if (band === undefined || ul === undefined) throw new Error("nothing painted");
    expect(band.h).toBeGreaterThan(band.w); // inline axis is vertical
    expect(ul.w).toBe(1);
    expect(ul.h).toBe(band.h);
    expect(ul.y).toBe(band.y);
    expect(ul.x).toBeGreaterThan(band.x + band.w / 2); // line-right half
    expect(ul.x + ul.w).toBeLessThanOrEqual(band.x + band.w);
    controller.destroy();
  });

  it("widgets on pages without a live canvas are not drawn until the page scrolls into view", () => {
    const cfg = config(TWO_PAGES);
    const { editor, ids } = seeded(["alpha", "bravo", "charlie"], cfg);
    const c = ids[2];
    if (c === undefined) throw new Error("setup");
    visiblePages = (i) => i === 0;
    const { container, controller } = mount(undefined, TWO_PAGES);
    controller.update(editor);
    controller.setDecorations([{ kind: "widget", id: "late", at: core.createPosition(c, 2), text: "!" }]);
    expect(container.querySelector('[data-tw-deco="late"]')).toBeNull();
    visiblePages = () => true; // "scroll": the observer now reports page 2
    controller.update(editor);
    const el = container.querySelector('[data-tw-deco="late"]');
    expect(el).not.toBeNull();
    expect((el as HTMLElement).style.left).toBe(`${controller.getCaretRect(core.createPosition(c, 2))?.left ?? NaN}px`);
    visiblePages = (i) => i === 0;
    controller.update(editor);
    expect(container.querySelector('[data-tw-deco="late"]')).toBeNull();
    controller.destroy();
  });
});

describe("print decorations — before the first update", () => {
  it("`decorations` reports the queued host set, which is applied to the first document", () => {
    const cfg = config();
    const { editor, ids } = seeded(["hello world"], cfg);
    const p = ids[0];
    if (p === undefined) throw new Error("setup");
    const { container, controller } = mount();
    const queued = [inline("q", p, 0, 5, { backgroundColor: BAND })];
    controller.setDecorations(queued);
    expect(controller.decorations.decorations).toEqual(queued);
    controller.update(editor);
    expect(controller.decorations.decorations.map((d) => d.id)).toEqual(["q"]);
    expect(fills(ctxOf(container), BAND)).toHaveLength(1);
    controller.destroy();
  });
});

describe("print decorations — review round 2", () => {
  it("resolves nested var() fallbacks, rejects CSS-wide keywords, and paints currentColor in the text colour", () => {
    const cfg = config();
    const { editor, ids } = seeded(["hello world foo bar"], cfg);
    const p = ids[0];
    if (p === undefined) throw new Error("setup");
    const { container, controller } = mount();
    container.style.setProperty("--mark", "rgb(4, 5, 6)");
    controller.update(editor);
    ctxOf(container)._ops.length = 0;
    controller.setDecorations([
      inline("nested", p, 0, 5, { backgroundColor: "var(--missing, var(--mark, red))" }),
      inline("paren", p, 6, 11, { backgroundColor: "var(--missing, rgb(7, 8, 9))" }),
      inline("kw", p, 12, 15, { backgroundColor: "inherit" }),
      inline("cur", p, 16, 19, { backgroundColor: "currentColor" }),
    ]);
    const ctx = ctxOf(container);
    expect(fills(ctx, "rgb(4, 5, 6)")[0]?.x).toBe(glyph(ctx, "h").x);
    expect(fills(ctx, "rgb(7, 8, 9)")[0]?.x).toBe(glyph(ctx, "w").x);
    expect(ctx._ops.some((o) => o.kind === "fillRect" && /inherit|var\(|currentcolor/i.test(o.fillStyle))).toBe(false);
    // currentColor → the decorated run's text colour, over "bar".
    const bar = glyph(ctx, "b");
    expect(ctx._ops.some((o) => o.kind === "fillRect" && o.fillStyle === bar.fillStyle && o.x === bar.x && o.w === 24)).toBe(true);
    // Nothing painted over "foo" (the rejected keyword).
    const f = glyph(ctx, "f");
    expect(ctx._ops.some((o) => o.kind === "fillRect" && o.x === f.x && o.w === 24 && o.h > 1)).toBe(false);
    controller.destroy();
  });

  it("sync() re-hit-tests via elementFromPoint, so a rebuilt widget under a resting pointer is not a leave/enter", () => {
    const cfg = config(TWO_PAGES);
    const { editor, ids } = seeded(["alpha", "bravo"], cfg);
    const a = ids[0];
    if (a === undefined) throw new Error("setup");
    const events: PrintDecorationPointerEvent[] = [];
    const { container, controller } = mount((e) => events.push(e), TWO_PAGES);
    controller.update(editor);
    const widget = (cls: string): core.WidgetDecoration => ({ kind: "widget", id: "wd", at: core.createPosition(a, 1), text: "*", class: cls });
    controller.setDecorations([widget("v1")]);
    const first = container.querySelector('[data-tw-deco="wd"]');
    if (!(first instanceof HTMLElement)) throw new Error("no widget");
    first.dispatchEvent(new MouseEvent("mousemove", { clientX: 3, clientY: 3, bubbles: true }));
    expect(events.map((e) => e.type)).toEqual(["enter"]);
    const original = document.elementFromPoint;
    document.elementFromPoint = () => container.querySelector('[data-tw-deco="wd"]');
    try {
      controller.setDecorations([widget("v2")]); // new look → the element is rebuilt
      const rebuilt = container.querySelector('[data-tw-deco="wd"]');
      expect(rebuilt).not.toBe(first);
      expect(events.map((e) => e.type)).toEqual(["enter"]); // no spurious leave / enter
      controller.setDecorations([]);
      document.elementFromPoint = () => container.querySelector("canvas");
      controller.update(editor);
      expect(events.map((e) => e.type)).toEqual(["enter", "leave"]);
    } finally {
      document.elementFromPoint = original;
    }
    controller.destroy();
  });

  it("an inline band covers a tab inside the decorated range", () => {
    const cfg = config();
    const { editor: e0, ids } = seeded(["ab"], cfg);
    const p = ids[0];
    if (p === undefined) throw new Error("setup");
    let editor = core.reduceEditor(e0, { type: "SET_SELECTION", selection: core.createSpan(core.createPosition(p, 2), core.createPosition(p, 2)) }, cfg);
    editor = core.reduceEditor(editor, { type: "INSERT_TAB" }, cfg);
    editor = core.reduceEditor(editor, { type: "INSERT_TEXT", text: "cd" }, cfg);
    const { container, controller } = mount();
    controller.update(editor);
    ctxOf(container)._ops.length = 0;
    controller.setDecorations([inline("t", p, 0, 5, { backgroundColor: BAND })]);
    const ctx = ctxOf(container);
    const bEnd = glyph(ctx, "b").x + 8;
    const c = glyph(ctx, "c").x;
    expect(c).toBeGreaterThan(bEnd); // the tab advance
    const bands = fills(ctx, BAND);
    // The bands cover [a .. d] with no gap at the tab.
    const covered = (x: number): boolean => bands.some((r) => r.x <= x && x < r.x + r.w);
    for (let x = glyph(ctx, "a").x; x < glyph(ctx, "d").x + 8; x += 2) expect(covered(x)).toBe(true);
    controller.destroy();
  });

  it("position: relative content: fragments, paint and hit-test share the shifted frame", () => {
    const state = core.buildState({
      rootId: "doc",
      blocks: [
        core.buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        core.buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: core.inlineContent([core.text("abc")]) }),
      ],
    });
    const p = core.asBlockId("p");
    const run = box("text-run", "p/run", { x: 0, y: 0, w: 24, h: 16 }, { text: "abc", offsetLength: 3, sourceStart: 0 });
    const line = box("line", "p/line", { x: 0, y: 0, w: 100, h: 16 }, { children: [run], baseline: 12, ownerBlockId: "p", inlineOffsetStart: 0, inlineOffsetEnd: 3, isBlockBoundaryLine: true });
    const para = box("block", "p", { x: 0, y: 0, w: 100, h: 16 }, { children: [line], relativeOffset: { dx: 30, dy: 5 } });
    const root = box("block", "doc", { x: 0, y: 0, w: 100, h: 40 }, { children: [para] });
    const set = core.createDecorationSet(state, [inline("rel", p, 1, 3, { backgroundColor: BAND })]);
    const rects = computeDecorationRects({
      state, decorations: set, root, pageIndex: null, measurer, pageSpanOf: () => null, resolve: () => null,
    });
    const frag = rects.find((r) => r.kind === "inline");
    expect(frag === undefined ? null : [frag.x, frag.y, frag.width]).toEqual([30 + 8, 5, 16]);
    const ctx = createSpyCtx();
    paintCanvas(ctx, root, [], rects, { x: 0, y: 0, height: 0 }, "hidden", 600, 800, 0, 800);
    const band = fills(ctx, BAND)[0];
    expect(band === undefined ? null : [band.x, band.y, band.w]).toEqual([38, 5, 16]);
    // The painted glyph "b" sits exactly where the fragment starts.
    expect(glyph(ctx, "b").x).toBe(band?.x);
  });
});

describe("print decorations — async host (basedOn)", () => {
  it("decorations computed on an older State land on the right text; an unknown State drops them", () => {
    const cfg = config();
    const { editor, ids } = seeded(["hello world foo"], cfg);
    const p = ids[0];
    if (p === undefined) throw new Error("setup");
    const { container, controller } = mount();
    controller.update(editor);
    const old = editor.state;
    const decos = [inline("m", p, 6, 11, { backgroundColor: BAND })]; // "world" in `old`
    const at0 = core.reduceEditor(editor, { type: "SET_SELECTION", selection: core.createSpan(core.createPosition(p, 0), core.createPosition(p, 0)) }, cfg);
    controller.update(at0);
    const typed = core.reduceEditor(at0, { type: "INSERT_TEXT", text: "XY" }, cfg);
    controller.update(typed);
    ctxOf(container)._ops.length = 0;
    controller.setDecorations(decos, old);
    const d = controller.decorations.decorations[0];
    expect(d?.kind === "inline" ? [d.from.offset, d.to.offset] : null).toEqual([8, 13]);
    expect(fills(ctxOf(container), BAND)[0]?.x).toBe(glyph(ctxOf(container), "w").x);

    const unknown = seeded(["other"], cfg).editor.state;
    controller.setDecorations(decos, unknown);
    expect(controller.decorations.decorations).toHaveLength(0);
    controller.destroy();
  });
});
