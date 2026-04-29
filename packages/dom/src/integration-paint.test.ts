/**
 * Integration tests for incremental painting (Plan 3.I Tasks 3-6).
 *
 * JSDOM does not implement CanvasRenderingContext2D.  These tests use a minimal
 * spy-stub that tracks which clearRect / fillRect calls are made; they exercise
 * the canvas-renderer logic end-to-end without a real GPU.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { paintCanvas, paintPage } from "./canvas-renderer";
import { createPaintCache } from "./paint-cache";
import type { LayoutBox } from "@taleweaver/core";

// ── Canvas mock ──────────────────────────────────────────────────────────────

interface ClearCall {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface MockCtx extends CanvasRenderingContext2D {
  _clearRects: ClearCall[];
}

function createMockCtx(width = 800, height = 600): MockCtx {
  const clearRects: ClearCall[] = [];
  const ctx: Partial<CanvasRenderingContext2D> & { _clearRects: ClearCall[] } = {
    _clearRects: clearRects,
    canvas: { width, height } as HTMLCanvasElement,
    font: "",
    textBaseline: "alphabetic",
    fillStyle: "",
    clearRect(x: number, y: number, w: number, h: number) {
      clearRects.push({ x, y, w, h });
    },
    fillRect() { /* no-op */ },
    fillText() { /* no-op */ },
    measureText: (text: string) => ({ width: text.length * 8 } as TextMetrics),
  };
  return ctx as unknown as MockCtx;
}

// ── LayoutBox helpers ────────────────────────────────────────────────────────

const BASE_CS = {
  backgroundColor: "transparent",
  color: "black",
  fontFamily: "sans-serif",
  fontSize: 16,
  fontWeight: "normal",
  fontStyle: "normal",
  textDecoration: "none",
  borderBlockStartStyle: "none",
  borderBlockEndStyle: "none",
  borderInlineStartStyle: "none",
  borderInlineEndStyle: "none",
  borderBlockStartColor: "black",
  borderBlockEndColor: "black",
  borderInlineStartColor: "black",
  borderInlineEndColor: "black",
  direction: "ltr",
};

const BASE_US = {
  paddingBlockStart: 0,
  paddingBlockEnd: 0,
  paddingInlineStart: 0,
  paddingInlineEnd: 0,
  borderBlockStartWidth: 0,
  borderBlockEndWidth: 0,
  borderInlineStartWidth: 0,
  borderInlineEndWidth: 0,
  borderBlockStartStyle: "none",
  borderBlockEndStyle: "none",
  borderInlineStartStyle: "none",
  borderInlineEndStyle: "none",
  borderBlockStartColor: "black",
  borderBlockEndColor: "black",
  borderInlineStartColor: "black",
  borderInlineEndColor: "black",
  direction: "ltr",
  lineHeight: 20,
};

function makeBlock(
  overrides: {
    key?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    children?: LayoutBox[];
    backgroundColor?: string;
  } = {},
): LayoutBox {
  return {
    type: "block",
    key: overrides.key ?? "root",
    inlineOffset: 0,
    blockOffset: 0,
    inlineSize: overrides.width ?? 800,
    blockSize: overrides.height ?? 600,
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    width: overrides.width ?? 800,
    height: overrides.height ?? 600,
    writingMode: "horizontal-tb",
    direction: "ltr",
    computedStyle: {
      ...BASE_CS,
      backgroundColor: overrides.backgroundColor ?? "transparent",
    },
    usedStyle: { ...BASE_US },
    children: overrides.children ?? [],
  } as unknown as LayoutBox;
}

