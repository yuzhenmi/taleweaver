/**
 * Integration: a floated IMAGE block narrows the FOLLOWING paragraph block.
 *
 * This locks the load-bearing layout claim behind the Google-Docs image-wrap
 * feature: an `image` block whose `wrap` attr maps (via `imageWrapFloat`) to a
 * logical `float` lays out as a CSS-9.5 float, and a SIBLING paragraph block's
 * IFC narrows its first lines around the float — with ZERO new layout
 * production code.
 *
 * Why sibling topology works (the load-bearing claim): the float and the
 * following paragraph are siblings under the document root, which is a BFC float
 * environment that spans BOTH siblings. The float's exclusion region reaches the
 * sibling paragraph's IFC because a `display:block` paragraph is NOT a new BFC
 * root and therefore INHERITS the root's `floatEnv` (see
 * layout-context.makeChildContext: non-BFC-root children inherit
 * `parent.floatEnv`; only a fresh BFC root gets a fresh, isolated env). So the
 * paragraph's `effectiveLineDims` (ifc.ts) queries the same float environment
 * the image float placed itself into, and narrows the lines that overlap it.
 *
 * The image component bakes `float` onto its element-box style from `attrs.wrap`
 * (components/image.ts) — here we drive the SAME element-box shape the component
 * produces (`display:block` + explicit `inlineSize`/`blockSize` + `float`)
 * through the SAME `layoutBlock` entry point floats-real.test.ts uses, so the
 * topology under test is exactly what a `wrap:"left"` image block produces at
 * layout time. The narrowing geometry is produced by Tasks 1+2 (the float bake)
 * + the pre-existing CSS-9.5 float subsystem; this test characterizes and locks
 * it as a regression boundary.
 *
 * Geometry (mock shaper charWidth=10, lineHeight=16; CONTENT_WIDTH=500, W=100,
 * H=32 = two line-heights):
 *   - float image: physical x=0, inlineOffset=0 (inline-start edge under LTR).
 *   - first two paragraph lines (y=0, y=16 — overlapping the float region 0..32):
 *     inlineOffset = x = W = 100; inlineSize = 500 - 100 = 400.
 *   - lines at/below the float bottom (y >= H = 32): inlineOffset = x = 0;
 *     inlineSize = 500 (full content width).
 */
import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "@taleweaver/core";
import type { RenderNode } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { layoutBlock } from "../layout/bfc";
import { createMockShaper } from "@taleweaver/core";
import { makeRootContext } from "../layout/layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import type { LayoutBox, LineBox } from "../layout/layout-box";

// charWidth = 10, lineHeight = 16 (matches floats-real.test.ts harness).
const shaper = createMockShaper(10, 16);

const CONTENT_WIDTH = 500;
const W = 100; // image inline-size (float width) — a clean 1/5 of CONTENT_WIDTH.
const H = 32; // image block-size (float height) = two line-heights (16 * 2).

// ~18 words × 5 chars (+ space) → wraps to several lines at both the narrowed
// 400px width and the full 500px width, so we get lines both overlapping and
// below the float region.
const LONG_TEXT =
  "alpha bravo charl delta echox foxtr golfx hotel india juliz kiloz limaa mikee novem oscar papaa quebe romeo";

function findBoxByKey(box: LayoutBox, key: string): LayoutBox | null {
  if (box.key === key) return box;
  if ("children" in box) {
    for (const c of box.children) {
      const r = findBoxByKey(c, key);
      if (r) return r;
    }
  }
  return null;
}

/** Collect every LineBox in the subtree in document order. */
function collectLines(box: LayoutBox, out: LineBox[]): void {
  if (box.type === "line") {
    out.push(box);
    return;
  }
  if ("children" in box) {
    for (const c of box.children) collectLines(c, out);
  }
}

/** Lay out `[children...]` under a `display:block` root at CONTENT_WIDTH. */
function layoutRoot(key: string, children: readonly RenderNode[]): LayoutBox {
  const root = createElementBox(key, { display: "block" }, children);
  const cascaded = cascadePass(root);
  if (cascaded.type !== "element") throw new Error("cascade failed");
  const ctx = makeRootContext(
    cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE,
    CONTENT_WIDTH,
  );
  const result = layoutBlock(cascaded, 0, 0, ctx, shaper, undefined);
  if (result.box === null) throw new Error("layoutBlock returned null box");
  return result.box;
}

