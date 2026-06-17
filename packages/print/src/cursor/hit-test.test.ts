import { describe, it, expect } from "vitest";
import { resolvePositionFromPixel as resolveHitRaw } from "./hit-test";
import { resolveHitPosition as resolvePositionFromPixel } from "../test-utils/hit-position";
import { selectWord } from "@taleweaver/core";
import { render } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { layoutTree } from "../layout/dispatch";
import { positionTreeForTest } from "../test-utils/position-tree";
import { createMockShaper } from "@taleweaver/core";
import { getLineIndex, collectLineLeaves } from "./line-flatten";
import { resolvePixelPosition } from "./cursor-position";
import type { TextShaper } from "@taleweaver/core";
import type { PageConfig } from "../layout/page-config";
import type { WritingMode } from "@taleweaver/core";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
  embed,
} from "@taleweaver/core";
import { createPosition } from "@taleweaver/core";
import type { State, BlockId } from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-node";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

function pipeline(
  state: State,
  containerInlineSize: number = 800,
  pageConfig?: PageConfig,
): { layout: LayoutBox; shaper: TextShaper } {
  const root = render(
    state,
    createDefaultComponentRegistry(),
    createDefaultAttrRegistry(),
  ).root;
  const shaper = createMockShaper(8, 16);
  const layout = positionTreeForTest(layoutTree(root, containerInlineSize, shaper, pageConfig));
  return { layout, shaper };
}

// `whiteSpace` (optional): when provided, pins the paragraph's
// `white-space` (via the `whiteSpace` attr interpreter) instead of
// inheriting the document root's default (`break-spaces`). Collapse-dependent
// fixtures pass `"normal"` so their pixel/offset assertions stay valid.
function singleParagraph(textContent: string, whiteSpace?: string): State {
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
        attrs: whiteSpace !== undefined ? { whiteSpace } : undefined,
        inlineContent: inlineContent([text(textContent)]),
      }),
    ],
  });
}

