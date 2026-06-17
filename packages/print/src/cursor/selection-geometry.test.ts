import { describe, it, expect } from "vitest";
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
import { createPosition, createSpan } from "@taleweaver/core";
import type { BlockId, State } from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-node";
import { getLineIndex } from "./line-flatten";

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
    const r = nth(rects, 0, "rect");
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
    const firstY = nth(rects, 0, "rects").y;
    const lastY = nth(rects, rects.length - 1, "rects").y;
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
    const p1Rect = nth(rects, 0, "rect");
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
    expect(nth(rects, 0, "rects").x).toBe(16);
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
    expect(nth(ys, 1, "y")).toBeGreaterThan(nth(ys, 0, "y"));
    expect(nth(ys, 2, "y")).toBeGreaterThan(nth(ys, 1, "y"));
    // The middle rect (on the empty paragraph) has positive width — the
    // bug was width=0 / no rect emitted for empty lines.
    expect(nth(rects, 1, "rects").width).toBeGreaterThan(0);
    // And positive height (line-height).
    expect(nth(rects, 1, "rects").height).toBeGreaterThan(0);
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
      expect(nth(rects, i, "rects").width).toBeGreaterThan(0);
      expect(nth(rects, i, "rects").height).toBeGreaterThan(0);
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
    expect(nth(rects, 1, "rects").width).toBeLessThan(50);
    // And still positive — the line return IS in the selection.
    expect(nth(rects, 1, "rects").width).toBeGreaterThan(0);
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
    expect(nth(rects, 0, "rects").width).toBeGreaterThan(0);
    expect(nth(rects, 0, "rects").height).toBeGreaterThan(0);
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
    expect(nth(rects, 0, "rects").width).toBe(24);
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
    const r = nth(rects, 0, "rect");
    expect(r.pageIndex).toBe(0);
    // Spans 1*8 to ~24 (mid "cd"). Width > 0.
    expect(r.width).toBeGreaterThan(0);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Text-transform selection geometry (Task 7). The transform renders a
  // DISPLAY string (uppercase ß→SS) while STATE offsets stay pristine.
  // Selection-geometry derives every edge-x by calling resolvePixelPosition
  // (Task 5), which remaps a within-leaf STATE offset to the DISPLAY index
  // via `box.sourceDisplayLengths`. So a selection over a length-changing
  // leaf must cover the FULL rendered glyphs — no independent offset→x path
  // exists in selection-geometry that would slice the display string by the
  // raw state offset. These lock that behavior (no production change needed).
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Single-paragraph document whose text run carries a `textTransform` inline
   * attr (the only path that reaches the run — a block attr does NOT, per the
   * pre-existing #310 gap). The inline cascade computes the transform, so the
   * IFC produces a DISPLAY string and, when length-changing, a
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

  it("selects the full 'SS' for a length-changing transform (ß→SS), not half", () => {
    // "aß" under text-transform: uppercase renders "ASS" (ß→SS, length-changing;
    // leaf carries sourceDisplayLengths [1, 2]). Selecting the ß — STATE span
    // offset 1..2 — must cover the WHOLE rendered "SS" (display index 1..3):
    // left ≈ leaf left + 8, right ≈ leaf left + 24 (width 16). A raw
    // `text.slice(0, 2)` = "AS" would wrongly give the end edge at +16 → width 8.
    const state = transformedParagraph("aß", "uppercase");
    const { layout, shaper } = pipeline(state, 800);
    const span = createSpan(
      createPosition("p" as BlockId, 1),
      createPosition("p" as BlockId, 2),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    expect(rects.length).toBe(1);
    const r = nth(rects, 0, "rect");
    expect(r.x).toBe(8); // after "A"
    expect(r.width).toBe(16); // full "SS", NOT 8 (half)
    expect(r.pageIndex).toBe(0);
  });

  it("1:1 transformed selection ('ab' uppercase) is geometry-identical to untransformed", () => {
    // "ab" uppercased → "AB" (1:1, sourceDisplayLengths undefined → state offset
    // IS display index). Selecting offset 0..2 covers the full 16px, identical
    // to the untransformed "ab" selection.
    const transformed = transformedParagraph("ab", "uppercase");
    const { layout: tLayout, shaper: tShaper } = pipeline(transformed, 800);
    const tSpan = createSpan(
      createPosition("p" as BlockId, 0),
      createPosition("p" as BlockId, 2),
    );
    const tRects = computeSelectionRects(transformed, tSpan, tLayout, tShaper);

    const plain = singleParagraph("ab");
    const { layout: pLayout, shaper: pShaper } = pipeline(plain, 800);
    const pSpan = createSpan(
      createPosition("p" as BlockId, 0),
      createPosition("p" as BlockId, 2),
    );
    const pRects = computeSelectionRects(plain, pSpan, pLayout, pShaper);

    expect(tRects.length).toBe(1);
    expect(pRects.length).toBe(1);
    expect(nth(tRects, 0, "tRects").x).toBe(nth(pRects, 0, "pRects").x);
    expect(nth(tRects, 0, "tRects").width).toBe(nth(pRects, 0, "pRects").width);
    expect(nth(tRects, 0, "tRects").x).toBe(0);
    expect(nth(tRects, 0, "tRects").width).toBe(16); // full "AB"
  });

  // ─────────────────────────────────────────────────────────────────────
  // Bidi-aware selection-rect segmentation (P4-C.2.5, spec §F). A logical
  // range crossing a direction boundary must render as ≥2 VISUAL highlight
  // rects (the legacy same-line `{x:startX, width:endX-startX}` strip is wrong
  // and can be NEGATIVE-width on a reordered line). Pure-LTR output stays
  // byte-identical; widths are always ≥ 0.
  // ─────────────────────────────────────────────────────────────────────

  it("pure-LTR same-line range is ONE rect, byte-identical to the legacy strip", () => {
    const state = singleParagraph("abc");
    const { layout, shaper } = pipeline(state, 800);
    // offsets 0..2 of "abc" (LTR, 8px/char): x=0, width=16.
    const span = createSpan(
      createPosition("p" as BlockId, 0),
      createPosition("p" as BlockId, 2),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    expect(rects.length).toBe(1);
    expect(nth(rects, 0, "rects").x).toBe(0);
    expect(nth(rects, 0, "rects").width).toBe(16);
  });

  it("uniform-RTL same-line range is ONE non-negative-width rect over the glyph extent", () => {
    // "אבג" resolves to a single RTL (level-1) run. caretX: off0→24, off3→0.
    // Selecting the whole run (0..3) → xLo=caretX(3)=0, xHi=caretX(0)=24 →
    // {x:0, width:24}. The legacy `endX - startX` (= 0 - 24) would be -24.
    const state = singleParagraph("אבג");
    const { layout, shaper } = pipeline(state, 800);
    const span = createSpan(
      createPosition("p" as BlockId, 0),
      createPosition("p" as BlockId, 3),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    expect(rects.length).toBe(1);
    expect(nth(rects, 0, "rects").x).toBe(0);
    expect(nth(rects, 0, "rects").width).toBe(24);
    expect(nth(rects, 0, "rects").width).toBeGreaterThan(0);
  });

  it("mixed boundary-crossing range yields ≥2 disjoint rects with correct x/width (KEY)", () => {
    // "abcאבג" in an LTR paragraph: Latin run [0,3) level 0 at x0-24, Hebrew
    // run [3,6) level 1 at x24-48 (RTL: caretX off3→48, off4→40, off5→32,
    // off6→24). A logical range 2..5 crosses the Latin→Hebrew boundary:
    //   Latin overlap [2,3): LTR → xLo=caretX(2)=16, xHi=caretX(3)=24 → {16,8}
    //   Hebrew overlap [3,5): RTL → xLo=caretX(5)=32, xHi=caretX(3)=48 → {32,16}
    // Two DISJOINT rects (24 ≠ 32 → not coalesced; different levels anyway).
    const state = singleParagraph("abcאבג");
    const { layout, shaper } = pipeline(state, 800);
    const span = createSpan(
      createPosition("p" as BlockId, 2),
      createPosition("p" as BlockId, 5),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    expect(rects.length).toBe(2);
    // Logical order: Latin segment first, Hebrew second.
    expect(nth(rects, 0, "rects").x).toBe(16);
    expect(nth(rects, 0, "rects").width).toBe(8);
    expect(nth(rects, 1, "rects").x).toBe(32);
    expect(nth(rects, 1, "rects").width).toBe(16);
    // Disjoint (no overlap; Latin ends at 24, Hebrew starts at 32).
    expect(nth(rects, 0, "rects").x + nth(rects, 0, "rects").width).toBeLessThanOrEqual(nth(rects, 1, "rects").x);
    // No negative widths.
    for (const r of rects) expect(r.width).toBeGreaterThanOrEqual(0);
  });

  it("within-RTL-run sub-range has SWAPPED endpoints (logically-later → lower x)", () => {
    // "abcאבג": a range 4..6 lies entirely inside the Hebrew RTL run [3,6).
    // RTL swap: xLo=caretX(6)=24, xHi=caretX(4)=40 → {x:24, width:16}. The
    // logically-LATER offset (6) sits at the LOWER x (24).
    const state = singleParagraph("abcאבג");
    const { layout, shaper } = pipeline(state, 800);
    const span = createSpan(
      createPosition("p" as BlockId, 4),
      createPosition("p" as BlockId, 6),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    expect(rects.length).toBe(1);
    expect(nth(rects, 0, "rects").x).toBe(24);
    expect(nth(rects, 0, "rects").width).toBe(16);
    expect(nth(rects, 0, "rects").width).toBeGreaterThan(0);
  });

  it("middle full line of a multi-line selection is byte-identical (computeLineEdges)", () => {
    // A wrapped LTR paragraph: a selection spanning ≥3 lines leaves the middle
    // line as a full-content rect from lineLeft to lineRight — unchanged by the
    // bidi segmentation (which only touches first/last/same-line partials).
    let s = "";
    for (let i = 0; i < 40; i++) s += "abcdefghi "; // 400 chars → ≥4 lines @800px
    const state = singleParagraph(s);
    const { layout, shaper } = pipeline(state, 800);
    const span = createSpan(
      createPosition("p" as BlockId, 5),
      createPosition("p" as BlockId, 395),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    expect(rects.length).toBeGreaterThanOrEqual(3);
    // A middle rect (neither first nor last) spans the full content width: it
    // starts at lineLeft (x=0) and is much wider than a single character.
    const middle = nth(rects, 1, "rect");
    expect(middle.x).toBe(0);
    expect(middle.width).toBeGreaterThan(100);
    for (const r of rects) expect(r.width).toBeGreaterThanOrEqual(0);
  });

  it("untransformed 'aß' selection (offset 1..2) covers the ß's single 8px", () => {
    // Sanity that the harness distinguishes transformed vs not: text-transform:
    // none → "aß" renders as-is (2 code units, no sourceDisplayLengths), so
    // selecting the ß (offset 1..2) covers a single 8px glyph.
    const state = transformedParagraph("aß", "none");
    const { layout, shaper } = pipeline(state, 800);
    const span = createSpan(
      createPosition("p" as BlockId, 1),
      createPosition("p" as BlockId, 2),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    expect(rects.length).toBe(1);
    expect(nth(rects, 0, "rects").x).toBe(8); // after "a"
    expect(nth(rects, 0, "rects").width).toBe(8); // single ß glyph
  });
});

// ─────────────────────────────────────────────────────────────────────────
// P3.5c — vertical-mode SelectionRect projection (I5).
//
// `SelectionRect {x,y,width,height}` feeds paint DIRECTLY, so it must be TRUE
// PHYSICAL for every writing mode. Per I5, the projection maps BOTH axes via
// `am = axisMapFor(line.writingMode, line.computedStyle.direction)`:
//   - the INLINE interval (the selected span within the line) → `am.inline`'s
//     physical axis (x+width if am.inline==="x", else y+height);
//   - the BLOCK band (the line's block-start + block-size) → `am.block`'s axis.
// For the vertical modes inline==Y, block==X, so the selected inline span lands
// on physical Y and the line's block band on physical X.
//
// Geometry mirrors `vertical-cursor-position.test.ts`: an 8px-char / 16px-cross
// mock shaper, a 20px-inline narrow page so "aa bb cc" wraps into three lines,
// page block-size 1000 (so the v-rl block-axis mirror lands line 0 at the
// far/right physical x). Probed concrete coords (identical setup):
//   vertical-rl: line0 absX=984, line1 absX=968, line2 absX=952 (absY=0 each).
//   vertical-lr: line0 absX=0,  line1 absX=16,  line2 absX=32  (absY=0 each).
//   each line inlineSize=20, blockSize=16; leaves "aa"/"bb"/"cc" w=16 h=16.
//
// These assertions are RED against the h-tb-only code (which emits
// y=al.absoluteY / height=line.blockSize for the block band and folds the
// inline extent onto x/width regardless of writing mode).
const VERTICAL_LINE_BLOCK = 16; // line blockSize (physical-X extent in vertical)

const verticalPageConfig: PageConfig = {
  pageInlineSize: 20,
  pageBlockSize: 1000,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 20,
};

function verticalDoc(wm: "vertical-rl" | "vertical-lr"): State {
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
  const shaper = createMockShaper(8, 16);
  const layout = positionTreeForTest(
    layoutTree(root, verticalPageConfig.pageInlineSize, shaper, verticalPageConfig),
  );
  return { layout, shaper };
}

function pLines(layout: LayoutBox): ReturnType<typeof getLineIndex>["all"] {
  return getLineIndex(layout).byBlock.get("p" as BlockId) ?? [];
}

describe("P3.5c vertical SelectionRect projection — vertical-rl", () => {
  const state = verticalDoc("vertical-rl");
  const { layout, shaper } = verticalPipeline(state);
  const lines = pLines(layout);

  it("layout sanity: three lines, block band mirrored along physical X (line0 far/high)", () => {
    expect(lines.length).toBe(3);
    expect(nth(lines, 0, "lines").absoluteX).toBeGreaterThan(nth(lines, 1, "lines").absoluteX);
    expect(nth(lines, 1, "lines").absoluteX).toBeGreaterThan(nth(lines, 2, "lines").absoluteX);
    expect(nth(lines, 0, "lines").absoluteY).toBe(0);
  });

  it("multi-line selection: each rect's block band on physical X, inline span on physical Y", () => {
    // Select offset 0 ("aa bb cc" start) through offset 8 (end) — spans all
    // three lines: line0 "aa" (inOff 0..3), line1 "bb" (3..6), line2 "cc" (6..8).
    const span = createSpan(
      createPosition("p" as BlockId, 0),
      createPosition("p" as BlockId, 8),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    // One rect per line (no bidi splits, pure-LTR runs).
    expect(rects.length).toBe(3);

    // line0 "aa ": the FIRST line covers offsets 0..3 (incl. the trailing space,
    // which hangs/clamps to the content edge), so its inline span is the line's
    // full inlineSize 20 down physical Y; block band = the line's physical x
    // (mirrored to 984) + blockSize 16 → physical X.
    const r0 = nth(rects, 0, "rect");
    expect(r0.x).toBe(nth(lines, 0, "lines").absoluteX); // block band start = physical x
    expect(r0.width).toBe(VERTICAL_LINE_BLOCK); // block band extent = blockSize
    expect(r0.y).toBe(0); // inline span start (physical Y)
    expect(r0.height).toBe(20); // full inline extent of the wrapped line
    expect(r0.pageIndex).toBe(0);

    // line1 "bb ": the MIDDLE full line — its whole content (inlineSize 20).
    const r1 = nth(rects, 1, "rect");
    expect(r1.x).toBe(nth(lines, 1, "lines").absoluteX);
    expect(r1.width).toBe(VERTICAL_LINE_BLOCK);
    expect(r1.y).toBe(0);
    expect(r1.height).toBe(20);

    // line2 "cc": the LAST line (offset 6..8) — "cc" = 2 chars * 8px, no
    // trailing space, so 16px down the inline (physical-Y) axis.
    const r2 = nth(rects, 2, "rect");
    expect(r2.x).toBe(nth(lines, 2, "lines").absoluteX);
    expect(r2.width).toBe(VERTICAL_LINE_BLOCK);
    expect(r2.y).toBe(0);
    expect(r2.height).toBe(16);

    // The block band marches DOWN in physical x (v-rl mirror): r0 > r1 > r2.
    expect(r0.x).toBeGreaterThan(r1.x);
    expect(r1.x).toBeGreaterThan(r2.x);
  });

  it("partial single-line selection: sub-span inline extent on physical Y, block band on physical X", () => {
    // Select just the first char of line0 "aa" (offset 0..1) — a sub-span of
    // one line. Inline extent = one char = 8px down physical Y; block band =
    // line0's physical x + blockSize 16 along physical X.
    const span = createSpan(
      createPosition("p" as BlockId, 0),
      createPosition("p" as BlockId, 1),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    expect(rects.length).toBe(1);
    const r = nth(rects, 0, "rect");
    expect(r.x).toBe(nth(lines, 0, "lines").absoluteX); // block band start
    expect(r.width).toBe(VERTICAL_LINE_BLOCK); // block band extent
    expect(r.y).toBe(0); // inline start
    expect(r.height).toBe(8); // one char along the inline (physical-Y) axis
  });
});

describe("P3.5c vertical SelectionRect projection — vertical-lr", () => {
  const state = verticalDoc("vertical-lr");
  const { layout, shaper } = verticalPipeline(state);
  const lines = pLines(layout);

  it("layout sanity: three lines, block band ascending along physical X (no mirror)", () => {
    expect(lines.length).toBe(3);
    expect(nth(lines, 0, "lines").absoluteX).toBeLessThan(nth(lines, 1, "lines").absoluteX);
    expect(nth(lines, 1, "lines").absoluteX).toBeLessThan(nth(lines, 2, "lines").absoluteX);
  });

  it("multi-line selection: block band ascends on physical X, inline span on physical Y", () => {
    const span = createSpan(
      createPosition("p" as BlockId, 0),
      createPosition("p" as BlockId, 8),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    expect(rects.length).toBe(3);

    const r0 = nth(rects, 0, "rect");
    expect(r0.x).toBe(nth(lines, 0, "lines").absoluteX); // = 0, block band start
    expect(r0.width).toBe(VERTICAL_LINE_BLOCK);
    expect(r0.y).toBe(0);
    expect(r0.height).toBe(20); // first wrapped line — full inline extent

    const r1 = nth(rects, 1, "rect");
    expect(r1.x).toBe(nth(lines, 1, "lines").absoluteX); // = 16
    expect(r1.width).toBe(VERTICAL_LINE_BLOCK);
    expect(r1.y).toBe(0);
    expect(r1.height).toBe(20); // middle full line — full inline extent

    const r2 = nth(rects, 2, "rect");
    expect(r2.x).toBe(nth(lines, 2, "lines").absoluteX); // = 32
    expect(r2.width).toBe(VERTICAL_LINE_BLOCK);
    expect(r2.y).toBe(0);
    expect(r2.height).toBe(16); // last line "cc" — 2 chars, no trailing space

    // Block band marches UP in physical x (no mirror): r0 < r1 < r2.
    expect(r0.x).toBeLessThan(r1.x);
    expect(r1.x).toBeLessThan(r2.x);
  });

  it("partial single-line selection: sub-span inline extent on physical Y", () => {
    const span = createSpan(
      createPosition("p" as BlockId, 0),
      createPosition("p" as BlockId, 1),
    );
    const rects = computeSelectionRects(state, span, layout, shaper);
    expect(rects.length).toBe(1);
    const r = nth(rects, 0, "rect");
    expect(r.x).toBe(nth(lines, 0, "lines").absoluteX);
    expect(r.width).toBe(VERTICAL_LINE_BLOCK);
    expect(r.y).toBe(0);
    expect(r.height).toBe(8);
  });
});

describe("P3.7 vertical bidi SelectionRect — range crossing an LTR↔RTL boundary on inline-Y", () => {
  // "abאב": Latin "ab" (lvl0, state [0,2], inline-Y [0,16]) + Hebrew "אב"
  // (lvl1, state [2,4], inline-Y [16,32]). Paragraph base LTR; the Hebrew CONTENT
  // gives the level-1 run. WIDE page → one line, so the only axis at play is the
  // inline (physical-Y) axis with the line's block band on physical X.
  //
  // Select logical [1,3): one char of the LTR run ("b", inline-Y [8,16]) and one
  // char of the RTL run (the Hebrew logical-FIRST char, which in an RTL run sits
  // at the run's FAR inline-Y edge [24,32]). A contiguous LOGICAL range therefore
  // maps to TWO DISJOINT visual intervals — the bidi-reorder signature — each
  // projected onto physical Y (height), with the block band on physical X (x +
  // width). The two intervals are NOT coalesced (different bidi levels).
  const wideBidiPage: PageConfig = {
    pageInlineSize: 800,
    pageBlockSize: 1000,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 20,
  };

  function bidiDoc(wm: "vertical-rl" | "vertical-lr"): State {
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
    const shaper = createMockShaper(8, 16);
    const layout = positionTreeForTest(
      layoutTree(root, wideBidiPage.pageInlineSize, shaper, wideBidiPage),
    );
    return { layout, shaper };
  }

  for (const wm of ["vertical-lr", "vertical-rl"] as const) {
    it(`${wm}: two disjoint rects projected onto physical Y, block band on physical X`, () => {
      const state = bidiDoc(wm);
      const { layout, shaper } = bidiPipeline(state);
      const lines = pLines(layout);
      expect(lines.length).toBe(1);
      const blockX = nth(lines, 0, "lines").absoluteX;

      const span = createSpan(
        createPosition("p" as BlockId, 1),
        createPosition("p" as BlockId, 3),
      );
      const rects = computeSelectionRects(state, span, layout, shaper);
      // The bidi-reorder signature: a single logical range → TWO visual rects.
      expect(rects.length).toBe(2);

      // Both rects sit in the line's block band on physical X (width = line
      // blockSize 16), with their inline extent on physical Y (height).
      for (const r of rects) {
        expect(r.x).toBe(blockX);
        expect(r.width).toBe(16);
      }
      // Sort by physical-Y start so the assertion is order-independent.
      const byY = [...rects].sort((a, b) => a.y - b.y);
      // LTR "b": inline-Y [8,16] → y=8, height=8.
      expect(nth(byY, 0, "byY").y).toBe(8);
      expect(nth(byY, 0, "byY").height).toBe(8);
      // RTL Hebrew logical-first char at the run's FAR inline-Y edge [24,32].
      // An LTR assumption would put it at the NEAR edge [16,24] (y=16) — the
      // discriminating value is y=24.
      expect(nth(byY, 1, "byY").y).toBe(24);
      expect(nth(byY, 1, "byY").height).toBe(8);
    });
  }
});

describe("computeSelectionRects — table cells (#P8.S4.T3 audit)", () => {
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

  // Selection geometry iterates the document-order lines BETWEEN the two
  // positions and emits one rect per line from that line's own absolute leaf
  // coords — so each rect is naturally CELL-LOCAL (no cross-cell bleed). Unlike
  // the band-PICK in hit-test (which had to choose ONE line and was column-
  // unaware, #P8.S4b), selection emits every in-range line, so it needs no
  // cell-restriction. This locks that per-cell correctness. (Whole-cell grid
  // selection — Google Docs highlighting entire cells when you drag across a
  // column — is a separate future selection-MODEL feature, not text-flow rect
  // geometry; out of scope here.)
  it("selection across two cells emits a per-cell rect, each within its own column", () => {
    const state = tableState();
    const { layout, shaper } = pipeline(state, 400); // cols [200, 200]
    const span = createSpan(createPosition("pA" as BlockId, 1), createPosition("pB" as BlockId, 2));
    const rects = computeSelectionRects(state, span, layout, shaper);
    expect(rects).toHaveLength(2);
    const rA = nth(rects, 0, "rect");
    const rB = nth(rects, 1, "rect");
    // Cell A's rect stays inside column 0 [0, 200); cell B's inside column 1 [200, 400).
    expect(rA.x).toBeGreaterThanOrEqual(0);
    expect(rA.x + rA.width).toBeLessThanOrEqual(200);
    expect(rB.x).toBeGreaterThanOrEqual(200);
    expect(rB.x + rB.width).toBeLessThanOrEqual(400);
  });
});
