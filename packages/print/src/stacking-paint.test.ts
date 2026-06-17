/**
 * POSITIONING slice 4 — z-index + stacking contexts (CSS 2.2 §E.2 paint order).
 *
 * Within a stacking context the painting order is the corrected §E.2 list:
 *   1. negative-z stacking-context children (z<0, ascending);
 *   2. the box's own background + borders;
 *   3. in-flow non-positioned BLOCK descendants;
 *   4. floats;
 *   5. in-flow non-positioned INLINE content;
 *   6. positioned descendants with z-index auto|0 (relative AND absolute), tree order;
 *   7. positive-z stacking-context children (z>0, ascending).
 * A child that is itself a stacking context paints ATOMICALLY at its z-slot; a
 * positioned non-stacking child shares the current context. The 99% case (no
 * z-index, no stacking context) must paint BYTE-IDENTICALLY to the old
 * document-order two-phase walk.
 *
 * These tests spy the ctx, recording an ORDERED op log (fillRect + fillText with
 * the operation index) so we can assert relative paint order.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { paintCanvas } from "./canvas-renderer";
import type { ComputedStyle } from "@taleweaver/core";
import type { LayoutBox } from "./index";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";

// ── Ordered-op spy ───────────────────────────────────────────────────────────
interface Op { kind: "fillRect" | "fillText"; text?: string; x: number; y: number; }
interface SpyCtx extends CanvasRenderingContext2D { _ops: Op[]; }

function createSpyCtx(width = 600, height = 800): SpyCtx {
  const ops: Op[] = [];
  const ctx: Partial<CanvasRenderingContext2D> & { _ops: Op[] } = {
    _ops: ops,
    canvas: { width, height } as HTMLCanvasElement,
    font: "",
    textBaseline: "alphabetic",
    fillStyle: "",
    clearRect() { /* no-op */ },
    fillRect(x: number, y: number) { ops.push({ kind: "fillRect", x, y }); },
    fillText(text: string, x: number, y: number) { ops.push({ kind: "fillText", text, x, y }); },
    measureText: (text: string) => ({ width: text.length * 8 } as TextMetrics),
  };
  return ctx as unknown as SpyCtx;
}

const BASE_US = {
  paddingBlockStart: 0, paddingBlockEnd: 0,
  paddingInlineStart: 0, paddingInlineEnd: 0,
  borderBlockStartWidth: 0, borderBlockEndWidth: 0,
  borderInlineStartWidth: 0, borderInlineEndWidth: 0,
  borderBlockStartStyle: "none", borderBlockEndStyle: "none",
  borderInlineStartStyle: "none", borderInlineEndStyle: "none",
  borderBlockStartColor: "black", borderBlockEndColor: "black",
  borderInlineStartColor: "black", borderInlineEndColor: "black",
  direction: "ltr", lineHeight: 16, writingMode: "horizontal-tb",
};

function csWith(overrides: Partial<ComputedStyle>): ComputedStyle {
  return { ...INITIAL_COMPUTED_STYLE, ...overrides };
}