describe("Floated image narrows the following paragraph (image-wrap topology)", () => {
  it("wrap:left image float pushes the overlapping paragraph lines right by W, returns to full width below", () => {
    const img = createElementBox(
      "img",
      { display: "block", inlineSize: W, blockSize: H, float: "inline-start" },
      [],
      { image: { src: "x.png", width: W, height: H } },
    );
    const para = createElementBox(
      "para",
      { display: "block" },
      [createTextBox("para-text", {}, LONG_TEXT)],
    );
    const out = layoutRoot("root", [img, para]);

    // --- The image lays out as a float at the inline-start edge ---
    const imgBox = findBoxByKey(out, "img");
    expect(imgBox).not.toBeNull();
    if (imgBox === null) throw new Error("img box missing");
    // Inline-start edge under LTR: logical inlineOffset 0 and physical x 0.
    expect(imgBox.inlineOffset).toBe(0);
    expect(imgBox.x).toBe(0);
    expect(imgBox.inlineSize).toBe(W);
    // The float BOX now honors its explicit block-size H=32: the bfc float branch
    // re-creates the placed float box with the explicit block-size (mirroring the
    // in-flow path), so the floated image's OWN box reports full height — paint,
    // hit-test, and selection-rects (all box-geometry readers) see the image at
    // H, not a degenerate 0. (The exclusion region was always H tall — proven by
    // the line narrowing below; the box geometry now matches it.)
    expect(imgBox.blockSize).toBe(H);

    // --- Paragraph lines: overlapping vs below the float ---
    const lines: LineBox[] = [];
    collectLines(out, lines);
    // Enough text to produce lines both inside (y < H) and below (y >= H).
    expect(lines.length).toBeGreaterThanOrEqual(3);

    const overlapping = lines.filter((l) => l.y < H);
    const below = lines.filter((l) => l.y >= H);
    expect(overlapping.length).toBeGreaterThanOrEqual(2);
    expect(below.length).toBeGreaterThanOrEqual(1);

    // First two lines (y=0, y=16) overlap the float region [0, H): pushed right
    // by exactly W, narrowed by exactly W.
    for (const l of overlapping) {
      expect(l.inlineOffset).toBe(W); // left inset == float width
      expect(l.x).toBe(W);
      expect(l.inlineSize).toBe(CONTENT_WIDTH - W); // 400
    }
    // The two specific overlapping line offsets are y=0 and y=16 (one line-height
    // apart), confirming the float region is H=32 tall (two line-heights).
    expect(overlapping.map((l) => l.y).sort((a, b) => a - b)).toEqual([0, 16]);

    // Lines at/below the float bottom (y >= H) return to FULL content width at
    // the inline-start edge.
    for (const l of below) {
      expect(l.inlineOffset).toBe(0);
      expect(l.x).toBe(0);
      expect(l.inlineSize).toBe(CONTENT_WIDTH); // 500
    }
    // The first below-float line sits exactly at the float's bottom edge (y=H).
    expect(below[0]?.y).toBe(H);
  });

  it("control: the SAME paragraph with NO preceding float lays out full-width on every line", () => {
    const para = createElementBox(
      "para",
      { display: "block" },
      [createTextBox("para-text", {}, LONG_TEXT)],
    );
    const out = layoutRoot("root-control", [para]);

    const lines: LineBox[] = [];
    collectLines(out, lines);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    // EVERY line is full-width at the inline-start edge — no float, no inset.
    for (const l of lines) {
      expect(l.inlineOffset).toBe(0);
      expect(l.x).toBe(0);
      expect(l.inlineSize).toBe(CONTENT_WIDTH); // 500
    }
    // The first line specifically: full width, distinguishing it from the
    // narrowed (400px, inset 100) first line in the float case above.
    expect(lines[0]?.y).toBe(0);
    expect(lines[0]?.inlineSize).toBe(CONTENT_WIDTH);
  });

  it("page-fit characterization: a float TALLER than remaining page space OVERFLOWS the page (no float fragmentation in BFC C.1)", () => {
    // INHERITED FLOAT-SUBSYSTEM PAGE-BREAK BOUNDARY (v1): the BFC does NOT
    // fragment floats — see bfc.ts "Fragmentation is NOT applied to floats in
    // C.1 (deferred to a later task)". A floated image whose height exceeds the
    // fragment's remaining block-space is placed at its anchoring offset and
    // OVERFLOWS the page box; it is NOT clipped, NOT split, and NOT reflowed to
    // the next page. This test makes that v1 limitation explicit and tested,
    // not silent — when float fragmentation lands, this assertion is the
    // tripwire to revisit.
    const FLOAT_H = 40;
    const AVAILABLE = 20; // remaining page space < FLOAT_H → would-be overflow.
    const tallImg = createElementBox(
      "tall",
      { display: "block", inlineSize: W, blockSize: FLOAT_H, float: "inline-start" },
      [],
      { image: { src: "x.png", width: W, height: FLOAT_H } },
    );
    const root = createElementBox("root-pagefit", { display: "block" }, [tallImg]);
    const cascaded = cascadePass(root);
    if (cascaded.type !== "element") throw new Error("cascade failed");
    const ctx = makeRootContext(
      cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE,
      CONTENT_WIDTH,
    );
    const result = layoutBlock(cascaded, 0, 0, ctx, shaper, undefined, {
      availableBlockSize: AVAILABLE,
      pageIndex: 0,
      resumeFrom: null,
    });

    // OVERFLOW, not split-or-move: a non-null box, no break token (the float is
    // not deferred to a later fragment), and the box's block-extent reaches the
    // float's full bottom edge (FLOAT_H), which EXCEEDS the fragment's available
    // block-size — i.e. it spills past the page boundary.
    expect(result.box).not.toBeNull();
    if (result.box === null) throw new Error("page-fit box missing");
    expect(result.breakToken).toBeNull();
    // The root box's block-extent is the float's lowest edge (FLOAT_H = 40),
    // proving the float was placed (not dropped) and overflows AVAILABLE = 20.
    expect(result.box.blockSize).toBe(FLOAT_H);
    expect(result.box.blockSize).toBeGreaterThan(AVAILABLE);

    const tallBox = findBoxByKey(result.box, "tall");
    expect(tallBox).not.toBeNull();
    if (tallBox === null) throw new Error("tall float box missing");
    // The float is anchored at the top of the fragment (blockOffset 0), so its
    // exclusion edge (FLOAT_H) lands FLOAT_H below — overflowing the page.
    expect(tallBox.blockOffset).toBe(0);
    expect(tallBox.y).toBe(0);
  });
});
