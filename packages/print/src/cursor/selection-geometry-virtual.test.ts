// Phase-4: computeSelectionRectsForPage emits a single page's selection rects
// from that page's PageBox. The per-page union (over all pages) must equal the
// full-tree computeSelectionRects over the assembled positioned tree (the oracle = ground
// truth) for NON-spanning-block selections (the per-page path's domain;
// spanning boundary blocks are routed to the bridge by the controller).
import { describe, it, expect } from "vitest";
import { createInitialEditorState, reduceEditor, createDefaultComponentRegistry, createDefaultAttrRegistry, createMockShaper, getBlock, createPosition, createSpan, spanStart, spanEnd, render, cascadePass, type EditorConfig, type PageConfig, type EditorState, type BlockId } from "@taleweaver/core";
import { resolvePixelPosition, computeSelectionRects, computeSelectionRectsForPage, layoutTree } from "../index";
import type { VirtualLayoutTree } from "../layout/virtual-layout-tree";
import { positionTreeForTest } from "../test-utils/position-tree";

// Phase 0b: `measurer` left core's `EditorConfig` for the backend's layout
// driver. Tests build the layout tree directly via core's pipeline (what the
// driver does) to assert the resolved per-page selection geometry.
const measurer = createMockShaper(8, 16);

function makeConfig(): EditorConfig {
  const pageConfig: PageConfig = {
    pageInlineSize: 800,
    pageBlockSize: 64, // 16px lines, margins 0 ⇒ 4 lines/page
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };
  return {
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: 800,
    pageConfig,
  };
}

/** Build the layout tree the backend driver would (render → cascade → layout). */
function layoutOf(editor: EditorState, config: EditorConfig): VirtualLayoutTree {
  const rendered = render(editor.state, config.componentRegistry, config.attrRegistry);
  const cascaded = cascadePass(rendered.root);
  const tree = layoutTree(cascaded, config.containerWidth, measurer, config.pageConfig);
  if (tree.type !== "virtual-root") throw new Error("expected virtual");
  return tree;
}

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

describe("computeSelectionRectsForPage equivalence vs the positioned-tree oracle", () => {
  const config = makeConfig();
  const editor = buildPasted(config, 16); // 16 one-line paras over 4-line pages ⇒ 4 pages
  const tree = layoutOf(editor, config);
  const bridge = positionTreeForTest(tree);
  const pageCount = tree.plan.entries.length;

  const cases: { name: string; a: [number, number]; f: [number, number] }[] = [
    { name: "same line", a: [2, 1], f: [2, 4] },
    { name: "same page, two paragraphs", a: [1, 2], f: [2, 3] },
    { name: "adjacent pages (last of p0 → first of p1)", a: [3, 1], f: [4, 2] },
    { name: "across an intermediate full page (p0 → p2)", a: [1, 2], f: [9, 3] },
    { name: "whole document", a: [0, 0], f: [15, 6] },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const span = createSpan(
        createPosition(nthBlockId(editor, c.a[0]), c.a[1]),
        createPosition(nthBlockId(editor, c.f[0]), c.f[1]),
      );
      const start = spanStart(editor.state, span);
      const end = spanEnd(editor.state, span);
      const startPos = resolvePixelPosition(editor.state, start, tree, measurer);
      const endPos = resolvePixelPosition(editor.state, end, tree, measurer);
      if (startPos === null || endPos === null) throw new Error("resolve failed");

      const perPage = [];
      for (let p = 0; p < pageCount; p++) {
        perPage.push(
          ...computeSelectionRectsForPage(
            editor.state, span, tree.getPage(p), p, startPos, endPos, measurer,
          ),
        );
      }
      const viaBridge = computeSelectionRects(editor.state, span, bridge, measurer);
      expect(perPage).toEqual(viaBridge);
    });
  }
});
