// Phase-4: moveToLine / moveToLineBoundary must resolve against a
// VirtualLayoutTree PER-PAGE (caret page + at most one adjacent page), never
// materializeAll(). Two guarantees:
//   1. EQUIVALENCE: the per-page result equals the materializeAll() bridge
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

// Small pages so a handful of one-line paragraphs span several pages.
// mock shaper line height 16; margins 0; pageBlockSize 64 ⇒ 4 lines/page.
function makeConfig(pageBlockSize = 64): EditorConfig {
  const pageConfig: PageConfig = {
    pageInlineSize: 800,
    pageBlockSize,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };
  return {
    measurer: createMockShaper(8, 16),
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: 800,
    pageConfig,
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

describe("line-navigation on a VirtualLayoutTree (Phase-4 per-page)", () => {
  describe("moveToLine equivalence vs the materializeAll bridge", () => {
    // 16 one-line paragraphs over 4-line pages ⇒ 4 pages.
    const config = makeConfig();
    const editor = buildPasted(config, 16);
    if (editor.layoutTree.type !== "virtual-root") throw new Error("expected virtual");
    const bridge = editor.layoutTree.materializeAll();

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

  describe("moveToLineBoundary equivalence vs the materializeAll bridge", () => {
    const config = makeConfig();
    const editor = buildPasted(config, 16);
    if (editor.layoutTree.type !== "virtual-root") throw new Error("expected virtual");
    const bridge = editor.layoutTree.materializeAll();

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
