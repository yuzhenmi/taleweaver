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
 * HYPH.S4 — cursor / offset behavior lock around a U+00AD SOFT HYPHEN.
 *
 * A soft hyphen is a REAL 1-UTF-16-unit source character that occupies one state
 * offset but renders ZERO width (slice 1). So a caret can sit immediately before
 * AND after it, and both positions map to the SAME x (the soft hyphen advances
 * nothing). `hyphens` defaults to `manual` (inherited from the document root), so
 * these documents honor the soft hyphen as a hyphenation point without any attr.
 *
 * "hy<SHY>phen" source offsets: h=0 y=1 <SHY>=2 p=3 h=4 e=5 n=6 (length 7).
 * Visible glyph widths (mock shaper, 8px/char): h,y,p,h,e,n = 8 each; <SHY> = 0.
 */
const SHY = "­";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

function pipeline(state: State, width = 800): { layout: LayoutBox; shaper: TextShaper } {
  const root = render(state, createDefaultComponentRegistry(), createDefaultAttrRegistry()).root;
  const shaper = createMockShaper(8, 16);
  const layout = positionTreeForTest(layoutTree(root, width, shaper));
  return { layout, shaper };
}

function softHyphenWord(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([text("hy" + SHY + "phen")]),
      }),
    ],
  });
}

describe("soft-hyphen caret/offset (HYPH.S4)", () => {
  it("maps every offset to x on a single line — the soft hyphen is zero-width so offsets 2 and 3 share an x", () => {
    const state = softHyphenWord();
    const { layout, shaper } = pipeline(state, 800);
    const x = (offset: number): number | null => {
      const r = resolvePixelPosition(state, createPosition("p" as BlockId, offset), layout, shaper);
      return r === null ? null : r.x;
    };
    expect(x(0)).toBe(0);
    expect(x(1)).toBe(8); // after "h"
    expect(x(2)).toBe(16); // after "hy", caret BEFORE the soft hyphen
    expect(x(3)).toBe(16); // caret AFTER the soft hyphen — zero-width, same x as offset 2
    expect(x(4)).toBe(24); // after "hy<SHY>p"
    expect(x(5)).toBe(32);
    expect(x(6)).toBe(40);
    expect(x(7)).toBe(48); // end of "hyphen" (6 visible glyphs × 8)
  });

  it("selection rects measure the word with the soft hyphen contributing zero width", () => {
    const state = softHyphenWord();
    const { layout, shaper } = pipeline(state, 800);
    // Whole word [0,7): one rect spanning x 0..48 (6 visible glyphs × 8).
    const whole = computeSelectionRects(
      state,
      createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 7)),
      layout,
      shaper,
    );
    expect(whole.length).toBe(1);
    expect(nth(whole, 0, "rect").x).toBe(0);
    expect(nth(whole, 0, "rect").width).toBe(48);
    // A range straddling the soft hyphen [2,4) = "<SHY>p": the soft hyphen adds 0,
    // "p" adds 8 → rect x 16..24 (width 8), not 24.
    const straddle = computeSelectionRects(
      state,
      createSpan(createPosition("p" as BlockId, 2), createPosition("p" as BlockId, 4)),
      layout,
      shaper,
    );
    expect(straddle.length).toBe(1);
    expect(nth(straddle, 0, "rect").x).toBe(16);
    expect(nth(straddle, 0, "rect").width).toBe(8);
  });

  it("click-to-offset maps unambiguous x positions across the word", () => {
    const state = softHyphenWord();
    const { layout, shaper } = pipeline(state, 800);
    const offsetAt = (px: number): number | null => {
      const r = resolvePositionFromPixel(state, layout, shaper, px, 4, 0);
      return r === null ? null : r.position.offset;
    };
    expect(offsetAt(0)).toBe(0);
    expect(offsetAt(8)).toBe(1);
    expect(offsetAt(24)).toBe(4); // after the soft hyphen + "p"
    expect(offsetAt(48)).toBe(7); // end of word
  });

  it("across a soft-hyphen wrap: prefix offsets land on line 1, suffix offsets on line 2 — all resolve", () => {
    // "hy<SHY>phen" = 48px in a 40px line → wraps at the soft hyphen. Line 1 =
    // "hy<SHY>" + the "-" glyph (y=0); line 2 = "phen" (y=16).
    const state = softHyphenWord();
    const { layout, shaper } = pipeline(state, 40);
    const at = (offset: number) =>
      resolvePixelPosition(state, createPosition("p" as BlockId, offset), layout, shaper);
    // Prefix offset 1 ("h|y") is on line 1.
    const p1 = at(1);
    expect(p1).not.toBeNull();
    expect(p1?.y).toBe(0);
    expect(p1?.x).toBe(8);
    // Suffix offset 5 ("ph|en") is on line 2 at x=16 (p,h from the line start).
    const p5 = at(5);
    expect(p5).not.toBeNull();
    expect(p5?.y).toBe(16);
    expect(p5?.x).toBe(16);
    // Every offset resolves to a finite caret (the zero-width soft hyphen at the
    // wrap boundary must not drop offset 3 from the map or produce NaN).
    for (let off = 0; off <= 7; off++) {
      const r = at(off);
      expect(r).not.toBeNull();
      if (r === null) continue;
      expect(Number.isFinite(r.x)).toBe(true);
      expect(Number.isFinite(r.y)).toBe(true);
    }
  });
});
