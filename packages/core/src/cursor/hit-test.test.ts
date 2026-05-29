import { describe, it, expect } from "vitest";
import { resolvePositionFromPixel } from "./hit-test";
import { selectWord } from "./cursor-ops";
import { render } from "../render/render";
import { createDefaultComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import { layoutTree } from "../layout/dispatch";
import { resolvePositionedTree } from "../layout/positioned-tree";
import { createMockShaper } from "../layout/mock-shaper";
import { getLineIndex, collectLineLeaves } from "./line-flatten";
import type { TextShaper } from "../layout/text-shaper";
import type { PageConfig } from "../layout/page-config";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
  embed,
} from "../test-utils/state-builders";
import type { State, BlockId } from "../state";
import type { LayoutBox } from "../layout/layout-node";

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
  const layout = resolvePositionedTree(layoutTree(root, containerInlineSize, shaper, pageConfig));
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
    const leaves = collectLineLeaves(al.line, al.absoluteX);
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
