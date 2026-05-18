import { describe, it, expect } from "vitest";
import { computeSelectionRects } from "./selection-geometry";
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
import { createPosition, createSpan } from "../state/block-position";
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

describe("computeSelectionRects (new)", () => {
  it("returns one rect for a single-block single-line span", () => {
    const state = singleParagraph("hello world");
    const { layout, shaper } = pipeline(state);
    const span = createSpan(
      createPosition("p" as BlockId, 1),
      createPosition("p" as BlockId, 4),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    expect(rects.length).toBe(1);
    const r = rects[0];
    // 8px/char: x from 8 to 32 → width 24.
    expect(r.x).toBe(8);
    expect(r.width).toBe(24);
    expect(r.pageIndex).toBe(0);
  });

  it("returns multiple rects for a span crossing a soft-wrap boundary", () => {
    let s = "";
    for (let i = 0; i < 20; i++) s += "abcdefghi "; // 200 chars
    const state = singleParagraph(s);
    const { layout, shaper } = pipeline(state, 800);
    // 8px/char in 800px container → soft wrap after ~100 chars.
    // Span from offset 50 to offset 150 spans two lines.
    const span = createSpan(
      createPosition("p" as BlockId, 50),
      createPosition("p" as BlockId, 150),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    expect(rects.length).toBeGreaterThanOrEqual(2);
  });

  it("returns rects across two blocks for a multi-block span", () => {
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
    const span = createSpan(
      createPosition("p1" as BlockId, 2),
      createPosition("p2" as BlockId, 3),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    expect(rects.length).toBeGreaterThanOrEqual(2);
    // First rect should be on p1's line, last on p2's line.
    const firstY = rects[0].y;
    const lastY = rects[rects.length - 1].y;
    expect(lastY).toBeGreaterThan(firstY);
  });

  it("returns rects on each page for a selection crossing a page break", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          firstChildId: "p1",
          lastChildId: "p5",
        }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("line1")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([text("line2")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", nextSiblingId: "p4", inlineContent: inlineContent([text("line3")]) }),
        buildBlock({ id: "p4", type: "paragraph", parentId: "doc", prevSiblingId: "p3", nextSiblingId: "p5", inlineContent: inlineContent([text("line4")]) }),
        buildBlock({ id: "p5", type: "paragraph", parentId: "doc", prevSiblingId: "p4", inlineContent: inlineContent([text("line5")]) }),
      ],
    });
    const pageConfig: PageConfig = {
      pageInlineSize: 800,
      pageBlockSize: 60,
      pageMargins: { blockStart: 10, blockEnd: 10, inlineStart: 0, inlineEnd: 0 },
      pageGap: 0,
    };
    const { layout, shaper } = pipeline(state, 800, pageConfig);
    const span = createSpan(
      createPosition("p1" as BlockId, 0),
      createPosition("p5" as BlockId, 5),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    const pages = new Set(rects.map((r) => r.pageIndex));
    expect(pages.size).toBeGreaterThanOrEqual(2);
  });

  it("returns empty array for a collapsed (anchor === focus) span", () => {
    const state = singleParagraph("hello");
    const { layout, shaper } = pipeline(state);
    const pos = createPosition("p" as BlockId, 2);
    const span = createSpan(pos, pos);
    const rects = computeSelectionRects(state, span, layout, shaper);
    expect(rects).toEqual([]);
  });

  it("includes a paragraph-break bridge rect at the end of the source paragraph", () => {
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
    // Select from end of p1 ("hello") to mid p2 ("wor"). The legacy
    // selection-geometry adds a small "line-break indicator" rect after
    // "hello" to bridge to p2's start. We expect ≥ 2 rects (one on p1's
    // line, one on p2's line).
    const span = createSpan(
      createPosition("p1" as BlockId, 3),
      createPosition("p2" as BlockId, 3),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    expect(rects.length).toBeGreaterThanOrEqual(2);
    // p1's rect should extend past "hello" (5*8=40); the indicator is
    // added to that rect's width.
    const p1Rect = rects[0];
    expect(p1Rect.x).toBe(24); // 3 chars in
    // p1Rect ends at 40 (end of "hello") + indicator. Indicator is "  "
    // measured = 16px; total width = 40 - 24 + 16 = 32.
    expect(p1Rect.width).toBeGreaterThan(40 - 24);
  });

  it("handles a span ending at offset 0 of the next block (zero-extent in end-block)", () => {
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
    const span = createSpan(
      createPosition("p1" as BlockId, 2),
      createPosition("p2" as BlockId, 0),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    // p1 portion only — p2's zero-extent end shouldn't add a rect on p2's line.
    expect(rects.length).toBeGreaterThanOrEqual(1);
    // First rect: starts at x=16 (offset 2), extends to end of "hello" + indicator.
    expect(rects[0].x).toBe(16);
  });

  it("produces a rect covering content around an embed item", () => {
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
    // Span from offset 1 (mid "ab") to offset 4 (mid "cd") — spans across embed slot.
    const span = createSpan(
      createPosition("p" as BlockId, 1),
      createPosition("p" as BlockId, 4),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    expect(rects.length).toBeGreaterThanOrEqual(1);
    // Single line — one rect.
    const r = rects[0];
    expect(r.pageIndex).toBe(0);
    // Spans 1*8 to ~24 (mid "cd"). Width > 0.
    expect(r.width).toBeGreaterThan(0);
  });
});
