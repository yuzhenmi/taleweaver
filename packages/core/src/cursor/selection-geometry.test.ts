import { describe, it, expect } from "vitest";
import { computeSelectionRects } from "./selection-geometry";
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
  const layout = resolvePositionedTree(layoutTree(root, containerInlineSize, shaper, pageConfig));
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

  // ─────────────────────────────────────────────────────────────────────
  // Selection across / within empty (strut-line) paragraphs (#169).
  // After #168 added a strut LineBox for empty inline-bearing leaves, the
  // selection-rect computation must paint a visible highlight on those
  // empty lines too. Browser-faithful behavior (Google Docs / Word): an
  // empty paragraph between two non-empty paragraphs highlights as a
  // single line-height-tall rect spanning the line's content area.
  // ─────────────────────────────────────────────────────────────────────

  it("paints one rect per line when selection crosses one empty paragraph", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          firstChildId: "p1",
          lastChildId: "p3",
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
          nextSiblingId: "p3",
          // Empty paragraph — strut line.
          inlineContent: inlineContent([]),
        }),
        buildBlock({
          id: "p3",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p2",
          inlineContent: inlineContent([text("world")]),
        }),
      ],
    });
    const { layout, shaper } = pipeline(state);
    // Select from offset 3 of p1 ("hel|lo") to offset 3 of p3 ("wor|ld").
    const span = createSpan(
      createPosition("p1" as BlockId, 3),
      createPosition("p3" as BlockId, 3),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    // Three lines visited (p1, empty p2, p3) → three rects.
    expect(rects.length).toBe(3);
    // Each rect lives on a strictly greater y.
    const ys = rects.map((r) => r.y);
    expect(ys[1]).toBeGreaterThan(ys[0]);
    expect(ys[2]).toBeGreaterThan(ys[1]);
    // The middle rect (on the empty paragraph) has positive width — the
    // bug was width=0 / no rect emitted for empty lines.
    expect(rects[1].width).toBeGreaterThan(0);
    // And positive height (line-height).
    expect(rects[1].height).toBeGreaterThan(0);
  });

  it("paints rects for N consecutive empty paragraphs in a selection", () => {
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
          inlineContent: inlineContent([text("start")]),
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p1",
          nextSiblingId: "p3",
          inlineContent: inlineContent([]),
        }),
        buildBlock({
          id: "p3",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p2",
          nextSiblingId: "p4",
          inlineContent: inlineContent([]),
        }),
        buildBlock({
          id: "p4",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p3",
          nextSiblingId: "p5",
          inlineContent: inlineContent([]),
        }),
        buildBlock({
          id: "p5",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p4",
          inlineContent: inlineContent([text("end")]),
        }),
      ],
    });
    const { layout, shaper } = pipeline(state);
    // Span the entire range from start of p1 to end of p5.
    const span = createSpan(
      createPosition("p1" as BlockId, 0),
      createPosition("p5" as BlockId, 3),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    // Five distinct line ys: p1's line, three empty paragraphs, p5's line.
    expect(rects.length).toBe(5);
    // The three middle rects (empty paragraphs) all have positive width
    // and positive height.
    for (let i = 1; i <= 3; i++) {
      expect(rects[i].width).toBeGreaterThan(0);
      expect(rects[i].height).toBeGreaterThan(0);
    }
  });

  // Regression: empty paragraphs caught in a multi-line selection should
  // emit a NARROW paragraph-break indicator (Google Docs / Word style),
  // NOT a full-line highlight. Pre-fix, the synthetic strut entry (which
  // spans the full line for hit-test purposes) made buildLineEdgeMaps
  // think the empty line had real content from x=0 to x=lineInlineSize —
  // producing a full-line rect. Post-fix, synthetic entries skip the
  // lineEnd update so the existing narrow-indicator fallback fires.
  it("empty paragraph rect is NARROW (paragraph-break indicator only), not full-line", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("aaa")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: inlineContent([text("zzz")]) }),
      ],
    });
    // Container 800px wide. Mock shaper: 8px/char, 16px line height.
    // Full empty-line width would be ~800; narrow indicator (`"  "`) = 16px.
    const { layout, shaper } = pipeline(state, 800);
    const span = createSpan(
      createPosition("p1" as BlockId, 0),
      createPosition("p3" as BlockId, 3),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    // Three rects: p1 line, empty p2 strut, p3 line.
    expect(rects.length).toBe(3);
    // The middle rect (on the empty paragraph) must be narrow — width
    // matches the paragraph-break indicator (two spaces, ~16px in the
    // mock shaper), NOT the full line width (~800px). Pre-fix this
    // failed: rects[1].width was ~800.
    expect(rects[1].width).toBeLessThan(50);
    // And still positive — the line return IS in the selection.
    expect(rects[1].width).toBeGreaterThan(0);
  });

  it("paints a rect inside a single empty paragraph when selection starts at its end and extends to next block", () => {
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
          inlineContent: inlineContent([]),
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p1",
          inlineContent: inlineContent([text("next")]),
        }),
      ],
    });
    const { layout, shaper } = pipeline(state);
    // Selection from start of empty p1 to mid p2.
    const span = createSpan(
      createPosition("p1" as BlockId, 0),
      createPosition("p2" as BlockId, 2),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    // Two lines: empty p1's strut, p2's line.
    expect(rects.length).toBe(2);
    // First rect (empty p1) must have positive width.
    expect(rects[0].width).toBeGreaterThan(0);
    expect(rects[0].height).toBeGreaterThan(0);
  });

  it("does not regress: single-line selection in a non-empty paragraph still produces text-width rect (not full-line)", () => {
    const state = singleParagraph("hello world");
    const { layout, shaper } = pipeline(state, 800);
    const span = createSpan(
      createPosition("p" as BlockId, 1),
      createPosition("p" as BlockId, 4),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    expect(rects.length).toBe(1);
    // Width of "ell" = 24px (8px/char). Must not be full-line (800px).
    expect(rects[0].width).toBe(24);
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
