// packages/core/src/cursor/cursor-textalign.test.ts
//
// Bug (user-reported, in-browser): on a center/right/justified paragraph the
// glyphs render at the aligned position (correct) but the caret, the selection
// highlight, and mouse hit-testing use an OVER-SHIFTED x.
//
// Root cause: a latent double-count in `collectLineLeaves`. The function is
// GIVEN the line's ABSOLUTE x (= blockAbsX + line.x) but its recursion's
// `line`/`inline` branch re-adds the line box's OWN `.x` (the alignment offset),
// so leaves landed at `lineAbsX + line.x + childRelX` instead of `lineAbsX +
// childRelX`. For start-aligned lines `line.x === 0` so it was masked; for a
// nonzero alignment offset the caret/selection/hit-test over-shifted by exactly
// that offset while glyphs (painted one frame at a time) stayed correct.
//
// These are the LOAD-BEARING regression tests: they exercise the real
// cursor/selection/hit-test APIs through the full render → layout pipeline on a
// CENTERED paragraph and assert the geometry round-trips against the centered
// line start. They were RED before the fix (over-shifted by the alignment
// offset) and GREEN after.

import { describe, it, expect } from "vitest";
import { resolvePixelPosition } from "./cursor-position";
import { computeSelectionRects } from "./selection-geometry";
import { resolvePositionFromPixel } from "./hit-test";
import { getLineIndex } from "./line-flatten";
import { render } from "../render/render";
import { createDefaultComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import { layoutTree } from "../layout/dispatch";
import { resolvePositionedTree } from "../layout/positioned-tree";
import { createMockShaper } from "../layout/mock-shaper";
import type { TextShaper } from "../layout/text-shaper";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "../test-utils/state-builders";
import { createPosition, createSpan } from "../state";
import type { BlockId, State } from "../state";
import type { LayoutBox } from "../layout/layout-node";

const CHAR_W = 8;
const LINE_H = 16;
const CONTAINER_W = 800;

function pipeline(state: State): { layout: LayoutBox; shaper: TextShaper } {
  const root = render(
    state,
    createDefaultComponentRegistry(),
    createDefaultAttrRegistry(),
  ).root;
  const shaper = createMockShaper(CHAR_W, LINE_H);
  const layout = resolvePositionedTree(layoutTree(root, CONTAINER_W, shaper));
  return { layout, shaper };
}

/**
 * Build a single-paragraph document with the given text and `textAlign` attr
 * (`center`, `end`, …). The attr is interpreted into computedStyle by the
 * cascade and drives the IFC alignment pass, so the produced LineBox gets a
 * nonzero physical `x`.
 */
function alignedParagraph(textContent: string, textAlign: string): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        firstChildId: "p",
        lastChildId: "p",
      }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        // pin white-space:normal so collapse-independent char metrics hold.
        attrs: { textAlign, whiteSpace: "normal" },
        inlineContent: inlineContent([text(textContent)]),
      }),
    ],
  });
}

/** Read the absolute x of the single centered/aligned LineBox for block "p". */
function alignedLineStart(layout: LayoutBox): number {
  const lines = getLineIndex(layout).byBlock.get("p" as BlockId) ?? [];
  expect(lines.length).toBe(1);
  return lines[0].absoluteX;
}

