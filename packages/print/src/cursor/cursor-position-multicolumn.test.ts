// packages/core/src/cursor/cursor-position-multicolumn.test.ts
//
// Multi-column SPANNING-BLOCK coverage — the case the existing multicol cursor
// tests (line-navigation-multicolumn / hit-test-multicolumn) do NOT exercise.
//
// Those tests use 8 SINGLE-LINE paragraphs, so each column carries DISTINCT
// block ids — a column-blind resolver could be masked because the block id
// alone disambiguates the column. Here ONE TALL paragraph FRAGMENTS across the
// column boundary: the SAME block id (`"p0"`) appears in BOTH column 0 (lines
// 0..K-1) and column 1 (lines K..end). Block id no longer disambiguates the
// column — only the x-position does. This is exactly where a column-blind
// cursor-position / selection-geometry bug would hide.
//
// These tests drive the REAL cursor-position (`resolvePixelPosition`),
// hit-test (`resolvePositionFromPixel`) and selection-geometry
// (`computeSelectionRects`) APIs through the positioned layout and assert
// COORDINATES/COLUMNS, not just structure. The within-block line-nav analog
// lives in line-navigation-multicolumn.test.ts (which already has the harness).

import { describe, it, expect } from "vitest";
import { resolvePixelPosition } from "./cursor-position";
import { resolvePositionFromPixel } from "./hit-test";
import { computeSelectionRects } from "./selection-geometry";
import { render } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { makeRootContext } from "../layout/layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { buildBlockFitMetas } from "../layout/build-fit-metas";
import { measurePass } from "../layout/measure-pass";
import { makeVirtualLayoutTree } from "../layout/virtual-layout-tree";
import { positionTreeForTest } from "../test-utils/position-tree";
import { getLineIndex, type AbsoluteLineBox } from "./line-flatten";
import { createPosition, createSpan } from "@taleweaver/core";
import type { ElementBox } from "@taleweaver/core";
import type { PageConfig } from "../layout/page-config";
import type { SectionPlan } from "../layout/section-plan";
import type { ColumnConfig } from "@taleweaver/core";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}
import type { LayoutBox } from "../layout/layout-box";
import type { TextShaper } from "@taleweaver/core";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "@taleweaver/core";
import type { State } from "@taleweaver/core";

const CHAR_W = 8;
const LINE_H = 16;

function noMarginPageConfig(pageBlockSize: number, pageInlineSize = 600, pageGap = 20): PageConfig {
  return {
    pageInlineSize,
    pageBlockSize,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap,
  };
}

/** A `SectionPlan` declaring an N-column doc-wide default (no per-section override). */
function columnSectionPlan(columnConfig: ColumnConfig): SectionPlan {
  return {
    boundaries: [{ startFlattenedIndex: 0, sectionId: null }],
    effectiveDefaultColumns: columnConfig,
  };
}

interface Built {
  state: State;
  layout: LayoutBox;
  shaper: TextShaper;
  page0: LayoutBox;
}

/**
 * Build a real-state document of `paragraphTexts.length` paragraphs (`p0`..),
 * lay it out as a 2-column page via the virtual pipeline, and materialize the
 * positioned root. Mirrors the harness in line-navigation-multicolumn.test.ts /
 * hit-test-multicolumn.test.ts (kept local so the spanning fixture is
 * self-contained).
 */
function buildMulticolumnDoc(
  paragraphTexts: readonly string[],
  pageConfig: PageConfig,
  columnConfig: ColumnConfig,
): Built {
  const blockIds = paragraphTexts.map((_, i) => `p${i}`);
  const state = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        firstChildId: blockIds[0],
        lastChildId: blockIds[blockIds.length - 1],
      }),
      ...paragraphTexts.map((t, i) =>
        buildBlock({
          id: nth(blockIds, i, "blockId"),
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: i > 0 ? blockIds[i - 1] : undefined,
          nextSiblingId: i < blockIds.length - 1 ? blockIds[i + 1] : undefined,
          inlineContent: inlineContent([text(t)]),
        }),
      ),
    ],
  });
  const rendered = render(
    state,
    createDefaultComponentRegistry(),
    createDefaultAttrRegistry(),
  ).root;
  const cascaded = cascadePass(rendered);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  const root = cascaded as ElementBox;

  const pageContentInlineSize =
    pageConfig.pageInlineSize - pageConfig.pageMargins.inlineStart - pageConfig.pageMargins.inlineEnd;
  const shaper = createMockShaper(CHAR_W, LINE_H);
  const metas = buildBlockFitMetas(root, shaper, undefined, pageContentInlineSize);
  // `buildMetasAtWidth` is REQUIRED for correct multicol pagination: the measure
  // pass's multicol branch rebuilds metas at each column's TRACK width so the
  // planned ColumnFit matches `materializePage`'s narrow-track layout. Without
  // it the plan is built at the FULL page width — fine for single-line
  // paragraphs (width-independent), but for a paragraph that WRAPS DIFFERENTLY
  // at track vs page width (this spanning fixture) it drives a measure-vs-
  // materialize ColumnFit drift throw. Mirrors `virtual-producer.ts`.
  const plan = measurePass(
    metas,
    pageConfig,
    columnSectionPlan(columnConfig),
    root.children,
    undefined,
    undefined,
    (inlineSize) => buildBlockFitMetas(root, shaper, undefined, inlineSize),
  );
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
  const virtual = makeVirtualLayoutTree(plan, root, ctx, createMockShaper(CHAR_W, LINE_H), pageConfig);

  const layout = positionTreeForTest(virtual);
  const page0 = virtual.getPage(0);
  return { state, layout, shaper, page0 };
}