describe("resolvePositionFromPixel (new)", () => {
  it("returns offset 0 for click at top-left of single paragraph", () => {
    const state = singleParagraph("hello");
    const { layout, shaper } = pipeline(state);
    const result = resolvePositionFromPixel(state, layout, shaper, 0, 0);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.blockId).toBe("p");
    expect(result.offset).toBe(0);
  });

  it("returns offset 3 for click mid-text via measurer binary search", () => {
    const state = singleParagraph("hello");
    const { layout, shaper } = pipeline(state);
    // 8px/char; clicking at x=24 lands between chars 2 and 3 → offset 3.
    const result = resolvePositionFromPixel(state, layout, shaper, 24, 0);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.blockId).toBe("p");
    expect(result.offset).toBe(3);
  });

  it("returns end-of-line offset for click past line end", () => {
    const state = singleParagraph("hello");
    const { layout, shaper } = pipeline(state);
    const result = resolvePositionFromPixel(state, layout, shaper, 1000, 0);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.blockId).toBe("p");
    expect(result.offset).toBe(5);
  });

  it("returns last position for click below all text (match legacy)", () => {
    // Legacy falls through to the last line on a click well below all text
    // (default targetLineY = last line). We mirror that behavior — returns
    // a position at the end of the last line (offset 5 for "hello").
    const state = singleParagraph("hello");
    const { layout, shaper } = pipeline(state);
    const result = resolvePositionFromPixel(state, layout, shaper, 0, 1000);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.blockId).toBe("p");
    // x=0 on the last (only) line → start; legacy returns offset 0 here.
    expect(result.offset).toBe(0);
  });

  it("returns a position in p2 for click in p2's text area", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          firstChildId: "p1",
          lastChildId: "p2",
        }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "p2",
          inlineContent: inlineContent([text("hi")]),
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p1",
          inlineContent: inlineContent([text("world")]),
        }),
      ],
    });
    const { layout, shaper } = pipeline(state);
    // p1 lives at y=0 (16px tall) + margin. p2 lives below.
    // Click well into p2's vertical area (y=50) at x=8 → offset 1 in p2.
    const result = resolvePositionFromPixel(state, layout, shaper, 8, 50);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.blockId).toBe("p2");
    expect(result.offset).toBe(1);
  });

  it("resolves a click near the embed boundary", () => {
    // Inline content: "ab", embed, "cd". Block offsets:
    //   0..2 -> "ab", 2 -> start of embed slot, 3 -> start of "cd", 3..5 -> "cd".
    // Embed currently has no layout box of its own (default display: inline,
    // no text). With "ab" being 16px wide and "cd" starting at x=16 (no gap),
    // a click at x=16, y=0 lands at the boundary; legacy hit-test returns
    // offset 2 (end of "ab" - the first matched box at that x) or offset 3
    // (start of "cd" - by spatial accumulation). We accept either as valid
    // per T2's pragma on embed boundary handling.
    const state = buildState({
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
          inlineContent: inlineContent([
            text("ab"),
            embed("fn-anchor", { contentBlockId: "fn" }),
            text("cd"),
          ]),
        }),
      ],
      embedContents: [
        buildBlock({
          id: "fn",
          type: "paragraph",
          inlineContent: inlineContent([text("body")]),
        }),
      ],
    });
    const { layout, shaper } = pipeline(state);

    // Click at x=4 (mid-"a") → offset 0 or 1 in "ab".
    const inAb = resolvePositionFromPixel(state, layout, shaper, 4, 0);
    expect(inAb).not.toBeNull();
    if (inAb === null) return;
    expect(inAb.blockId).toBe("p");
    expect(inAb.offset).toBeGreaterThanOrEqual(0);
    expect(inAb.offset).toBeLessThanOrEqual(1);

    // Click at x=20 (mid-"c" — "cd" starts at x=16, char "c" spans 16..24)
    // → expected offset 3 (start of "c") or 4 (end of "c" / start of "d").
    const inCd = resolvePositionFromPixel(state, layout, shaper, 20, 0);
    expect(inCd).not.toBeNull();
    if (inCd === null) return;
    expect(inCd.blockId).toBe("p");
    expect(inCd.offset).toBeGreaterThanOrEqual(3);
    expect(inCd.offset).toBeLessThanOrEqual(4);
  });

  it("respects pageIndex arg in a paginated document", () => {
    // Mirror T2 test 5: page content height ~40px, ~2 paragraphs per page.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          firstChildId: "p1",
          lastChildId: "p5",
        }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "p2",
          inlineContent: inlineContent([text("line1")]),
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p1",
          nextSiblingId: "p3",
          inlineContent: inlineContent([text("line2")]),
        }),
        buildBlock({
          id: "p3",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p2",
          nextSiblingId: "p4",
          inlineContent: inlineContent([text("line3")]),
        }),
        buildBlock({
          id: "p4",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p3",
          nextSiblingId: "p5",
          inlineContent: inlineContent([text("line4")]),
        }),
        buildBlock({
          id: "p5",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p4",
          inlineContent: inlineContent([text("line5")]),
        }),
      ],
    });
    const pageConfig: PageConfig = {
      pageInlineSize: 800,
      pageBlockSize: 60,
      pageMargins: {
        blockStart: 10,
        blockEnd: 10,
        inlineStart: 0,
        inlineEnd: 0,
      },
      pageGap: 0,
    };
    const { layout, shaper } = pipeline(state, 800, pageConfig);

    // Click at the top of page index 1, x=0 → should resolve to a block
    // whose text-runs live on pageIndex 1 (not the page 0 blocks).
    const result = resolvePositionFromPixel(state, layout, shaper, 0, 0, 1);
    expect(result).not.toBeNull();
    if (result === null) return;
    // Page 0 has ~2 blocks (p1, p2). Page 1 starts at p3 or p4.
    expect(["p3", "p4", "p5"]).toContain(result.blockId);
  });

  it("resolves to offset 0 of the empty paragraph for a click in its strut line", () => {
    // Empty paragraph still occupies one line-height (strut). A click at its
    // y should land on offset 0 of THAT paragraph (not null, not the prev/next
    // line — there are none here). See #170.
    const state = buildState({
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
          inlineContent: inlineContent([]),
        }),
      ],
    });
    const { layout, shaper } = pipeline(state);
    // Click anywhere inside the strut line (y=0 is the top of the strut).
    const result = resolvePositionFromPixel(state, layout, shaper, 0, 0);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.blockId).toBe("p");
    expect(result.offset).toBe(0);
  });

  it("resolves click on an empty paragraph between two non-empty ones to offset 0 of the empty block", () => {
    // Structure: [A] / [empty] / [B]. Clicking on the middle (empty) line
    // should land on offset 0 of the empty paragraph — NOT fall through to
    // A's last line or B's first line. See #170.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          firstChildId: "pA",
          lastChildId: "pB",
        }),
        buildBlock({
          id: "pA",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "pEmpty",
          inlineContent: inlineContent([text("A")]),
        }),
        buildBlock({
          id: "pEmpty",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "pA",
          nextSiblingId: "pB",
          inlineContent: inlineContent([]),
        }),
        buildBlock({
          id: "pB",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "pEmpty",
          inlineContent: inlineContent([text("B")]),
        }),
      ],
    });
    const { layout, shaper } = pipeline(state);
    // Layout: pA at y=0 h=16, pEmpty strut at y=24 h=16, pB at y=48 h=16
    // (default 8px paragraph margins). Click well into pEmpty's strut line.
    const result = resolvePositionFromPixel(state, layout, shaper, 8, 30);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.blockId).toBe("pEmpty");
    expect(result.offset).toBe(0);
  });

  it("still resolves to a non-empty paragraph when the click is on its line (synthetic does not override real)", () => {
    // Non-regression: with synthetic entries now consulted as a fallback,
    // a click on a real text-run line must still resolve to that text-run
    // (not to a synthetic on a different line). See #170.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          firstChildId: "pA",
          lastChildId: "pB",
        }),
        buildBlock({
          id: "pA",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "pEmpty",
          inlineContent: inlineContent([text("AAAA")]),
        }),
        buildBlock({
          id: "pEmpty",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "pA",
          nextSiblingId: "pB",
          inlineContent: inlineContent([]),
        }),
        buildBlock({
          id: "pB",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "pEmpty",
          inlineContent: inlineContent([text("BBBB")]),
        }),
      ],
    });
    const { layout, shaper } = pipeline(state);
    // Click at y=0 (pA's line), x=8 — must resolve in pA, not pEmpty.
    const onA = resolvePositionFromPixel(state, layout, shaper, 8, 0);
    expect(onA).not.toBeNull();
    if (onA === null) return;
    expect(onA.blockId).toBe("pA");

    // Click at y=50 (within pB's line), x=8 — must resolve in pB, not pEmpty.
    const onB = resolvePositionFromPixel(state, layout, shaper, 8, 50);
    expect(onB).not.toBeNull();
    if (onB === null) return;
    expect(onB.blockId).toBe("pB");
  });

  it("returns offset 0 of the empty last paragraph for a click below all text", () => {
    // The default-to-last-line path (no real boxes on lineYs below the click)
    // must still resolve correctly when the LAST line is a synthetic-only
    // empty paragraph. Reviewer-flagged coverage gap; the code handles it via
    // the synthetic-fallback at resolvePositionFromPixel, but no test
    // exercised it before. See #173 review.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          firstChildId: "pA",
          lastChildId: "pEmpty",
        }),
        buildBlock({
          id: "pA",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "pEmpty",
          inlineContent: inlineContent([text("hello")]),
        }),
        buildBlock({
          id: "pEmpty",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "pA",
          inlineContent: inlineContent([]),
        }),
      ],
    });
    const { layout, shaper } = pipeline(state);
    // Click well below all rendered text — should snap to the last line,
    // which is the empty paragraph's strut. Result must be pEmpty:0.
    const result = resolvePositionFromPixel(state, layout, shaper, 0, 1000);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.blockId).toBe("pEmpty");
    expect(result.offset).toBe(0);
  });
});

