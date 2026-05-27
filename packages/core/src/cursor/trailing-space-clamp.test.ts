// #338 P2 — trailing-space HANG + CLAMP, caret/hit-test/selection on-page.
//
// P1 made a SPACE wrap unit HANG on the current line instead of wrapping (only
// WORD units wrap). P2 CLAMPS the hung-space geometry to the line's content
// edge so glyphs, caret, hit-test, and selection ALL stay on-page for ANY
// number of trailing spaces — the on-page guarantee the reverted Phase-2 hang
// lacked (its caret rendered off-page).
//
// Two clamps:
//   (1) IFC box clamp — a hung SPACE box's inlineOffset/width is clamped to the
//       line content edge (lineInlineSize, line-relative).
//   (2) cursor-position caret clamp — the resolved caret x is clamped to the
//       LEAF's own box right edge (leaf.absoluteX + leaf.width), so a caret
//       INSIDE a clamped (width-0) space leaf lands at the edge, not edge + 8px.
//
// Render / hit-test / selection read box.x / box.width and follow the box clamp
// for free (verified here, not separately patched).
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
const EPS = 1e-6;

/**
 * Lay out a single paragraph in a container of `containerW`. A narrow container
 * forces the line content edge to be small so trailing spaces overflow it (and
 * must clamp). break-spaces is the document default (each space its own unit).
 */
function pipeline(state: State, containerW: number): { layout: LayoutBox; shaper: TextShaper } {
  const root = render(
    state,
    createDefaultComponentRegistry(),
    createDefaultAttrRegistry(),
  ).root;
  const shaper = createMockShaper(CHAR_W, LINE_H);
  const layout = resolvePositionedTree(layoutTree(root, containerW, shaper));
  return { layout, shaper };
}

function paragraph(textContent: string, attrs?: Record<string, unknown>): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        attrs,
        inlineContent: inlineContent([text(textContent)]),
      }),
    ],
  });
}

/** Absolute lines for block "p" (single paragraph fixtures → 1+ own-lines). */
function ownLines(layout: LayoutBox) {
  return getLineIndex(layout).byBlock.get("p" as BlockId) ?? [];
}

/** The first line's content right edge in absolute coords. */
function contentEdgeOf(layout: LayoutBox): number {
  const lines = ownLines(layout);
  return lines[0].absoluteX + lines[0].line.inlineSize;
}

describe("#338 P2 — trailing-space CLAMP: caret on-page through the hung run", () => {
  // "word" (32px) + N trailing spaces in a 80px content line. The N spaces HANG
  // on line 1 (P1) and CLAMP to the edge (P2). break-spaces is the default.
  const N = 40;
  const CONTAINER_W = 80;

  it("LOAD-BEARING: caret for EVERY offset in the hung trailing run stays at or before the content edge", () => {
    const state = paragraph("word" + " ".repeat(N));
    const { layout, shaper } = pipeline(state, CONTAINER_W);
    const lines = ownLines(layout);
    expect(lines).toHaveLength(1); // all spaces hang on one line
    const contentEdge = contentEdgeOf(layout);

    // Walk EVERY offset from the first trailing space (offset 5, after "word ")
    // through the END offset (4 + N). Each caret x must be ≤ contentEdge (P1 left
    // intermediate offsets at edge + k×8px → off-page; the caret clamp fixes it).
    for (let offset = 4; offset <= 4 + N; offset++) {
      const pos = resolvePixelPosition(state, createPosition("p" as BlockId, offset), layout, shaper);
      expect(pos).not.toBeNull();
      if (pos === null) return;
      expect(pos.x).toBeLessThanOrEqual(contentEdge + EPS);
    }
  });

  it("the END offset (after all N spaces) resolves exactly to the content edge", () => {
    const state = paragraph("word" + " ".repeat(N));
    const { layout, shaper } = pipeline(state, CONTAINER_W);
    const contentEdge = contentEdgeOf(layout);
    const pos = resolvePixelPosition(state, createPosition("p" as BlockId, 4 + N), layout, shaper);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    expect(pos.x).toBeCloseTo(contentEdge, 6);
  });

  it("NO-REGRESSION: a normal word caret (no clamp needed) is unchanged", () => {
    // "hello" in a wide container: offset 3 → 24px, well within the line.
    const state = paragraph("hello");
    const { layout, shaper } = pipeline(state, 800);
    const pos = resolvePixelPosition(state, createPosition("p" as BlockId, 3), layout, shaper);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    expect(pos.x).toBe(24); // 3 × 8 — leaf-edge clamp is a no-op here
  });
});

describe("#338 P2 — trailing-space CLAMP: hit-test past the edge", () => {
  const N = 20;
  const CONTAINER_W = 80;

  it("a click past the content edge (in the hung region) resolves to the end-of-trailing-run offset, on the correct line", () => {
    const state = paragraph("word" + " ".repeat(N));
    const { layout, shaper } = pipeline(state, CONTAINER_W);
    const lines = ownLines(layout);
    expect(lines).toHaveLength(1);
    const contentEdge = contentEdgeOf(layout);
    const y = lines[0].absoluteY + 1; // on the line

    // Click well past the content edge.
    const pos = resolvePositionFromPixel(state, layout, shaper, contentEdge + 500, y);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    expect(pos.blockId).toBe("p");
    // Resolves to the end of the trailing run (the last reachable offset on the
    // line) — on-page, not a crash / wrong offset.
    expect(pos.offset).toBe(4 + N);
  });
});

describe("#338 P2 — trailing-space CLAMP: selection over a hung run", () => {
  const N = 20;
  const CONTAINER_W = 80;

  it("a selection covering the trailing spaces does NOT produce a rect past the content edge", () => {
    const state = paragraph("word" + " ".repeat(N));
    const { layout, shaper } = pipeline(state, CONTAINER_W);
    const contentEdge = contentEdgeOf(layout);

    // Select from the start of the trailing run (offset 4) to the end (4 + N).
    const span = createSpan(
      createPosition("p" as BlockId, 4),
      createPosition("p" as BlockId, 4 + N),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    expect(rects.length).toBeGreaterThan(0);
    for (const r of rects) {
      expect(r.x + r.width).toBeLessThanOrEqual(contentEdge + EPS);
    }
  });
});

describe("#338 P2 — trailing-space CLAMP: centered line composition (case 7)", () => {
  const CONTAINER_W = 80;

  it("a centered line with trailing spaces keeps the caret within the line; no crash", () => {
    // Centered "hi" + trailing spaces. The centered content (line.x) is
    // unaffected (trailing spaces excluded from content width). The caret for
    // the end-of-trailing-run offset stays within the line's content region.
    const state = paragraph("hi" + " ".repeat(20), { textAlign: "center" });
    const { layout, shaper } = pipeline(state, CONTAINER_W);
    const lines = ownLines(layout);
    expect(lines).toHaveLength(1);
    const lineLeft = lines[0].absoluteX;
    const lineRight = lineLeft + lines[0].line.inlineSize;

    // End offset (after "hi" + 20 spaces) = 22.
    const pos = resolvePixelPosition(state, createPosition("p" as BlockId, 22), layout, shaper);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    // Caret stays within the centered line's content region.
    expect(pos.x).toBeGreaterThanOrEqual(lineLeft - EPS);
    expect(pos.x).toBeLessThanOrEqual(lineRight + EPS);
  });
});
