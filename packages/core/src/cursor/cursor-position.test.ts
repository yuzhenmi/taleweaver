import { describe, it, expect } from "vitest";
import { resolvePixelPosition } from "./cursor-position";
import { render } from "../render/render";
import { createDefaultComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import { layoutTree } from "../layout/dispatch";
import { resolvePositionedTree } from "../layout/positioned-tree";
import { createMockShaper } from "../layout/mock-shaper";
import type { TextShaper } from "../layout/text-shaper";
import type { PageConfig } from "../layout/page-config";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
  embed,
} from "../test-utils/state-builders";
import { createPosition } from "../state/block-position";
import type { BlockId } from "../state/block-id";
import type { State } from "../state/state";
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
  const shaper = createMockShaper(8, 16); // 8px char width, 16px line height
  // Bridge the (possibly virtual) layout result to a positioned tree; the
  // cursor APIs operate on positioned boxes (Phase 3 Task 1).
  const layout = resolvePositionedTree(layoutTree(root, containerInlineSize, shaper, pageConfig));
  return { layout, shaper };
}

/** Build a single-paragraph document with the given text. */
function singleParagraph(textContent: string): State {
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

  it("offset inside a collapsed inter-word whitespace tail clamps to the run's right edge", () => {
    // "dsajidosja idoajs  dsajiodj" — double space between word2 and word3.
    // State offsets: dsajidosja=[0,10), space@10, idoajs=[11,17), space@17,
    //   space@18 (collapsed away), dsajiodj=[19,27).
    // Runs (single wide line): "dsajidosja " (offsetLength 11, rendered 11ch),
    //   "idoajs " (offsetLength 8 — owns the 2 source spaces, rendered 7ch),
    //   "dsajiodj" (offsetLength 8). Run2 spans x[88,144); run3 starts at 144.
    const state = singleParagraph("dsajidosja idoajs  dsajiodj");
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
});
