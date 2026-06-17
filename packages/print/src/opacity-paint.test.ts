/**
 * POSITIONING slice 6 — `opacity` (offscreen group compositing).
 *
 * A box with `cs.opacity < 1` paints its ENTIRE atomic subtree (both paint
 * sub-phases + all descendants) into a temporary offscreen surface, then
 * composites that surface onto the parent canvas with `globalAlpha = opacity`.
 * This honors CSS-spec opacity GROUPING: a half-opaque box with overlapping
 * children reads as ONE half-opaque region (the group composites once), NOT
 * additive per-child alpha.
 *
 * `opacity === 1` (or undefined) takes the existing DIRECT paint path — ZERO
 * offscreen allocation, `globalAlpha` untouched (the 99.99% common case).
 *
 * JSDOM has no real `OffscreenCanvas`, so the painter obtains its offscreen
 * surface through an injectable factory seam (`setOffscreenSurfaceFactory`).
 * These tests install a fake factory that records the offscreen ctx's draw
 * calls and lets `drawImage(offscreenCanvas, x, y)` be asserted on the parent.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { paintCanvas } from "./canvas-renderer";
import { setOffscreenSurfaceFactory, resetOffscreenSurfaceFactory } from "./offscreen-surface";
import type { OffscreenSurface } from "./offscreen-surface";
import type { ComputedStyle } from "@taleweaver/core";
import type { LayoutBox } from "./index";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

// ── Parent-ctx spy: records globalAlpha at each drawImage + the composite count ──
interface DrawImageCall {
  /** A stable id of the offscreen surface that was composited. */
  surfaceId: number;
  x: number;
  y: number;
  /** The parent's globalAlpha at the moment of this drawImage. */
  alpha: number;
}

interface SpyCtx extends CanvasRenderingContext2D {
  _drawImages: DrawImageCall[];
  _glyphs: { text: string; x: number; y: number }[];
}

function createSpyCtx(width = 600, height = 800): SpyCtx {
  const drawImages: DrawImageCall[] = [];
  const glyphs: { text: string; x: number; y: number }[] = [];
  let alpha = 1;
  const ctx: Partial<CanvasRenderingContext2D> & {
    _drawImages: DrawImageCall[];
    _glyphs: { text: string; x: number; y: number }[];
  } = {
    _drawImages: drawImages,
    _glyphs: glyphs,
    canvas: { width, height } as HTMLCanvasElement,
    font: "",
    textBaseline: "alphabetic",
    fillStyle: "",
    get globalAlpha() {
      return alpha;
    },
    set globalAlpha(v: number) {
      alpha = v;
    },
    clearRect() {
      /* no-op */
    },
    fillRect() {
      /* no-op */
    },
    fillText(text: string, x: number, y: number) {
      glyphs.push({ text, x, y });
    },
    measureText: (text: string) => ({ width: text.length * 8 } as TextMetrics),
    drawImage(image: CanvasImageSource, x: number, y: number) {
      // The fake offscreen canvas carries a numeric `_id` marker.
      const surfaceId = (image as unknown as { _id: number })._id;
      drawImages.push({ surfaceId, x, y, alpha });
    },
  };
  return ctx as unknown as SpyCtx;
}

// ── Fake offscreen factory: each surface records its own glyph draws ──────────
interface FakeOffscreenSurface extends OffscreenSurface {
  _glyphs: { text: string; x: number; y: number }[];
}

let surfaceSeq = 0;
let createdSurfaces: FakeOffscreenSurface[] = [];

function installFakeOffscreen(): void {
  surfaceSeq = 0;
  createdSurfaces = [];
  setOffscreenSurfaceFactory((width: number, height: number): OffscreenSurface => {
    const id = ++surfaceSeq;
    const surfaceGlyphs: { text: string; x: number; y: number }[] = [];
    const canvas = { _id: id, width, height } as unknown as CanvasImageSource;
    const ctx: Partial<CanvasRenderingContext2D> = {
      font: "",
      textBaseline: "alphabetic",
      fillStyle: "",
      globalAlpha: 1,
      clearRect() {
        /* no-op */
      },
      fillRect() {
        /* no-op */
      },
      fillText(text: string, x: number, y: number) {
        surfaceGlyphs.push({ text, x, y });
      },
      measureText: (text: string) => ({ width: text.length * 8 } as TextMetrics),
      drawImage() {
        /* nested opacity composites here in real life; not asserted */
      },
    };
    const surface: FakeOffscreenSurface = {
      canvas,
      ctx: ctx as unknown as CanvasRenderingContext2D,
      _glyphs: surfaceGlyphs,
    };
    createdSurfaces.push(surface);
    return surface;
  });
}

// ── LayoutBox helpers ─────────────────────────────────────────────────────────
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
  lineHeight: 16,
  writingMode: "horizontal-tb",
};

function csWith(overrides: Partial<ComputedStyle>): ComputedStyle {
  return { ...INITIAL_COMPUTED_STYLE, ...overrides };
}

