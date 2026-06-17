/**
 * #433 (Find & Replace UI, slice: match-highlight overlay): paint find matches
 * as a translucent highlight band UNDER the selection tint and UNDER the text.
 *
 * Two layers of coverage:
 *  1. RENDERER (paintCanvas/paintPage): pass `MatchHighlightRect[]` directly and
 *     pin the paint ORDER (match highlight fillRect < selection fillRect < glyph
 *     fillText), the COLOURS (yellow all / orange active; inactive painted before
 *     active), and the COUNTS (N matches → N bands; multi-rect for multi-line).
 *  2. CONTROLLER (createEditorController + REAL renderer + a spy canvas): drive
 *     `setFindHighlights([...], i)` / `clearFindHighlights()` and assert the
 *     rects/colours actually reach the canvas (the two-stage rect resolution).
 *
 * Mirrors selection-composite-paint.test.ts's mock-canvas op-recording pattern.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  paintCanvas,
  paintPage,
  MATCH_HIGHLIGHT_FILL,
  ACTIVE_MATCH_HIGHLIGHT_FILL,
  createEditorController,
  type MatchHighlightRect,
} from "./index";
import { createPaintCache } from "./paint-cache";
import type { LayoutBox, SelectionRect } from "./index";
import * as core from "@taleweaver/core";

type Op =
  | { kind: "fillRect"; x: number; y: number; w: number; h: number; fillStyle: string }
  | { kind: "fillText"; text: string; x: number; y: number; fillStyle: string }
  | { kind: "clearRect"; x: number; y: number; w: number; h: number };

interface SpyCtx extends CanvasRenderingContext2D {
  _ops: Op[];
}

function createSpyCtx(): SpyCtx {
  const ops: Op[] = [];
  const ctx: Partial<CanvasRenderingContext2D> & { _ops: Op[] } = {
    _ops: ops,
    canvas: { width: 600, height: 800 } as HTMLCanvasElement,
    font: "",
    textBaseline: "alphabetic",
    fillStyle: "",
    clearRect(x: number, y: number, w: number, h: number) {
      ops.push({ kind: "clearRect", x, y, w, h });
    },
    fillRect(this: { fillStyle: string }, x: number, y: number, w: number, h: number) {
      ops.push({ kind: "fillRect", x, y, w, h, fillStyle: this.fillStyle });
    },
    fillText(this: { fillStyle: string }, text: string, x: number, y: number) {
      ops.push({ kind: "fillText", text, x, y, fillStyle: this.fillStyle });
    },
    measureText: (t: string) => ({ width: t.length * 8 } as TextMetrics),
    setTransform() {
      /* no-op */
    },
  };
  return ctx as unknown as SpyCtx;
}

const RUN_WIDTH = 100;
const RUN_HEIGHT = 16;
const BASE_CS = {
  backgroundColor: "transparent",
  color: "black",
  fontFamily: "sans-serif",
  fontSize: 16,
  fontWeight: "normal",
  fontStyle: "normal",
  underline: false,
  lineThrough: false,
  direction: "ltr",
};
const BASE_US = {
  paddingBlockStart: 0, paddingBlockEnd: 0, paddingInlineStart: 0, paddingInlineEnd: 0,
  borderBlockStartWidth: 0, borderBlockEndWidth: 0, borderInlineStartWidth: 0, borderInlineEndWidth: 0,
  borderBlockStartStyle: "none", borderBlockEndStyle: "none", borderInlineStartStyle: "none", borderInlineEndStyle: "none",
  borderBlockStartColor: "black", borderBlockEndColor: "black", borderInlineStartColor: "black", borderInlineEndColor: "black",
  direction: "ltr", lineHeight: 20, writingMode: "horizontal-tb",
};

const SELECTION_FILL = "rgba(59, 130, 246, 0.3)";

