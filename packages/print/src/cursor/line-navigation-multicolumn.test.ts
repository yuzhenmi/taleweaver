// packages/core/src/cursor/line-navigation-multicolumn.test.ts
//
// Multi-column slice 3b — COLUMN-AWARE line navigation (ArrowUp/Down across
// columns).
//
// `moveToLineOnPage` selects the up/down TARGET line by document-order index
// in the flattened LineIndex; for a multicol page that order is
// [column 0 lines top→bottom, column 1 lines top→bottom], which IS the correct
// visual column-flow order — so the SELECTION is already right (Down from
// column 0's last line selects column 1's first line; Up from column 1's first
// line selects column 0's last line).
//
// The BUG was in `resolveTargetLine`: it re-picked the line from scratch via
// the FULL hit-test at `(clickX = the preserved inline goal X, clickY = the
// target's block edge)`. After slice 3a the hit-test restricts candidates to
// the column containing `clickX`; for a cross-column move the goal X is the
// SOURCE column's X, so the hit-test re-picked a SOURCE-column line at the
// target's Y — never reaching the other column. The slice-3b fix CLAMPS the
// preserved inline goal to the TARGET line's own inline extent before building
// the hit-test click point, so the click sits inside the target's column and
// the column-restricted band-pick lands on the target's column. The RETURNED
// `targetX` stays the ORIGINAL unclamped goal so Up-undoes-Down returns to the
// original column.
//
// These tests REUSE the multicol fixture (`buildMulticolumnDoc`) and drive the
// real `moveToLine` path through the positioned layout. Each cross-column case
// FAILS before the clamp (resolves back into the SOURCE column) and PASSES
// after; the within-column case proves no single-column regression.

import { describe, it, expect } from "vitest";
import { moveToLine } from "./line-navigation";
import { resolvePixelPosition } from "./cursor-position";
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
import { createPosition } from "@taleweaver/core";
import type { ElementBox } from "@taleweaver/core";
import type { PageConfig } from "../layout/page-config";
import type { SectionPlan } from "../layout/section-plan";
import type { ColumnConfig } from "@taleweaver/core";
import type { LayoutBox, MultiColumnBox } from "../layout/layout-box";
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
 * Build a real-state document of single-line paragraphs (`p0`..`p{n-1}`), lay
 * it out as a 2-column page via the virtual pipeline, and materialize the
 * positioned root. Each block holds one short line so columns 0 and 1 carry
 * DISTINCT blocks at overlapping Y bands. (Mirrors hit-test-multicolumn.test.ts.)
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
  // planned ColumnFit matches `materializePage`'s narrow-track layout. For the
  // single-line fixtures it is a no-op (each paragraph fits on one line at any
  // width), but the within-block spanning fixture below has a paragraph that
  // WRAPS DIFFERENTLY at track vs page width — without the closure that drives a
  // measure-vs-materialize ColumnFit drift throw. Mirrors `virtual-producer.ts`.
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

