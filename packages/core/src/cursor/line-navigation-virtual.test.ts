// Phase-4: moveToLine / moveToLineBoundary must resolve against a
// VirtualLayoutTree PER-PAGE (caret page + at most one adjacent page), never
// the assembled positioned tree (oracle). Two guarantees:
//   1. EQUIVALENCE: the per-page result equals the positioned-tree oracle
//      result (the current shipped behavior = ground truth) for every position
//      and direction, including page-boundary crossings.
//   2. PERF: one moveToLine on a large doc materializes O(1) pages, not O(N).
import { describe, it, expect, beforeEach } from "vitest";
import {
  createInitialEditorState,
  reduceEditor,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  createMockShaper,
  getBlock,
  createPosition,
  type EditorConfig,
  type PageConfig,
  type EditorState,
  type BlockId,
} from "../index";
import { moveToLine, moveToLineBoundary } from "./line-navigation";
import {
  __getGetPageDriverCountForTest,
  __resetGetPageDriverCountForTest,
} from "../layout/virtual-layout-tree";
import { resolvePixelPosition } from "./cursor-position";
import { render } from "../render/render";
import { cascadePass } from "../cascade";
import { paginateRoot } from "../layout/paginate";
import { makeRootContext } from "../layout/layout-context";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import { getLineIndex } from "./line-flatten";
import { positionTreeForTest } from "../test-utils/position-tree";
import type { BlockBox } from "../layout/layout-box";

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

function makeConfig(pageBlockSize = 64): EditorConfig {
  return {
    measurer: createMockShaper(8, 16),
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: 800,
    pageConfig: makePageConfig(pageBlockSize),
  };
}

/** Build an N-paragraph doc in one O(N) PASTE (one paragraph per line). */
function buildPasted(config: EditorConfig, n: number): EditorState {
  const text = Array.from({ length: n }, (_, i) => `para ${i}`).join("\n");
  return reduceEditor(createInitialEditorState(config), { type: "PASTE", text }, config);
}

function nthBlockId(editor: EditorState, n: number): BlockId {
  const root = getBlock(editor.state, editor.state.rootId);
  if (root === null || root.firstChildId === null) throw new Error("no blocks");
  let id: BlockId | null = root.firstChildId;
  for (let i = 0; i < n && id !== null; i++) {
    id = getBlock(editor.state, id)?.nextSiblingId ?? null;
  }
  if (id === null) throw new Error(`no block ${n}`);
  return id;
}

/**
 * Build an editor whose SOLE body child is ONE paragraph tall enough to span
 * `pages` pages (via soft-wrap), so its line fragments live on multiple pages.
 * Returns the editor + the spanning paragraph's block id. PASTE of a single
 * space-separated string (no `\n`) keeps it one paragraph that wraps.
 */
function buildSpanningEditor(
  config: EditorConfig,
  pages: number,
): { editor: EditorState; blockId: BlockId } {
  // 800px page, 8px/char ⇒ ~100 chars/line; pageBlockSize 64 ⇒ 4 lines/page.
  // Use short words so the run wraps at break opportunities. Generously
  // overshoot the line budget so the paragraph definitively spans `pages`.
  const linesPerPage = 4;
  const charsPerLine = 90; // < 100 so each visual line is comfortably full
  const wordsNeeded = Math.ceil((pages * linesPerPage * charsPerLine) / 6) + 20;
  const text = Array.from({ length: wordsNeeded }, (_, i) => `w${i}`).join(" ");
  const editor = reduceEditor(
    createInitialEditorState(config),
    { type: "PASTE", text },
    config,
  );
  const root = getBlock(editor.state, editor.state.rootId);
  if (root === null || root.firstChildId === null) throw new Error("no blocks");
  return { editor, blockId: root.firstChildId };
}

/**
 * The `paginateRoot` positioned oracle for an editor's current document — the
 * SAME doc the virtual tree describes, fully positioned. Slice-2 equivalence
 * backstop: the virtual spanning path must deep-equal nav over this oracle.
 */