describe("cursor-position / selection-geometry — multi-column SPANNING block (same block id in both columns)", () => {
  // ONE tall paragraph. The narrow page (600px inline, 2 columns, 40px gap →
  // ~280px tracks = 35 chars/line at 8px/char) wraps the single block to many
  // lines; a SHORT 64px body balances to 4 lines/column → column 0 holds the
  // first 4 lines, column 1 the rest. All lines carry `ownerBlockId === "p0"`,
  // so the SAME block spans both columns.
  const columnGap = 40;
  const pageConfig = noMarginPageConfig(64, 600);
  const columnConfig: ColumnConfig = { columnCount: 2, columnGap, columnRule: null };
  // 40 "word " tokens → ~200 chars → wraps to ~8 lines at the track width.
  const tallParagraph = "word ".repeat(40).trim();

  function geometry() {
    const built = buildMulticolumnDoc([tallParagraph], pageConfig, columnConfig);
    // Partition lines into columns GEOMETRICALLY by each line's absoluteX falling
    // within the column box's inline range — exactly how the column-aware hit-test
    // picks a column. (The SAME block id spans both columns, so only the
    // x-position disambiguates — which is the whole point of this fixture.)
    if (built.page0.type !== "page") throw new Error("expected page box");
    const body = nth(built.page0.children, 0, "body");
    if (body.type !== "multicolumn") throw new Error("expected a MultiColumnBox body");
    const col0 = nth(body.columns, 0, "column 0");
    const col1 = nth(body.columns, 1, "column 1");
    const allLines = getLineIndex(built.layout).all;
    const inColumn = (l: AbsoluteLineBox, col: { x: number; width: number }): boolean =>
      l.absoluteX >= col.x && l.absoluteX < col.x + col.width;
    const col0Lines = allLines.filter((l) => inColumn(l, col0));
    const col1Lines = allLines.filter((l) => inColumn(l, col1));

    // Each column's x-range, read straight off its lines' absoluteX (no need to
    // reach into MultiColumnBox geometry). Column 0 clusters at track 0; column
    // 1 at trackInlineSize + columnGap. The midpoint of [col0 max-x, col1
    // min-x] is the inter-column GAP center — a clean separator for assertions.
    const col0MinX = Math.min(...col0Lines.map((l) => l.absoluteX));
    const col0MaxX = Math.max(...col0Lines.map((l) => l.absoluteX));
    const col1MinX = Math.min(...col1Lines.map((l) => l.absoluteX));
    const col1MaxX = Math.max(...col1Lines.map((l) => l.absoluteX));

    return {
      ...built,
      allLines,
      col0Lines,
      col1Lines,
      col0MinX,
      col0MaxX,
      col1MinX,
      col1MaxX,
    };
  }

  it("PRECONDITION: the single block 'p0' has lines in BOTH columns (it spans the boundary)", () => {
    const { col0Lines, col1Lines } = geometry();
    expect(col0Lines.length).toBeGreaterThan(0);
    expect(col1Lines.length).toBeGreaterThan(0);
    // The load-bearing premise: the SAME block id appears in both columns.
    const col0HasP0 = col0Lines.some((l) => l.line.ownerBlockId === "p0");
    const col1HasP0 = col1Lines.some((l) => l.line.ownerBlockId === "p0");
    expect(col0HasP0 && col1HasP0).toBe(true);
    // And column 1's track is genuinely to the right of column 0's (a real gap,
    // not overlapping tracks) — otherwise the column-x assertions below are
    // vacuous.
    const { col0MaxX, col1MinX } = geometry();
    expect(col1MinX).toBeGreaterThan(col0MaxX);
  });

  it("a caret whose line is in COLUMN 1 resolves to column-1 coords, NOT column 0 (load-bearing)", () => {
    const { state, layout, shaper, col1Lines, col0MaxX, col1MinX } = geometry();

    // A line that lives in column 1 but belongs to the SAME block 'p0'.
    const target = col1Lines.find((l) => l.line.ownerBlockId === "p0");
    expect(target).toBeDefined();
    if (target === undefined) return;

    // An offset within that column-1 line.
    const caret = createPosition(target.line.ownerBlockId, target.line.inlineOffsetStart);
    const pixel = resolvePixelPosition(state, caret, layout, shaper);
    expect(pixel).not.toBeNull();
    if (pixel === null) return;

    // The caret must sit in column 1's x-range (at/right of the gap center),
    // NOT back in column 0. A column-blind resolver (using block-id-only
    // lookup) would resolve this column-1 offset to a column-0 line's x.
    const gapCenter = (col0MaxX + col1MinX) / 2;
    expect(pixel.x).toBeGreaterThanOrEqual(gapCenter);
    // And specifically aligned with the target line's own track origin.
    expect(pixel.x).toBeGreaterThanOrEqual(target.absoluteX);
  });

  it("round-trips a column-1 caret AND a column-0 caret through hit-test across the boundary", () => {
    const { state, layout, shaper, col0Lines, col1Lines } = geometry();

    const roundTrip = (al: AbsoluteLineBox): void => {
      // Use an offset strictly INSIDE the line (start + 1, clamped to end) so
      // the soft-wrap boundary preference can't pull the resolve onto a
      // neighbouring line during the round-trip.
      const off = Math.min(al.line.inlineOffsetStart + 1, al.line.inlineOffsetEnd);
      const pos = createPosition(al.line.ownerBlockId, off);
      const pixel = resolvePixelPosition(state, pos, layout, shaper);
      expect(pixel).not.toBeNull();
      if (pixel === null) return;

      const hit = resolvePositionFromPixel(state, layout, shaper, pixel.x, pixel.y, 0);
      expect(hit).not.toBeNull();
      if (hit === null) return;
      expect(hit.position.blockId).toBe(pos.blockId);
      // Adjacency tolerance of 1 absorbs a leading/trailing affinity choice at
      // the click point; the column must be recovered exactly (same block,
      // same line band).
      expect(Math.abs(hit.position.offset - off)).toBeLessThanOrEqual(1);
    };

    const c1 = col1Lines.find((l) => l.line.ownerBlockId === "p0");
    const c0 = col0Lines.find((l) => l.line.ownerBlockId === "p0");
    expect(c1).toBeDefined();
    expect(c0).toBeDefined();
    if (c1 === undefined || c0 === undefined) return;
    roundTrip(c1);
    roundTrip(c0);
  });

  it("selection from a column-0 offset to a column-1 offset (SAME block) draws rects in both columns and NONE spanning the gap", () => {
    const { state, layout, shaper, col0Lines, col1Lines, col0MaxX, col1MinX } = geometry();

    const c0 = col0Lines.find((l) => l.line.ownerBlockId === "p0");
    const c1 = col1Lines.find((l) => l.line.ownerBlockId === "p0");
    expect(c0).toBeDefined();
    expect(c1).toBeDefined();
    if (c0 === undefined || c1 === undefined) return;

    // Anchor mid-way into a column-0 line; focus mid-way into a column-1 line.
    const c0Off = Math.min(
      c0.line.inlineOffsetStart + 2,
      c0.line.inlineOffsetEnd,
    );
    const c1Off = Math.min(
      c1.line.inlineOffsetStart + 2,
      c1.line.inlineOffsetEnd,
    );
    // Both lines belong to the SAME spanning block; reuse its branded
    // `ownerBlockId` (a plain `"p0"` string is not assignable to `BlockId`).
    const blockId = c0.line.ownerBlockId;
    const span = createSpan(
      createPosition(blockId, c0Off),
      createPosition(blockId, c1Off),
    );

    const rects = computeSelectionRects(state, span, layout, shaper);

    // (a) multi-line selection across the boundary → at least 2 rects.
    expect(rects.length).toBeGreaterThanOrEqual(2);

    // (b) at least one rect in each column's x-range.
    const hasCol0Rect = rects.some((r) => r.x < col0MaxX + CHAR_W);
    const hasCol1Rect = rects.some((r) => r.x + r.width > col1MinX);
    expect(hasCol0Rect).toBe(true);
    expect(hasCol1Rect).toBe(true);

    // (c) NO rect straddles the inter-column gap (the classic multicol
    // selection bug: a single strip from inside column 0 through the gap into
    // column 1). A gap-spanner has left edge inside column 0's track AND right
    // edge inside column 1's track.
    const gapSpanner = rects.find(
      (r) => r.x < col0MaxX && r.x + r.width > col1MinX,
    );
    expect(gapSpanner).toBeUndefined();
  });
});