describe("textAlign caret/selection/hit-test geometry (no double-count of the line's alignment offset)", () => {
  const TEXT = "centerme"; // 8 chars × 8px = 64px content
  const CONTENT_W = TEXT.length * CHAR_W; // 64
  // A centered line's start: (available − content) / 2. The whole container
  // width is the available inline size (no margins in this fixture).
  const EXPECTED_LINE_START = (CONTAINER_W - CONTENT_W) / 2; // 368

  it("precondition: the centered line really has a nonzero physical x", () => {
    const { layout } = pipeline(alignedParagraph(TEXT, "center"));
    const lineStart = alignedLineStart(layout);
    expect(lineStart).toBe(EXPECTED_LINE_START); // 368 — the alignment offset
    expect(lineStart).toBeGreaterThan(0);
  });

  it("caret at offset 0 of a centered line lands at the centered line start (not +offset)", () => {
    const state = alignedParagraph(TEXT, "center");
    const { layout, shaper } = pipeline(state);
    const lineStart = alignedLineStart(layout);

    const pos = resolvePixelPosition(state, createPosition("p" as BlockId, 0), layout, shaper);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    // BUG: caret x was lineStart + lineStart (double-counted offset). FIX: ===
    // the centered line start exactly.
    expect(pos.x).toBe(lineStart);
  });

  it("caret at an interior offset of a centered line === lineStart + measureWidth(prefix)", () => {
    const state = alignedParagraph(TEXT, "center");
    const { layout, shaper } = pipeline(state);
    const lineStart = alignedLineStart(layout);

    // offset 3 → after "cen" → 3 × 8 = 24px past the line start.
    const pos = resolvePixelPosition(state, createPosition("p" as BlockId, 3), layout, shaper);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    expect(pos.x).toBe(lineStart + 3 * CHAR_W); // 368 + 24 = 392
  });

  it("caret at end offset of a centered line === lineStart + content width", () => {
    const state = alignedParagraph(TEXT, "center");
    const { layout, shaper } = pipeline(state);
    const lineStart = alignedLineStart(layout);

    const pos = resolvePixelPosition(state, createPosition("p" as BlockId, TEXT.length), layout, shaper);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    expect(pos.x).toBe(lineStart + CONTENT_W); // 368 + 64 = 432
  });

  it("selection covering the whole centered line: left edge === centered line start (not over-shifted)", () => {
    const state = alignedParagraph(TEXT, "center");
    const { layout, shaper } = pipeline(state);
    const lineStart = alignedLineStart(layout);

    const span = createSpan(
      createPosition("p" as BlockId, 0),
      createPosition("p" as BlockId, TEXT.length),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    expect(rects.length).toBe(1);
    const r = rects[0];
    // BUG: left edge was lineStart + lineStart. FIX: the centered line start.
    expect(r.x).toBe(lineStart); // 368
    expect(r.width).toBe(CONTENT_W); // 64 — full content
  });

  it("selection of an interior slice of a centered line: left edge === lineStart + prefix", () => {
    const state = alignedParagraph(TEXT, "center");
    const { layout, shaper } = pipeline(state);
    const lineStart = alignedLineStart(layout);

    // select "ter" — offsets 3..6.
    const span = createSpan(
      createPosition("p" as BlockId, 3),
      createPosition("p" as BlockId, 6),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    expect(rects.length).toBe(1);
    const r = rects[0];
    expect(r.x).toBe(lineStart + 3 * CHAR_W); // 368 + 24 = 392
    expect(r.width).toBe(3 * CHAR_W); // 24
  });

  it("hit-test at a centered glyph's x round-trips to the correct offset (caret x matches)", () => {
    const state = alignedParagraph(TEXT, "center");
    const { layout, shaper } = pipeline(state);
    const lineStart = alignedLineStart(layout);

    // Click inside the LEFT half of the 4th char ("t" of "centerme"), i.e.
    // before its midpoint, so findCharOffset rounds DOWN to offset 3. (At the
    // exact midpoint findCharOffset snaps to the next offset — see its
    // semantics — so we deliberately stay left of it.) y in the line band.
    const lines = getLineIndex(layout).byBlock.get("p" as BlockId) ?? [];
    const line = lines[0];
    const y = line.absoluteY + line.line.blockSize / 2;
    const clickX = lineStart + 3 * CHAR_W + 2; // left of the 4th char's midpoint

    const hit = resolvePositionFromPixel(state, layout, shaper, clickX, y, 0);
    expect(hit).not.toBeNull();
    if (hit === null) return;
    expect(hit.blockId).toBe("p");
    // BUG: with the over-shifted leaf x's, this click (correctly at a centered
    // glyph) resolved to a wrong/clamped offset. FIX: offset 3.
    expect(hit.offset).toBe(3);

    // Round-trip: the caret for the resolved offset is back near the click x.
    const caret = resolvePixelPosition(state, createPosition("p" as BlockId, hit.offset), layout, shaper);
    expect(caret).not.toBeNull();
    if (caret === null) return;
    expect(caret.x).toBe(lineStart + 3 * CHAR_W); // 392 — left edge of the 4th char
  });

  it("hit-test in the empty band LEFT of a centered line clamps to offset 0 at the line start", () => {
    const state = alignedParagraph(TEXT, "center");
    const { layout, shaper } = pipeline(state);
    const lineStart = alignedLineStart(layout);
    const lines = getLineIndex(layout).byBlock.get("p" as BlockId) ?? [];
    const line = lines[0];
    const y = line.absoluteY + line.line.blockSize / 2;

    // Click in the empty area to the LEFT of the centered text (x=10, well below
    // the line start of 368): should clamp to the first offset at the line start.
    const hit = resolvePositionFromPixel(state, layout, shaper, 10, y, 0);
    expect(hit).not.toBeNull();
    if (hit === null) return;
    expect(hit.blockId).toBe("p");
    expect(hit.offset).toBe(0);
    const caret = resolvePixelPosition(state, createPosition("p" as BlockId, 0), layout, shaper);
    expect(caret).not.toBeNull();
    if (caret === null) return;
    expect(caret.x).toBe(lineStart);
  });

  it("no-regression: start-aligned line is byte-identical (caret/selection from x=0)", () => {
    const state = alignedParagraph(TEXT, "start");
    const { layout, shaper } = pipeline(state);
    const lineStart = alignedLineStart(layout);
    expect(lineStart).toBe(0); // start-aligned → no offset

    const caret = resolvePixelPosition(state, createPosition("p" as BlockId, 3), layout, shaper);
    expect(caret).not.toBeNull();
    if (caret === null) return;
    expect(caret.x).toBe(3 * CHAR_W); // 24 — unchanged

    const span = createSpan(
      createPosition("p" as BlockId, 0),
      createPosition("p" as BlockId, TEXT.length),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    expect(rects[0].x).toBe(0);
    expect(rects[0].width).toBe(CONTENT_W);
  });
});