describe("P4-C.2.2a — RTL-aware hit-test OFFSET (click → correct logical offset)", () => {
  // The mock shaper is 8px/char. The paragraph base stays LTR (no `direction`
  // attr), but Hebrew CONTENT resolves to level-1 (RTL) runs by UAX #9 — exactly
  // the leaf-level the §C intra-leaf RTL math keys off. Geometry mirrors
  // cursor-position.test.ts's P4-C.2.1 fixtures (this is the INVERSE direction):
  //   "אבג"     → Hebrew run (lvl1) x[0,24]; offset 0 at right edge 24, offset 3
  //               at left edge 0.
  //   "abcאבג"  → Latin "abc" (lvl0) x[0,24], Hebrew "אבג" (lvl1) x[24,48].
  //   "abc אבג" → "abc" x[0,24], " " x[24,32], "אבג" x[32,56].

  it("round-trip with C.2.1 (uniform RTL 'אבג'): click at caret X of offset k returns offset k", () => {
    // caretInlineCoordInLeaf places offset k of the RTL run at x = 24 − 8k (from
    // cursor-position.test.ts): offset 0→24, 1→16, 2→8, 3→0. Clicking those
    // exact Xs must invert back to k. The clamps below (+2 / −2) nudge off the
    // exact glyph boundary so the nearest-char midpoint rule resolves
    // deterministically (a click ON a midpoint is ambiguous).
    const state = singleParagraph("אבג");
    const { layout, shaper } = pipeline(state, 800);
    // offset 0 at right edge (24) — click just inside (x=23) → offset 0.
    const k0 = resolvePositionFromPixel(state, layout, shaper, 23, 0);
    expect(k0?.blockId).toBe("p");
    expect(k0?.offset).toBe(0);
    // offset 1 at x=16 — click at x=15 (left of midpoint between glyph 0 and 1).
    const k1 = resolvePositionFromPixel(state, layout, shaper, 15, 0);
    expect(k1?.offset).toBe(1);
    // offset 2 at x=8 — click at x=7.
    const k2 = resolvePositionFromPixel(state, layout, shaper, 7, 0);
    expect(k2?.offset).toBe(2);
    // offset 3 at left edge (0) — click at x=1 → offset 3 (the logical END).
    const k3 = resolvePositionFromPixel(state, layout, shaper, 1, 0);
    expect(k3?.offset).toBe(3);
  });

  it("uniform RTL 'אבג': click near visual-LEFT edge → logical-LAST offset (3); near visual-RIGHT → offset 0 (OPPOSITE of LTR)", () => {
    // The decisive direction test. Under the OLD LTR-only `findCharOffset(text,
    // localX)` a click at the visual LEFT (x≈0) returned offset 0 (the logically
    // FIRST char) — wrong, because that glyph is visually RIGHTMOST in an RTL run.
    // RTL-aware: visual-left → logical-LAST (3), visual-right → logical-FIRST (0).
    const state = singleParagraph("אבג");
    const { layout, shaper } = pipeline(state, 800);

    const nearLeft = resolvePositionFromPixel(state, layout, shaper, 1, 0);
    expect(nearLeft?.blockId).toBe("p");
    expect(nearLeft?.offset).toBe(3); // logical LAST — was 0 under the LTR bug

    const nearRight = resolvePositionFromPixel(state, layout, shaper, 23, 0);
    expect(nearRight?.blockId).toBe("p");
    expect(nearRight?.offset).toBe(0); // logical FIRST — was 3 under the LTR bug
  });

  it("mixed 'abcאבג': click in the Latin run → a Latin offset; click in the Hebrew run → a Hebrew offset (visual→logical leaf mapping)", () => {
    // Latin "abc" lvl0 x[0,24] owns state [0,3]; Hebrew "אבג" lvl1 x[24,48] owns
    // state [3,6]. The OLD visual `withinLineOffset` accumulation summed leaves
    // in VISUAL order then added as a LOGICAL offset — here visual order ==
    // logical order so it happened to work, BUT the WITHIN-leaf direction was
    // still wrong for the Hebrew run. Assert both the right leaf AND the right
    // intra-run direction.
    const state = singleParagraph("abcאבג");
    const { layout, shaper } = pipeline(state, 800);

    // Click mid-"b" (x=10, glyph "b" spans [8,16)) → Latin offset 1.
    const inLatin = resolvePositionFromPixel(state, layout, shaper, 10, 0);
    expect(inLatin?.blockId).toBe("p");
    expect(inLatin?.offset).toBe(1);

    // Hebrew run x[24,48] is RTL: by C.2.1's geometry offset 3 (logical FIRST,
    // == boundary) sits at the RIGHT edge 48, offset 6 (logical LAST) at the LEFT
    // edge 24. So clicking near the visual-RIGHT edge (x=47) → logical-FIRST
    // Hebrew offset 3; near the visual-LEFT edge (x=25) → logical-LAST offset 6.
    // Under the OLD LTR-only within-leaf math these would be SWAPPED.
    const hebRight = resolvePositionFromPixel(state, layout, shaper, 47, 0);
    expect(hebRight?.blockId).toBe("p");
    expect(hebRight?.offset).toBe(3);

    const hebLeft = resolvePositionFromPixel(state, layout, shaper, 25, 0);
    expect(hebLeft?.blockId).toBe("p");
    expect(hebLeft?.offset).toBe(6);
  });

  it("mixed 'abc אבג' (with space): a click in each run resolves to that run's logical offset", () => {
    // "abc" x[0,24] state [0,3]; " " x[24,32] state [3,4]; "אבג" x[32,56] state
    // [4,7]. Round-trips C.2.1's xAt values (offset 5→48, 6→40, 7→32).
    const state = singleParagraph("abc אבג");
    const { layout, shaper } = pipeline(state, 800);

    // Click mid-"a" (x=2) → Latin offset 0.
    const inLatin = resolvePositionFromPixel(state, layout, shaper, 2, 0);
    expect(inLatin?.offset).toBe(0);

    // Hebrew run [32,56]: offset 4 at right edge 56, offset 7 at left edge 32.
    // Click at x=33 (near visual-left) → logical-LAST Hebrew offset 7.
    const hebLeft = resolvePositionFromPixel(state, layout, shaper, 33, 0);
    expect(hebLeft?.offset).toBe(7);
    // Click at x=55 (near visual-right) → logical-FIRST Hebrew offset 4.
    const hebRight = resolvePositionFromPixel(state, layout, shaper, 55, 0);
    expect(hebRight?.offset).toBe(4);
    // Click mid Hebrew (x=47, caret X of offset 5 is 48) → offset 5.
    const hebMid = resolvePositionFromPixel(state, layout, shaper, 47, 0);
    expect(hebMid?.offset).toBe(5);
  });
});

