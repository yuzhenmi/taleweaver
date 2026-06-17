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
import { buildState, buildBlock, inlineContent, text } from "@taleweaver/core";
import { createPosition, createSpan } from "@taleweaver/core";
import type { BlockId, State } from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-node";

/**
 * OW.S4 — cursor / offset behavior lock around an `overflow-wrap: break-word`
 * EMERGENCY break (the editor BODY default; no per-block override).
 *
 * Unlike a soft-hyphen break (HYPH.S4), an emergency break inserts NO character:
 * the word "aaaaaaaaaa" splits into two real-source fragments, so the offset map
 * is fully contiguous (every code unit is a real source char on exactly one side
 * of the split). Caret / click / selection across the break must resolve to the
 * right offsets — an emergency split is an ordinary token split, so this should
 * already hold; the tests lock it. "aaaaaaaaaa" = 10 × 8px = 80px (mock shaper).
 */
function pipeline(state: State, width: number): { layout: LayoutBox; shaper: TextShaper } {
  const root = render(state, createDefaultComponentRegistry(), createDefaultAttrRegistry()).root;
  const shaper = createMockShaper(8, 16);
  const layout = positionTreeForTest(layoutTree(root, width, shaper));
  return { layout, shaper };
}

/** A document body paragraph holding one long unbreakable word — NO explicit
 *  overflowWrap (relies on the document component's `break-word` body default). */
function longWordDoc(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc",
        inlineContent: inlineContent([text("aaaaaaaaaa")]) }),
    ],
  });
}

describe("overflow-wrap emergency-break caret/offset (OW.S4)", () => {
  it("single line (fits): contiguous offset→x map (no emergency break when it fits)", () => {
    const state = longWordDoc();
    const { layout, shaper } = pipeline(state, 800); // 80px word fits → 1 line
    const x = (offset: number): number | null => {
      const r = resolvePixelPosition(state, createPosition("p" as BlockId, offset), layout, shaper);
      return r === null ? null : r.x;
    };
    expect(x(0)).toBe(0);
    expect(x(1)).toBe(8);
    expect(x(5)).toBe(40);
    expect(x(10)).toBe(80); // end of the 10-char word
  });

  it("across an emergency break: prefix offsets on line 1, suffix on line 2 — every offset resolves", () => {
    // "aaaaaaaaaa" (80px) in a 40px column breaks at grapheme 5: "aaaaa" (line 1)
    // + "aaaaa" (line 2). NO inserted char, so offsets are contiguous: line 1 owns
    // [0,5], line 2 owns [5,10].
    const state = longWordDoc();
    const { layout, shaper } = pipeline(state, 40);
    const at = (offset: number) =>
      resolvePixelPosition(state, createPosition("p" as BlockId, offset), layout, shaper);
    // Prefix offset 1 ("a|aaaa…") is on line 1.
    const p1 = at(1);
    expect(p1?.y).toBe(0);
    expect(p1?.x).toBe(8);
    // Suffix offset 7 (2 chars into the suffix "aaaaa") is on line 2 at x=16.
    const p7 = at(7);
    expect(p7?.y).toBe(16);
    expect(p7?.x).toBe(16);
    // Every offset resolves to a finite caret (the emergency split must not drop
    // the boundary offset 5 or produce NaN).
    for (let off = 0; off <= 10; off++) {
      const r = at(off);
      expect(r).not.toBeNull();
      if (r === null) continue;
      expect(Number.isFinite(r.x)).toBe(true);
      expect(Number.isFinite(r.y)).toBe(true);
    }
  });

  it("click-to-offset resolves the correct fragment on each emergency-broken line", () => {
    const state = longWordDoc();
    const { layout, shaper } = pipeline(state, 40);
    const offsetAt = (px: number, py: number): number | null => {
      const r = resolvePositionFromPixel(state, layout, shaper, px, py, 0);
      return r === null ? null : r.position.offset;
    };
    // Click line 1 (y≈4) near x=8 → offset 1 (inside the prefix).
    expect(offsetAt(8, 4)).toBe(1);
    // Click line 2 (y≈20) near x=16 → offset 7 (2 chars into the suffix).
    expect(offsetAt(16, 20)).toBe(7);
  });

  it("selection spanning the emergency break covers both lines", () => {
    const state = longWordDoc();
    const { layout, shaper } = pipeline(state, 40);
    // Select the whole word [0,10) — it straddles the break, so the geometry spans
    // both lines (a rect on each). The total width selected per line is ≤ 40.
    const rects = computeSelectionRects(
      state,
      createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 10)),
      layout,
      shaper,
    );
    expect(rects.length).toBeGreaterThanOrEqual(2);
    const ys = new Set(rects.map((r) => r.y));
    expect(ys.has(0)).toBe(true); // line 1
    expect(ys.has(16)).toBe(true); // line 2
    for (const r of rects) expect(r.width).toBeLessThanOrEqual(40);
  });
});
