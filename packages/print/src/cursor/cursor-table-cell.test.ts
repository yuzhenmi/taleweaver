// packages/core/src/cursor/cursor-table-cell.test.ts
//
// #495 regression: a caret INSIDE a table cell must resolve to a page WITHOUT
// crashing. A table-cell paragraph lives in the MAIN `blocks` tree but is NOT a
// top-level body child (paragraph → table-cell → table-row → table), so
// `pageIndexOfBlock` (a top-level-body-only map) can't map it, and the
// template/footnote fallbacks miss it too. Before the fix this dev-threw
// "resolveInVirtualTree: block <id> maps to no page". The fix adds a
// nested-main-tree resolver that walks up `parentId` to the containing top-level
// block (the table) and resolves the caret on that block's page.
//
// Builds the fixture through the REAL `createTable` op and keeps the VIRTUAL
// tree (NOT a fully-positioned tree), exercising the production per-page path.

import { describe, it, expect } from "vitest";
import { render } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { makeRootContext } from "../layout/layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { buildVirtualPaginatedTree } from "../layout/virtual-producer";
import type { ElementBox, RenderNode } from "@taleweaver/core";
import type { TextShaper } from "@taleweaver/core";
import type { PageConfig } from "../layout/page-config";
import type { VirtualLayoutTree } from "../layout/virtual-layout-tree";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "@taleweaver/core";
import { createTable } from "@taleweaver/core";
import { createTestAllocator } from "@taleweaver/core";
import { createPosition } from "@taleweaver/core";
import { collectFootnoteAnchors } from "@taleweaver/core";
import type { State, BlockId, Position } from "@taleweaver/core";
import { resolvePixelPosition } from "./cursor-position";
import { moveToLine, moveToLineBoundary } from "./line-navigation";

const SHAPER_CHAR_W = 8;
const SHAPER_LINE_H = 16;

function pageConfig(): PageConfig {
  return {
    pageInlineSize: 320,
    pageBlockSize: 400,
    pageMargins: { blockStart: 60, blockEnd: 60, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };
}

interface Built {
  state: State;
  tree: VirtualLayoutTree;
  shaper: TextShaper;
  caretInto: Position;
  tableId: BlockId;
}

/** doc > p("body"); then insert a `rows×cols` table at the start of `p`. */
function buildDocWithTable(rows: number, cols: number, cfg: PageConfig = pageConfig()): Built {
  const seed = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([text("body")]),
      }),
    ],
  });

  const { state, caretInto, newTableId } = createTable(
    seed,
    createPosition("p" as BlockId, 0),
    rows,
    cols,
    createTestAllocator("t"),
  );

  const out = render(
    state,
    createDefaultComponentRegistry(),
    createDefaultAttrRegistry(),
  );
  const cascadedRoot = cascadePass(out.root);
  if (cascadedRoot.type !== "element") throw new Error("root cascade not element");

  const cascadedEmbedContents = new Map<BlockId, ElementBox>();
  for (const [id, node] of out.embedContents) {
    const c = cascadePass(node as RenderNode);
    if (c.type === "element") cascadedEmbedContents.set(id, c);
  }

  const shaper = createMockShaper(SHAPER_CHAR_W, SHAPER_LINE_H);
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, cfg.pageInlineSize);
  const tree = buildVirtualPaginatedTree(
    cascadedRoot,
    ctx,
    shaper,
    cfg,
    undefined,
    undefined,
    cascadedEmbedContents,
    collectFootnoteAnchors(state),
  );

  return { state, tree, shaper, caretInto, tableId: newTableId };
}

describe("table-cell caret resolves per-page (#495)", () => {
  it("resolvePixelPosition resolves a freshly-inserted table cell caret without throwing", () => {
    const { state, tree, shaper, caretInto } = buildDocWithTable(2, 2);
    // `caretInto` is cell (0,0)'s paragraph at offset 0 — a main-tree block
    // nested under the table, which `pageIndexOfBlock` cannot map directly.
    const pixel = resolvePixelPosition(state, caretInto, tree, shaper);
    expect(pixel).not.toBeNull();
    // The table is on page 0 (the only page), so the cell caret resolves there.
    expect(pixel?.pageIndex).toBe(0);
  });

  it("moveToLine (Up/Down) resolves a table-cell caret without throwing", () => {
    const { state, tree, shaper, caretInto } = buildDocWithTable(2, 2);
    // Up/Down from a cell caret must resolve the cell's page (the crash branch in
    // moveToLineVirtual) rather than dev-throwing. The result may be null (no line
    // in the goal direction within reach) or a moved position; the contract under
    // test is "does not throw".
    expect(() => moveToLine(state, caretInto, tree, shaper, "up", null)).not.toThrow();
    expect(() => moveToLine(state, caretInto, tree, shaper, "down", null)).not.toThrow();
  });

  it("moveToLineBoundary resolves a table-cell caret without throwing", () => {
    const { state, tree, shaper, caretInto } = buildDocWithTable(2, 2);
    const start = moveToLineBoundary(state, caretInto, tree, shaper, "start");
    const end = moveToLineBoundary(state, caretInto, tree, shaper, "end");
    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    // An empty cell paragraph: Home/End both pin to offset 0 in the same block.
    expect(start?.blockId).toBe(caretInto.blockId);
    expect(start?.offset).toBe(0);
    expect(end?.blockId).toBe(caretInto.blockId);
    expect(end?.offset).toBe(0);
  });
});

describe("table-cell caret on a SPANNING table resolves the carrying page (#496)", () => {
  // A small page so a many-row table fragments across pages. `pageIndexOfBlock`
  // maps a top-level block to its WHOLE-BLOCK-PROGRESS (LAST) page; before #496
  // the nested resolver returned that last page for EVERY cell, so a cell whose
  // lines are on an EARLIER page missed `byBlock` + `findBlockBaseline` there and
  // dev-threw. The fix forward-walks the table's page span to the carrying page.
  function smallPageConfig(): PageConfig {
    return {
      pageInlineSize: 320,
      pageBlockSize: 120,
      pageMargins: { blockStart: 10, blockEnd: 10, inlineStart: 0, inlineEnd: 0 },
      pageGap: 24,
    };
  }

  it("the table actually spans >1 page (fixture sanity)", () => {
    const { tree, tableId } = buildDocWithTable(12, 1, smallPageConfig());
    const span = tree.plan.pageSpanOfBlock(tableId);
    if (span === null) throw new Error("table has no page span");
    expect(span.last).toBeGreaterThan(span.first);
  });

  it("cell (0,0) on the FIRST page resolves to page 0, not the table's last page", () => {
    const { state, tree, shaper, caretInto } = buildDocWithTable(12, 1, smallPageConfig());
    // caretInto is cell (0,0)'s paragraph — its lines are on page 0 (the top of
    // the table). The table's last page is > 0, so the pre-#496 resolver pointed
    // the caret at the wrong page and dev-threw.
    const pixel = resolvePixelPosition(state, caretInto, tree, shaper);
    expect(pixel).not.toBeNull();
    expect(pixel?.pageIndex).toBe(0);
  });
});
