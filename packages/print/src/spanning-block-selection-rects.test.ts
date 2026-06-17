// packages/print/src/spanning-block-selection-rects.test.ts
//
// VL bridge removal, Slice 3 (Bucket A). The controller's three spanning-block
// fallbacks — selection rects, find-match highlight, comment highlight — used to
// route through a whole-tree-positioning bridge (`computeSelectionRects` over the
// fully-positioned tree). They now union `computeSelectionRectsForPage` over the
// pages a spanning block covers (`selectionRectsAcrossPages` in the controller).
//
// These tests prove that per-page union (the exact logic the helper runs) on a
// REAL paragraph taller than a page:
//   1. equals `computeSelectionRects` over the materialized tree (no behavior
//      change) — order-insensitive equivalence;
//   2. produces rects on >= 2 DISTINCT page indices, each rect carrying a
//      PAGE-LOCAL y + its `pageIndex` (page-1 rects carry pageIndex 1 with a
//      page-local y, not a doc-absolute y stacked under page-0 — the controller
//      adds the slot offset at paint time).
// The span shape is feature-agnostic: a selection span, a find-match span, and a
// comment-range span over the same boundary block all feed the identical
// `selectionRectsAcrossPages` union — so this property covers all three sites.
//
// Real core (no `@taleweaver/core` mock): we need genuine multi-page geometry,
// which the mock-based editor-controller.test.ts (resolvePixelPosition stubbed to
// pageIndex 0) cannot exercise.
//
// Spec: docs/superpowers/specs/2026-06-09-vl-bridge-removal-design.md §Bucket A.

import { describe, it, expect } from "vitest";
import { createInitialEditorState, reduceEditor, createDefaultComponentRegistry, createDefaultAttrRegistry, createMockMeasurer, createSpan, createPosition, spanStart, spanEnd, INITIAL_COMPUTED_STYLE, getBlock, inlineContentLength, render, cascadePass, type EditorState, type EditorConfig, type State, type Span, type TextShaper, type TextMeasurer, type BlockId, type PageConfig } from "@taleweaver/core";
import { resolvePixelPosition, computeSelectionRects, computeSelectionRectsForPage, createBlockBox, computeUsedStyle, layoutTree, type LayoutBox, type VirtualLayoutTree, type SelectionRect } from "./index";

/**
 * TEST-ONLY oracle: assemble a `VirtualLayoutTree`'s pages into one positioned
 * `LayoutBox` (the equivalence ground truth that replaced the deleted
 * whole-tree-positioning bridge). Each `getPage(i)` is already positioned at its
 * document-absolute `blockOffset`, so wrapping them in a minimal outer box
 * reproduces the bridge's document-absolute line geometry. Production never
 * materializes the whole tree (it reads per-page via `getPage`).
 */
function assembleAllPages(tree: VirtualLayoutTree): LayoutBox {
  const pageCount = tree.plan.entries.length;
  const pages = tree.getPages(0, pageCount - 1);
  const usedStyle = computeUsedStyle(INITIAL_COMPUTED_STYLE, tree.inlineSize, "indefinite");
  return createBlockBox(
    "virtual-root",
    0,
    0,
    tree.inlineSize,
    tree.blockSize,
    INITIAL_COMPUTED_STYLE.writingMode,
    INITIAL_COMPUTED_STYLE.direction,
    INITIAL_COMPUTED_STYLE,
    usedStyle,
    pages,
    tree.inlineSize,
  );
}

const CHAR_W = 8;
const LINE_H = 16;

// A short content area so a single long paragraph wraps across several pages.
// No margins → content block-size == pageBlockSize; at 16px line-height a 96px
// page holds 6 lines.
const PAGE_CONFIG: PageConfig = {
  pageInlineSize: 320,
  pageBlockSize: 96,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 24,
};

function makeConfig(): EditorConfig {
  return {
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: PAGE_CONFIG.pageInlineSize,
    pageConfig: PAGE_CONFIG,
  };
}

