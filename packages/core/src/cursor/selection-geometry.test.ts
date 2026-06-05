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
import { createPosition, createSpan } from "../state";
import type { BlockId, State } from "../state";
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
    const r = rects[0];
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
    expect(tRects[0].x).toBe(pRects[0].x);
    expect(tRects[0].width).toBe(pRects[0].width);
    expect(tRects[0].x).toBe(0);
    expect(tRects[0].width).toBe(16); // full "AB"
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
    expect(rects[0].x).toBe(0);
    expect(rects[0].width).toBe(16);
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
    expect(rects[0].x).toBe(0);
    expect(rects[0].width).toBe(24);
    expect(rects[0].width).toBeGreaterThan(0);
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
    expect(rects[0].x).toBe(16);
    expect(rects[0].width).toBe(8);
    expect(rects[1].x).toBe(32);
    expect(rects[1].width).toBe(16);
    // Disjoint (no overlap; Latin ends at 24, Hebrew starts at 32).
    expect(rects[0].x + rects[0].width).toBeLessThanOrEqual(rects[1].x);
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
    expect(rects[0].x).toBe(24);
    expect(rects[0].width).toBe(16);
    expect(rects[0].width).toBeGreaterThan(0);
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
    const middle = rects[1];
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
    expect(rects[0].x).toBe(8); // after "a"
    expect(rects[0].width).toBe(8); // single ß glyph
  });
});
