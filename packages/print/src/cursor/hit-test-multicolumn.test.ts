// packages/core/src/cursor/hit-test-multicolumn.test.ts
//
// Multi-column slice 3a — COLUMN-AWARE hit-test (the column-X filter).
//
// `materializePage` builds a `MultiColumnBox` for a multicol page: N side-by-side
// column tracks, each a `BlockBox` holding a contiguous doc-order run. The
// flattened `AbsoluteLineBox` set then contains lines from ALL columns sharing
// the same block (Y) band. The hit-test line PICKER is inline-axis-UNAWARE until
// the in-line leaf pick, so for two columns at the same Y a click in the RIGHT
// column would resolve into the LEFT column's line — wrong column. Slice 3a adds
// a column restriction (mirroring the table-cell restriction) so the band+leaf
// pick runs WITHIN the clicked column.
//
// This test builds a REAL state-backed 2-column page (so the lines carry real
// `ownerBlockId`s `resolveBlock` accepts) and asserts a click in column 1 lands
// in a column-1 block, a click in column 0 in a column-0 block. It FAILS before
// the column restriction (column-1 click wrongly resolves into a column-0 block).

import { describe, it, expect } from "vitest";
import { resolveHitPosition as resolvePositionFromPixel } from "../test-utils/hit-position";
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
import { getLineIndex } from "./line-flatten";
import type { AbsoluteLineBox } from "./line-flatten";
import type { ElementBox } from "@taleweaver/core";
import type { PageConfig } from "../layout/page-config";
import type { SectionPlan } from "../layout/section-plan";
import type { ColumnConfig } from "@taleweaver/core";
import type { LayoutBox, MultiColumnBox, BlockBox } from "../layout/layout-box";
import type { TextShaper } from "@taleweaver/core";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "@taleweaver/core";
import type { State, BlockId } from "@taleweaver/core";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

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
 * Build a real-state document of `n` single-line paragraphs (`p0`..`p{n-1}`),
 * lay it out as a 2-column page via the virtual pipeline, and materialize the
 * positioned root. Each block holds one short line so columns 0 and 1 carry
 * DISTINCT blocks at overlapping Y bands.
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
          id: nth(blockIds, i, "block id"),
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
  const plan = measurePass(metas, pageConfig, columnSectionPlan(columnConfig), root.children);
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
  const virtual = makeVirtualLayoutTree(plan, root, ctx, createMockShaper(CHAR_W, LINE_H), pageConfig);

  const layout = positionTreeForTest(virtual);
  const page0 = virtual.getPage(0);
  return { state, layout, shaper, page0 };
}

describe("hit-test — multi-column column-X filter (slice 3a)", () => {
  // 8 one-line paragraphs, 2 columns. 8 lines at 16px = 128px of content; a
  // 64px page body balances to 4 lines/column → columns 0 and 1 each hold 4
  // DISTINCT blocks, sharing the same Y band [0, 64).
  const columnGap = 40;
  const pageConfig = noMarginPageConfig(64, 600);
  const columnConfig: ColumnConfig = { columnCount: 2, columnGap, columnRule: null };
  const texts = Array.from({ length: 8 }, (_, i) => `para${i}`);

  function geometry() {
    const built = buildMulticolumnDoc(texts, pageConfig, columnConfig);
    const page0 = built.page0;
    if (page0.type !== "page") throw new Error("expected page box");
    const body = nth(page0.children, 0, "page child");
    if (body.type !== "multicolumn") throw new Error("expected a MultiColumnBox body");
    const mc = body as MultiColumnBox;
    const col0 = nth(mc.columns, 0, "column");
    const col1 = nth(mc.columns, 1, "column");
    return { ...built, mc, col0, col1 };
  }

  it("a single 2-column page splits content into two columns with distinct blocks at the same Y", () => {
    const { col0, col1 } = geometry();
    // Distinct, non-empty columns — the test geometry precondition.
    expect(col0.children.length).toBeGreaterThan(0);
    expect(col1.children.length).toBeGreaterThan(0);
  });

  it("a click in column 1 (right) at a shared Y resolves to a column-1 block, not column 0", () => {
    const { state, layout, shaper, mc, col0, col1 } = geometry();

    // The set of blockIds laid out in each column, partitioned GEOMETRICALLY by
    // each line's absoluteX falling within the column box's inline range — exactly
    // how the column-aware hit-test picks a column.
    const allLines = getLineIndex(layout).all;
    const inColumn = (l: AbsoluteLineBox, col: BlockBox): boolean =>
      l.absoluteX >= col.x && l.absoluteX < col.x + col.width;
    const col0Blocks = new Set(
      allLines.filter((l) => inColumn(l, col0)).map((l) => l.line.ownerBlockId),
    );
    const col1Blocks = new Set(
      allLines.filter((l) => inColumn(l, col1)).map((l) => l.line.ownerBlockId),
    );
    expect(col0Blocks.size).toBeGreaterThan(0);
    expect(col1Blocks.size).toBeGreaterThan(0);

    // A Y in the FIRST line band shared by both columns (both columns start at
    // the body block-offset; the first line of each sits there).
    const sharedY = mc.blockOffset + LINE_H / 2;
    // An X clearly inside column 1 (mid-track of the right column).
    const col1X = col1.x + col1.width / 2;
    const col0X = col0.x + col0.width / 2;

    const hitCol1 = resolvePositionFromPixel(state, layout, shaper, col1X, sharedY, 0);
    expect(hitCol1).not.toBeNull();
    if (hitCol1 === null) return;
    // The resolved block must belong to column 1, NOT column 0.
    expect(col1Blocks.has(hitCol1.blockId as BlockId)).toBe(true);
    expect(col0Blocks.has(hitCol1.blockId as BlockId)).toBe(false);

    // Symmetric: a click in column 0 resolves to a column-0 block.
    const hitCol0 = resolvePositionFromPixel(state, layout, shaper, col0X, sharedY, 0);
    expect(hitCol0).not.toBeNull();
    if (hitCol0 === null) return;
    expect(col0Blocks.has(hitCol0.blockId as BlockId)).toBe(true);
    expect(col1Blocks.has(hitCol0.blockId as BlockId)).toBe(false);
  });
});
