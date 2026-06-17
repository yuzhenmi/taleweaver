/**
 * Comments slice 4 — `getCommentRangeRects` host query.
 *
 * Geometry-level tests: build comment markers into a real laid-out fixture via
 * the `addComment` op, then assert the returned `SelectionRect`s. The
 * load-bearing properties: (1) a LIVE comment highlights EXACTLY the commented
 * glyphs (the zero-width markers don't shift geometry — proven by equivalence
 * against `computeSelectionRects` over the plain-text span); (2) a range
 * crossing a soft-wrap / page boundary emits one rect per line / per page;
 * (3) an ORPHANED comment (one marker deleted), a FULLY-DELETED comment
 * (`resolveCommentRange` → null), and an ABSENT commentId all return `[]`.
 */
import { describe, it, expect } from "vitest";
import { getCommentRangeRects } from "./comment-rects";
import { computeSelectionRects } from "./selection-geometry";
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
import {
  createPosition,
  createSpan,
  addComment,
  deleteRange,
  resolveCommentRange,
  COMMENT_START_EMBED_TYPE,
  COMMENT_END_EMBED_TYPE,
  type BlockId,
  type State,
  type CommentId,
} from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-node";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const CID = "c1" as CommentId;
const ADD = { id: CID, author: "alice", body: "look here", createdAt: 1000 } as const;

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

function singleParagraph(textContent: string): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([text(textContent)]),
      }),
    ],
  });
}