function makeTextRun(text: string, x: number, y: number): LayoutBox {
  return {
    type: "text-run", key: `run-${text}-${x}-${y}`,
    inlineOffset: 0, blockOffset: 0, inlineSize: 16, blockSize: 16,
    x, y, width: 16, height: 16,
    writingMode: "horizontal-tb", direction: "ltr",
    text,
    computedStyle: csWith({ backgroundColor: "transparent", color: "black", fontSize: 16 }),
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

/** A block at (x,y) sized (w,h) with a coloured background (so it emits a fillRect). */
function makeBlock(opts: {
  key: string; x: number; y: number; width: number; height: number;
  children?: LayoutBox[];
  absoluteChildren?: LayoutBox[];
  cs?: Partial<ComputedStyle>;
  bg?: boolean;
}): LayoutBox {
  const cs = csWith({
    backgroundColor: opts.bg === false ? "transparent" : "#eee",
    ...opts.cs,
  });
  return {
    type: "block", key: opts.key,
    inlineOffset: opts.x, blockOffset: opts.y,
    inlineSize: opts.width, blockSize: opts.height,
    x: opts.x, y: opts.y, width: opts.width, height: opts.height,
    writingMode: "horizontal-tb", direction: "ltr",
    children: opts.children ?? [],
    ...(opts.absoluteChildren !== undefined ? { absoluteChildren: opts.absoluteChildren } : {}),
    computedStyle: cs,
    usedStyle: { ...BASE_US },
    // Mirror the factory's deterministic stacking-context role (the spy boxes
    // bypass the factory, so set it explicitly per the same predicate).
    ...((cs.position !== "static" && cs.zIndex !== "auto") || cs.opacity < 1 || cs.transform.length > 0
      ? { stackingContextRole: "self" as const }
      : {}),
  } as unknown as LayoutBox;
}

function paint(ctx: SpyCtx, root: LayoutBox): void {
  paintCanvas(ctx, root, [], [], [], [], { x: 0, y: 0, height: 0 }, "hidden", 600, 800, 0, 800);
}

/** Index of the first op matching a glyph text (foreground), or -1. */
function glyphIndex(ctx: SpyCtx, text: string): number {
  return ctx._ops.findIndex((o) => o.kind === "fillText" && o.text === text);
}

describe("z-index stacking paint order (§E.2)", () => {
  let ctx: SpyCtx;
  beforeEach(() => { ctx = createSpyCtx(); });

  it("a positioned child with z-index:5 paints ABOVE a later document-order sibling", () => {
    // The high-z stacking-context child appears FIRST in document order but must
    // paint AFTER (above) the later, lower-priority positioned sibling.
    const high = makeBlock({
      key: "high", x: 0, y: 0, width: 40, height: 16,
      cs: { position: "relative", zIndex: 5 },
      children: [makeTextRun("H", 0, 0)],
    });
    const low = makeBlock({
      key: "low", x: 0, y: 0, width: 40, height: 16,
      cs: { position: "relative", zIndex: "auto" },
      children: [makeTextRun("L", 0, 0)],
    });
    const root = makeBlock({ key: "root", x: 0, y: 0, width: 200, height: 100, children: [high, low] });

    paint(ctx, root);

    // H (positive z, bucket 7) paints after L (auto z, bucket 6).
    expect(glyphIndex(ctx, "H")).toBeGreaterThan(glyphIndex(ctx, "L"));
  });

  it("a z-index:-1 positioned child paints BELOW the parent's background-following content", () => {
    // Negative-z (bucket 1) paints before the parent's own in-flow inline content
    // (bucket 5 — the "N" glyph belongs to a plain in-flow run on root).
    const neg = makeBlock({
      key: "neg", x: 0, y: 0, width: 40, height: 16,
      cs: { position: "relative", zIndex: -1 },
      children: [makeTextRun("B", 0, 0)],
    });
    const inflowRun = makeTextRun("N", 0, 0);
    const root = makeBlock({
      key: "root", x: 0, y: 0, width: 200, height: 100,
      children: [neg, inflowRun],
    });

    paint(ctx, root);

    // B (negative z) paints BEFORE N (in-flow inline content).
    expect(glyphIndex(ctx, "B")).toBeLessThan(glyphIndex(ctx, "N"));
  });

  it("two positioned auto-z children (relative + absolute) interleave in DOCUMENT order (bucket 6)", () => {
    const rel = makeBlock({
      key: "rel", x: 0, y: 0, width: 40, height: 16,
      cs: { position: "relative", zIndex: "auto" },
      children: [makeTextRun("R", 0, 0)],
    });
    const abs = makeBlock({
      key: "abs", x: 50, y: 0, width: 40, height: 16,
      cs: { position: "absolute", zIndex: "auto" },
      children: [makeTextRun("A", 0, 0)],
    });
    // rel is an in-flow child, abs is an absoluteChild — both are bucket 6 and must
    // paint in document order. We declare rel BEFORE abs (children before
    // absoluteChildren = document order in this engine), so R paints before A.
    const root = makeBlock({
      key: "root", x: 0, y: 0, width: 200, height: 100,
      children: [rel], absoluteChildren: [abs],
    });

    paint(ctx, root);

    expect(glyphIndex(ctx, "R")).toBeLessThan(glyphIndex(ctx, "A"));
  });

  it("a positioned (z-index) child paints above a non-positioned in-flow sibling", () => {
    const positioned = makeBlock({
      key: "pos", x: 0, y: 0, width: 40, height: 16,
      cs: { position: "relative", zIndex: 2 },
      children: [makeTextRun("P", 0, 0)],
    });
    const plain = makeBlock({
      key: "plain", x: 0, y: 20, width: 40, height: 16,
      bg: false,
      children: [makeTextRun("F", 0, 0)],
    });
    // Declare the positioned child FIRST so document order alone would paint P
    // before F; the stacking reorder must move P (bucket 7) AFTER F (bucket 3/5).
    const root = makeBlock({
      key: "root", x: 0, y: 0, width: 200, height: 100,
      children: [positioned, plain],
    });

    paint(ctx, root);

    expect(glyphIndex(ctx, "P")).toBeGreaterThan(glyphIndex(ctx, "F"));
  });

  it("nested stacking contexts don't leak z across the boundary", () => {
    // A child stacking context (sc) with z-index:1, containing a VERY high-z
    // descendant (deep, z:999), must NOT paint that descendant above the PARENT
    // context's later sibling (sib) which has z:2. The whole `sc` subtree paints
    // atomically at z:1, so `sib` (z:2) wins.
    const deep = makeBlock({
      key: "deep", x: 0, y: 0, width: 20, height: 16,
      cs: { position: "relative", zIndex: 999 },
      children: [makeTextRun("D", 0, 0)],
    });
    const sc = makeBlock({
      key: "sc", x: 0, y: 0, width: 40, height: 16,
      cs: { position: "relative", zIndex: 1 },
      children: [deep],
    });
    const sib = makeBlock({
      key: "sib", x: 0, y: 0, width: 40, height: 16,
      cs: { position: "relative", zIndex: 2 },
      children: [makeTextRun("S", 0, 0)],
    });
    const root = makeBlock({
      key: "root", x: 0, y: 0, width: 200, height: 100,
      children: [sc, sib],
    });

    paint(ctx, root);

    // S (parent context, z:2) paints ABOVE D (z:999 but trapped inside sc@z:1).
    expect(glyphIndex(ctx, "S")).toBeGreaterThan(glyphIndex(ctx, "D"));
  });
});

describe("common-path-unchanged guarantee (no z-index / no stacking)", () => {
  let ctx: SpyCtx;
  beforeEach(() => { ctx = createSpyCtx(); });

  it("a plain multi-block doc paints in the exact document order (byte-identical reorder-free path)", () => {
    // Three plain in-flow blocks, each with a glyph. With no stacking contexts and
    // no z-index, the painter must NOT reorder: glyphs land in document order.
    const b1 = makeBlock({ key: "b1", x: 0, y: 0, width: 100, height: 16, children: [makeTextRun("1", 0, 0)] });
    const b2 = makeBlock({ key: "b2", x: 0, y: 20, width: 100, height: 16, children: [makeTextRun("2", 0, 0)] });
    const b3 = makeBlock({ key: "b3", x: 0, y: 40, width: 100, height: 16, children: [makeTextRun("3", 0, 0)] });
    const root = makeBlock({ key: "root", x: 0, y: 0, width: 200, height: 100, bg: false, children: [b1, b2, b3] });

    paint(ctx, root);

    expect(glyphIndex(ctx, "1")).toBeLessThan(glyphIndex(ctx, "2"));
    expect(glyphIndex(ctx, "2")).toBeLessThan(glyphIndex(ctx, "3"));
  });
});
