import { describe, it, expect } from "vitest";
import { resolvePixelPosition } from "./cursor-position";
import { render } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { layoutTree } from "../layout/dispatch";
import { positionTreeForTest } from "../test-utils/position-tree";
import { createMockShaper } from "@taleweaver/core";
import type { TextShaper } from "@taleweaver/core";
import type { PageConfig } from "../layout/page-config";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
  embed,
} from "@taleweaver/core";
import { createPosition } from "@taleweaver/core";
import type { BlockId, State } from "@taleweaver/core";
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
  const shaper = createMockShaper(8, 16); // 8px char width, 16px line height
  // Bridge the (possibly virtual) layout result to a positioned tree; the
  // cursor APIs operate on positioned boxes (Phase 3 Task 1).
  const layout = positionTreeForTest(layoutTree(root, containerInlineSize, shaper, pageConfig));
  return { layout, shaper };
}

/**
 * Build a single-paragraph document with the given text.
 *
 * `whiteSpace` (optional): when provided, pins the paragraph's
 * `white-space` (via the `whiteSpace` attr interpreter) instead of
 * inheriting the document root's default (`break-spaces`). Collapse-dependent
 * fixtures pass `"normal"` so their pixel/offset assertions stay valid.
 */
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

describe("resolvePixelPosition (new)", () => {
  it("returns origin for offset 0 of a single paragraph", () => {
    const state = singleParagraph("hello");
    const { layout, shaper } = pipeline(state);
    const pos = createPosition("p" as BlockId, 0);

    const result = resolvePixelPosition(state, pos, layout, shaper);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.pageIndex).toBe(0);
  });

  it("returns correct x for mid-text of a single paragraph", () => {
    const state = singleParagraph("hello");
    const { layout, shaper } = pipeline(state);
    const pos = createPosition("p" as BlockId, 3); // after "hel"

    const result = resolvePixelPosition(state, pos, layout, shaper);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.x).toBe(24); // 3 chars * 8px
    expect(result.y).toBe(0);
    expect(result.height).toBe(16);
  });

  it("places cursor past trailing space (user-reported: cursor 'stuck' after space)", () => {
    // After typing "abc" + " ", offset is 4. The cursor must render at the
    // x position AFTER the trailing space (32px for "abc "), not at the
    // position of the "c" (24px). Bug symptom: user types space, cursor
    // doesn't visually move until they type another character.
    const state = singleParagraph("abc ");
    const { layout, shaper } = pipeline(state, 800);
    const pos = createPosition("p" as BlockId, 4); // after the space
    const result = resolvePixelPosition(state, pos, layout, shaper);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.x).toBe(32); // 4 chars × 8px — cursor sits past the trailing space
  });

  it("places cursor past N trailing spaces (regression for multi-space tokenization)", () => {
    // Pressing space twice must advance the cursor by 2 char widths.
    // Reviewer flagged: the single-space fix originally emitted one
    // trailing-space token regardless of N, so offset 5 of "abc  "
    // clamped to x=32 instead of x=40.
    const state = singleParagraph("abc  ");
    const { layout, shaper } = pipeline(state, 800);
    const pos = createPosition("p" as BlockId, 5); // after both spaces
    const result = resolvePixelPosition(state, pos, layout, shaper);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.x).toBe(40); // 5 chars × 8px
  });

  it("#308: caret at offsets inside LEADING whitespace under normal lands at x=0", () => {
    // "   hello" under white-space: normal. Today (before fix), the leading
    // spaces are dropped by the IFC's collapsing-mode skip — `line.inlineOffsetEnd`
    // covers only [3, 8) and a caret at offset 0, 1, or 2 falls past the line
    // start mapping and clamps to x=0 by accident (or wraps oddly). With
    // the fix, offsets 0..2 land at x=0 BY CONSTRUCTION: each leading-space
    // leaf has width=0 anchored at x=0, and the cursor-position leaf-right-edge
    // clamp pins resolvedX to leaf.absoluteX (=0).
    const state = singleParagraph("   hello", "normal");
    const { layout, shaper } = pipeline(state, 800);
    for (const off of [0, 1, 2]) {
      const pos = createPosition("p" as BlockId, off);
      const r = resolvePixelPosition(state, pos, layout, shaper);
      expect(r).not.toBeNull();
      if (r === null) return;
      expect(r.x).toBe(0); // leading-space caret pinned at line start
    }
    // Offset 3: start of "h" — first non-whitespace glyph at x=0 (no glyph
    // width yet rendered).
    const r3 = resolvePixelPosition(state, createPosition("p" as BlockId, 3), layout, shaper);
    expect(r3?.x).toBe(0);
    // Offset 4: after "h" — x=8.
    const r4 = resolvePixelPosition(state, createPosition("p" as BlockId, 4), layout, shaper);
    expect(r4?.x).toBe(8);
    // Offset 8: end of "hello" — x=40.
    const r8 = resolvePixelPosition(state, createPosition("p" as BlockId, 8), layout, shaper);
    expect(r8?.x).toBe(40);
  });

  it("#308: caret at every offset of an all-whitespace paragraph under normal lands at x=0", () => {
    // "   " — three spaces, no word. Under normal the line collapses to a
    // contentless line that nevertheless owns 3 source chars. Caret at 0, 1,
    // 2, 3 all land at x=0 (no rendered glyph width).
    const state = singleParagraph("   ", "normal");
    const { layout, shaper } = pipeline(state, 800);
    for (const off of [0, 1, 2, 3]) {
      const pos = createPosition("p" as BlockId, off);
      const r = resolvePixelPosition(state, pos, layout, shaper);
      expect(r).not.toBeNull();
      if (r === null) continue;
      expect(r.x).toBe(0);
    }
  });

  it("offset inside a collapsed inter-word whitespace tail clamps to the run's right edge", () => {
    // "dsajidosja idoajs  dsajiodj" — double space between word2 and word3.
    // State offsets: dsajidosja=[0,10), space@10, idoajs=[11,17), space@17,
    //   space@18 (collapsed away), dsajiodj=[19,27).
    // Runs (single wide line): "dsajidosja " (offsetLength 11, rendered 11ch),
    //   "idoajs " (offsetLength 8 — owns the 2 source spaces, rendered 7ch),
    //   "dsajiodj" (offsetLength 8). Run2 spans x[88,144); run3 starts at 144.
    //
    // Pinned to white-space:normal: this fixture's run geometry (the
    // collapsed double space, run2 absorbing the source spaces, x=144 clamp)
    // is the COLLAPSE rendering. The editor body default is now break-spaces
    // (preserves both spaces), so this collapse-dependent fixture opts back
    // into `normal`.
    const state = singleParagraph("dsajidosja idoajs  dsajiodj", "normal");
    const { layout, shaper } = pipeline(state, 800);

    // offset 18: the collapsed-away second space. Lives in run2's tail; the
    // explicit clamp pins X to run2's rendered right edge = 88 + 7*8 = 144.
    const pos18 = createPosition("p" as BlockId, 18);
    const r18 = resolvePixelPosition(state, pos18, layout, shaper);
    expect(r18).not.toBeNull();
    if (r18 === null) return;
    expect(r18.x).toBe(144);

    // offset 19: start of "dsajiodj". Left edge of run3 = 144 (adjacent).
    const pos19 = createPosition("p" as BlockId, 19);
    const r19 = resolvePixelPosition(state, pos19, layout, shaper);
    expect(r19).not.toBeNull();
    if (r19 === null) return;
    expect(r19.x).toBe(144);

    // offset 27: end of "dsajiodj" = 144 + 8*8 = 208.
    const pos27 = createPosition("p" as BlockId, 27);
    const r27 = resolvePixelPosition(state, pos27, layout, shaper);
    expect(r27).not.toBeNull();
    if (r27 === null) return;
    expect(r27.x).toBe(208);
  });

  it("wraps to line 2 when offset falls past line 1's break", () => {
    // 200 chars at 8px/char in a 800px container → ~100 chars/line.
    // Use spaces every 10 chars so the mock shaper can soft-break.
    let s = "";
    for (let i = 0; i < 20; i++) s += "abcdefghi "; // 200 chars including trailing space
    const state = singleParagraph(s);
    const { layout, shaper } = pipeline(state, 800);

    // Offset 100: at or after the first soft-wrap → line 2.
    const pos = createPosition("p" as BlockId, 100);
    const result = resolvePixelPosition(state, pos, layout, shaper);
    expect(result).not.toBeNull();
    if (result === null) return;
    // Line 2 y is 16 (line 1's height). x near 0 (start of line).
    expect(result.y).toBe(16);
    expect(result.x).toBeLessThanOrEqual(8); // start of line 2, possibly minor offset
  });

  it("honors caretAffinity 'before' at a soft-wrap boundary — stays at line 1's end (#474 B2)", () => {
    // Same 200-char / ~100-per-line fixture; offset 100 is the wrap boundary
    // (line 1's end AND line 2's start). Without an affinity the caret jumps to
    // line 2's start (default, above). With affinity "before" it must stay at
    // line 1's END — otherwise the end-of-a-wrapped-line caret is unreachable.
    let s = "";
    for (let i = 0; i < 20; i++) s += "abcdefghi ";
    const state = singleParagraph(s);
    const { layout, shaper } = pipeline(state, 800);
    const pos = createPosition("p" as BlockId, 100);

    // "after" (and default) → line 2 start.
    const after = resolvePixelPosition(state, pos, layout, shaper, undefined, "after");
    expect(after).not.toBeNull();
    if (after === null) return;
    expect(after.y).toBe(16);
    expect(after.x).toBeLessThanOrEqual(8);

    // "before" → line 1's end: same y as line 1 (0), x far from the line start.
    const before = resolvePixelPosition(state, pos, layout, shaper, undefined, "before");
    expect(before).not.toBeNull();
    if (before === null) return;
    expect(before.y).toBe(0);
    expect(before.x).toBeGreaterThan(8);
  });

  it("returns y past first paragraph for offset 0 of a second paragraph", () => {
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
          inlineContent: inlineContent([text("hello")]),
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
    const pos = createPosition("p2" as BlockId, 0);

    const result = resolvePixelPosition(state, pos, layout, shaper);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.x).toBe(0);
    expect(result.y).toBeGreaterThan(0); // must be below p1
  });

  it("returns pageIndex === 1 for a position in the 4th paragraph with pagination", () => {
    // pageBlockSize 60, blockStart/End margin 10 → content height ~40px.
    // Each paragraph is one line of 16px tall (plus marginBlockEnd 0.5em = 8px).
    // So ~2 paragraphs fit per page.
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

    // Resolve a position in paragraph 4. Should be on page index >= 1.
    const pos = createPosition("p4" as BlockId, 0);
    const result = resolvePixelPosition(state, pos, layout, shaper);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.pageIndex).toBeGreaterThanOrEqual(1);
  });

  it("returns null for an unknown blockId", () => {
    // Legacy behavior: returned a sentinel object. New behavior: return null
    // (cleaner contract for unknown blocks; consumer can fall back).
    const state = singleParagraph("hello");
    const { layout, shaper } = pipeline(state);
    const pos = createPosition("missing" as BlockId, 0);

    const result = resolvePixelPosition(state, pos, layout, shaper);
    expect(result).toBeNull();
  });

  it("returns baseline coords for offset 0 of an empty block", () => {
    // Empty paragraph has no text-runs in layout. Should still resolve.
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
    const pos = createPosition("p" as BlockId, 0);

    const result = resolvePixelPosition(state, pos, layout, shaper);
    expect(result).not.toBeNull();
    if (result === null) return;
    // Empty block sits at the document origin (y=0, x=0). pageIndex 0.
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.pageIndex).toBe(0);
  });

  it("returns coords at the embed boundary for a position on an embed item", () => {
    // Inline content: text("ab"), embed, text("cd"). Block offsets:
    //   0..2 -> "ab", 2 -> start of embed, 3 -> start of "cd", 3..5 -> "cd".
    // The embed currently has no own layout box (default display: inline,
    // no text). The expected behavior at the embed boundary is the end of
    // the preceding "ab" run / start of the following "cd" run.
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

    // offset 2: position at the embed slot (between "ab" and the embed's
    // visual position). With "ab" being 16px wide, this lands at x=16.
    const posEmbed = createPosition("p" as BlockId, 2);
    const resultEmbed = resolvePixelPosition(state, posEmbed, layout, shaper);
    expect(resultEmbed).not.toBeNull();
    if (resultEmbed === null) return;
    expect(resultEmbed.x).toBe(16); // end of "ab"
    expect(resultEmbed.y).toBe(0);

    // offset 3: start of "cd" run. "cd" starts after the embed at x=16.
    const posCd = createPosition("p" as BlockId, 3);
    const resultCd = resolvePixelPosition(state, posCd, layout, shaper);
    expect(resultCd).not.toBeNull();
    if (resultCd === null) return;
    expect(resultCd.x).toBe(16); // start of "cd"
    expect(resultCd.y).toBe(0);

    // offset 4: 1 char into "cd".
    const posMid = createPosition("p" as BlockId, 4);
    const resultMid = resolvePixelPosition(state, posMid, layout, shaper);
    expect(resultMid).not.toBeNull();
    if (resultMid === null) return;
    expect(resultMid.x).toBe(24); // 16 + 8
    expect(resultMid.y).toBe(0);
  });

  /**
   * Build a single-paragraph document whose text run carries a `textTransform`
   * inline attr. The inline cascade computes the transform onto the run's
   * `ComputedStyle.textTransform`, so the IFC produces a DISPLAY string (e.g.
   * "aß" + uppercase → "ASS") and, when length-changing, a
   * `sourceDisplayLengths` map on the leaf box.
   */
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

  it("remaps within-leaf STATE offset to display index for a length-changing transform (ß→SS)", () => {
    // "aß" under text-transform: uppercase renders the DISPLAY string "ASS"
    // (ß→SS, length-changing). The leaf carries sourceDisplayLengths [1, 2].
    // The caret must measure the DISPLAY prefix, not slice the display string
    // by the raw STATE offset.
    const state = transformedParagraph("aß", "uppercase");
    const { layout, shaper } = pipeline(state, 800);

    // state offset 0 → leaf left edge (no glyph rendered).
    const r0 = resolvePixelPosition(state, createPosition("p" as BlockId, 0), layout, shaper);
    expect(r0?.x).toBe(0);

    // state offset 1 (between "a" and "ß") → after "A" → +8.
    const r1 = resolvePixelPosition(state, createPosition("p" as BlockId, 1), layout, shaper);
    expect(r1?.x).toBe(8);

    // state offset 2 (after "ß") → after the WHOLE "SS" → +24 (NOT +16, which a
    // raw `text.slice(0, 2)` = "AS" would give).
    const r2 = resolvePixelPosition(state, createPosition("p" as BlockId, 2), layout, shaper);
    expect(r2?.x).toBe(24);
  });

  it("leaves the caret unchanged for a 1:1 transform (uppercase, no length change)", () => {
    // "ab" uppercased → "AB", a 1:1 transform — sourceDisplayLengths is
    // undefined, so the state offset IS the display index.
    const state = transformedParagraph("ab", "uppercase");
    const { layout, shaper } = pipeline(state, 800);
    const r1 = resolvePixelPosition(state, createPosition("p" as BlockId, 1), layout, shaper);
    expect(r1?.x).toBe(8); // after "A"
    const r2 = resolvePixelPosition(state, createPosition("p" as BlockId, 2), layout, shaper);
    expect(r2?.x).toBe(16); // after "AB"
  });

  it("leaves the caret unchanged for an untransformed leaf (text-transform: none)", () => {
    const state = transformedParagraph("aß", "none");
    const { layout, shaper } = pipeline(state, 800);
    // No transform — "aß" renders as-is (2 code units), state offset === index.
    const r1 = resolvePixelPosition(state, createPosition("p" as BlockId, 1), layout, shaper);
    expect(r1?.x).toBe(8); // after "a"
    const r2 = resolvePixelPosition(state, createPosition("p" as BlockId, 2), layout, shaper);
    expect(r2?.x).toBe(16); // after "ß"
  });

  // ──────────────────────────────────────────────────────────────────────────
  // P4-C.2.1 — direction-aware caret X in bidi-reordered lines.
  //
  // The mock shaper is 8px/char. There is no registered `direction` block attr,
  // so the paragraph base stays LTR; Hebrew CONTENT still resolves to level-1
  // (RTL) runs by UAX #9 — which is what the §B intra-leaf RTL math keys off
  // (the LEAF level parity, not the paragraph direction). See line-bidi.test.ts.
  // ──────────────────────────────────────────────────────────────────────────

  it("uniform RTL run: caret X decreases monotonically (offset 0 → right edge, end → left edge)", () => {
    // "אבג" (3 Hebrew chars) in an LTR paragraph: one level-1 run at x[0,24].
    // BEFORE this task the LTR-only `absoluteX + measureWidth(prefix)` formula
    // produced INCREASING x (0,8,16,24) — the bug. Direction-aware: offset 0 is
    // the logical START, which under RTL sits at the run's RIGHT edge (24);
    // offset 3 (logical end) sits at the LEFT edge (0); monotonically decreasing.
    const state = singleParagraph("אבג");
    const { layout, shaper } = pipeline(state, 800);
    const xs = [0, 1, 2, 3].map((off) => {
      const r = resolvePixelPosition(state, createPosition("p" as BlockId, off), layout, shaper);
      expect(r).not.toBeNull();
      return r?.x ?? NaN;
    });
    expect(xs).toEqual([24, 16, 8, 0]); // rightmost → leftmost
    for (let i = 1; i < xs.length; i++) {
      expect(nth(xs, i, "x")).toBeLessThan(nth(xs, i - 1, "x")); // strictly decreasing
    }
  });

  it("mixed LTR+RTL (no space): caret X tracks the bidi visual layout; the run-boundary offset is a DUAL caret", () => {
    // "abcאבג": Latin "abc" (level 0) at x[0,24], Hebrew "אבג" (level 1) at
    // x[24,48]. State offsets: a=0,b=1,c=2 | boundary=3 | Hebrew=[3,6].
    const state = singleParagraph("abcאבג");
    const { layout, shaper } = pipeline(state, 800);
    const xAt = (off: number, affinity?: "before" | "after") => {
      const r = resolvePixelPosition(
        state,
        createPosition("p" as BlockId, off),
        layout,
        shaper,
        undefined,
        affinity,
      );
      expect(r).not.toBeNull();
      return r?.x ?? NaN;
    };

    // Latin prefix grows left→right.
    expect(xAt(0)).toBe(0);
    expect(xAt(1)).toBe(8);
    expect(xAt(2)).toBe(16);

    // Hebrew interior offsets DECREASE off the run's right edge (48).
    expect(xAt(4)).toBe(40); // 48 − 8
    expect(xAt(5)).toBe(32); // 48 − 16
    expect(xAt(6)).toBe(24); // 48 − 24 = Hebrew run's left edge

    // Boundary offset 3 == Latin.logEnd == Hebrew.logStart: DUAL caret.
    //   "after"  → the leaf STARTING at 3 (the RTL Hebrew run) → its RIGHT edge 48.
    //   "before" → the leaf ENDING at 3 (the LTR Latin run)   → its RIGHT edge 24.
    expect(xAt(3, "after")).toBe(48);
    expect(xAt(3, "before")).toBe(24);
    expect(xAt(3, "after")).not.toBe(xAt(3, "before"));
    // Default (undefined) === "after".
    expect(xAt(3)).toBe(48);
  });

  it("mixed LTR+space+RTL: caret X tracks the bidi visual layout; the space↔Hebrew offset is a DUAL caret", () => {
    // "abc אבג": "abc" (lvl0) x[0,24], " " (lvl0) x[24,32], "אבג" (lvl1) x[32,56].
    // State: a=0,b=1,c=2 | space=[3,4] | Hebrew=[4,7].
    const state = singleParagraph("abc אבג");
    const { layout, shaper } = pipeline(state, 800);
    const xAt = (off: number, affinity?: "before" | "after") => {
      const r = resolvePixelPosition(
        state,
        createPosition("p" as BlockId, off),
        layout,
        shaper,
        undefined,
        affinity,
      );
      expect(r).not.toBeNull();
      return r?.x ?? NaN;
    };

    expect(xAt(0)).toBe(0);
    expect(xAt(3)).toBe(24); // end of "abc" / start of the (LTR) space
    // Hebrew interior decreases off its right edge (56).
    expect(xAt(5)).toBe(48); // 56 − 8
    expect(xAt(6)).toBe(40); // 56 − 16
    expect(xAt(7)).toBe(32); // 56 − 24 = Hebrew run's left edge

    // Boundary offset 4 == space.logEnd == Hebrew.logStart: DUAL caret.
    //   "after"  → the RTL Hebrew run STARTING at 4 → its RIGHT edge 56.
    //   "before" → the LTR space leaf ENDING at 4   → its RIGHT edge 32.
    expect(xAt(4, "after")).toBe(56);
    expect(xAt(4, "before")).toBe(32);
    expect(xAt(4, "after")).not.toBe(xAt(4, "before"));
  });

  it("RTL run followed by a clamped trailing space (#338): caret pins to the correct physical edges", () => {
    // "אבג " — Hebrew (lvl1) x[0,24] + a logically-trailing space. By UAX #9 L1
    // the trailing whitespace takes the PARAGRAPH level (0 = LTR here), so it
    // sits as a separate level-0 leaf at x[24,32], to the PHYSICAL RIGHT of the
    // Hebrew run. The break-spaces clamp (#338) must still land the caret on the
    // leaf's own box edge — not overflow past it.
    const state = singleParagraph("אבג ");
    const { layout, shaper } = pipeline(state, 800);
    const xAt = (off: number, affinity?: "before" | "after") => {
      const r = resolvePixelPosition(
        state,
        createPosition("p" as BlockId, off),
        layout,
        shaper,
        undefined,
        affinity,
      );
      expect(r).not.toBeNull();
      return r?.x ?? NaN;
    };

    // Hebrew interior: offset 0 → right edge 24, offset 3 → left edge 0.
    expect(xAt(0)).toBe(24);
    expect(xAt(1)).toBe(16);
    expect(xAt(2)).toBe(8);

    // Boundary offset 3 == Hebrew.logEnd == space.logStart: DUAL caret.
    //   "before" → the RTL Hebrew run ENDING at 3 → its LEFT edge 0.
    //   "after"  → the LTR space leaf STARTING at 3 → its LEFT edge 24.
    expect(xAt(3, "before")).toBe(0);
    expect(xAt(3, "after")).toBe(24);

    // Offset 4 (logical end of the trailing space): pinned to the space leaf's
    // own right edge (32) — the clamp keeps it ON the box edge, never past it.
    expect(xAt(4)).toBe(32);
  });
});
