// Phase-4: moveToLine / moveToLineBoundary must resolve against a
// VirtualLayoutTree PER-PAGE (caret page + at most one adjacent page), never
// the assembled positioned tree (oracle). Two guarantees:
//   1. EQUIVALENCE: the per-page result equals the positioned-tree oracle
//      result (the current shipped behavior = ground truth) for every position
//      and direction, including page-boundary crossings.
//   2. PERF: one moveToLine on a large doc materializes O(1) pages, not O(N).
//
// Migrated from `packages/core/src/cursor/line-navigation-virtual.test.ts`
// (Phase 0b: MOVE_LINE / MOVE_LINE_BOUNDARY / EXPAND_LINE left core's reducer
// for the print backend's `resolveNavIntent`). The virtual layout tree is now
// built by the driver via `makeNavEditor`'s `pageConfig` option (read with
// `layoutOf`); the bridge/oracle positioned tree is assembled from that virtual
// tree's own `getPages` with the public `createBlockBox`, exactly reproducing
// the geometry the deleted `positionTreeForTest` / `paginateRoot` oracles
// produced. The behavior block drives MOVE_LINE / MOVE_LINE_BOUNDARY keystrokes
// through `nav` (NavIntent → resolveNavIntent → reduceEditor). Assertions
// byte-identical.
import { describe, it, expect, beforeEach } from "vitest";
import { createMockShaper, getBlock, createPosition, createSpan, INITIAL_COMPUTED_STYLE, type PageConfig, type TextShaper, type BlockId } from "@taleweaver/core";
import { computeUsedStyle, createBlockBox, moveToLine, moveToLineBoundary, resolvePixelPosition, getLineIndex, __getGetPageDriverCountForTest, __resetGetPageDriverCountForTest, type LayoutBox, type VirtualLayoutTree } from "../index";
import {
  makeNavEditor,
  dispatch,
  nav,
  layoutOf,
  type NavCtx,
} from "./nav-test-helpers";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

// Small pages so a handful of one-line paragraphs span several pages.
// mock shaper line height 16; margins 0; pageBlockSize 64 ⇒ 4 lines/page.
function makePageConfig(pageBlockSize = 64): PageConfig {
  return {
    pageInlineSize: 800,
    pageBlockSize,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };
}

/** The mock shaper that matches the driver's measurer (8px/char, 16px line-height). */
const sharedMeasurer: TextShaper = createMockShaper(8, 16);

/** A driver-backed paginated nav context (charWidth 8, lineHeight 16). */
function makeCtx(pageBlockSize = 64): NavCtx {
  return makeNavEditor({
    pageConfig: makePageConfig(pageBlockSize),
    containerWidth: 800,
    charWidth: 8,
    lineHeight: 16,
  });
}

/** The driver-built virtual tree for the context's CURRENT state. */
function virtualTree(ctx: NavCtx): VirtualLayoutTree {
  const lt = layoutOf(ctx);
  if (lt.type !== "virtual-root") throw new Error("expected virtual");
  return lt;
}

/**
 * Assemble a VirtualLayoutTree's pages into one positioned `BlockBox` — the
 * equivalence oracle the per-page line-nav must deep-equal. Each `getPage(i)` is
 * already positioned at its document-absolute `blockOffset`; wrapping them in a
 * minimal outer box reproduces the document-absolute coordinate space the former
 * whole-tree-positioning bridge / `paginateRoot` oracle produced.
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

/** Build an N-paragraph doc in one O(N) PASTE (one paragraph per line). */
function buildPasted(pageBlockSize: number, n: number): NavCtx {
  const ctx = makeCtx(pageBlockSize);
  const text = Array.from({ length: n }, (_, i) => `para ${i}`).join("\n");
  return dispatch(ctx, { type: "PASTE", text });
}

function nthBlockId(ctx: NavCtx, n: number): BlockId {
  const root = getBlock(ctx.editor.state, ctx.editor.state.rootId);
  if (root === null || root.firstChildId === null) throw new Error("no blocks");
  let id: BlockId | null = root.firstChildId;
  for (let i = 0; i < n && id !== null; i++) {
    id = getBlock(ctx.editor.state, id)?.nextSiblingId ?? null;
  }
  if (id === null) throw new Error(`no block ${n}`);
  return id;
}

/**
 * Build a context whose SOLE body child is ONE paragraph tall enough to span
 * `pages` pages (via soft-wrap), so its line fragments live on multiple pages.
 * Returns the context + the spanning paragraph's block id. PASTE of a single
 * space-separated string (no `\n`) keeps it one paragraph that wraps.
 */