// Phase 0b: core's `EditorState` is geometry-free — the layout tree lives in the
// backend driver. Build it via core's render → cascade → layout pipeline (exactly
// what the driver does) so this test exercises the migrated per-page union path
// against a real `VirtualLayoutTree`. The measurer is a print-mechanics input the
// backend supplies (it left core's `EditorConfig` in this phase).
const MEASURER: TextMeasurer = createMockMeasurer(CHAR_W, LINE_H);

function buildVirtualTree(
  state: State,
  config: EditorConfig,
): LayoutBox | VirtualLayoutTree {
  const rendered = render(state, config.componentRegistry, config.attrRegistry);
  const cascaded = cascadePass(rendered.root);
  return layoutTree(cascaded, config.containerWidth, MEASURER, config.pageConfig);
}

/**
 * Build an editor whose first (only) paragraph is long enough to span multiple
 * pages, by typing space-separated short words (frequent break opportunities)
 * into the seeded empty document. Returns the editor state, the layout tree
 * built via the backend pipeline (a real `VirtualLayoutTree`), the body block
 * id, and the measurer.
 */
function buildSpanningEditor(): {
  editor: EditorState;
  tree: LayoutBox | VirtualLayoutTree;
  measurer: TextShaper | TextMeasurer;
  blockId: BlockId;
} {
  const config = makeConfig();
  let editor = createInitialEditorState(config);
  // ~120 words * 5 chars ≈ 600 chars; 40 chars/line ÷ 6 lines/page → ~2.5 pages.
  const words = Array.from({ length: 120 }, () => "xxxx");
  editor = reduceEditor(editor, { type: "INSERT_TEXT", text: words.join(" ") }, config);

  // The seeded body paragraph is the document root's first child.
  const root = getBlock(editor.state, editor.state.rootId);
  const blockId = root?.firstChildId;
  if (blockId === undefined || blockId === null) {
    throw new Error("expected a seeded body paragraph");
  }
  const tree = buildVirtualTree(editor.state, config);
  return { editor, tree, measurer: MEASURER, blockId };
}

function asVirtual(tree: LayoutBox | VirtualLayoutTree): VirtualLayoutTree {
  if (tree.type !== "virtual-root") {
    throw new Error("expected a paginated VirtualLayoutTree fixture");
  }
  return tree;
}

/**
 * The exact per-page union the controller's `selectionRectsAcrossPages` runs:
 * resolve the span's start/end once against the virtual tree, then concat
 * `computeSelectionRectsForPage` over the covered page range. Mirrors the
 * controller helper so this test exercises the migrated path's geometry.
 */
function selectionRectsAcrossPages(
  state: State,
  span: Span,
  tree: VirtualLayoutTree,
  measurer: TextShaper | TextMeasurer,
): SelectionRect[] {
  const startPos = resolvePixelPosition(state, spanStart(state, span), tree, measurer);
  const endPos = resolvePixelPosition(state, spanEnd(state, span), tree, measurer);
  if (startPos === null || endPos === null) return [];
  const rects: SelectionRect[] = [];
  for (let p = startPos.pageIndex; p <= endPos.pageIndex; p++) {
    rects.push(
      ...computeSelectionRectsForPage(state, span, tree.getPage(p), p, startPos, endPos, measurer),
    );
  }
  return rects;
}

// Order-insensitive rect key (pages may emit in a different order than a single
// materialized walk).
function rectKey(r: SelectionRect): string {
  return `${r.pageIndex}|${r.x}|${r.y}|${r.width}|${r.height}`;
}
function sortedKeys(rects: readonly SelectionRect[]): string[] {
  return rects.map(rectKey).sort();
}