describe("P4-C.2.2b — caret-affinity SEED (hit-leaf-owner rule)", () => {
  // `resolveHitRaw` is the raw `resolvePositionFromPixel` returning
  // `{ position, caretAffinity }` (P4-C.2.2b §D). The HIT leaf owns the offset:
  // a click landing on a leaf's TRAILING edge sticks to that (preceding) leaf →
  // "before"; everything else → "after" (mid-leaf / leading edge / empty line).
  // Geometry reuses the C.2.2a fixtures: "abcאבג" → Latin "abc" lvl0 x[0,24]
  // owns state [0,3]; Hebrew "אבג" lvl1 x[24,48] owns state [3,6].

  it("returns the { position, caretAffinity } shape", () => {
    const state = singleParagraph("hello");
    const { layout, shaper } = pipeline(state);
    const hit = resolveHitRaw(state, layout, shaper, 0, 0);
    expect(hit).not.toBeNull();
    expect(hit?.position.blockId).toBe("p");
    expect(hit?.position.offset).toBe(0);
    expect(hit?.caretAffinity).toBe("after");
  });

  it("clicking the LATIN side of the boundary seeds 'before' (offset 3 == Latin leaf's trailing edge)", () => {
    // Latin run x[0,24]: a click near its visual-RIGHT edge (x=23) resolves to
    // offset 3 — the Latin leaf's logEnd (its trailing edge) — so the caret
    // sticks to the Latin (preceding) leaf → "before".
    const state = singleParagraph("abcאבג");
    const { layout, shaper } = pipeline(state);
    const hit = resolveHitRaw(state, layout, shaper, 23, 0);
    expect(hit?.position.offset).toBe(3);
    expect(hit?.caretAffinity).toBe("before");
  });

  it("clicking the HEBREW side of the boundary seeds 'after' (offset 3 is the Hebrew leaf's LEADING edge)", () => {
    // Hebrew run x[24,48] is RTL: offset 3 (its logStart, the boundary) sits at
    // the run's RIGHT edge (x=48). A click near x=47 lands in the HEBREW leaf and
    // resolves to offset 3 = that leaf's logStart (leading edge), NOT its trailing
    // edge → "after". Same logical offset 3 as the Latin-side click, OPPOSITE
    // affinity — exactly the dual-caret boundary the seed disambiguates.
    const state = singleParagraph("abcאבג");
    const { layout, shaper } = pipeline(state);
    const hit = resolveHitRaw(state, layout, shaper, 47, 0);
    expect(hit?.position.offset).toBe(3);
    expect(hit?.caretAffinity).toBe("after");
  });

  it("a mid-run click seeds 'after' (interior offset is inert)", () => {
    // Click mid-"b" (x=10) → offset 1, interior to the Latin leaf [0,3]. An
    // interior offset is neither leaf's trailing edge → "after".
    const state = singleParagraph("abcאבג");
    const { layout, shaper } = pipeline(state);
    const hit = resolveHitRaw(state, layout, shaper, 10, 0);
    expect(hit?.position.offset).toBe(1);
    expect(hit?.caretAffinity).toBe("after");
  });

  it("pure-LTR click at line END seeds 'before' (end-of-run is the only run's trailing edge) — still inert at render", () => {
    // "hello" single LTR leaf [0,5]. A click past the end (x=1000) resolves to
    // offset 5 = the leaf's logEnd → "before". On a uniform LTR line both sides
    // give the same X, so this is inert at render; it just confirms the
    // hit-leaf-owner rule fires symmetrically (not RTL-only).
    const state = singleParagraph("hello");
    const { layout, shaper } = pipeline(state);
    const hit = resolveHitRaw(state, layout, shaper, 1000, 0);
    expect(hit?.position.offset).toBe(5);
    expect(hit?.caretAffinity).toBe("before");
  });

  it("empty line seeds 'after'", () => {
    const state = singleParagraph("");
    const { layout, shaper } = pipeline(state);
    const hit = resolveHitRaw(state, layout, shaper, 0, 0);
    expect(hit?.position.offset).toBe(0);
    expect(hit?.caretAffinity).toBe("after");
  });

  it("synthetic-glyph regression (C.2.2a): a click past EVERY line's end returns that line's inlineOffsetEnd, NEVER inlineOffsetEnd + 1", () => {
    // The C.2.2a bug: a synthetic trailing glyph (the hyphenation hyphen, the
    // soft-wrap break) owns no state offsets but the pre-C.2.2a hit-test
    // accumulator could COUNT it as a caret target, returning inlineOffsetEnd +
    // 1. `buildLineBidiView` now excludes synthetic runs, so a click past the
    // line content clamps to the line's real inlineOffsetEnd. This wraps a word
    // across lines so the non-final wrapped lines carry a synthetic line-break
    // glyph at their visual edge — the exact place the +1 could have leaked.
    const state = singleParagraph("aaaa bbbb cccc dddd", "normal");
    const { layout, shaper } = pipeline(state, 40); // narrow ⇒ multiple wrapped lines
    const lines = getLineIndex(layout).byBlock.get("p" as BlockId) ?? [];
    expect(lines.length).toBeGreaterThan(1); // it wrapped
    for (const al of lines) {
      // Click far past the line's content edge — onto the trailing synthetic
      // glyph / past line end. The resolved offset is the line's real
      // inlineOffsetEnd, never one past it.
      const hit = resolveHitRaw(state, layout, shaper, 1000, al.absoluteY);
      expect(hit?.position.offset).toBe(al.line.inlineOffsetEnd);
      expect(hit?.position.offset).not.toBe(al.line.inlineOffsetEnd + 1);
    }
  });
});

describe("editor default white-space: break-spaces (multiple spaces render)", () => {
  // Under the editor's default white-space (now `break-spaces`, set on the
  // document root and inherited), a paragraph that contains two interior
  // spaces preserves BOTH — they don't collapse to one. This is a GEOMETRY
  // assertion through the real render→layout pipeline with the default doc
  // (no explicit white-space attr): the only line must own all 4 state chars
  // and its rendered content width must reflect both spaces.
  it("'a  b' renders both spaces: line owns all 4 chars and is 32px wide", () => {
    const state = singleParagraph("a  b");
    const { layout } = pipeline(state);

    // Find the paragraph's single LineBox and assert it owns the full state
    // range [0, 4) — under collapse the second space would be dropped from
    // the offset accounting / rendered width.
    const pLines = getLineIndex(layout).byBlock.get("p" as BlockId) ?? [];
    expect(pLines.length).toBe(1);
    const al = pLines[0];
    if (al === undefined) return;
    expect(al.line.inlineOffsetStart).toBe(0);
    expect(al.line.inlineOffsetEnd).toBe(4);

    // Rendered content width: "a"(8) + " "(8) + " "(8) + "b"(8) = 32px.
    // Under collapse it would be 24px (one space dropped). Sum the rendered
    // widths of the line's leaves (text-runs).
    const leaves = collectLineLeaves(al.line, al.absoluteX, al.absoluteY);
    const width = leaves.reduce((sum, leaf) => sum + leaf.width, 0);
    expect(width).toBe(32);
  });

  it("selectWord on 'b' after the two spaces selects just 'b' [3,4)", () => {
    const state = singleParagraph("a  b");
    const { layout, shaper } = pipeline(state);
    // "b" is the 4th rendered glyph: under break-spaces both interior spaces
    // render, so "b" lives at x ∈ [24, 32). Click at x=25 (just inside the
    // start of "b") → state offset 3. Under collapse "b" would sit at x=16
    // and this click would land in the (collapsed) space tail instead.
    const result = resolvePositionFromPixel(state, layout, shaper, 25, 0);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.blockId).toBe("p");
    expect(result.offset).toBe(3);
    const span = selectWord(state, result);
    expect(span.anchor.blockId).toBe("p");
    expect(span.focus.blockId).toBe("p");
    expect(span.anchor.offset).toBe(3);
    expect(span.focus.offset).toBe(4);
  });
});