function buildSpanningEditor(
  pageBlockSize: number,
  pages: number,
): { ctx: NavCtx; blockId: BlockId } {
  // 800px page, 8px/char ⇒ ~100 chars/line; pageBlockSize 64 ⇒ 4 lines/page.
  // Use short words so the run wraps at break opportunities. Generously
  // overshoot the line budget so the paragraph definitively spans `pages`.
  const linesPerPage = 4;
  const charsPerLine = 90; // < 100 so each visual line is comfortably full
  const wordsNeeded = Math.ceil((pages * linesPerPage * charsPerLine) / 6) + 20;
  const text = Array.from({ length: wordsNeeded }, (_, i) => `w${i}`).join(" ");
  const ctx = dispatch(makeCtx(pageBlockSize), { type: "PASTE", text });
  const root = getBlock(ctx.editor.state, ctx.editor.state.rootId);
  if (root === null || root.firstChildId === null) throw new Error("no blocks");
  return { ctx, blockId: root.firstChildId };
}

describe("line-navigation on a VirtualLayoutTree (Phase-4 per-page)", () => {
  describe("moveToLine equivalence vs the positioned-tree oracle", () => {
    // 16 one-line paragraphs over 4-line pages ⇒ 4 pages.
    const ctx = buildPasted(64, 16);
    const tree = virtualTree(ctx);
    const bridge = assembleAllPages(tree);

    // Positions chosen to exercise: within-page, first line of a non-first
    // page, last line of a page, doc top, doc bottom.
    const cases: { name: string; blockIdx: number; dir: "up" | "down" }[] = [
      { name: "within page 0, up", blockIdx: 2, dir: "up" },
      { name: "within page 0, down", blockIdx: 1, dir: "down" },
      { name: "first line of page 1, up (→ last of page 0)", blockIdx: 4, dir: "up" },
      { name: "last line of page 0, down (→ first of page 1)", blockIdx: 3, dir: "down" },
      { name: "first line of page 2, up (→ last of page 1)", blockIdx: 8, dir: "up" },
      { name: "doc top, up (→ start of doc)", blockIdx: 0, dir: "up" },
      { name: "doc bottom, down (→ end of doc)", blockIdx: 15, dir: "down" },
    ];

    for (const c of cases) {
      it(c.name, () => {
        const pos = createPosition(nthBlockId(ctx, c.blockIdx), 2);
        const viaVirtual = moveToLine(ctx.editor.state, pos, tree, sharedMeasurer, c.dir, null);
        const viaBridge = moveToLine(ctx.editor.state, pos, bridge, sharedMeasurer, c.dir, null);
        expect(viaVirtual).toEqual(viaBridge);
      });
    }
  });

  describe("moveToLineBoundary equivalence vs the positioned-tree oracle", () => {
    const ctx = buildPasted(64, 16);
    const tree = virtualTree(ctx);
    const bridge = assembleAllPages(tree);

    for (const boundary of ["start", "end"] as const) {
      for (const blockIdx of [0, 5, 9, 15]) {
        it(`${boundary} on block ${blockIdx}`, () => {
          const pos = createPosition(nthBlockId(ctx, blockIdx), 3);
          const viaVirtual = moveToLineBoundary(ctx.editor.state, pos, tree, sharedMeasurer, boundary);
          const viaBridge = moveToLineBoundary(ctx.editor.state, pos, bridge, sharedMeasurer, boundary);
          expect(viaVirtual).toEqual(viaBridge);
        });
      }
    }
  });

  describe("perf: one moveToLine materializes O(1) pages, not O(N)", () => {
    beforeEach(() => __resetGetPageDriverCountForTest());

    it("a within-page move on a ~30-page doc materializes ≤ 3 pages", () => {
      // 120 one-line paragraphs over 4-line pages ⇒ 30 pages.
      const ctx = buildPasted(64, 120);
      const tree = virtualTree(ctx);
      // Fresh tree: no pages materialized yet. Move from a mid-document block
      // (well inside a page, not at a boundary) DOWN one line.
      const pos = createPosition(nthBlockId(ctx, 60), 2);
      __resetGetPageDriverCountForTest();
      const result = moveToLine(ctx.editor.state, pos, tree, sharedMeasurer, "down", null);
      expect(result).not.toBeNull();
      // The bridge would materialize all 30 pages. Per-page touches the caret
      // page (+ possibly one adjacent / the target page) — a small constant.
      expect(__getGetPageDriverCountForTest()).toBeLessThanOrEqual(3);
    });
  });
});

// ---------------------------------------------------------------------------
// Slice 2 — spanning-block line navigation through the per-page collector.
// A single paragraph taller than one page (its fragments on `span.first..last`)
// is navigated by stitching its per-page line fragments into one offset-domain
// list and resolving the target line's geometry per-page — NEVER the whole tree.
// Backstop: the virtual spanning result deep-equals nav over the assembled
// positioned oracle for every caret placement and direction.
// ---------------------------------------------------------------------------