describe("getCommentRangeRects", () => {
  it("returns rects covering exactly the commented glyphs (single line)", () => {
    // Comment over "world" in "hello world": span 6..11. addComment inserts a
    // comment-start marker at offset 6 (zero-width) and a comment-end marker at
    // the original offset 11 (now 12). resolveCommentRange → start={6}, end={12};
    // the createSpan(6,12) covers the start marker (zero-width) + "world" — i.e.
    // exactly the commented glyphs at display x [48, 88).
    const span = createSpan(
      createPosition("p" as BlockId, 6),
      createPosition("p" as BlockId, 11),
    );
    const state = addComment(singleParagraph("hello world"), span, ADD).state;
    const { layout, shaper } = pipeline(state, 800);

    const rects = getCommentRangeRects(state, layout, shaper, CID);
    expect(rects.length).toBe(1);
    const r = nth(rects, 0, "comment rect");
    // "world" = offsets 6..11 of "hello world": 8px/char → x 48, width 40.
    expect(r.x).toBe(48);
    expect(r.width).toBe(40);
    expect(r.pageIndex).toBe(0);

    // Equivalence: identical geometry to selecting "world" by plain-text span in
    // the SAME (markered) state — the zero-width markers don't shift the glyphs.
    // In the markered state, "world" lives at offsets 7..12 (after the start
    // marker at 6). createSpan(6,12) (markers included) === the comment span.
    const plainSpan = createSpan(
      createPosition("p" as BlockId, 6),
      createPosition("p" as BlockId, 12),
    );
    const plainRects = computeSelectionRects(state, plainSpan, layout, shaper);
    expect(rects).toEqual(plainRects);
  });

  it("returns one rect per line for a range crossing a soft-wrap boundary", () => {
    let s = "";
    for (let i = 0; i < 20; i++) s += "abcdefghi "; // 200 chars
    // 8px/char in 800px container → soft-wrap ~every 100 chars. Comment 50..150
    // spans two lines.
    const span = createSpan(
      createPosition("p" as BlockId, 50),
      createPosition("p" as BlockId, 150),
    );
    const state = addComment(singleParagraph(s), span, ADD).state;
    const { layout, shaper } = pipeline(state, 800);

    const rects = getCommentRangeRects(state, layout, shaper, CID);
    expect(rects.length).toBeGreaterThanOrEqual(2);
    // Per-line y-coordinates differ (each rect lives on a distinct line).
    const ys = new Set(rects.map((r) => r.y));
    expect(ys.size).toBeGreaterThanOrEqual(2);
  });

  it("returns rects on each page for a range crossing a page boundary", () => {
    // Five single-line paragraphs, tiny pages → each paragraph on its own page.
    // Comment from p1 to p5 crosses page boundaries → rects on ≥2 pages.
    const state0 = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p5" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("line1")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([text("line2")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", nextSiblingId: "p4", inlineContent: inlineContent([text("line3")]) }),
        buildBlock({ id: "p4", type: "paragraph", parentId: "doc", prevSiblingId: "p3", nextSiblingId: "p5", inlineContent: inlineContent([text("line4")]) }),
        buildBlock({ id: "p5", type: "paragraph", parentId: "doc", prevSiblingId: "p4", inlineContent: inlineContent([text("line5")]) }),
      ],
    });
    const span = createSpan(
      createPosition("p1" as BlockId, 0),
      createPosition("p5" as BlockId, 5),
    );
    const state = addComment(state0, span, ADD).state;
    const pageConfig: PageConfig = {
      pageInlineSize: 800,
      pageBlockSize: 60,
      pageMargins: { blockStart: 10, blockEnd: 10, inlineStart: 0, inlineEnd: 0 },
      pageGap: 0,
    };
    const { layout, shaper } = pipeline(state, 800, pageConfig);

    const rects = getCommentRangeRects(state, layout, shaper, CID);
    const pages = new Set(rects.map((r) => r.pageIndex));
    expect(pages.size).toBeGreaterThanOrEqual(2);
  });

  it("returns [] for an orphaned comment (one marker deleted)", () => {
    // Comment over "world" (6..11) → start marker at 6, end marker at 12.
    // Delete just the start marker (span 6..7) → a one-sided surviving end
    // marker → resolveCommentRange reports orphaned → no highlight.
    const span = createSpan(
      createPosition("p" as BlockId, 6),
      createPosition("p" as BlockId, 11),
    );
    let state = addComment(singleParagraph("hello world"), span, ADD).state;
    state = deleteRange(
      state,
      createSpan(
        createPosition("p" as BlockId, 6),
        createPosition("p" as BlockId, 7),
      ),
    ).state;
    const { layout, shaper } = pipeline(state, 800);

    expect(getCommentRangeRects(state, layout, shaper, CID)).toEqual([]);
  });

  it("returns [] for an INVERTED orphaned comment (end-before-start, non-collapsed)", () => {
    // Construct an orphaned range whose two positions are DISTINCT (not the
    // collapsed self-range a one-sided delete yields): place the comment-END
    // marker EARLY (offset 2) and the comment-START marker LATE (offset 6+, after
    // the end marker shifts it). One of each marker, but start NOT strictly
    // before end → resolveCommentRange.orphaned === true with start.offset >
    // end.offset. This makes the `range.orphaned` guard load-bearing: without it,
    // createSpan(start,end) would normalize to a NON-empty span and emit a rect.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("he"),
            embed(COMMENT_END_EMBED_TYPE, { commentId: CID }), // offset 2
            text("llo wo"),
            embed(COMMENT_START_EMBED_TYPE, { commentId: CID }), // offset 9
            text("rld"),
          ]),
        }),
      ],
    });
    // Sanity: the range resolves orphaned with distinct, inverted endpoints.
    const range = resolveCommentRange(state, CID);
    expect(range).not.toBeNull();
    expect(range?.orphaned).toBe(true);
    expect(range?.start.offset).not.toBe(range?.end.offset);

    const { layout, shaper } = pipeline(state, 800);
    expect(getCommentRangeRects(state, layout, shaper, CID)).toEqual([]);
  });

  it("returns [] for a fully-deleted comment (both markers gone)", () => {
    // Comment over "world" (6..11) → start marker at 6, end marker at 12.
    // Delete the whole commented range incl. both markers (span 6..13) →
    // resolveCommentRange → null → no highlight.
    const span = createSpan(
      createPosition("p" as BlockId, 6),
      createPosition("p" as BlockId, 11),
    );
    let state = addComment(singleParagraph("hello world"), span, ADD).state;
    state = deleteRange(
      state,
      createSpan(
        createPosition("p" as BlockId, 6),
        createPosition("p" as BlockId, 13),
      ),
    ).state;
    const { layout, shaper } = pipeline(state, 800);

    expect(getCommentRangeRects(state, layout, shaper, CID)).toEqual([]);
  });

  it("returns [] for an absent commentId", () => {
    const span = createSpan(
      createPosition("p" as BlockId, 6),
      createPosition("p" as BlockId, 11),
    );
    const state = addComment(singleParagraph("hello world"), span, ADD).state;
    const { layout, shaper } = pipeline(state, 800);

    expect(getCommentRangeRects(state, layout, shaper, "nope" as CommentId)).toEqual([]);
  });
});