describe("text-transform hit-test: display→state reverse remap (ß→SS)", () => {
  // A length-changing text-transform (uppercase ß→SS) renders DISPLAY text "ASS"
  // while state offsets stay pristine ("aß" = 2 code units). The leaf carries
  // `sourceDisplayLengths` [1, 2]. `findCharOffset` returns a DISPLAY offset into
  // the leaf's display text; hit-test must reverse-map it to a STATE offset so a
  // click inside the "SS" resolves to the source boundary before/after the ß
  // (offset 1 or 2), NEVER an interior offset that splits the ß.
  function transformedParagraph(textContent: string, textTransform: string): State {
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
          inlineContent: inlineContent([text(textContent, { textTransform })]),
        }),
      ],
    });
  }

  it("'aß' uppercase: click in 'a' → state offset 0; mid-'SS' → nearest source boundary (1 or 2); past end → 2", () => {
    // Display "ASS" (8px/char); leaf spans x ∈ [0, 24). sourceDisplayLengths [1,2].
    const state = transformedParagraph("aß", "uppercase");
    const { layout, shaper } = pipeline(state, 800);

    // Click in 'A' (x = 2, clearly left of the char midpoint at 4) → display
    // offset 0 → state offset 0.
    const inA = resolvePositionFromPixel(state, layout, shaper, 2, 0);
    expect(inA).not.toBeNull();
    if (inA === null) return;
    expect(inA.blockId).toBe("p");
    expect(inA.offset).toBe(0);

    // Click in the right half of the SECOND "S" (x = 22, char S2 spans [16, 24),
    // right of its midpoint 20) → DISPLAY offset 3. This is the interior of the
    // ß (state code unit 1 spans display [1, 3)). The raw display offset 3 must
    // be reverse-mapped to the nearest SOURCE boundary — state offset 2 (the
    // position AFTER the ß), NEVER the raw display 3 (which would be an offset
    // PAST the 2-code-unit source). It must be 1 OR 2, never an interior/3.
    const midSS = resolvePositionFromPixel(state, layout, shaper, 22, 0);
    expect(midSS).not.toBeNull();
    if (midSS === null) return;
    expect(midSS.blockId).toBe("p");
    expect([1, 2]).toContain(midSS.offset);

    // Click past the end (x = 30) → display offset 3 → state offset 2 (NOT the
    // raw display offset 3, which would split/overrun the 2-code-unit source).
    const pastEnd = resolvePositionFromPixel(state, layout, shaper, 30, 0);
    expect(pastEnd).not.toBeNull();
    if (pastEnd === null) return;
    expect(pastEnd.blockId).toBe("p");
    expect(pastEnd.offset).toBe(2);
  });

  it("'ab' uppercase (1:1, sourceDisplayLengths undefined): click in 'b' resolves normally to state offset 1", () => {
    // Display "AB" 1:1 — no sourceDisplayLengths, state offset === display offset.
    const state = transformedParagraph("ab", "uppercase");
    const { layout, shaper } = pipeline(state, 800);
    // Click in 'B' (x = 10, char "B" spans [8, 16), left of its midpoint 12) → 1.
    const inB = resolvePositionFromPixel(state, layout, shaper, 10, 0);
    expect(inB).not.toBeNull();
    if (inB === null) return;
    expect(inB.blockId).toBe("p");
    expect(inB.offset).toBe(1);
  });

  it("'aß' none (untransformed): click resolves normally, state offset === index", () => {
    const state = transformedParagraph("aß", "none");
    const { layout, shaper } = pipeline(state, 800);
    // "aß" renders as-is (2 code units). Click in 'ß' (x = 10, spans [8, 16),
    // left of its midpoint 12) → 1.
    const inSecond = resolvePositionFromPixel(state, layout, shaper, 10, 0);
    expect(inSecond).not.toBeNull();
    if (inSecond === null) return;
    expect(inSecond.blockId).toBe("p");
    expect(inSecond.offset).toBe(1);
  });
});

describe("collapsed-whitespace offset drift (double-click third word after double space)", () => {
  // Root-cause repro: under white-space:normal a double space collapses to one
  // rendered space, but cursor offsets are STATE offsets. A click at the
  // rendered start of word3 must resolve to its STATE offset, not drift down
  // by the collapse count. Then `selectWord` must select word3's full range.
  const SENTENCE = "dsajidosja idoajs  dsajiodj saoidj";
  // State offsets: dsajidosja=[0,10), space@10, idoajs=[11,17), space@17,
  //   space@18 (collapsed away in render), dsajiodj=[19,27), space@27, saoidj=[28,34).
  // Rendered (collapsed) string: "dsajidosja idoajs dsajiodj saoidj".
  // Rendered start of word3 "dsajiodj": 10 + 1 + 6 + 1 = 18 rendered chars → x = 18*8 = 144.

  it("click at rendered start of word3 resolves to STATE offset 19", () => {
    // Pinned to white-space:normal: this fixture's rendered geometry
    // (x=144 for word3) is the COLLAPSE rendering. The editor body default
    // is now break-spaces (preserves the double space), so collapse-dependent
    // assertions must opt back into `normal`.
    const state = singleParagraph(SENTENCE, "normal");
    const { layout, shaper } = pipeline(state);
    // Click slightly inside word3's first glyph (x≈146) on the single line.
    const result = resolvePositionFromPixel(state, layout, shaper, 146, 0);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.blockId).toBe("p");
    expect(result.offset).toBe(19);
  });

  it("selectWord at the resolved offset selects word3 [19, 27)", () => {
    // Pinned to white-space:normal (collapse-dependent geometry; see above).
    const state = singleParagraph(SENTENCE, "normal");
    const { layout, shaper } = pipeline(state);
    const result = resolvePositionFromPixel(state, layout, shaper, 146, 0);
    expect(result).not.toBeNull();
    if (result === null) return;
    const span = selectWord(state, result);
    expect(span.anchor.blockId).toBe("p");
    expect(span.focus.blockId).toBe("p");
    expect(span.anchor.offset).toBe(19);
    expect(span.focus.offset).toBe(27);
  });

  it("single-space sentence: word offsets are unaffected (no regression)", () => {
    // "dsajidosja idoajs dsajiodj" with SINGLE spaces. word3 starts at state
    // offset 10+1+6+1 = 18 (no collapse), rendered x = 18*8 = 144.
    const single = "dsajidosja idoajs dsajiodj saoidj";
    const state = singleParagraph(single);
    const { layout, shaper } = pipeline(state);
    const result = resolvePositionFromPixel(state, layout, shaper, 146, 0);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.offset).toBe(18);
    const span = selectWord(state, result);
    expect(span.anchor.offset).toBe(18);
    expect(span.focus.offset).toBe(26);
  });
});