describe("line-navigation — multi-column column-aware ArrowUp/Down (slice 3b)", () => {
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
    const body = nth(page0.children, 0, "body");
    if (body.type !== "multicolumn") throw new Error("expected a MultiColumnBox body");
    const mc = body as MultiColumnBox;
    const col0 = nth(mc.columns, 0, "column 0");
    const col1 = nth(mc.columns, 1, "column 1");

    // Column membership: blockIds laid out in each column, in TOP→BOTTOM order
    // (the flat line index is doc-order = column-flow order). Partitioned
    // GEOMETRICALLY by each line's absoluteX within the column box's inline range
    // — exactly how the column-aware hit-test picks a column.
    const allLines = getLineIndex(built.layout).all;
    const inColumn = (l: AbsoluteLineBox, col: { x: number; width: number }): boolean =>
      l.absoluteX >= col.x && l.absoluteX < col.x + col.width;
    const col0Lines = allLines.filter((l) => inColumn(l, col0));
    const col1Lines = allLines.filter((l) => inColumn(l, col1));
    const col0Blocks = col0Lines.map((l) => l.line.ownerBlockId);
    const col1Blocks = col1Lines.map((l) => l.line.ownerBlockId);
    const col0Set = new Set(col0Blocks);
    const col1Set = new Set(col1Blocks);

    return {
      ...built,
      mc,
      col0,
      col1,
      col0Lines,
      col1Lines,
      col0Blocks,
      col1Blocks,
      col0Set,
      col1Set,
    };
  }

  it("the fixture splits content into two columns with distinct blocks (precondition)", () => {
    const { col0Set, col1Set } = geometry();
    expect(col0Set.size).toBeGreaterThan(0);
    expect(col1Set.size).toBeGreaterThan(0);
    // Distinct columns: no block appears in both.
    for (const b of col0Set) expect(col1Set.has(b)).toBe(false);
  });

  it("ArrowDown from the LAST line of column 0 crosses into a column-1 block (not back into column 0, not the next page)", () => {
    const { state, layout, shaper, col0Lines, col0Set, col1Set } = geometry();

    // Caret on the LAST (bottom-most) line of column 0.
    const lastCol0 = nth(col0Lines, col0Lines.length - 1, "col0 last line");
    const caret = createPosition(lastCol0.line.ownerBlockId, lastCol0.line.inlineOffsetStart);

    // Goal X squarely inside column 0 (the SOURCE column's X). Before the clamp
    // fix the hit-test re-picks a column-0 line at the target's Y → resolves
    // back into column 0 (wrong).
    const goalX = lastCol0.absoluteX + 1;

    const result = moveToLine(state, caret, layout, shaper, "down", goalX);
    expect(result).not.toBeNull();
    if (result === null) return;

    const landed = result.position.blockId as BlockId;
    expect(col1Set.has(landed)).toBe(true);
    expect(col0Set.has(landed)).toBe(false);
  });

  it("ArrowUp from the FIRST line of column 1 crosses into a column-0 block", () => {
    const { state, layout, shaper, col1Lines, col0Set, col1Set } = geometry();

    // Caret on the FIRST (top-most) line of column 1.
    const firstCol1 = nth(col1Lines, 0, "col1 first line");
    const caret = createPosition(firstCol1.line.ownerBlockId, firstCol1.line.inlineOffsetStart);

    // Goal X squarely inside column 1 (the SOURCE column's X).
    const goalX = firstCol1.absoluteX + 1;

    const result = moveToLine(state, caret, layout, shaper, "up", goalX);
    expect(result).not.toBeNull();
    if (result === null) return;

    const landed = result.position.blockId as BlockId;
    expect(col0Set.has(landed)).toBe(true);
    expect(col1Set.has(landed)).toBe(false);
  });

  it("ArrowDown WITHIN column 0 stays in column 0 (no single-column-style regression)", () => {
    const { state, layout, shaper, col0Lines, col0Set } = geometry();
    expect(col0Lines.length).toBeGreaterThanOrEqual(2);

    // Caret on a NON-last line of column 0 (the first).
    const firstCol0 = nth(col0Lines, 0, "col0 first line");
    const caret = createPosition(firstCol0.line.ownerBlockId, firstCol0.line.inlineOffsetStart);
    const goalX = firstCol0.absoluteX + 1;

    const result = moveToLine(state, caret, layout, shaper, "down", goalX);
    expect(result).not.toBeNull();
    if (result === null) return;

    const landed = result.position.blockId as BlockId;
    // Still in column 0, and specifically the NEXT column-0 block down.
    expect(col0Set.has(landed)).toBe(true);
    expect(landed).toBe(nth(col0Lines, 1, "col0 second line").line.ownerBlockId);
  });

  it("Down across the boundary then Up returns to a column-0 block (original-targetX preservation)", () => {
    const { state, layout, shaper, col0Lines, col0Set, col1Set } = geometry();

    const lastCol0 = nth(col0Lines, col0Lines.length - 1, "col0 last line");
    const caret = createPosition(lastCol0.line.ownerBlockId, lastCol0.line.inlineOffsetStart);
    const goalX = lastCol0.absoluteX + 1;

    const down = moveToLine(state, caret, layout, shaper, "down", goalX);
    expect(down).not.toBeNull();
    if (down === null) return;
    expect(col1Set.has(down.position.blockId as BlockId)).toBe(true);
    // The returned targetX must be the ORIGINAL unclamped goal, preserving the
    // column-0 goal across the next move.
    expect(down.targetX).toBe(goalX);

    const up = moveToLine(state, down.position, layout, shaper, "up", down.targetX);
    expect(up).not.toBeNull();
    if (up === null) return;
    // Back into column 0 (the original column) — preserved goal X re-clamps to
    // a column-0 line.
    expect(col0Set.has(up.position.blockId as BlockId)).toBe(true);
  });
});

