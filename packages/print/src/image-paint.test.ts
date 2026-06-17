/**
 * Image paint: the typed `box.metadata.image` read drives `drawImage`.
 *
 * Regression guard for #429 (typed LayoutBoxMetadata): the canvas-renderer's
 * image branch used to read the metadata through an unchecked
 * `as { src; width; height }` cast. That cast was removed when `metadata.image`
 * became a strongly-typed field. This test asserts the paint still reads
 * `src`/`width`/`height` off the typed metadata and draws the cached image at
 * the metadata-given size/position — i.e. the typed read is wired correctly.
 *
 * JSDOM does not implement CanvasRenderingContext2D — we use a spy-stub that
 * records drawImage (image + x + y + w + h).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { paintCanvas } from "./canvas-renderer";
import type { LayoutBox } from "./index";

interface DrawImageCall {
  img: CanvasImageSource;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SpyCtx extends CanvasRenderingContext2D {
  _draws: DrawImageCall[];
}

function createSpyCtx(width = 600, height = 800): SpyCtx {
  const draws: DrawImageCall[] = [];
  // Duck-typed canvas stub: the renderer only uses the handful of methods
  // below. Typed as a loose record (not Partial<CanvasRenderingContext2D>) so
  // the overloaded `drawImage` signature isn't structurally re-checked here.
  const ctx: Record<string, unknown> = {
    _draws: draws,
    canvas: { width, height } as HTMLCanvasElement,
    font: "",
    textBaseline: "alphabetic",
    fillStyle: "",
    clearRect() { /* no-op */ },
    fillRect() { /* no-op */ },
    fillText() { /* no-op */ },
    measureText: (text: string) => ({ width: text.length * 8 } as TextMetrics),
    drawImage(
      img: CanvasImageSource,
      x: number,
      y: number,
      w?: number,
      h?: number,
    ) {
      draws.push({ img, x, y, w: w ?? 0, h: h ?? 0 });
    },
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
  lineHeight: 20,
  writingMode: "horizontal-tb",
};

/** A block-level image box carrying typed `metadata.image`, at (x, y). */
function makeImageBlock(opts: {
  x: number; y: number; src: string; width: number; height: number;
}): LayoutBox {
  return {
    type: "block",
    key: "img",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: opts.width, blockSize: opts.height,
    x: opts.x, y: opts.y,
    width: opts.width, height: opts.height,
    writingMode: "horizontal-tb", direction: "ltr",
    children: [],
    metadata: { image: { src: opts.src, width: opts.width, height: opts.height } },
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

function paint(ctx: SpyCtx, box: LayoutBox, imageCache: { get(src: string): HTMLImageElement | null }): void {
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
    // 13th positional arg = imageCache; the renderer reads it via
    // `state.imageCache.get(metadata.image.src)` in the block paint branch.
    imageCache as unknown as Parameters<typeof paintCanvas>[12],
  );
}

describe("image painting (typed metadata.image)", () => {
  let ctx: SpyCtx;

  beforeEach(() => {
    ctx = createSpyCtx();
  });

  it("draws the cached image at the metadata-given position and size", () => {
    const fakeImg = { tag: "cached-image" } as unknown as HTMLImageElement;
    const cache = { get: (src: string) => (src === "pic.png" ? fakeImg : null) };
    const box = makeImageBlock({ x: 12, y: 30, src: "pic.png", width: 64, height: 48 });

    paint(ctx, box, cache);

    expect(ctx._draws).toHaveLength(1);
    const d = ctx._draws[0];
    if (d === undefined) throw new Error("expected one draw");
    expect(d.img).toBe(fakeImg);
    // absX = box.x (0 root offset + 12), absY = box.y (30); size from metadata.
    expect(d.x).toBeCloseTo(12, 6);
    expect(d.y).toBeCloseTo(30, 6);
    expect(d.w).toBe(64);
    expect(d.h).toBe(48);
  });
});