describe("spanning-block selection rects: per-page union (VL Slice 3)", () => {
  it("the boundary block really spans >= 2 pages (fixture sanity)", () => {
    const { tree, blockId } = buildSpanningEditor();
    const virtual = asVirtual(tree);
    expect(virtual.plan.entries.length).toBeGreaterThanOrEqual(2);
    const span = virtual.plan.pageSpanOfBlock(blockId);
    expect(span).not.toBeNull();
    expect(span && span.first !== span.last).toBe(true);
  });

  it("per-page union equals computeSelectionRects over the materialized tree (no behavior change)", () => {
    const { editor, tree, measurer, blockId } = buildSpanningEditor();
    const virtual = asVirtual(tree);
    // Oracle: assemble all pages into one positioned tree (replaces the deleted
    // whole-tree-positioning bridge; see VL bridge removal spec §testing).
    const positioned = assembleAllPages(virtual);

    const blk = getBlock(editor.state, blockId);
    const total = blk?.inlineContent ? inlineContentLength(blk.inlineContent) : 0;
    expect(total).toBeGreaterThan(0);

    // A span covering the whole spanning block. (Feature-agnostic: a selection,
    // find-match, or comment-range span over this block all union identically.)
    const span = createSpan(
      createPosition(blockId, 0),
      createPosition(blockId, total),
    );

    const perPage = selectionRectsAcrossPages(editor.state, span, virtual, measurer);
    const oracle = computeSelectionRects(editor.state, span, positioned, measurer);

    expect(perPage.length).toBe(oracle.length);
    expect(sortedKeys(perPage)).toEqual(sortedKeys(oracle));
  });

  it("union spans >= 2 DISTINCT pageIndex values, each with that page's absolute Y", () => {
    const { editor, tree, measurer, blockId } = buildSpanningEditor();
    const virtual = asVirtual(tree);

    const blk = getBlock(editor.state, blockId);
    const total = blk?.inlineContent ? inlineContentLength(blk.inlineContent) : 0;
    const span = createSpan(
      createPosition(blockId, 0),
      createPosition(blockId, total),
    );

    const rects = selectionRectsAcrossPages(editor.state, span, virtual, measurer);
    expect(rects.length).toBeGreaterThan(0);

    const pages = new Set(rects.map((r) => r.pageIndex));
    expect(pages.size).toBeGreaterThanOrEqual(2);

    // Per-page contract: each rect's `y` is PAGE-LOCAL (0 at the page's content
    // top) and its `pageIndex` says which page's frame it belongs under — the
    // controller adds the slot offset at paint time. So page-1 rects carry
    // pageIndex 1 with a page-local y, NOT a doc-absolute y stacked under
    // page 0. Assert each y stays within its page's content block-size.
    for (const r of rects) {
      const entry = virtual.plan.entries[r.pageIndex];
      if (entry === undefined) throw new Error(`expected plan entry at page ${r.pageIndex}`);
      expect(r.y).toBeGreaterThanOrEqual(-0.5);
      expect(r.y).toBeLessThanOrEqual(entry.blockSize + 0.5);
    }
    // A rect on page 1 exists with pageIndex 1 (the boundary block's
    // continuation), distinct from page 0's rects — proves per-page placement.
    expect(rects.some((r) => r.pageIndex === 0)).toBe(true);
    expect(rects.some((r) => r.pageIndex >= 1)).toBe(true);
  });

  it("a partial span ending mid-block on page 1 still emits page-0 + page-1 rects", () => {
    const { editor, tree, measurer, blockId } = buildSpanningEditor();
    const virtual = asVirtual(tree);
    // Oracle: assemble all pages into one positioned tree (replaces the deleted
    // whole-tree-positioning bridge; see VL bridge removal spec §testing).
    const positioned = assembleAllPages(virtual);

    const blk = getBlock(editor.state, blockId);
    const total = blk?.inlineContent ? inlineContentLength(blk.inlineContent) : 0;

    // End the span partway in (past the first page's lines), keeping a real
    // cross-page boundary while exercising the cull/clamp at both ends.
    const span = createSpan(
      createPosition(blockId, 10),
      createPosition(blockId, Math.min(total, 320)),
    );

    const perPage = selectionRectsAcrossPages(editor.state, span, virtual, measurer);
    const oracle = computeSelectionRects(editor.state, span, positioned, measurer);

    expect(sortedKeys(perPage)).toEqual(sortedKeys(oracle));
    expect(new Set(perPage.map((r) => r.pageIndex)).size).toBeGreaterThanOrEqual(2);
  });
});