describe("line-navigation — multi-column WITHIN-BLOCK column boundary (same block id in both columns)", () => {
  // ONE tall paragraph fragments across the column boundary, so the SAME block
  // id ("p0") owns lines in BOTH columns (column 0 = lines 0..K-1, column 1 =
  // lines K..end). The cross-BLOCK ArrowDown/Up case above is masked because the
  // landed block id differs per column; here block id alone does NOT
  // disambiguate the column, so a column-blind line-nav bug would surface as
  // ArrowDown/Up resolving back into the wrong column at the SAME block.
  const columnGap = 40;
  const pageConfig = noMarginPageConfig(64, 600);
  const columnConfig: ColumnConfig = { columnCount: 2, columnGap, columnRule: null };
  const tallParagraph = "word ".repeat(40).trim();

  function geometry() {
    const built = buildMulticolumnDoc([tallParagraph], pageConfig, columnConfig);
    // Partition lines into columns GEOMETRICALLY by each line's absoluteX within
    // the column box's inline range (the SAME block id spans both columns, so only
    // the x-position disambiguates) — exactly how the column-aware hit-test picks.
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
    return { ...built, col0Lines, col1Lines };
  }

  it("precondition: one paragraph 'p0' spans BOTH columns (same block id in each)", () => {
    const { col0Lines, col1Lines } = geometry();
    expect(col0Lines.length).toBeGreaterThan(0);
    expect(col1Lines.length).toBeGreaterThan(0);
    expect(col0Lines.every((l) => l.line.ownerBlockId === "p0")).toBe(true);
    expect(col1Lines.every((l) => l.line.ownerBlockId === "p0")).toBe(true);
  });

  it("ArrowDown from the LAST line of column 0 lands on the FIRST line of column 1 (same block, next visual line, larger offset)", () => {
    const { state, layout, shaper, col0Lines, col1Lines } = geometry();

    const lastCol0 = nth(col0Lines, col0Lines.length - 1, "col0 last line");
    const firstCol1 = nth(col1Lines, 0, "col1 first line");
    const caret = createPosition(lastCol0.line.ownerBlockId, lastCol0.line.inlineOffsetStart);
    // Goal X inside column 0 (the SOURCE column).
    const goalX = lastCol0.absoluteX + 1;

    const result = moveToLine(state, caret, layout, shaper, "down", goalX);
    expect(result).not.toBeNull();
    if (result === null) return;

    // Same block (it spans), but the landed offset must be on the column-1
    // continuation — i.e. >= column 1's first line start (a LARGER offset than
    // where column 0 ended), NOT a column-0 offset.
    expect(result.position.blockId).toBe("p0");
    expect(result.position.offset).toBeGreaterThanOrEqual(firstCol1.line.inlineOffsetStart);
    expect(result.position.offset).toBeLessThanOrEqual(firstCol1.line.inlineOffsetEnd);
    // And strictly past where column 0 stopped (the within-block visual advance).
    expect(result.position.offset).toBeGreaterThan(lastCol0.line.inlineOffsetEnd - 1);
  });

  // FOUND BUG (within-block multicol ArrowUp): ArrowUp from the FIRST line of
  // column 1 (top of the right track) should move the caret VISUALLY UP onto the
  // last line of column 0 (bottom of the left track). For a SPANNING block the
  // column boundary is a SOFT-WRAP, so col0's last-line END offset EQUALS col1's
  // first-line START offset (here both 105). `moveToLine` returns the boundary
  // offset (105) WITHOUT a `caretAffinity`, and `handleMoveLine` (move-line.ts)
  // does NOT seed one — so the caret renders with the DEFAULT ("after") affinity,
  // which `resolvePixelPosition` pins to COLUMN 1's first line (the start side of
  // the boundary). Net effect: ArrowUp at the top of column 1 leaves the caret
  // visually in column 1 — it does NOT step up into column 0.
  //
  // The down-direction analog (test above) works because ArrowDown lands at a
  // strictly-larger offset that is unambiguously in column 1; only the UP
  // direction hits the boundary-offset/affinity ambiguity. The cross-BLOCK
  // ArrowUp (slice-3b test) is masked because there the landed offset belongs to
  // a DIFFERENT block whose sole line is in column 0 — no affinity ambiguity.
  //
  // This test asserts the CORRECT behavior (caret resolves into column 0) and is
  // RED until the move-up across a within-block column boundary seeds the
  // "before" affinity (or otherwise lands a column-0-disambiguated position).
  it("ArrowUp from the FIRST line of column 1 lands back in COLUMN 0 (same block) — FOUND BUG: caret stays in column 1", () => {
    const { state, layout, shaper, col0Lines, col1Lines } = geometry();

    const firstCol1 = nth(col1Lines, 0, "col1 first line");
    const lastCol0 = nth(col0Lines, col0Lines.length - 1, "col0 last line");
    const caret = createPosition(firstCol1.line.ownerBlockId, firstCol1.line.inlineOffsetStart);
    // Goal X inside column 1 (the SOURCE column).
    const goalX = firstCol1.absoluteX + 1;

    const result = moveToLine(state, caret, layout, shaper, "up", goalX);
    expect(result).not.toBeNull();
    if (result === null) return;

    // Same spanning block; the landed offset is within column 0's last line
    // [start, end] (offset alone can't separate the columns at this soft-wrap
    // boundary — `lastCol0.end === firstCol1.start`).
    expect(result.position.blockId).toBe("p0");
    expect(result.position.offset).toBeLessThanOrEqual(lastCol0.line.inlineOffsetEnd);
    expect(result.position.offset).toBeGreaterThanOrEqual(lastCol0.line.inlineOffsetStart);

    // The load-bearing column check: resolved with the affinity the move THREADED
    // OUT (#500 — `handleMoveLine` seeds `EditorState.caretAffinity` from this, and
    // `resolvePixelPosition` reads that field), the landed caret must sit in
    // COLUMN 0's x-range (left of the inter-column gap). The shared boundary offset
    // (`lastCol0.end === firstCol1.start`) is ambiguous WITHOUT the affinity — so
    // the move must return `"before"` to pin the caret to column 0's last line.
    expect(result.caretAffinity).toBe("before");
    // The caret resolved with the threaded affinity must sit in COLUMN 0 — i.e.
    // strictly LEFT of column 1's track origin. (The caret lands at column 0's
    // last-line END x = the column-0 content right edge; that edge can exceed the
    // mid-gap point, so the column-membership check is "left of column 1's left
    // edge", NOT "left of the gap center".)
    const col1MinX = Math.min(...col1Lines.map((l) => l.absoluteX));
    const pixel = resolvePixelPosition(state, result.position, layout, shaper, undefined, result.caretAffinity);
    expect(pixel).not.toBeNull();
    if (pixel === null) return;
    expect(pixel.x).toBeLessThan(col1MinX);
  });
});