describe("#308 — click at x=0 of a line with leading collapsed whitespace lands at offset 0", () => {
  // Behavior-level regression: a paragraph "   hello" (3 leading spaces + word)
  // under white-space:normal. Before the fix the IFC dropped the leading
  // spaces from the line's offset accumulator (`line.inlineOffsetEnd = 5`
  // instead of 8) — a click at x=0 of the line landed past the leading
  // whitespace at offset 0 only because of accidental clamping, NOT because
  // the layout-vs-state offset accounting was correct. Worse, the all-
  // whitespace "   " case clamped to a strut with `inlineOffsetEnd = 0`, so
  // a click on it could yield offset 0 only — there was no way to reach
  // offsets 1, 2, 3 (the user pressing ArrowRight 3 times after typing "   "
  // would each fall back to clamped offset 0). This test exercises the line
  // OWNERSHIP contract: after the fix, the line owns ALL source chars, so
  // ArrowRight / hit-test / cursor APIs see the full state offset range.
  it("'   hello' under normal: click past end reaches offset 8 (was 5 pre-fix); click at x=0 lands at the rendered glyph (offset 3)", () => {
    const state = singleParagraph("   hello", "normal");
    const { layout, shaper } = pipeline(state);

    // Click past the end: lands at offset 8 — the LINE OWNS all 8 source
    // chars. Pre-fix, the leading 3 spaces were dropped from the offset
    // accumulator so `line.inlineOffsetEnd` was 5 and clicks past the end
    // clamped to offset 5 (unreachable: offsets 6, 7, 8). The PRIMARY #308
    // contract is this: cursor APIs can REACH every source-char offset.
    const rEnd = resolvePositionFromPixel(state, layout, shaper, 100, 0);
    expect(rEnd).not.toBeNull();
    if (rEnd === null) return;
    expect(rEnd.blockId).toBe("p");
    expect(rEnd.offset).toBe(8);

    // Click at x=0: the leading-space leaves all stack at x=0 with width=0,
    // and the "hello" leaf also starts at x=0 (collapsed leading spaces
    // contribute zero advance). Hit-test picks the "hello" leaf for a
    // click that lands within its x-range — offset 3 (start of the
    // rendered glyph), matching Google Docs / Word UX where the caret lands
    // at the visible character, not inside collapsed whitespace. The fact
    // that an offset is REACHABLE (offsets 0, 1, 2 are walkable via
    // ArrowLeft from offset 3) is the new contract; landing AT the rendered
    // glyph for a click is the expected UX (collapsed whitespace is
    // visually 0-width, so a click at x=0 picks the first visible char).
    const r0 = resolvePositionFromPixel(state, layout, shaper, 0, 0);
    expect(r0).not.toBeNull();
    if (r0 === null) return;
    expect(r0.blockId).toBe("p");
    expect(r0.offset).toBe(3);
  });

  it("'   ' (all-whitespace) under normal: click past end clamps to offset 3 (was 0 strut bug)", () => {
    // All-whitespace under collapsing mode: the line is contentless (every
    // leaf has width=0) but owns 3 state chars. Before the fix the line was a
    // strut with inlineOffsetEnd=0, so any cursor advance past offset 0
    // crashed back to 0. After the fix, the line.inlineOffsetEnd is 3 and
    // cursor APIs can reach the end offset.
    //
    // (Click at x=0 with stacked zero-width leaves is ambiguous — the
    // hit-test's "last leaf wins at tie" picks an interior leaf, which is
    // fine behavior; what matters is the line OWNS all 3 source chars so
    // ArrowRight/ArrowLeft can WALK through them and END is reachable.)
    const state = singleParagraph("   ", "normal");
    const { layout, shaper } = pipeline(state);

    // Click well past end of line — should clamp to the last position
    // (offset 3), not offset 0 (the strut-line bug pre-fix).
    const rEnd = resolvePositionFromPixel(state, layout, shaper, 100, 0);
    expect(rEnd).not.toBeNull();
    if (rEnd === null) return;
    expect(rEnd.blockId).toBe("p");
    expect(rEnd.offset).toBe(3);

    // Defensive: a click on the line yields a valid offset in [0, 3].
    const r0 = resolvePositionFromPixel(state, layout, shaper, 0, 0);
    expect(r0).not.toBeNull();
    if (r0 === null) return;
    expect(r0.offset).toBeGreaterThanOrEqual(0);
    expect(r0.offset).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// P3.5b — vertical-mode BODY hit-test (click → offset)
// ---------------------------------------------------------------------------
//
// The BODY line/leaf pick in `resolvePositionFromPixel` is generalized to the
// active line's axis map (P3.5b): the LINE is picked by the click's BLOCK-axis
// component (physical X for the vertical modes — blocks stack across the page),
// the LEAF by the click's INLINE-axis component (physical Y — inline runs DOWN
// the page). For `vertical-rl` blocks stack right→left (the block-axis mirror),
// so document order is DESCENDING physical-X; for `vertical-lr` ascending.
//
// Geometry mirrors `vertical-cursor-position.test.ts` (and `layout/
// vertical-geometry.test.ts`): an 8px-char mock shaper, a 20px-inline narrow
// page so "aa bb cc" wraps into three lines, page block-size 1000 (so the v-rl
// block-axis mirror lands line 0 at the far/right physical X). Probed concrete
// coords:
//   vertical-rl: line0 absX=984, line1 absX=968, line2 absX=952 (absY=0 each).
//   vertical-lr: line0 absX=0,  line1 absX=16,  line2 absX=32  (absY=0 each).
//   each line inlineSize=20, blockSize=16; leaves "aa"/"bb"/"cc" w=16 h=16.
// State offsets ("aa bb cc"): line0 owns "aa" [0,2] (end 3 incl. the space),
// line1 owns "bb" [3,5] (end 6), line2 owns "cc" [6,8].
//
// These click coordinates are RED against the OLD h-tb-path code, which picked
// the LINE by a physical-Y band (`y < absoluteY + blockSize`) and the LEAF by a
// physical-X coord (`x < leaf.absoluteX`). With every line at absY=0 the old
// line-pick ALWAYS chose line 0 (y < 16) regardless of the click's X, and the
// old leaf-pick measured `x − leaf.absoluteX` against the wrong axis — so the
// resolved offset landed in the wrong line at the wrong character.

const VCHAR_W = 8;
const VLINE_CROSS = 16;

const verticalPageConfig: PageConfig = {
  pageInlineSize: 20,
  pageBlockSize: 1000,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 20,
};

function verticalDoc(wm: WritingMode): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        attrs: { writingMode: wm },
        firstChildId: "p",
        lastChildId: "p",
      }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        attrs: { writingMode: wm },
        inlineContent: inlineContent([text("aa bb cc")]),
      }),
    ],
  });
}