/** Offsets covering the five spec cases (a)–(e) for a spanning block. */
function spanningCaretOffsets(
  ctx: NavCtx,
  blockId: BlockId,
): { name: string; offset: number }[] {
  const tree = virtualTree(ctx);
  const span = tree.plan.pageSpanOfBlock(blockId);
  if (span === null) throw new Error("span unexpectedly null");
  const page0 = getLineIndex(tree.getPage(0)).byBlock.get(blockId) ?? [];
  const page1 = getLineIndex(tree.getPage(1)).byBlock.get(blockId) ?? [];
  if (page0.length === 0 || page1.length === 0) {
    throw new Error("paragraph did not span pages 0 and 1");
  }
  const firstLine = nth(page0, 0, "page0 first line").line;
  const lastPageLines = getLineIndex(tree.getPage(span.last)).byBlock.get(blockId) ?? [];
  const lastLine = nth(lastPageLines, lastPageLines.length - 1, "last-page last line").line;
  // (c) the fragment boundary: last offset of page-0's last fragment line.
  const boundaryOffset = nth(page0, page0.length - 1, "page0 last line").line.inlineOffsetEnd;
  return [
    // (a) mid-block on the page-0 fragment.
    { name: "mid page-0 fragment", offset: nth(page0, 0, "page0 first line").line.inlineOffsetEnd + 1 },
    // (b) mid-block on the page-1 fragment.
    { name: "mid page-1 fragment", offset: nth(page1, 0, "page1 first line").line.inlineOffsetEnd },
    // (c) at the fragment boundary (last offset of page-0 fragment).
    { name: "fragment boundary", offset: boundaryOffset },
    // (d) on the block's first line.
    { name: "block first line", offset: firstLine.inlineOffsetStart + 1 },
    // (e) on the block's last line.
    { name: "block last line", offset: lastLine.inlineOffsetEnd },
  ];
}

describe("line-navigation spanning block (Slice 2): equivalence vs the positioned oracle", () => {
  for (const pages of [2, 3]) {
    describe(`a ${pages}-page spanning paragraph`, () => {
      const { ctx, blockId } = buildSpanningEditor(64, pages);
      const tree = virtualTree(ctx);
      const oracle = assembleAllPages(tree);

      it("genuinely spans the requested pages", () => {
        const span = tree.plan.pageSpanOfBlock(blockId);
        expect(span).not.toBeNull();
        if (span === null) return;
        expect(span.first).toBe(0);
        expect(span.last).toBeGreaterThanOrEqual(pages - 1);
      });

      for (const { name, offset } of spanningCaretOffsets(ctx, blockId)) {
        for (const dir of ["up", "down"] as const) {
          it(`moveToLine ${dir} — ${name}`, () => {
            const pos = createPosition(blockId, offset);
            const viaVirtual = moveToLine(ctx.editor.state, pos, tree, sharedMeasurer, dir, null);
            const viaOracle = moveToLine(ctx.editor.state, pos, oracle, sharedMeasurer, dir, null);
            expect(viaVirtual).toEqual(viaOracle);
          });
        }
        for (const boundary of ["start", "end"] as const) {
          it(`moveToLineBoundary ${boundary} — ${name}`, () => {
            const pos = createPosition(blockId, offset);
            const viaVirtual = moveToLineBoundary(ctx.editor.state, pos, tree, sharedMeasurer, boundary);
            const viaOracle = moveToLineBoundary(ctx.editor.state, pos, oracle, sharedMeasurer, boundary);
            expect(viaVirtual).toEqual(viaOracle);
          });
        }
      }
    });
  }
});