function makeTextRun(text: string, x: number, y: number): LayoutBox {
  return {
    type: "text-run",
    key: `run-${text}-${x}-${y}`,
    inlineOffset: 0,
    blockOffset: 0,
    inlineSize: 16,
    blockSize: 16,
    x,
    y,
    width: 16,
    height: 16,
    writingMode: "horizontal-tb",
    direction: "ltr",
    text,
    computedStyle: csWith({ backgroundColor: "transparent", color: "black", fontSize: 16 }),
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

function makeBlock(opts: {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children?: LayoutBox[];
  absoluteChildren?: LayoutBox[];
  cs?: Partial<ComputedStyle>;
}): LayoutBox {
  const cs = csWith({ backgroundColor: "transparent", ...opts.cs });
  return {
    type: "block",
    key: opts.key,
    inlineOffset: opts.x,
    blockOffset: opts.y,
    inlineSize: opts.width,
    blockSize: opts.height,
    x: opts.x,
    y: opts.y,
    width: opts.width,
    height: opts.height,
    writingMode: "horizontal-tb",
    direction: "ltr",
    children: opts.children ?? [],
    ...(opts.absoluteChildren !== undefined ? { absoluteChildren: opts.absoluteChildren } : {}),
    computedStyle: cs,
    usedStyle: { ...BASE_US },
    // Mirror the factory's deterministic stacking-context role.
    ...((cs.position !== "static" && cs.zIndex !== "auto") || cs.opacity < 1 || cs.transform.length > 0
      ? { stackingContextRole: "self" as const }
      : {}),
  } as unknown as LayoutBox;
}

function paint(ctx: SpyCtx, root: LayoutBox): void {
  paintCanvas(ctx, root, [], [], [], [], { x: 0, y: 0, height: 0 }, "hidden", 600, 800, 0, 800);
}

describe("opacity offscreen compositing", () => {
  beforeEach(() => {
    installFakeOffscreen();
  });
  afterEach(() => {
    resetOffscreenSurfaceFactory();
  });

  it("opacity 0.5 box → globalAlpha set to 0.5 + ONE drawImage compositing the group", () => {
    const ctx = createSpyCtx();
    const half = makeBlock({
      key: "half",
      x: 10,
      y: 20,
      width: 100,
      height: 16,
      cs: { opacity: 0.5 },
      children: [makeTextRun("H", 0, 0)],
    });
    const root = makeBlock({ key: "root", x: 0, y: 0, width: 200, height: 100, children: [half] });

    paint(ctx, root);

    // Exactly one offscreen surface was created (for the opacity<1 box).
    expect(createdSurfaces.length).toBe(1);
    // Exactly one composite onto the parent, at globalAlpha 0.5.
    expect(ctx._drawImages.length).toBe(1);
    expect(nth(ctx._drawImages, 0, "drawImage").alpha).toBeCloseTo(0.5, 6);
    // Composited at the box's painted origin (root@0 + box@(10,20)).
    expect(nth(ctx._drawImages, 0, "drawImage").x).toBeCloseTo(10, 6);
    expect(nth(ctx._drawImages, 0, "drawImage").y).toBeCloseTo(20, 6);
    // The group's glyph drew into the OFFSCREEN, not directly onto the parent.
    expect(nth(createdSurfaces, 0, "surface")._glyphs.some((g) => g.text === "H")).toBe(true);
    expect(ctx._glyphs.some((g) => g.text === "H")).toBe(false);
    // After compositing, the parent's globalAlpha is restored to 1 (no leak).
    expect(ctx.globalAlpha).toBeCloseTo(1, 6);
  });

  it("a half-opaque box with two OVERLAPPING children composites the GROUP ONCE (not per-child)", () => {
    const ctx = createSpyCtx();
    // Two children at the SAME spot (overlapping). Opacity grouping: the group
    // composites a single time at 0.5, NOT each child at 0.5 (which would read
    // additively / double-alpha in the overlap region).
    const c1 = makeTextRun("A", 0, 0);
    const c2 = makeTextRun("B", 0, 0); // same x,y → overlaps A
    const group = makeBlock({
      key: "group",
      x: 0,
      y: 0,
      width: 40,
      height: 16,
      cs: { opacity: 0.5 },
      children: [c1, c2],
    });
    const root = makeBlock({ key: "root", x: 0, y: 0, width: 200, height: 100, children: [group] });

    paint(ctx, root);

    // ONE surface, ONE composite — the whole group, not two child composites.
    expect(createdSurfaces.length).toBe(1);
    expect(ctx._drawImages.length).toBe(1);
    expect(nth(ctx._drawImages, 0, "drawImage").alpha).toBeCloseTo(0.5, 6);
    // Both children drew into the SAME offscreen surface (the group).
    expect(nth(createdSurfaces, 0, "surface")._glyphs.some((g) => g.text === "A")).toBe(true);
    expect(nth(createdSurfaces, 0, "surface")._glyphs.some((g) => g.text === "B")).toBe(true);
  });

  it("opacity 1 (and default/undefined) → DIRECT path, NO offscreen, globalAlpha untouched", () => {
    const ctx = createSpyCtx();
    const opaque = makeBlock({
      key: "opaque",
      x: 5,
      y: 5,
      width: 100,
      height: 16,
      cs: { opacity: 1 },
      children: [makeTextRun("O", 0, 0)],
    });
    const root = makeBlock({ key: "root", x: 0, y: 0, width: 200, height: 100, children: [opaque] });

    paint(ctx, root);

    expect(createdSurfaces.length).toBe(0);
    expect(ctx._drawImages.length).toBe(0);
    expect(ctx.globalAlpha).toBeCloseTo(1, 6);
    // The glyph drew DIRECTLY onto the parent ctx.
    expect(ctx._glyphs.some((g) => g.text === "O")).toBe(true);
  });

  it("opacity<1 + a z-indexed stacking context inside still composites the WHOLE group", () => {
    const ctx = createSpyCtx();
    // The opacity box contains a positive-z positioned child and a plain child;
    // the offscreen captures the WHOLE §E.2-ordered subtree as one group.
    const zChild = makeBlock({
      key: "z",
      x: 0,
      y: 0,
      width: 20,
      height: 16,
      cs: { position: "relative", zIndex: 5 },
      children: [makeTextRun("Z", 0, 0)],
    });
    const plain = makeBlock({
      key: "plain",
      x: 0,
      y: 0,
      width: 20,
      height: 16,
      children: [makeTextRun("P", 0, 0)],
    });
    const group = makeBlock({
      key: "group",
      x: 0,
      y: 0,
      width: 40,
      height: 16,
      cs: { opacity: 0.25 },
      children: [zChild, plain],
    });
    const root = makeBlock({ key: "root", x: 0, y: 0, width: 200, height: 100, children: [group] });

    paint(ctx, root);

    expect(createdSurfaces.length).toBe(1);
    expect(ctx._drawImages.length).toBe(1);
    expect(nth(ctx._drawImages, 0, "drawImage").alpha).toBeCloseTo(0.25, 6);
    // BOTH the z-ordered and the plain child landed in the one group surface.
    expect(nth(createdSurfaces, 0, "surface")._glyphs.some((g) => g.text === "Z")).toBe(true);
    expect(nth(createdSurfaces, 0, "surface")._glyphs.some((g) => g.text === "P")).toBe(true);
    // None leaked directly onto the parent.
    expect(ctx._glyphs.length).toBe(0);
  });

  it("opacity<1 + position:relative offset composites at the SHIFTED origin (no double-count)", () => {
    const ctx = createSpyCtx();
    // A relative box (relativeOffset 30,0) that is ALSO opacity<1. Its content must
    // map to surface-local (0,0) and composite ONCE at the shifted painted origin
    // (box.x 10 + rel.dx 30 = 40). The bug: the inner render added rel.dx to the
    // surface-local position AND the drawImage was at the shifted absX → the offset
    // counted twice (glyph at surface-local 30, composite at 40 → final 70).
    const half = makeBlock({
      key: "half",
      x: 10,
      y: 20,
      width: 100,
      height: 16,
      cs: { opacity: 0.5 },
      children: [makeTextRun("G", 0, 0)],
    });
    const halfRel = { ...half, relativeOffset: { dx: 30, dy: 0 } } as unknown as LayoutBox;
    const root = makeBlock({ key: "root", x: 0, y: 0, width: 200, height: 100, children: [halfRel] });

    paint(ctx, root);

    expect(createdSurfaces.length).toBe(1);
    expect(ctx._drawImages.length).toBe(1);
    // Composite at the SHIFTED painted origin: root@0 + box.x(10) + rel.dx(30) = 40.
    expect(nth(ctx._drawImages, 0, "drawImage").x).toBeCloseTo(40, 6);
    expect(nth(ctx._drawImages, 0, "drawImage").y).toBeCloseTo(20, 6);
    // The glyph maps to surface-local (0,0) — NOT 30 (which would double-apply the
    // offset once the composite already lands at the shifted origin).
    const g = nth(createdSurfaces, 0, "surface")._glyphs.find((gl) => gl.text === "G");
    expect(g).toBeDefined();
    expect(g?.x).toBeCloseTo(0, 6);
  });

  it("an opacity<1 box as the document root composites once (direct paintCanvas call)", () => {
    const ctx = createSpyCtx();
    const root = makeBlock({
      key: "root",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      cs: { opacity: 0.5 },
      children: [makeTextRun("R", 0, 0)],
    });

    paint(ctx, root);

    expect(createdSurfaces.length).toBe(1);
    expect(ctx._drawImages.length).toBe(1);
    expect(nth(ctx._drawImages, 0, "drawImage").alpha).toBeCloseTo(0.5, 6);
    expect(nth(createdSurfaces, 0, "surface")._glyphs.some((g) => g.text === "R")).toBe(true);
  });
});