function verticalPipeline(state: State): { layout: LayoutBox; shaper: TextShaper } {
  const root = render(state, createDefaultComponentRegistry(), createDefaultAttrRegistry()).root;
  const shaper = createMockShaper(VCHAR_W, VLINE_CROSS);
  const layout = positionTreeForTest(
    layoutTree(root, verticalPageConfig.pageInlineSize, shaper, verticalPageConfig),
  );
  return { layout, shaper };
}

function vLines(layout: LayoutBox): ReturnType<typeof getLineIndex>["all"] {
  return getLineIndex(layout).byBlock.get("p" as BlockId) ?? [];
}

describe("P3.5b vertical hit-test — vertical-rl (blocks stack right→left)", () => {
  const state = verticalDoc("vertical-rl");
  const { layout, shaper } = verticalPipeline(state);
  const lines = vLines(layout);

  it("layout sanity: three lines, descending physical X, absY=0", () => {
    expect(lines.length).toBe(3);
    expect(nth(lines, 0, "line").absoluteX).toBeGreaterThan(nth(lines, 1, "line").absoluteX);
    expect(nth(lines, 1, "line").absoluteX).toBeGreaterThan(nth(lines, 2, "line").absoluteX);
    expect(nth(lines, 0, "line").absoluteY).toBe(0);
  });

  it("click in line 1's block band, mid-'b' → offset 4 (RED: old code → line 0 / offset 0)", () => {
    // line1 block-X band [968, 984]; click X=975 falls inside it. Inline Y=4 is
    // inside "bb"'s glyph 0 vs 1 boundary → display offset 1 → state offset
    // 3 ("bb" logStart) + 1 = 4 ("b|b"). Old code: line-pick by Y picked line0
    // (4 < 16); leaf-pick by X measured 975 − 984 = −9 → offset 0 in line0.
    const r = resolvePositionFromPixel(state, layout, shaper, 975, 4);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.blockId).toBe("p");
    expect(r.offset).toBe(4);
  });

  it("click in line 2's block band, line-start inline → offset 6 (start of 'cc')", () => {
    // line2 block-X band [952, 968]; click X=958. Inline Y=1 → display offset 0
    // ("c"'s glyph midpoint is 4) → state offset 6 ("cc" logStart). Old code →
    // line0 / offset 0.
    const r = resolvePositionFromPixel(state, layout, shaper, 958, 1);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.blockId).toBe("p");
    expect(r.offset).toBe(6);

    // Sub-pixel boundary snap (mode-aware facing-edge). The line1/line2 shared
    // boundary is at block-X 968 (line1 band [968,984], line2 band [952,968]).
    // A click at X=968.2 lands just INSIDE line1 but within 0.5px of the
    // boundary → it must snap FORWARD to line2 (offset 6, start of "cc"). RED
    // against pre-fix code, which compared to line2's LOW edge (952) — 16.2px
    // away, so the snap never fired and it resolved to line1 (offset 3, "bb").
    const snap = resolvePositionFromPixel(state, layout, shaper, 968.2, 1);
    expect(snap?.blockId).toBe("p");
    expect(snap?.offset).toBe(6);
  });

  it("pixel→offset→pixel round-trips offset 7 (mid 'cc') against resolvePixelPosition", () => {
    const pos = createPosition("p" as BlockId, 7);
    const px = resolvePixelPosition(state, pos, layout, shaper);
    expect(px).not.toBeNull();
    if (px === null) return;
    // px.x = caret INLINE coord (physical Y) = 8; px.y = BLOCK coord = line2 X.
    expect(px.x).toBe(8);
    expect(px.y).toBe(nth(lines, 2, "line").absoluteX);
    // Click that pixel back: block component = physical X = px.y, inline = px.x.
    const r = resolvePositionFromPixel(state, layout, shaper, px.y, px.x);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.blockId).toBe("p");
    expect(r.offset).toBe(7);
  });

  it("edge: click before the first line (block-X past content start) → line 0 start (offset 0)", () => {
    // X=5000 is beyond line0's far edge in flow; clamps to the document-first
    // (visual-first) line. Inline Y=0 → offset 0.
    const r = resolvePositionFromPixel(state, layout, shaper, 5000, 0);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.blockId).toBe("p");
    expect(r.offset).toBe(0);
  });

  it("edge: click after the last line (block-X past content end) → last line (offset 6 start of 'cc')", () => {
    // X=0 is past line2's near edge in flow; clamps to the document-last line2.
    // Inline Y=1 → offset 6.
    const r = resolvePositionFromPixel(state, layout, shaper, 0, 1);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.blockId).toBe("p");
    expect(r.offset).toBe(6);
  });

  it("edge: before-first-leaf (inline-Y < 0) → line start; after-last-leaf (inline-Y past end) → line end", () => {
    // Click in line0's block band (X=990) at inline Y below the leaf → offset 0
    // (line0 inlineOffsetStart); at inline Y past the leaf → line0's
    // inlineOffsetEnd (the trailing-space-inclusive content end, 3).
    const before = resolvePositionFromPixel(state, layout, shaper, 990, -5);
    expect(before?.blockId).toBe("p");
    expect(before?.offset).toBe(nth(lines, 0, "line").line.inlineOffsetStart);
    expect(before?.offset).toBe(0);
    const after = resolvePositionFromPixel(state, layout, shaper, 990, 1000);
    expect(after?.blockId).toBe("p");
    expect(after?.offset).toBe(nth(lines, 0, "line").line.inlineOffsetEnd);
  });
});

