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
import { resolveHitPosition as resolvePositionFromPixel } from "../test-utils/hit-position";
import { getLineIndex } from "./line-flatten";
import { render } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { layoutTree } from "../layout/dispatch";
import { positionTreeForTest } from "../test-utils/position-tree";
import { createMockShaper } from "@taleweaver/core";
import { createElementBox, createTextBox } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { layoutBlock } from "../layout/bfc";
import { makeRootContext } from "../layout/layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import type { TextShaper } from "@taleweaver/core";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "@taleweaver/core";
import { createPosition, createSpan } from "@taleweaver/core";
import type { BlockId, State } from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-node";

const CHAR_W = 8;
const LINE_H = 16;
const EPS = 1e-6;

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

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
  const layout = positionTreeForTest(layoutTree(root, containerW, shaper));
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
  const line0 = nth(lines, 0, "line");
  return line0.absoluteX + line0.line.inlineSize;
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
    const y = nth(lines, 0, "line").absoluteY + 1; // on the line

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
    const lineLeft = nth(lines, 0, "line").absoluteX;
    const lineRight = lineLeft + nth(lines, 0, "line").line.inlineSize;

    // End offset (after "hi" + 20 spaces) = 22.
    const pos = resolvePixelPosition(state, createPosition("p" as BlockId, 22), layout, shaper);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    // Caret stays within the centered line's content region.
    expect(pos.x).toBeGreaterThanOrEqual(lineLeft - EPS);
    expect(pos.x).toBeLessThanOrEqual(lineRight + EPS);
  });
});

describe("#340 — caret on-page for trailing spaces INSIDE an inline element", () => {
  // The editor's render path turns text marks into flat differently-styled runs,
  // not nested inline elements, so this exercises the IFC + cursor path directly:
  // build a layout whose paragraph contains a `display:inline` element wrapping a
  // word + trailing spaces at the line edge, paired with a matching `State` (the
  // block id "p" matches the element-box key, so the stamped LineBoxes'
  // `ownerBlockId` resolves; the offset geometry is read off the layout, not the
  // state). Before #340, the inner trailing-space box escaped the content-edge
  // clamp, so its (and the caret's) physical position ran past the edge.
  const CHAR_W = 8;
  const LINE_H = 16;

  // "aaaa" (32) + <em>"bbbb" (32) + 4 spaces</em> at content width 72.
  // "aaaa"+"bbbb" = 64 fits; the em's 4 inner trailing spaces hang past 72.
  const LEAD = "aaaa";
  const EM = "bbbb    "; // 4 trailing spaces
  const CONTENT_W = 72;
  const TOTAL_OFFSET = LEAD.length + EM.length; // 4 + 8 = 12

  function inlineLayout(): { layout: LayoutBox; shaper: TextShaper } {
    const shaper = createMockShaper(CHAR_W, LINE_H);
    const tree = cascadePass(
      createElementBox("p", { display: "block", whiteSpace: "break-spaces" }, [
        createTextBox("t1", {}, LEAD),
        createElementBox("em", { display: "inline" }, [
          createTextBox("t2", {}, EM),
        ]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, CONTENT_W), shaper, undefined);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    return { layout: positionTreeForTest(r.box), shaper };
  }

  // Minimal matching State: a paragraph "p" so `resolveBlock(state, "p")` passes.
  function matchingState(): State {
    return buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text(LEAD), text(EM)]),
        }),
      ],
    });
  }

  it("LOAD-BEARING: caret for offsets inside the inline-wrapped trailing run stays ≤ the content edge (RED before #340)", () => {
    const { layout, shaper } = inlineLayout();
    const state = matchingState();
    const lines = ownLines(layout);
    expect(lines).toHaveLength(1);
    const contentEdge = contentEdgeOf(layout);

    // Offsets inside the em's trailing run: after "aaaabbbb" (offset 8) through
    // the END (offset 12). Each caret x must be ≤ contentEdge — before #340 the
    // inner space box escaped the clamp and the caret ran past it.
    for (let offset = LEAD.length + 4; offset <= TOTAL_OFFSET; offset++) {
      const pos = resolvePixelPosition(state, createPosition("p" as BlockId, offset), layout, shaper);
      expect(pos).not.toBeNull();
      if (pos === null) return;
      expect(pos.x).toBeLessThanOrEqual(contentEdge + EPS);
    }
  });

  it("the END offset (after all inline trailing spaces) resolves to the content edge", () => {
    const { layout, shaper } = inlineLayout();
    const state = matchingState();
    const contentEdge = contentEdgeOf(layout);
    const pos = resolvePixelPosition(state, createPosition("p" as BlockId, TOTAL_OFFSET), layout, shaper);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    expect(pos.x).toBeCloseTo(contentEdge, 6);
  });
});
