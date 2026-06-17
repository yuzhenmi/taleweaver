/**
 * Merged table-cell paint (P8.S4.T4).
 *
 * Table-cell borders/backgrounds are painted GEOMETRY-DRIVEN: the `table-cell`
 * branch of `paintBox` draws `paintBorders(ctx, us, absX, absY, box.width,
 * box.height)`, so a SPANNING cell — whose box carries the merged width (colSpan,
 * P8.S2) / height (rowSpan, P8.S3) — paints its border around the FULL merged
 * rect by construction. No span-specific paint code is needed; this locks that a
 * colSpan-2 cell's border spans both columns (not just its first column). The
 * pixel-level visual confirm is the browser smoke (user's domain).
 *
 * JSDOM has no CanvasRenderingContext2D — spy-stub records fillRect (borders are
 * drawn as filled side-rects).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { paintCanvas } from "./canvas-renderer";
import type { LayoutBox } from "./index";

interface Rect { x: number; y: number; w: number; h: number; }

interface SpyCtx extends CanvasRenderingContext2D {
  _rects: Rect[];
}

function createSpyCtx(width = 800, height = 800): SpyCtx {
  const rects: Rect[] = [];
  const ctx: Partial<CanvasRenderingContext2D> & { _rects: Rect[] } = {
    _rects: rects,
    canvas: { width, height } as HTMLCanvasElement,
    font: "",
    textBaseline: "alphabetic",
    fillStyle: "",
    clearRect() { /* no-op */ },
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h });
    },
    fillText() { /* no-op */ },
    measureText: (text: string) => ({ width: text.length * 8 } as TextMetrics),
  };
  return ctx as unknown as SpyCtx;
}

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
  lineHeight: 20,
  writingMode: "horizontal-tb",
};

// US with a 2px solid border on all four logical sides.
const BORDER_US = {
  paddingBlockStart: 0, paddingBlockEnd: 0,
  paddingInlineStart: 0, paddingInlineEnd: 0,
  borderBlockStartWidth: 2, borderBlockEndWidth: 2,
  borderInlineStartWidth: 2, borderInlineEndWidth: 2,
  borderBlockStartStyle: "solid", borderBlockEndStyle: "solid",
  borderInlineStartStyle: "solid", borderInlineEndStyle: "solid",
  borderBlockStartColor: "black", borderBlockEndColor: "black",
  borderInlineStartColor: "black", borderInlineEndColor: "black",
  direction: "ltr",
  lineHeight: 20,
  writingMode: "horizontal-tb",
};

function box(type: string, x: number, y: number, width: number, height: number, children: LayoutBox[], us: object = BORDER_US): LayoutBox {
  return {
    type, key: `${type}-${x}-${y}`,
    inlineOffset: x, blockOffset: y,
    inlineSize: width, blockSize: height,
    x, y, width, height,
    writingMode: "horizontal-tb", direction: "ltr",
    children,
    columnPxWidths: [], occupancy: [], columnCount: 0,
    computedStyle: { ...BASE_CS },
    usedStyle: { ...us },
  } as unknown as LayoutBox;
}

function paint(ctx: SpyCtx, root: LayoutBox): void {
  paintCanvas(ctx, root, [], [], [], [], { x: 0, y: 0, height: 0 }, "hidden", 800, 800, 0, 800);
}

describe("merged table-cell paint (#P8.S4.T4)", () => {
  let ctx: SpyCtx;
  beforeEach(() => { ctx = createSpyCtx(); });

  it("a colSpan-2 cell paints its border spanning the FULL merged width", () => {
    // table(0,0,600,16) > row(0,0,600,16) > cell(0,0,600,16) — the cell's box
    // width 600 IS the merged colSpan-2 width (S2). All at origin so absX=0.
    const cell = box("table-cell", 0, 0, 600, 16, []);
    const row = box("table-row", 0, 0, 600, 16, [cell], BASE_CS);
    const table = box("table", 0, 0, 600, 16, [row], BASE_CS);
    const root = box("block", 0, 0, 600, 16, [table], BASE_CS);
    paint(ctx, root);

    // Top border: a filled rect (x=0, y=0, w=600, h=2) — spans the merged width,
    // NOT a single 300px column.
    const top = ctx._rects.find((r) => r.x === 0 && r.y === 0 && r.h === 2);
    expect(top).toBeDefined();
    expect(top?.w).toBe(600);
    // Right border sits at the merged right edge (x = 600 − 2 = 598), full height.
    const right = ctx._rects.find((r) => r.x === 598 && r.w === 2 && r.h === 16);
    expect(right).toBeDefined();
  });

  it("a 1×1 cell paints its border at its own column width (control)", () => {
    const cell = box("table-cell", 0, 0, 300, 16, []);
    const row = box("table-row", 0, 0, 300, 16, [cell], BASE_CS);
    const table = box("table", 0, 0, 300, 16, [row], BASE_CS);
    const root = box("block", 0, 0, 300, 16, [table], BASE_CS);
    paint(ctx, root);

    const top = ctx._rects.find((r) => r.x === 0 && r.y === 0 && r.h === 2);
    expect(top?.w).toBe(300); // own column width, not merged
  });
});