describe("P3.5b vertical hit-test — vertical-lr (blocks stack left→right)", () => {
  const state = verticalDoc("vertical-lr");
  const { layout, shaper } = verticalPipeline(state);
  const lines = vLines(layout);

  it("layout sanity: three lines, ascending physical X, absY=0", () => {
    expect(lines.length).toBe(3);
    expect(nth(lines, 0, "line").absoluteX).toBeLessThan(nth(lines, 1, "line").absoluteX);
    expect(nth(lines, 1, "line").absoluteX).toBeLessThan(nth(lines, 2, "line").absoluteX);
    expect(nth(lines, 0, "line").absoluteY).toBe(0);
  });

  it("click in line 1's block band, mid-'b' → offset 4 (RED: old code → line 0 / offset 2)", () => {
    // line1 block-X band [16, 32]; click X=20. Inline Y=4 → state offset 4.
    // Old code: line-pick by Y → line0 (4 < 16); leaf-pick by X measured the
    // line0 leaf "aa" at 20 − 0 = 20 ≥ lastMidpoint → offset 2 in line0.
    const r = resolvePositionFromPixel(state, layout, shaper, 20, 4);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.blockId).toBe("p");
    expect(r.offset).toBe(4);
  });

  it("pixel→offset→pixel round-trips offset 7 (mid 'cc') against resolvePixelPosition", () => {
    const pos = createPosition("p" as BlockId, 7);
    const px = resolvePixelPosition(state, pos, layout, shaper);
    expect(px).not.toBeNull();
    if (px === null) return;
    expect(px.x).toBe(8);
    expect(px.y).toBe(nth(lines, 2, "line").absoluteX); // = 32
    const r = resolvePositionFromPixel(state, layout, shaper, px.y, px.x);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.blockId).toBe("p");
    expect(r.offset).toBe(7);
  });

  it("edge: click after the last line (block-X past content end) → last line", () => {
    // X=5000 is past line2's far edge; clamps to the document-last line2.
    const r = resolvePositionFromPixel(state, layout, shaper, 5000, 1);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.blockId).toBe("p");
    expect(r.offset).toBe(6);
  });

  it("edge: click before the first line (block-X negative) → first line start (offset 0)", () => {
    const r = resolvePositionFromPixel(state, layout, shaper, -5, 0);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.blockId).toBe("p");
    expect(r.offset).toBe(0);
  });
});

describe("P3.7 vertical bidi hit-test — RTL run on the inline (physical-Y) axis", () => {
  // "abאב": Latin "ab" (lvl0, state [0,2], inline-Y [0,16]) + Hebrew "אב"
  // (lvl1, state [2,4], inline-Y [16,32]). Paragraph base LTR; Hebrew CONTENT
  // gives the level-1 run. WIDE page → one line. A click's BLOCK component is
  // physical X (the line band), its INLINE component is physical Y.
  //
  // By-hand click→offset: in the RTL Hebrew run [16,32] the visual-NEAR (low-Y)
  // edge is the logical-LAST char and the visual-FAR (high-Y) edge is the
  // logical-FIRST — the exact INVERSE of an LTR run. So:
  //   inline-Y 1  → off 0 (start of "ab")
  //   inline-Y 9  → off 1 (mid "ab")
  //   inline-Y 17 → off 4 (just inside Hebrew at its near edge → logical LAST)
  //   inline-Y 25 → off 3 (mid Hebrew)
  //   inline-Y 31 → off 2 (Hebrew far edge → logical FIRST)
  // An LTR-only within-leaf assumption would SWAP 17↔31 (give 2 and 4). The
  // inline axis is physical-Y for BOTH vertical modes, so the offsets are
  // identical across them — only the block band (physical X) differs.
  const wideBidiPage: PageConfig = {
    pageInlineSize: 800,
    pageBlockSize: 1000,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 20,
  };

  function bidiDoc(wm: WritingMode): State {
    return buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", attrs: { writingMode: wm }, firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", attrs: { writingMode: wm }, inlineContent: inlineContent([text("abאב")]) }),
      ],
    });
  }

  function bidiPipeline(state: State): { layout: LayoutBox; shaper: TextShaper } {
    const root = render(state, createDefaultComponentRegistry(), createDefaultAttrRegistry()).root;
    const shaper = createMockShaper(VCHAR_W, VLINE_CROSS);
    const layout = positionTreeForTest(
      layoutTree(root, wideBidiPage.pageInlineSize, shaper, wideBidiPage),
    );
    return { layout, shaper };
  }

  for (const wm of ["vertical-lr", "vertical-rl"] as const) {
    it(`${wm}: click→offset inverts correctly inside the RTL run on inline-Y`, () => {
      const state = bidiDoc(wm);
      const { layout, shaper } = bidiPipeline(state);
      const lines = vLines(layout);
      expect(lines.length).toBe(1);
      const blockX = nth(lines, 0, "line").absoluteX + 1; // inside the line's block band.

      const off = (inlineY: number): number | undefined =>
        resolvePositionFromPixel(state, layout, shaper, blockX, inlineY)?.offset;

      expect(off(1)).toBe(0);
      expect(off(9)).toBe(1);
      // RTL inversion on the inline-Y axis (the discriminating pair):
      expect(off(17)).toBe(4); // near edge → logical LAST
      expect(off(25)).toBe(3);
      expect(off(31)).toBe(2); // far edge → logical FIRST
    });
  }
});

describe("resolvePositionFromPixel — table cell awareness (#P8.S4b)", () => {
  // doc > table[cols 0.5/0.5] > row > (cellA > pA"AAAA") (cellB > pB"BBBB")
  function tableState(): State {
    return buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "tbl", lastChildId: "tbl" }),
        buildBlock({ id: "tbl", type: "table", parentId: "doc", attrs: { columnWidths: [0.5, 0.5] }, firstChildId: "row", lastChildId: "row" }),
        buildBlock({ id: "row", type: "table-row", parentId: "tbl", firstChildId: "cA", lastChildId: "cB" }),
        buildBlock({ id: "cA", type: "table-cell", parentId: "row", nextSiblingId: "cB", firstChildId: "pA", lastChildId: "pA" }),
        buildBlock({ id: "cB", type: "table-cell", parentId: "row", prevSiblingId: "cA", firstChildId: "pB", lastChildId: "pB" }),
        buildBlock({ id: "pA", type: "paragraph", parentId: "cA", inlineContent: inlineContent([text("AAAA")]) }),
        buildBlock({ id: "pB", type: "paragraph", parentId: "cB", inlineContent: inlineContent([text("BBBB")]) }),
      ],
    });
  }

  it("a click in column B resolves into column B (was: column A — flat band-pick is column-unaware)", () => {
    const state = tableState();
    const { layout, shaper } = pipeline(state, 400); // cols [200, 200]
    // Sanity: a click in column A lands in pA.
    const inA = resolvePositionFromPixel(state, layout, shaper, 8, 4);
    expect(inA?.blockId).toBe("pA");
    // The fix: a click in column B's region lands in pB (NOT pA, NOT end-of-A).
    const inB = resolvePositionFromPixel(state, layout, shaper, 230, 4);
    expect(inB?.blockId).toBe("pB");
    // ...and the offset is measured WITHIN cell B: a click past "BBBB" clamps to
    // the END of pB (offset 4). On the old column-unaware pick this resolved into
    // pA (the click's x fell past cell A's content → clamped to end of pA).
    const inBEnd = resolvePositionFromPixel(state, layout, shaper, 398, 4);
    expect(inBEnd?.blockId).toBe("pB");
    expect(inBEnd?.offset).toBe(4);
  });
});
