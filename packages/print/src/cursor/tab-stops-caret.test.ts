import { describe, it, expect } from "vitest";
import { resolvePixelPosition } from "./cursor-position";
import { resolvePositionFromPixel } from "./hit-test";
import { computeSelectionRects } from "./selection-geometry";
import { render } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { layoutTree } from "../layout/dispatch";
import { positionTreeForTest } from "../test-utils/position-tree";
import { createMockShaper } from "@taleweaver/core";
import type { TextShaper } from "@taleweaver/core";
import { buildState, buildBlock, inlineContent, text, embed } from "@taleweaver/core";
import { createPosition, createSpan } from "@taleweaver/core";
import type { BlockId, State } from "@taleweaver/core";
import type { TabStop } from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-node";

/**
 * Tab stops S4 — caret / hit-test / selection BEHAVIOR LOCK over a tab.
 *
 * S3 froze the tab's advance onto a fixed-width inline-block leaf box. Caret,
 * hit-test, and selection therefore flow through the existing inline-block leaf
 * path in the cursor layer (the same path footnote-anchors / inline images use):
 *   - caret-before the tab → the box's inline-start edge;
 *   - caret-after the tab → the box's inline-end edge (= the next run's start);
 *   - click in the first half of the advance → before; second half → after
 *     (midpoint split on the advance);
 *   - a selection over just the tab → one rect spanning the advance.
 *
 * This file is a behavior lock + regression guard: it proves the inline-block
 * leaf path gives correct cursor behavior for a 1-offset zero-text tab unit, and
 * would FAIL if that path regressed.
 *
 * Geometry (mock shaper = 8px/char, default tab interval = 48px):
 *   inlineContent [text("a"), embed("tab"), text("b")] with an explicit left
 *   stop at 100. pen after "a" = 8 → tab advances to x=100 → tab box spans
 *   x∈[8,100] (advance 92) → "b" starts at x=100 and ends at x=108.
 *
 * Offsets: 0=before "a", 1=before tab, 2=after tab / before "b", 3=after "b".
 */

const componentRegistry = createDefaultComponentRegistry();
const attrRegistry = createDefaultAttrRegistry();

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

function pipeline(state: State, width: number): { layout: LayoutBox; shaper: TextShaper } {
  const root = render(state, componentRegistry, attrRegistry).root;
  const shaper = createMockShaper(8, 16);
  const layout = positionTreeForTest(layoutTree(root, width, shaper));
  return { layout, shaper };
}

/**
 * Doc = document → paragraph with inlineContent [text("a"), embed("tab"), text("b")].
 * `tabStops` is carried as a paragraph block-attr; the cascade resolves it onto
 * the paragraph's ComputedStyle, which the IFC reads to resolve the tab advance.
 */
function tabDoc(tabStops: readonly TabStop[]): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        attrs: { tabStops },
        inlineContent: inlineContent([text("a"), embed("tab"), text("b")]),
      }),
    ],
  });
}

/** Caret x of position(blockId, offset). Returns NaN if it fails to resolve, so
 *  a regression fails loudly rather than silently passing on null. */
function caretX(
  state: State,
  blockId: string,
  offset: number,
  layout: LayoutBox,
  shaper: TextShaper,
): number {
  const r = resolvePixelPosition(state, createPosition(blockId as BlockId, offset), layout, shaper);
  return r === null ? Number.NaN : r.x;
}

/** Click → state offset at (px, py). Returns -1 if it fails to resolve. */
function offsetAt(
  state: State,
  layout: LayoutBox,
  shaper: TextShaper,
  px: number,
  py: number,
): number {
  const r = resolvePositionFromPixel(state, layout, shaper, px, py, 0);
  return r === null ? -1 : r.position.offset;
}

function selRects(
  state: State,
  blockId: string,
  from: number,
  to: number,
  layout: LayoutBox,
  shaper: TextShaper,
) {
  return computeSelectionRects(
    state,
    createSpan(createPosition(blockId as BlockId, from), createPosition(blockId as BlockId, to)),
    layout,
    shaper,
  );
}

describe("tab-stops S4 — caret/click/selection over a tab (inline-block leaf path)", () => {
  const stops: readonly TabStop[] = [{ position: 100, alignment: "left", leader: "none" }];

  it("caret before the tab sits at the tab box inline-start (x=8)", () => {
    const state = tabDoc(stops);
    const { layout, shaper } = pipeline(state, 800);
    expect(caretX(state, "p", 1, layout, shaper)).toBe(8);
  });

  it("caret after the tab sits at the tab box inline-end / 'b' start (x=100)", () => {
    const state = tabDoc(stops);
    const { layout, shaper } = pipeline(state, 800);
    expect(caretX(state, "p", 2, layout, shaper)).toBe(100);
  });

  it("click in the first half of the tab advance resolves to before (offset 1)", () => {
    // tab box spans x∈[8,100]; midpoint = 8 + 92/2 = 54. x=30 < 54 → before.
    const state = tabDoc(stops);
    const { layout, shaper } = pipeline(state, 800);
    expect(offsetAt(state, layout, shaper, 30, 8)).toBe(1);
  });

  it("click in the second half of the tab advance resolves to after (offset 2)", () => {
    // x=80 ≥ 54 → after.
    const state = tabDoc(stops);
    const { layout, shaper } = pipeline(state, 800);
    expect(offsetAt(state, layout, shaper, 80, 8)).toBe(2);
  });

  it("selection over just the tab [1,2) yields one rect spanning the advance (width 92, x=8)", () => {
    const state = tabDoc(stops);
    const { layout, shaper } = pipeline(state, 800);
    const rects = selRects(state, "p", 1, 2, layout, shaper);
    expect(rects.length).toBe(1);
    expect(nth(rects, 0, "rect").width).toBe(92); // 100 − 8
    expect(nth(rects, 0, "rect").x).toBe(8);
  });

  it("the tab is selectable as part of a larger range: [0,3) covers x=0..108 on one line", () => {
    // Whole paragraph "a"(0..8) + tab(8..100) + "b"(100..108) on a single line.
    const state = tabDoc(stops);
    const { layout, shaper } = pipeline(state, 800);
    const rects = selRects(state, "p", 0, 3, layout, shaper);
    expect(rects.length).toBe(1);
    const ys = new Set(rects.map((r) => r.y));
    expect(ys.size).toBe(1); // single line
    expect(nth(rects, 0, "rect").x).toBe(0);
    expect(nth(rects, 0, "rect").x + nth(rects, 0, "rect").width).toBe(108);
  });
});