describe("line-navigation spanning block (Slice 2): behavior through the real editor", () => {
  /** Resolve the caret's `(pageIndex, lineTop)` — its VISUAL line identity. */
  function caretLine(ctx: NavCtx): { pageIndex: number; lineY: number } {
    const px = resolvePixelPosition(ctx.editor.state, ctx.editor.selection.focus, layoutOf(ctx), sharedMeasurer);
    if (px === null) throw new Error("caret did not resolve");
    return { pageIndex: px.pageIndex, lineY: px.lineY };
  }

  /** Same visual line ⇔ same page AND same line-top. */
  function sameVisualLine(
    a: { pageIndex: number; lineY: number },
    b: { pageIndex: number; lineY: number },
  ): boolean {
    return a.pageIndex === b.pageIndex && a.lineY === b.lineY;
  }

  function placeCaret(ctx: NavCtx, blockId: BlockId, offset: number): NavCtx {
    const pos = createPosition(blockId, offset);
    return dispatch(ctx, { type: "SET_SELECTION", selection: createSpan(pos, pos) });
  }

  it("ArrowDown then ArrowUp on a spanning block move exactly one visual line each (no double-Up)", () => {
    const { ctx: base, blockId } = buildSpanningEditor(64, 2);
    const tree = virtualTree(base);
    const page0 = getLineIndex(tree.getPage(0)).byBlock.get(blockId) ?? [];
    expect(page0.length).toBeGreaterThanOrEqual(2);
    // Caret on a MIDDLE line of page 0's fragment (not the first, not the last).
    const midOffset = nth(page0, 1, "page0 second line").line.inlineOffsetStart + 1;
    const start = placeCaret(base, blockId, midOffset);
    const startLine = caretLine(start);

    // ArrowDown: caret moves to a DIFFERENT, strictly-lower visual line.
    const down = nav(start, { type: "MOVE_LINE", direction: "down" });
    const downLine = caretLine(down);
    expect(sameVisualLine(downLine, startLine)).toBe(false);
    // Down within the same page increases lineY by ~one line-height.
    expect(downLine.pageIndex).toBe(startLine.pageIndex);
    expect(downLine.lineY).toBeGreaterThan(startLine.lineY);
    expect(downLine.lineY - startLine.lineY).toBeCloseTo(16, 0);

    // ArrowUp undoes it: back to exactly the starting visual line (one line up).
    const back = nav(down, { type: "MOVE_LINE", direction: "up" });
    expect(sameVisualLine(caretLine(back), startLine)).toBe(true);
  });

  it("a single ArrowUp at the fragment boundary does NOT leave the caret on the same visual line (the double-Up regression)", () => {
    const { ctx: base, blockId } = buildSpanningEditor(64, 2);
    const tree = virtualTree(base);
    const page0 = getLineIndex(tree.getPage(0)).byBlock.get(blockId) ?? [];
    const page1 = getLineIndex(tree.getPage(1)).byBlock.get(blockId) ?? [];
    expect(page0.length).toBeGreaterThan(0);
    expect(page1.length).toBeGreaterThan(0);

    // The cross-page soft-wrap boundary: end-of-page-0's-last-fragment === the
    // offset that resolves onto page 1's FIRST line. `resolvePixelPosition` snaps
    // such a caret to page 1 (the continuation). A single ArrowUp must step to
    // page 0's last line — NOT stay on page 1's first line (the double-Up bug,
    // where a per-page lookup put the caret at idx 0 of page 1 and "up" targeted
    // the last line of page 0, the same visual line it was already snapped onto).
    const boundaryOffset = nth(page0, page0.length - 1, "page0 last line").line.inlineOffsetEnd;
    expect(nth(page1, 0, "page1 first line").line.inlineOffsetStart).toBe(boundaryOffset);

    const atBoundary = placeCaret(base, blockId, boundaryOffset);
    const boundaryLine = caretLine(atBoundary);
    expect(boundaryLine.pageIndex).toBe(1); // snapped to the continuation page.

    const up = nav(atBoundary, { type: "MOVE_LINE", direction: "up" });
    const upLine = caretLine(up);
    // The single Up genuinely moved to a different visual line (page 0's last).
    expect(sameVisualLine(upLine, boundaryLine)).toBe(false);
    expect(upLine.pageIndex).toBe(0);
  });

  it("Home / End on a spanning block land at the caret line's start / end offset (page-0 fragment)", () => {
    const { ctx: base, blockId } = buildSpanningEditor(64, 2);
    const tree = virtualTree(base);
    // A line on the PAGE-0 fragment — the discriminating case: `pageIndexOfBlock`
    // returns the block's LAST page (1+), so a naive single-page read would pull
    // page-1's lines and find the WRONG line for a page-0 caret. The collector
    // stitch must read the page-0 fragment. Use a middle line of page 0.
    const page0 = getLineIndex(tree.getPage(0)).byBlock.get(blockId) ?? [];
    expect(page0.length).toBeGreaterThanOrEqual(2);
    const line = nth(page0, 1, "page0 second line").line;
    const midOffset = Math.floor((line.inlineOffsetStart + line.inlineOffsetEnd) / 2);
    const placed = placeCaret(base, blockId, midOffset);

    const home = nav(placed, { type: "MOVE_LINE_BOUNDARY", boundary: "start" });
    expect(home.editor.selection.focus.blockId).toBe(blockId);
    expect(home.editor.selection.focus.offset).toBe(line.inlineOffsetStart);

    const end = nav(placed, { type: "MOVE_LINE_BOUNDARY", boundary: "end" });
    expect(end.editor.selection.focus.blockId).toBe(blockId);
    expect(end.editor.selection.focus.offset).toBe(line.inlineOffsetEnd);
  });
});
