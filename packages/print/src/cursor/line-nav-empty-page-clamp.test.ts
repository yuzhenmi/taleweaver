// packages/core/src/cursor/line-nav-empty-page-clamp.test.ts
//
// VL-bridge-removal Slice 4 (Bucket C): the empty-adjacent-page guards in
// `moveToLineOnPage` must CLAMP to a document boundary rather than materialize.
// A degenerate adjacent page that filters to ZERO context-lines is possible; the
// pre-Slice-4 code materialized the whole tree there. Slice 4 clamps:
//   - ArrowUp with an empty PREVIOUS page → start-of-document.
//   - ArrowDown with an empty NEXT page → end-of-document.
// No crash, never positions the whole document.
//
// We build a real 2-page document, then wrap `getPage` so the adjacent page
// returns a PageBox with NO children (zero lines). The caret on the populated
// page then steps toward the emptied page and must clamp to a boundary.

import { describe, it, expect } from "vitest";
import { moveToLine } from "./line-navigation";
import { render } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { buildBlockFitMetas } from "../layout/build-fit-metas";
import { measurePass } from "../layout/measure-pass";
import { IMPLICIT_SECTION_PLAN } from "../layout/section-plan";
import { makeRootContext } from "../layout/layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { makeVirtualLayoutTree, type VirtualLayoutTree } from "../layout/virtual-layout-tree";
import type { PageConfig } from "../layout/page-config";
import type { PageBox } from "../layout/page-box";
import { buildState, buildBlock, inlineContent, text } from "@taleweaver/core";
import { createPosition, firstLeafBlock, lastLeafBlock } from "@taleweaver/core";
import type { State, BlockId } from "@taleweaver/core";

const SHAPER_CHAR_W = 8;
const SHAPER_LINE_H = 16;

// A SHORT page so a handful of body paragraphs spill onto a 2nd page.
function pageConfig(): PageConfig {
  return {
    pageInlineSize: 320,
    pageBlockSize: 120,
    pageMargins: { blockStart: 10, blockEnd: 10, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };
}

function buildTwoPageDoc(): { state: State; tree: VirtualLayoutTree } {
  // Enough single-line paragraphs to overflow a 100px content band (≈6 lines).
  const paraCount = 12;
  const bodyBlocks = Array.from({ length: paraCount }, (_, i) =>
    buildBlock({
      id: `bp${i}`,
      type: "paragraph",
      parentId: "doc",
      prevSiblingId: i === 0 ? null : `bp${i - 1}`,
      nextSiblingId: i === paraCount - 1 ? null : `bp${i + 1}`,
      inlineContent: inlineContent([text(`para ${i}`)]),
    }),
  );
  const state = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        firstChildId: "bp0",
        lastChildId: `bp${paraCount - 1}`,
      }),
      ...bodyBlocks,
    ],
  });

  const out = render(state, createDefaultComponentRegistry(), createDefaultAttrRegistry());
  const cascadedRoot = cascadePass(out.root);
  if (cascadedRoot.type !== "element") throw new Error("root cascade not element");

  const cfg = pageConfig();
  const shaper = createMockShaper(SHAPER_CHAR_W, SHAPER_LINE_H);
  const pcis = cfg.pageInlineSize - cfg.pageMargins.inlineStart - cfg.pageMargins.inlineEnd;
  const metas = buildBlockFitMetas(cascadedRoot, shaper, undefined, pcis);
  const plan = measurePass(metas, cfg, IMPLICIT_SECTION_PLAN, cascadedRoot.children);
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, cfg.pageInlineSize);
  const tree = makeVirtualLayoutTree(plan, cascadedRoot, ctx, shaper, cfg, undefined, undefined);
  return { state, tree };
}

/** Wrap a tree so `getPage(emptyPage)` returns a PageBox with NO children.
 *  The clamp path reads per-page via `getPage` only — there is no whole-tree
 *  materialization to guard against (the bridge is gone), so the wrapper only
 *  needs to empty the target page. */
function withEmptiedPage(
  tree: VirtualLayoutTree,
  emptyPage: number,
): { guarded: VirtualLayoutTree } {
  // A wrapper object (NOT a Proxy: `getPage` is a non-configurable own data
  // property on the tree, which a Proxy may not re-target). It mirrors the
  // tree's fields, overriding `getPage` to empty `emptyPage`.
  const guarded: VirtualLayoutTree = {
    ...tree,
    getPage(i: number): PageBox {
      const page = tree.getPage(i);
      if (i === emptyPage) {
        return { ...page, children: [], headerSlot: null, footerSlot: null, footnoteSlot: null };
      }
      return page;
    },
  };
  return { guarded };
}

describe("empty-adjacent-page guard clamps to a document boundary (per-page only)", () => {
  it("precondition: the doc paginates to ≥ 2 pages", () => {
    const { tree } = buildTwoPageDoc();
    expect(tree.plan.entries.length).toBeGreaterThanOrEqual(2);
  });

  it("ArrowDown into an empty NEXT page clamps to end-of-document", () => {
    const { state, tree } = buildTwoPageDoc();
    const shaper = createMockShaper(SHAPER_CHAR_W, SHAPER_LINE_H);
    // Empty page 1; put the caret on the LAST body block of page 0 so ArrowDown
    // steps toward page 1.
    const { guarded } = withEmptiedPage(tree, 1);
    // The last block whose whole-block progress is page 0.
    const page0LastBlock = ((): BlockId => {
      for (let i = 11; i >= 0; i--) {
        const id = `bp${i}` as BlockId;
        if (tree.plan.pageIndexOfBlock(id) === 0) return id;
      }
      throw new Error("no page-0 block found");
    })();
    const pos = createPosition(page0LastBlock, 0);
    const moved = moveToLine(state, pos, guarded, shaper, "down", null);
    expect(moved).not.toBeNull();
    // Clamp = end-of-document (last leaf, its content length).
    const lastLeaf = lastLeafBlock(state, state.rootId);
    expect(moved?.position.blockId).toBe(lastLeaf);
  });

  it("ArrowUp into an empty PREVIOUS page clamps to start-of-document", () => {
    const { state, tree } = buildTwoPageDoc();
    const shaper = createMockShaper(SHAPER_CHAR_W, SHAPER_LINE_H);
    // Empty page 0; put the caret on the FIRST body block of page 1 so ArrowUp
    // steps toward page 0.
    const { guarded } = withEmptiedPage(tree, 0);
    const page1FirstBlock = ((): BlockId => {
      for (let i = 0; i < 12; i++) {
        const id = `bp${i}` as BlockId;
        if (tree.plan.pageIndexOfBlock(id) === 1) return id;
      }
      throw new Error("no page-1 block found");
    })();
    const pos = createPosition(page1FirstBlock, 0);
    const moved = moveToLine(state, pos, guarded, shaper, "up", null);
    expect(moved).not.toBeNull();
    // Clamp = start-of-document (first leaf, offset 0).
    const firstLeaf = firstLeafBlock(state, state.rootId);
    expect(moved?.position.blockId).toBe(firstLeaf);
    expect(moved?.position.offset).toBe(0);
  });
});
