import { describe, it, expect } from "vitest";
import { resolvePositionFromPixel } from "./hit-test";
import { render } from "../render/render";
import { createDefaultComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import { layoutTree } from "../layout/dispatch";
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
  const shaper = createMockShaper(8, 16);
  const layout = layoutTree(root, containerInlineSize, shaper, pageConfig);
  return { layout, shaper };
}

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

  it("returns null for click outside any box (no boxes)", () => {
    // Empty document with no inline content → no text-runs → null.
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
    const result = resolvePositionFromPixel(state, layout, shaper, -100, -100);
    expect(result).toBeNull();
  });
});
