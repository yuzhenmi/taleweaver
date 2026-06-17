// packages/print/src/cursor/cursor-textalign.test.ts
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
import { resolveHitPosition as resolvePositionFromPixel } from "../test-utils/hit-position";
import { getLineIndex } from "./line-flatten";
import { render } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { layoutTree } from "../layout/dispatch";
import { positionTreeForTest } from "../test-utils/position-tree";
import { createMockShaper } from "@taleweaver/core";
import type { TextShaper } from "@taleweaver/core";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "@taleweaver/core";
import { createPosition, createSpan } from "@taleweaver/core";
import type { BlockId, State } from "@taleweaver/core";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}
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
  const layout = positionTreeForTest(layoutTree(root, CONTAINER_W, shaper));
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

/**
 * Read the absolute x of the centered content's anchor — the first child of the
 * single line for block "p". Under the #333 full-width line model the LINE
 * spans `[0, available]` and the alignment offset rides on the children's
 * `inlineOffset`, so the centered content's absolute x is the first child's
 * absoluteX (line.absoluteX + child.x). This is what every caret/selection
 * geometry assertion below pins against (was the line.absoluteX under the
 * pre-#333 model — same numeric value, different intermediate).
 */
function alignedLineStart(layout: LayoutBox): number {
  const lines = getLineIndex(layout).byBlock.get("p" as BlockId) ?? [];
  expect(lines.length).toBe(1);
  const line0 = nth(lines, 0, "line");
  const first = line0.line.children[0];
  if (first === undefined) return line0.absoluteX;
  return line0.absoluteX + first.x;
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
    const r = nth(rects, 0, "rect");
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
    const r = nth(rects, 0, "rect");
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
    const line = nth(lines, 0, "line");
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
    const line = nth(lines, 0, "line");
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
    expect(nth(rects, 0, "rect").x).toBe(0);
    expect(nth(rects, 0, "rect").width).toBe(CONTENT_W);
  });
});

// ---------------------------------------------------------------------------
// Bug (user-reported, in-browser, print): partially selecting a line with
// `text-align: justify` shows GAPS in the highlight between words. Justification
// widens each interior inter-word SPACE — the stretch is baked into the space
// leaf's `box.width`. But `caretInlineCoordInLeaf` mapped a leaf-trailing offset
// to `base + measureWidth(glyphs)` (the NATURAL glyph width), not the box's
// actual (widened) extent. So a selection segment ended at the space's natural
// right edge while the next word's leaf began at its justified (further) x —
// leaving a visible gap of exactly the distributed expansion at every space.
//
// FIX: at a leaf's trailing edge (full text) the caret/selection coord uses the
// box's own inline extent (`size`), which carries the justification stretch.
// Byte-identical for un-stretched leaves (box width == measured glyph width).
// ---------------------------------------------------------------------------
describe("textAlign justify: partial selection has no inter-word gaps (#justify-selection-gap)", () => {
  // A narrow container so a multi-word paragraph wraps and the FIRST line is
  // justified (justify applies to every line except the last). Equal-length
  // words keep the wrap deterministic under the mock shaper (every char = 8px,
  // spaces included).
  const JUSTIFY_W = 70;

  function pipelineW(state: State, width: number): { layout: LayoutBox; shaper: TextShaper } {
    const root = render(
      state,
      createDefaultComponentRegistry(),
      createDefaultAttrRegistry(),
    ).root;
    const shaper = createMockShaper(CHAR_W, LINE_H);
    const layout = positionTreeForTest(layoutTree(root, width, shaper));
    return { layout, shaper };
  }

  it("selecting a justified line's content yields ONE contiguous rect (no gaps at stretched spaces)", () => {
    // "aa bb cc dd": line 1 = "aa bb cc" (content 64px) on a 70px line → gap 6px
    // distributed across the 2 interior spaces (+3px each); "dd" wraps to line 2,
    // so line 1 IS justified. Without the fix the two stretched spaces leave 3px
    // gaps → the selection fragments into 3 rects with holes.
    const state = alignedParagraph("aa bb cc dd", "justify");
    const { layout, shaper } = pipelineW(state, JUSTIFY_W);

    const lines = getLineIndex(layout).byBlock.get("p" as BlockId) ?? [];
    expect(lines.length).toBeGreaterThanOrEqual(2); // wrapped → line 1 justified
    const line1 = nth(lines, 0, "line1");

    // Select the whole first line's logical content (start → its inline end). A
    // same-line span routes through `selectionRectsForLineRange`, the path that
    // segments per leaf — exactly where the stretched-space gap appeared.
    const span = createSpan(
      createPosition("p" as BlockId, line1.line.inlineOffsetStart),
      createPosition("p" as BlockId, line1.line.inlineOffsetEnd),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);

    // No gaps: the per-leaf intervals must coalesce into ONE contiguous rect that
    // reaches the justified line's right edge (the available width). RED before
    // the fix (3 rects with 3px holes between words).
    expect(rects.length).toBe(1);
    const r = nth(rects, 0, "rect");
    expect(r.x).toBe(0); // justify does not shift the line's inline-start
    expect(r.width).toBe(JUSTIFY_W); // fills to the line's available width
  });
});
