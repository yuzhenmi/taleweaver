/**
 * POSITIONING slice 2 — `position: relative` paint-time visual offset.
 *
 * The BFC resolves a physical `relativeOffset` (dx, dy) for a `position: relative`
 * box from its `inset*` (the box's LayoutBox geometry stays PRE-offset). The
 * painter must add that delta to the box's accumulated origin so the box AND its
 * descendants draw shifted together — while an un-positioned box is unaffected.
 *
 * This test drives the real render→paint seam (`paintCanvas` → `paintBox`),
 * spying on the canvas ctx like the inline-block / tab-leader paint tests. JSDOM
 * has no CanvasRenderingContext2D, so we use a fillText-recording spy stub.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { paintCanvas } from "./canvas-renderer";
import { createPaintCache } from "./paint-cache";
import type { LayoutBox } from "./index";

// ── Canvas mock (records fillText text+x+y and clearRect rects) ──────────────
interface FillText { text: string; x: number; y: number; }
interface ClearRect { x: number; y: number; w: number; h: number; }

interface SpyCtx extends CanvasRenderingContext2D {
  _fills: FillText[];
  _clears: ClearRect[];
}

function createSpyCtx(width = 600, height = 800): SpyCtx {
  const fills: FillText[] = [];
  const clears: ClearRect[] = [];
  const ctx: Partial<CanvasRenderingContext2D> & { _fills: FillText[]; _clears: ClearRect[] } = {
    _fills: fills,
    _clears: clears,
    canvas: { width, height } as HTMLCanvasElement,
    font: "",
    textBaseline: "alphabetic",
    fillStyle: "",
    clearRect(x: number, y: number, w: number, h: number) {
      clears.push({ x, y, w, h });
    },
    fillRect() { /* no-op */ },
    fillText(text: string, x: number, y: number) {
      fills.push({ text, x, y });
    },
    measureText: (text: string) => ({ width: text.length * 8 } as TextMetrics),
  };
  return ctx as unknown as SpyCtx;
}

// ── LayoutBox helpers ────────────────────────────────────────────────────────
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
  paddingBlockStart: 0, paddingBlockEnd: 0,
  paddingInlineStart: 0, paddingInlineEnd: 0,
  borderBlockStartWidth: 0, borderBlockEndWidth: 0,
  borderInlineStartWidth: 0, borderInlineEndWidth: 0,
  borderBlockStartStyle: "none", borderBlockEndStyle: "none",
  borderInlineStartStyle: "none", borderInlineEndStyle: "none",
  borderBlockStartColor: "black", borderBlockEndColor: "black",
  borderInlineStartColor: "black", borderInlineEndColor: "black",
  direction: "ltr",
  lineHeight: 16,
  writingMode: "horizontal-tb",
};