function makeRun(): LayoutBox {
  return {
    type: "text-run",
    key: "run",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: RUN_WIDTH, blockSize: RUN_HEIGHT,
    x: 0, y: 0, width: RUN_WIDTH, height: RUN_HEIGHT,
    writingMode: "horizontal-tb", direction: "ltr",
    text: "abc",
    computedStyle: { ...BASE_CS, backgroundColor: "transparent" },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

const isMatchInactive = (o: Op): boolean =>
  o.kind === "fillRect" && o.fillStyle === MATCH_HIGHLIGHT_FILL;
const isMatchActive = (o: Op): boolean =>
  o.kind === "fillRect" && o.fillStyle === ACTIVE_MATCH_HIGHLIGHT_FILL;
const isSelection = (o: Op): boolean =>
  o.kind === "fillRect" && o.fillStyle === SELECTION_FILL;
const isGlyph = (o: Op): boolean => o.kind === "fillText";

// ── Renderer-level: paintCanvas ──────────────────────────────────────────────

describe("match-highlight overlay — paintCanvas (#433)", () => {
  it("paints match highlight BEFORE selection BEFORE glyphs", () => {
    const ctx = createSpyCtx();
    const matches: MatchHighlightRect[] = [
      { x: 0, y: 0, width: 24, height: RUN_HEIGHT, pageIndex: 0, active: false },
    ];
    const selection: SelectionRect[] = [
      { x: 0, y: 0, width: RUN_WIDTH, height: RUN_HEIGHT, pageIndex: 0 },
    ];
    paintCanvas(ctx, makeRun(), selection, matches, [], [], { x: 0, y: 0, height: 0 }, "hidden", 600, 800, 0, 800);
    const ops = ctx._ops;
    const match = ops.findIndex(isMatchInactive);
    const sel = ops.findIndex(isSelection);
    const glyph = ops.findIndex(isGlyph);

    expect(match).toBeGreaterThanOrEqual(0);
    expect(sel).toBeGreaterThanOrEqual(0);
    expect(glyph).toBeGreaterThanOrEqual(0);
    // match highlight is BEHIND the selection tint, which is BEHIND the glyphs.
    expect(match).toBeLessThan(sel);
    expect(sel).toBeLessThan(glyph);
  });

  it("paints N matches → N highlight bands in the inactive colour", () => {
    const ctx = createSpyCtx();
    const matches: MatchHighlightRect[] = [
      { x: 0, y: 0, width: 24, height: RUN_HEIGHT, pageIndex: 0, active: false },
      { x: 40, y: 0, width: 24, height: RUN_HEIGHT, pageIndex: 0, active: false },
      { x: 80, y: 0, width: 16, height: RUN_HEIGHT, pageIndex: 0, active: false },
    ];
    paintCanvas(ctx, makeRun(), [], matches, [], [], { x: 0, y: 0, height: 0 }, "hidden", 600, 800, 0, 800);
    const bands = ctx._ops.filter(isMatchInactive);
    expect(bands).toHaveLength(3);
    expect(ctx._ops.filter(isMatchActive)).toHaveLength(0);
  });

  it("active match uses the active colour; inactive matches use the inactive colour; inactive painted BEFORE active", () => {
    const ctx = createSpyCtx();
    const matches: MatchHighlightRect[] = [
      { x: 0, y: 0, width: 24, height: RUN_HEIGHT, pageIndex: 0, active: false },
      { x: 40, y: 0, width: 24, height: RUN_HEIGHT, pageIndex: 0, active: true },
    ];
    paintCanvas(ctx, makeRun(), [], matches, [], [], { x: 0, y: 0, height: 0 }, "hidden", 600, 800, 0, 800);
    const ops = ctx._ops;
    expect(ops.filter(isMatchInactive)).toHaveLength(1);
    expect(ops.filter(isMatchActive)).toHaveLength(1);
    // Inactive band painted before active (active colour wins overlap).
    expect(ops.findIndex(isMatchInactive)).toBeLessThan(ops.findIndex(isMatchActive));
  });

  it("a multi-line match → multiple rects (one band per line)", () => {
    // computeSelectionRects already emits one rect per line for a span that
    // wraps; the controller flattens those into the per-match MatchHighlightRect
    // list. Here we model the wrapped match as two rects of the SAME match.
    const ctx = createSpyCtx();
    const matches: MatchHighlightRect[] = [
      { x: 60, y: 0, width: 40, height: RUN_HEIGHT, pageIndex: 0, active: false },
      { x: 0, y: RUN_HEIGHT, width: 30, height: RUN_HEIGHT, pageIndex: 0, active: false },
    ];
    paintCanvas(ctx, makeRun(), [], matches, [], [], { x: 0, y: 0, height: 0 }, "hidden", 600, 800, 0, 800);
    expect(ctx._ops.filter(isMatchInactive)).toHaveLength(2);
  });

  it("empty matches → no match-highlight fillRects (no regression to normal paint)", () => {
    const ctx = createSpyCtx();
    paintCanvas(ctx, makeRun(), [], [], [], [], { x: 0, y: 0, height: 0 }, "hidden", 600, 800, 0, 800);
    expect(ctx._ops.filter((o) => isMatchInactive(o) || isMatchActive(o))).toHaveLength(0);
    // Glyphs still painted.
    expect(ctx._ops.some(isGlyph)).toBe(true);
  });
});

// ── Renderer-level: paintPage (production paginated path) ─────────────────────

const PAGE_WIDTH = 600;
const PAGE_HEIGHT = 800;
const BASE_LINE_US = { ...BASE_US, lineHeight: RUN_HEIGHT };

function makePage(): LayoutBox {
  const run = makeRun();
  const line: LayoutBox = {
    type: "line",
    key: "line",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: RUN_WIDTH, blockSize: RUN_HEIGHT,
    x: 0, y: 0, width: RUN_WIDTH, height: RUN_HEIGHT,
    writingMode: "horizontal-tb", direction: "ltr",
    baseline: 12, ownerBlockId: "owner", inlineStartOffset: 0,
    children: [run],
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_LINE_US },
  } as unknown as LayoutBox;
  const block: LayoutBox = {
    type: "block",
    key: "block",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: RUN_WIDTH, blockSize: RUN_HEIGHT,
    x: 0, y: 0, width: RUN_WIDTH, height: RUN_HEIGHT,
    writingMode: "horizontal-tb", direction: "ltr",
    children: [line],
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
  return {
    type: "page",
    key: "page-0",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: PAGE_WIDTH, blockSize: PAGE_HEIGHT,
    x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT,
    writingMode: "horizontal-tb", direction: "ltr",
    children: [block],
    pageIndex: 0,
    headerSlot: null, footerSlot: null, footnoteSlot: null,
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

describe("match-highlight overlay — paintPage (#433)", () => {
  it("paints match highlight BEFORE selection BEFORE glyphs (paintPage)", () => {
    const ctx = createSpyCtx();
    const matches: MatchHighlightRect[] = [
      { x: 0, y: 0, width: 24, height: RUN_HEIGHT, pageIndex: 0, active: false },
    ];
    const selection: SelectionRect[] = [
      { x: 0, y: 0, width: RUN_WIDTH, height: RUN_HEIGHT, pageIndex: 0 },
    ];
    paintPage(ctx, makePage(), selection, matches, [], [], null, "hidden");
    const ops = ctx._ops;
    const match = ops.findIndex(isMatchInactive);
    const sel = ops.findIndex(isSelection);
    const glyph = ops.findIndex(isGlyph);
    expect(match).toBeGreaterThanOrEqual(0);
    expect(sel).toBeGreaterThanOrEqual(0);
    expect(glyph).toBeGreaterThanOrEqual(0);
    expect(match).toBeLessThan(sel);
    expect(sel).toBeLessThan(glyph);
  });

  it("active match emphasized over the inactive band (paintPage)", () => {
    const ctx = createSpyCtx();
    const matches: MatchHighlightRect[] = [
      { x: 0, y: 0, width: 24, height: RUN_HEIGHT, pageIndex: 0, active: false },
      { x: 40, y: 0, width: 24, height: RUN_HEIGHT, pageIndex: 0, active: true },
    ];
    paintPage(ctx, makePage(), [], matches, [], [], null, "hidden");
    const ops = ctx._ops;
    expect(ops.filter(isMatchInactive)).toHaveLength(1);
    expect(ops.filter(isMatchActive)).toHaveLength(1);
    expect(ops.findIndex(isMatchInactive)).toBeLessThan(ops.findIndex(isMatchActive));
  });
});

// ── Renderer-level: incremental clear/erase (addMatchHighlightDirty) ──────────
//
// The controller's clearFindHighlights() path repaints with `matchHighlights:
// []`. On the INCREMENTAL paint path (a real PaintCache holding the prior
// frame's highlight rects), `addMatchHighlightDirty` must dirty the PRIOR rects'
// regions so the stale yellow band is erased — otherwise the
// layout-reference-equal short-circuit would skip the repaint and the old band
// would linger. This drives the true incremental branch (`cache` non-null) end
// to end, distinguishing it from the full-clear non-incremental path: it would
// FAIL if `addMatchHighlightDirty` did not push the prior rects when current
// highlights are empty. Mirrors integration-paint.test.ts's clearRect tracking.

const isClearOver = (o: Op, x: number, y: number, w: number, h: number): boolean =>
  o.kind === "clearRect" &&
  o.x <= x && o.y <= y &&
  o.x + o.w >= x + w && o.y + o.h >= y + h;

describe("match-highlight overlay — incremental clear/erase (#433)", () => {
  it("clearing highlights (curr=[]) dirties + clearRects the OLD highlight rects", () => {
    const ctx = createSpyCtx();
    const cache = createPaintCache();
    const page = makePage();
    const OLD_RECT = { x: 5, y: 7, width: 24, height: RUN_HEIGHT };
    const matches: MatchHighlightRect[] = [
      { ...OLD_RECT, pageIndex: 0, active: false },
    ];

    // Frame 1: paint WITH a highlight so the PaintCache records its rect.
    paintPage(ctx, page, [], matches, [], [], null, "hidden", undefined, cache);
    expect(cache.getLastMatchHighlightRects()).not.toBeNull();
    expect(ctx._ops.filter(isMatchInactive)).toHaveLength(1);

    // Frame 2: SAME (reference-equal) layout tree, but highlights cleared to [].
    // The only thing that changed is the highlight set → the repaint MUST be
    // driven purely by addMatchHighlightDirty dirtying the OLD rect.
    ctx._ops.length = 0;
    const dirty = paintPage(ctx, page, [], [], [], [], null, "hidden", undefined, cache);

    // The OLD highlight rect's region was dirtied (so it gets erased)...
    expect(
      dirty.some(
        (r) =>
          r.x <= OLD_RECT.x && r.y <= OLD_RECT.y &&
          r.x + r.w >= OLD_RECT.x + OLD_RECT.width &&
          r.y + r.h >= OLD_RECT.y + OLD_RECT.height,
      ),
    ).toBe(true);
    // ...and clearRect was actually issued over the OLD coordinates.
    expect(
      ctx._ops.some((o) => isClearOver(o, OLD_RECT.x, OLD_RECT.y, OLD_RECT.width, OLD_RECT.height)),
    ).toBe(true);
    // No new highlight band is painted after the clear.
    expect(ctx._ops.filter((o) => isMatchInactive(o) || isMatchActive(o))).toHaveLength(0);
    // Cache forgot the old rects (curr=[] recorded).
    expect(cache.getLastMatchHighlightRects()).toEqual([]);
  });
});

// ── Controller-level (real controller + real renderer + spy canvas) ──────────

const measurer: core.TextMeasurer = core.createMockMeasurer(8, 16);

function seededEditorState(text: string): { editor: core.EditorState; blockId: core.BlockId } {
  const config: core.EditorConfig = {
    componentRegistry: core.createDefaultComponentRegistry(),
    attrRegistry: core.createDefaultAttrRegistry(),
    containerWidth: 600,
  };
  let editor = core.createInitialEditorState(config);
  editor = core.reduceEditor(editor, { type: "INSERT_TEXT", text }, config);
  const block = core.getBlock(editor.state, editor.state.rootId);
  const blockId = block?.firstChildId;
  if (blockId === null || blockId === undefined) throw new Error("no paragraph block");
  return { editor, blockId };
}

describe("controller setFindHighlights / clearFindHighlights (#433)", () => {
  const containers: HTMLElement[] = [];
  let originalGetContext: PropertyDescriptor | undefined;
  // One spy ctx per canvas (non-paginated path uses ONE canvas).
  const canvasCtxMap = new WeakMap<HTMLCanvasElement, SpyCtx>();
  let activeCtx: SpyCtx | null = null;

  afterEach(() => {
    if (originalGetContext) {
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalGetContext);
    }
    for (const c of containers) c.remove();
    containers.length = 0;
    activeCtx = null;
  });

  function mount(): { container: HTMLElement; lastCtx: () => SpyCtx | null } {
    originalGetContext = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      "getContext",
    );
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value: function (this: HTMLCanvasElement) {
        let ctx = canvasCtxMap.get(this);
        if (!ctx) {
          ctx = createSpyCtx();
          canvasCtxMap.set(this, ctx);
        }
        activeCtx = ctx;
        return ctx;
      },
      writable: true,
      configurable: true,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    return { container, lastCtx: () => activeCtx };
  }

  function matchOps(ctx: SpyCtx | null): { inactive: Op[]; active: Op[] } {
    const ops = ctx?._ops ?? [];
    return {
      inactive: ops.filter(isMatchInactive),
      active: ops.filter(isMatchActive),
    };
  }

  it("setFindHighlights([m0, m1], 1) → m1's rects active colour, m0's inactive", () => {
    const { editor, blockId } = seededEditorState("foo bar foo");
    const { container, lastCtx } = mount();
    const controller = createEditorController(container, { measurer, dispatch: vi.fn() });
    controller.update(editor);

    // Two matches of "foo": at [0,3) and [8,11).
    const matches = core.findMatches(editor.state, "foo");
    expect(matches.length).toBe(2);
    const match0 = matches[0];
    if (match0 === undefined) throw new Error("expected match 0");
    expect(match0.blockId).toBe(blockId);

    controller.setFindHighlights(matches, 1);
    const { inactive, active } = matchOps(lastCtx());
    // m0 → at least one inactive band; m1 (active) → at least one active band.
    expect(inactive.length).toBeGreaterThan(0);
    expect(active.length).toBeGreaterThan(0);

    controller.destroy();
  });

  it("activeIndex out of range → all rects inactive colour", () => {
    const { editor } = seededEditorState("foo bar foo");
    const { container, lastCtx } = mount();
    const controller = createEditorController(container, { measurer, dispatch: vi.fn() });
    controller.update(editor);

    const matches = core.findMatches(editor.state, "foo");
    controller.setFindHighlights(matches, 99); // out of range
    const { inactive, active } = matchOps(lastCtx());
    expect(inactive.length).toBeGreaterThan(0);
    expect(active.length).toBe(0);

    controller.destroy();
  });

  it("clearFindHighlights() → no match-highlight fillRects painted afterwards", () => {
    const { editor } = seededEditorState("foo bar foo");
    const { container, lastCtx } = mount();
    const controller = createEditorController(container, { measurer, dispatch: vi.fn() });
    controller.update(editor);

    const matches = core.findMatches(editor.state, "foo");
    controller.setFindHighlights(matches, 0);
    expect(matchOps(lastCtx()).inactive.length + matchOps(lastCtx()).active.length).toBeGreaterThan(0);

    // Clear: subsequent paints emit no match bands.
    const ctx = lastCtx();
    if (ctx) ctx._ops.length = 0;
    controller.clearFindHighlights();
    const after = matchOps(lastCtx());
    expect(after.inactive.length).toBe(0);
    expect(after.active.length).toBe(0);

    controller.destroy();
  });

  it("no setFindHighlights call → normal paint emits no match bands", () => {
    const { editor } = seededEditorState("foo bar foo");
    const { container, lastCtx } = mount();
    const controller = createEditorController(container, { measurer, dispatch: vi.fn() });
    controller.update(editor);
    const { inactive, active } = matchOps(lastCtx());
    expect(inactive.length).toBe(0);
    expect(active.length).toBe(0);
    controller.destroy();
  });
});