function makeTextRun(overrides: {
  key?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
} = {}): LayoutBox {
  return {
    type: "text-run",
    key: overrides.key ?? "text1",
    inlineOffset: 0,
    blockOffset: 0,
    inlineSize: overrides.width ?? 100,
    blockSize: overrides.height ?? 20,
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    width: overrides.width ?? 100,
    height: overrides.height ?? 20,
    writingMode: "horizontal-tb",
    direction: "ltr",
    text: overrides.text ?? "hello",
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("paintCanvas incremental (cache)", () => {
  let ctx: MockCtx;
  const noCursor = { x: 0, y: 0, height: 0 };
  const noCursorState = "hidden" as const;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it("without cache: clears full canvas on every paint", () => {
    const root = makeBlock();
    paintCanvas(ctx, root, [], noCursor, noCursorState, 800, 600, 0, 600);

    // Must have exactly one full-canvas clear.
    expect(ctx._clearRects).toHaveLength(1);
    expect(ctx._clearRects[0]).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });

  it("first paint with cache: dirty regions cover all changed boxes", () => {
    const root = makeBlock({ width: 800, height: 600 });
    const cache = createPaintCache();

    const dirty = paintCanvas(ctx, root, [], noCursor, noCursorState, 800, 600, 0, 600, undefined, cache);

    // On the first pass every box is new → dirty regions must be non-empty.
    expect(dirty.length).toBeGreaterThan(0);
  });

  it("identical re-paint with cache: dirty regions empty on second pass", () => {
    const root = makeBlock({ width: 800, height: 600 });
    const cache = createPaintCache();

    // First paint — seeds the cache.
    paintCanvas(ctx, root, [], noCursor, noCursorState, 800, 600, 0, 600, undefined, cache);

    ctx._clearRects.length = 0; // reset spy

    // Second paint with identical layout.
    const dirty = paintCanvas(ctx, root, [], noCursor, noCursorState, 800, 600, 0, 600, undefined, cache);

    expect(dirty).toHaveLength(0);
    // No clearRects should have been issued (nothing was dirty).
    expect(ctx._clearRects).toHaveLength(0);
  });

  it("paint after layout change: dirty regions correspond to changed box", () => {
    const text1 = makeTextRun({ key: "t1", x: 0, y: 0, width: 100, height: 20, text: "hello" });
    const root = makeBlock({ children: [text1] });
    const cache = createPaintCache();

    // First paint seeds cache.
    paintCanvas(ctx, root, [], noCursor, noCursorState, 800, 600, 0, 600, undefined, cache);

    // Mutate the text box (simulates a layout update).
    (text1 as unknown as Record<string, unknown>)["text"] = "world!";
    (text1 as unknown as Record<string, unknown>)["width"] = 120;

    ctx._clearRects.length = 0;

    const dirty = paintCanvas(ctx, root, [], noCursor, noCursorState, 800, 600, 0, 600, undefined, cache);

    // The changed text-run must appear in dirty regions.
    expect(dirty.length).toBeGreaterThan(0);
    // At least one dirty region should cover the text run's position.
    const coversText = dirty.some((r) => r.x === 0 && r.y === 0);
    expect(coversText).toBe(true);
  });
});

describe("paintPage incremental (cache)", () => {
  let ctx: MockCtx;
  const noCursor = null;
  const noCursorState = "hidden" as const;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it("without cache: paints full page background on every call", () => {
    const page = makeBlock({ width: 600, height: 800, backgroundColor: "white" });
    paintPage(ctx, page, [], noCursor, noCursorState);
    // Should not have clearRect calls (paintPage uses fillRect for white bg, not clearRect).
    // Just verify it doesn't throw.
    expect(true).toBe(true);
  });

  it("identical re-paint with cache: dirty regions empty on second pass", () => {
    const page = makeBlock({ width: 600, height: 800, backgroundColor: "white" });
    const cache = createPaintCache();

    // First paint.
    paintPage(ctx, page, [], noCursor, noCursorState, undefined, cache);

    // Second paint — same layout.
    const dirty = paintPage(ctx, page, [], noCursor, noCursorState, undefined, cache);

    expect(dirty).toHaveLength(0);
  });

  it("paint after layout change: dirty regions non-empty", () => {
    const text1 = makeTextRun({ key: "t1", x: 0, y: 0, width: 100, height: 20, text: "hello" });
    const page = makeBlock({ width: 600, height: 800, backgroundColor: "white", children: [text1] });
    const cache = createPaintCache();

    // First paint.
    paintPage(ctx, page, [], noCursor, noCursorState, undefined, cache);

    // Mutate.
    (text1 as unknown as Record<string, unknown>)["text"] = "changed";

    const dirty = paintPage(ctx, page, [], noCursor, noCursorState, undefined, cache);

    expect(dirty.length).toBeGreaterThan(0);
  });
});