function makeTextRun(opts: { text: string; x: number; y: number; width?: number; height?: number }): LayoutBox {
  const h = opts.height ?? 16;
  return {
    type: "text-run",
    key: `run-${opts.text}`,
    inlineOffset: 0, blockOffset: 0,
    inlineSize: opts.width ?? 100, blockSize: h,
    x: opts.x, y: opts.y,
    width: opts.width ?? 100, height: h,
    writingMode: "horizontal-tb", direction: "ltr",
    text: opts.text,
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

/**
 * A block at (x, y) sized (w, h) containing the given children, optionally with a
 * `position: relative` paint offset.
 */
function makeBlock(opts: {
  key: string;
  x: number; y: number; width: number; height: number;
  children: LayoutBox[];
  relativeOffset?: { dx: number; dy: number };
}): LayoutBox {
  return {
    type: "block",
    key: opts.key,
    inlineOffset: opts.x, blockOffset: opts.y,
    inlineSize: opts.width, blockSize: opts.height,
    x: opts.x, y: opts.y,
    width: opts.width, height: opts.height,
    writingMode: "horizontal-tb", direction: "ltr",
    children: opts.children,
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
    ...(opts.relativeOffset !== undefined ? { relativeOffset: opts.relativeOffset } : {}),
  } as unknown as LayoutBox;
}

function paint(ctx: SpyCtx, box: LayoutBox): void {
  paintCanvas(
    ctx,
    box,
    [],
    [],
    [], [], { x: 0, y: 0, height: 0 },
    "hidden",
    600,
    800,
    0,
    800,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe("position: relative paint-time offset", () => {
  let ctx: SpyCtx;
  beforeEach(() => { ctx = createSpyCtx(); });

  it("paints a relative box's content shifted by (dx, dy); a child inside is shifted too", () => {
    // A relative block at flow position (0, 0), offset by (20, 13). Its own
    // text-run sits at local (5, 0). The painted glyph must land at the SHIFTED
    // absolute position: absX = 0 + box.x(0) + dx(20) + run.x(5) = 25;
    // absY reflects box.y(0) + dy(13) + run.y(0) + line half-leading (0 here,
    // box.height 16 == fontSize 16 → half-leading 0).
    const run = makeTextRun({ text: "R", x: 5, y: 0, width: 16, height: 16 });
    const rel = makeBlock({
      key: "rel", x: 0, y: 0, width: 100, height: 16,
      children: [run], relativeOffset: { dx: 20, dy: 13 },
    });
    const root = makeBlock({ key: "root", x: 0, y: 0, width: 200, height: 100, children: [rel] });

    paint(ctx, root);

    const fill = ctx._fills.find((f) => f.text === "R");
    expect(fill).toBeDefined();
    expect(fill?.x).toBeCloseTo(25, 6);   // 0 + 0 + dx(20) + run.x(5)
    expect(fill?.y).toBeCloseTo(13, 6);   // 0 + 0 + dy(13) + run.y(0) + half-leading(0)
  });

  it("a NON-relative box (no relativeOffset) paints at its un-shifted position", () => {
    // Same geometry but no relativeOffset → glyph at the un-shifted spot.
    const run = makeTextRun({ text: "S", x: 5, y: 0, width: 16, height: 16 });
    const plain = makeBlock({
      key: "plain", x: 0, y: 0, width: 100, height: 16, children: [run],
    });
    const root = makeBlock({ key: "root", x: 0, y: 0, width: 200, height: 100, children: [plain] });

    paint(ctx, root);

    const fill = ctx._fills.find((f) => f.text === "S");
    expect(fill).toBeDefined();
    expect(fill?.x).toBeCloseTo(5, 6);   // 0 + 0 + run.x(5) — no offset
    expect(fill?.y).toBeCloseTo(0, 6);
  });

  it("a relative box's negative offset shifts content up-and-left", () => {
    const run = makeTextRun({ text: "N", x: 0, y: 0, width: 16, height: 16 });
    const rel = makeBlock({
      key: "rel", x: 40, y: 50, width: 100, height: 16,
      children: [run], relativeOffset: { dx: -10, dy: -7 },
    });
    const root = makeBlock({ key: "root", x: 0, y: 0, width: 200, height: 100, children: [rel] });

    paint(ctx, root);

    const fill = ctx._fills.find((f) => f.text === "N");
    expect(fill).toBeDefined();
    expect(fill?.x).toBeCloseTo(30, 6);   // 0 + box.x(40) + dx(-10) + run.x(0)
    expect(fill?.y).toBeCloseTo(43, 6);   // 0 + box.y(50) + dy(-7) + run.y(0)
  });

  it("incremental repaint: a relative box's dirty clearRect lands at the SHIFTED position", () => {
    // Regression (code-review C): walkAndDetectChanges (the incremental path)
    // must compute the dirty rect at box.{x,y} + relativeOffset, matching where
    // paintBox draws. Without the offset, clearRect clears the PRE-offset region
    // while paintBox draws at the shifted region → stale pixels linger.
    const run = makeTextRun({ text: "R", x: 0, y: 0, width: 16, height: 16 });
    const rel = makeBlock({
      key: "rel", x: 0, y: 0, width: 100, height: 16,
      children: [run], relativeOffset: { dx: 20, dy: 13 },
    });
    const root = makeBlock({ key: "root", x: 0, y: 0, width: 200, height: 100, children: [rel] });
    const cache = createPaintCache();

    // Incremental path (cache passed): first paint marks every box dirty.
    paintCanvas(ctx, root, [], [], [], [], { x: 0, y: 0, height: 0 }, "hidden", 600, 800, 0, 800, undefined, cache);

    // The rel block's dirty rect must be at the SHIFTED origin (0+0+dx, 0+0+dy),
    // NOT the pre-offset (0, 0). w=100 disambiguates the block from its run.
    const relClear = ctx._clears.find((c) => c.w === 100 && c.h === 16);
    expect(relClear).toBeDefined();
    expect(relClear?.x).toBe(20);
    expect(relClear?.y).toBe(13);
  });
});

// POSITIONING slice 3 — abs-pos children are painted via `box.absoluteChildren`
// (OUT of `box.children`), with the SAME parent origin (absX/absY) the box uses for
// its in-flow children, AFTER them (document order). The incremental dirty-rect walk
// must also cover them (else a painted abs box absent from the dirty walk leaves
// stale pixels — the same lesson as slice 2's relativeOffset).
describe("position: absolute paint", () => {
  let ctx: SpyCtx;
  beforeEach(() => { ctx = createSpyCtx(); });

  // A block carrying an abs child block (already resolved at its inset position in
  // the establishing box's frame).
  function makeBlockWithAbs(opts: {
    key: string; x: number; y: number; width: number; height: number;
    children: LayoutBox[]; absoluteChildren: LayoutBox[];
  }): LayoutBox {
    return {
      type: "block", key: opts.key,
      inlineOffset: opts.x, blockOffset: opts.y,
      inlineSize: opts.width, blockSize: opts.height,
      x: opts.x, y: opts.y, width: opts.width, height: opts.height,
      writingMode: "horizontal-tb", direction: "ltr",
      children: opts.children,
      absoluteChildren: opts.absoluteChildren,
      computedStyle: { ...BASE_CS }, usedStyle: { ...BASE_US },
    } as unknown as LayoutBox;
  }

  it("paints an abs child's content at its resolved absolute position", () => {
    // An abs child block at (50, 60) in the establishing box's frame, containing a
    // text-run at local (0, 0). The glyph lands at absX = root.x(0) + abs.x(50) +
    // run.x(0) = 50; absY = 60.
    const absRun = makeTextRun({ text: "A", x: 0, y: 0, width: 16, height: 16 });
    const absChild = makeBlock({ key: "abs", x: 50, y: 60, width: 40, height: 16, children: [absRun] });
    const inflowRun = makeTextRun({ text: "F", x: 0, y: 0, width: 16, height: 16 });
    const inflow = makeBlock({ key: "inflow", x: 0, y: 0, width: 100, height: 16, children: [inflowRun] });
    const root = makeBlockWithAbs({
      key: "root", x: 0, y: 0, width: 200, height: 100,
      children: [inflow], absoluteChildren: [absChild],
    });

    paint(ctx, root);

    // In-flow glyph at its normal spot.
    const fInflow = ctx._fills.find((f) => f.text === "F");
    expect(fInflow?.x).toBeCloseTo(0, 6);
    expect(fInflow?.y).toBeCloseTo(0, 6);
    // Abs glyph at the resolved abs position (proves absoluteChildren were painted).
    const fAbs = ctx._fills.find((f) => f.text === "A");
    expect(fAbs).toBeDefined();
    expect(fAbs?.x).toBeCloseTo(50, 6);
    expect(fAbs?.y).toBeCloseTo(60, 6);
  });

  it("incremental dirty-rect walk covers absoluteChildren (clearRect at the abs region)", () => {
    const absRun = makeTextRun({ text: "A", x: 0, y: 0, width: 16, height: 16 });
    const absChild = makeBlock({ key: "abs", x: 50, y: 60, width: 40, height: 16, children: [absRun] });
    const root = makeBlockWithAbs({
      key: "root", x: 0, y: 0, width: 200, height: 100,
      children: [], absoluteChildren: [absChild],
    });
    const cache = createPaintCache();

    paintCanvas(ctx, root, [], [], [], [], { x: 0, y: 0, height: 0 }, "hidden", 600, 800, 0, 800, undefined, cache);

    // The abs block's dirty rect (w=40, h=16) lands at its resolved (50, 60) — proving
    // walkAndDetectChanges descended absoluteChildren. Without it, the abs region is
    // never marked dirty and a stale abs box never clears/repaints.
    const absClear = ctx._clears.find((c) => c.w === 40 && c.h === 16);
    expect(absClear).toBeDefined();
    expect(absClear?.x).toBe(50);
    expect(absClear?.y).toBe(60);
  });
});