function paginateOracle(
  editor: EditorState,
  config: EditorConfig,
  pageConfig: PageConfig,
): BlockBox {
  const rendered = render(
    editor.state,
    config.componentRegistry,
    config.attrRegistry,
  ).root;
  const cascaded = cascadePass(rendered);
  if (cascaded.type !== "element") {
    throw new Error("paginateOracle: cascadePass returned a non-element root");
  }
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
  // The mock shaper matches `makeConfig`'s measurer (8px/char, 16px line-height).
  return paginateRoot(cascaded, ctx, createMockShaper(8, 16), pageConfig);
}

describe("line-navigation on a VirtualLayoutTree (Phase-4 per-page)", () => {
  describe("moveToLine equivalence vs the positioned-tree oracle", () => {
    // 16 one-line paragraphs over 4-line pages ⇒ 4 pages.
    const config = makeConfig();
    const editor = buildPasted(config, 16);
    if (editor.layoutTree.type !== "virtual-root") throw new Error("expected virtual");
    const bridge = positionTreeForTest(editor.layoutTree);

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
        const pos = createPosition(nthBlockId(editor, c.blockIdx), 2);
        const viaVirtual = moveToLine(editor.state, pos, editor.layoutTree, config.measurer, c.dir, null);
        const viaBridge = moveToLine(editor.state, pos, bridge, config.measurer, c.dir, null);
        expect(viaVirtual).toEqual(viaBridge);
      });
    }
  });

  describe("moveToLineBoundary equivalence vs the positioned-tree oracle", () => {
    const config = makeConfig();
    const editor = buildPasted(config, 16);
    if (editor.layoutTree.type !== "virtual-root") throw new Error("expected virtual");
    const bridge = positionTreeForTest(editor.layoutTree);

    for (const boundary of ["start", "end"] as const) {
      for (const blockIdx of [0, 5, 9, 15]) {
        it(`${boundary} on block ${blockIdx}`, () => {
          const pos = createPosition(nthBlockId(editor, blockIdx), 3);
          const viaVirtual = moveToLineBoundary(editor.state, pos, editor.layoutTree, config.measurer, boundary);
          const viaBridge = moveToLineBoundary(editor.state, pos, bridge, config.measurer, boundary);
          expect(viaVirtual).toEqual(viaBridge);
        });
      }
    }
  });

  describe("perf: one moveToLine materializes O(1) pages, not O(N)", () => {
    beforeEach(() => __resetGetPageDriverCountForTest());

    it("a within-page move on a ~30-page doc materializes ≤ 3 pages", () => {
      // 120 one-line paragraphs over 4-line pages ⇒ 30 pages.
      const config = makeConfig();
      const editor = buildPasted(config, 120);
      if (editor.layoutTree.type !== "virtual-root") throw new Error("expected virtual");
      // Fresh tree: no pages materialized yet. Move from a mid-document block
      // (well inside a page, not at a boundary) DOWN one line.
      const pos = createPosition(nthBlockId(editor, 60), 2);
      __resetGetPageDriverCountForTest();
      const result = moveToLine(editor.state, pos, editor.layoutTree, config.measurer, "down", null);
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
// Backstop: the virtual spanning result deep-equals nav over the `paginateRoot`
// positioned oracle for every caret placement and direction.
// ---------------------------------------------------------------------------

/** Offsets covering the five spec cases (a)–(e) for a spanning block. */
function spanningCaretOffsets(
  editor: EditorState,
  blockId: BlockId,
): { name: string; offset: number }[] {
  if (editor.layoutTree.type !== "virtual-root") throw new Error("expected virtual");
  const tree = editor.layoutTree;
  const span = tree.plan.pageSpanOfBlock(blockId);
  if (span === null) throw new Error("span unexpectedly null");
  const page0 = getLineIndex(tree.getPage(0)).byBlock.get(blockId) ?? [];
  const page1 = getLineIndex(tree.getPage(1)).byBlock.get(blockId) ?? [];
  if (page0.length === 0 || page1.length === 0) {
    throw new Error("paragraph did not span pages 0 and 1");
  }
  const firstLine = page0[0].line;
  const lastPageLines = getLineIndex(tree.getPage(span.last)).byBlock.get(blockId) ?? [];
  const lastLine = lastPageLines[lastPageLines.length - 1].line;
  // (c) the fragment boundary: last offset of page-0's last fragment line.
  const boundaryOffset = page0[page0.length - 1].line.inlineOffsetEnd;
  return [
    // (a) mid-block on the page-0 fragment.
    { name: "mid page-0 fragment", offset: page0[0].line.inlineOffsetEnd + 1 },
    // (b) mid-block on the page-1 fragment.
    { name: "mid page-1 fragment", offset: page1[0].line.inlineOffsetEnd },
    // (c) at the fragment boundary (last offset of page-0 fragment).
    { name: "fragment boundary", offset: boundaryOffset },
    // (d) on the block's first line.
    { name: "block first line", offset: firstLine.inlineOffsetStart + 1 },
    // (e) on the block's last line.
    { name: "block last line", offset: lastLine.inlineOffsetEnd },
  ];
}

describe("line-navigation spanning block (Slice 2): equivalence vs paginateRoot", () => {
  for (const pages of [2, 3]) {
    describe(`a ${pages}-page spanning paragraph`, () => {
      const pageConfig = makePageConfig();
      const config = makeConfig();
      const { editor, blockId } = buildSpanningEditor(config, pages);
      if (editor.layoutTree.type !== "virtual-root") throw new Error("expected virtual");
      const oracle = paginateOracle(editor, config, pageConfig);

      it("genuinely spans the requested pages", () => {
        const tree = editor.layoutTree;
        if (tree.type !== "virtual-root") throw new Error("expected virtual");
        const span = tree.plan.pageSpanOfBlock(blockId);
        expect(span).not.toBeNull();
        if (span === null) return;
        expect(span.first).toBe(0);
        expect(span.last).toBeGreaterThanOrEqual(pages - 1);
      });

      for (const { name, offset } of spanningCaretOffsets(editor, blockId)) {
        for (const dir of ["up", "down"] as const) {
          it(`moveToLine ${dir} — ${name}`, () => {
            const pos = createPosition(blockId, offset);
            const viaVirtual = moveToLine(editor.state, pos, editor.layoutTree, config.measurer, dir, null);
            const viaOracle = moveToLine(editor.state, pos, oracle, config.measurer, dir, null);
            expect(viaVirtual).toEqual(viaOracle);
          });
        }
        for (const boundary of ["start", "end"] as const) {
          it(`moveToLineBoundary ${boundary} — ${name}`, () => {
            const pos = createPosition(blockId, offset);
            const viaVirtual = moveToLineBoundary(editor.state, pos, editor.layoutTree, config.measurer, boundary);
            const viaOracle = moveToLineBoundary(editor.state, pos, oracle, config.measurer, boundary);
            expect(viaVirtual).toEqual(viaOracle);
          });
        }
      }
    });
  }
});

describe("line-navigation spanning block (Slice 2): behavior through the real editor", () => {
  const config = makeConfig();

  /** Resolve the caret's `(pageIndex, lineTop)` — its VISUAL line identity. */
  function caretLine(editor: EditorState): { pageIndex: number; lineY: number } {
    const px = resolvePixelPosition(editor.state, editor.selection.focus, editor.layoutTree, config.measurer);
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

  function placeCaret(editor: EditorState, blockId: BlockId, offset: number): EditorState {
    return reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: { anchor: createPosition(blockId, offset), focus: createPosition(blockId, offset) },
      },
      config,
    );
  }

  it("ArrowDown then ArrowUp on a spanning block move exactly one visual line each (no double-Up)", () => {
    const { editor: base, blockId } = buildSpanningEditor(config, 2);
    if (base.layoutTree.type !== "virtual-root") throw new Error("expected virtual");
    const tree = base.layoutTree;
    const page0 = getLineIndex(tree.getPage(0)).byBlock.get(blockId) ?? [];
    expect(page0.length).toBeGreaterThanOrEqual(2);
    // Caret on a MIDDLE line of page 0's fragment (not the first, not the last).
    const midOffset = page0[1].line.inlineOffsetStart + 1;
    const start = placeCaret(base, blockId, midOffset);
    const startLine = caretLine(start);

    // ArrowDown: caret moves to a DIFFERENT, strictly-lower visual line.
    const down = reduceEditor(start, { type: "MOVE_LINE", direction: "down" }, config);
    const downLine = caretLine(down);
    expect(sameVisualLine(downLine, startLine)).toBe(false);
    // Down within the same page increases lineY by ~one line-height.
    expect(downLine.pageIndex).toBe(startLine.pageIndex);
    expect(downLine.lineY).toBeGreaterThan(startLine.lineY);
    expect(downLine.lineY - startLine.lineY).toBeCloseTo(16, 0);

    // ArrowUp undoes it: back to exactly the starting visual line (one line up).
    const back = reduceEditor(down, { type: "MOVE_LINE", direction: "up" }, config);
    expect(sameVisualLine(caretLine(back), startLine)).toBe(true);
  });

  it("a single ArrowUp at the fragment boundary does NOT leave the caret on the same visual line (the double-Up regression)", () => {
    const { editor: base, blockId } = buildSpanningEditor(config, 2);
    if (base.layoutTree.type !== "virtual-root") throw new Error("expected virtual");
    const tree = base.layoutTree;
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
    const boundaryOffset = page0[page0.length - 1].line.inlineOffsetEnd;
    expect(page1[0].line.inlineOffsetStart).toBe(boundaryOffset);

    const atBoundary = placeCaret(base, blockId, boundaryOffset);
    const boundaryLine = caretLine(atBoundary);
    expect(boundaryLine.pageIndex).toBe(1); // snapped to the continuation page.

    const up = reduceEditor(atBoundary, { type: "MOVE_LINE", direction: "up" }, config);
    const upLine = caretLine(up);
    // The single Up genuinely moved to a different visual line (page 0's last).
    expect(sameVisualLine(upLine, boundaryLine)).toBe(false);
    expect(upLine.pageIndex).toBe(0);
  });

  it("Home / End on a spanning block land at the caret line's start / end offset (page-0 fragment)", () => {
    const { editor: base, blockId } = buildSpanningEditor(config, 2);
    if (base.layoutTree.type !== "virtual-root") throw new Error("expected virtual");
    const tree = base.layoutTree;
    // A line on the PAGE-0 fragment — the discriminating case: `pageIndexOfBlock`
    // returns the block's LAST page (1+), so a naive single-page read would pull
    // page-1's lines and find the WRONG line for a page-0 caret. The collector
    // stitch must read the page-0 fragment. Use a middle line of page 0.
    const page0 = getLineIndex(tree.getPage(0)).byBlock.get(blockId) ?? [];
    expect(page0.length).toBeGreaterThanOrEqual(2);
    const line = page0[1].line;
    const midOffset = Math.floor((line.inlineOffsetStart + line.inlineOffsetEnd) / 2);
    const placed = placeCaret(base, blockId, midOffset);

    const home = reduceEditor(placed, { type: "MOVE_LINE_BOUNDARY", boundary: "start" }, config);
    expect(home.selection.focus.blockId).toBe(blockId);
    expect(home.selection.focus.offset).toBe(line.inlineOffsetStart);

    const end = reduceEditor(placed, { type: "MOVE_LINE_BOUNDARY", boundary: "end" }, config);
    expect(end.selection.focus.blockId).toBe(blockId);
    expect(end.selection.focus.offset).toBe(line.inlineOffsetEnd);
  });
});
