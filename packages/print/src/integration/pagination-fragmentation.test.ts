// packages/core/src/integration/pagination-fragmentation.test.ts
import { describe, it, expect } from "vitest";
import { paginatedHarness } from "../test-utils/paginated-harness";
import type { PageConfig } from "../layout/page-config";
import type { RenderNode } from "@taleweaver/core";
import type { LayoutBox, BlockBox } from "../layout/layout-box";
import type { PageBox } from "../layout/page-box";
import { layoutTreeIncremental } from "../layout/layout-incremental";
import { positionTreeForTest } from "../test-utils/position-tree";
import { createMockShaper } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import {
  createInitialEditorState,
  reduceEditor,
  type EditorConfig,
} from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { getBlock, createPosition, createSpan } from "@taleweaver/core";
import { render } from "@taleweaver/core";
import { layoutTree } from "../layout/dispatch";
import type { EditorState } from "@taleweaver/core";
import type { VirtualLayoutTree } from "../layout/virtual-layout-tree";

// Phase 0b: `measurer` left core's `EditorConfig` for the backend's layout
// driver. The editor-state test below builds the layout tree directly via core's
// pipeline (what the driver does) to assert the virtual-root paginated shape.
const layoutMeasurer = createMockShaper(8, 16);

/** Build the layout tree the backend driver would (render → cascade → layout). */
function layoutOf(editor: EditorState, config: EditorConfig): VirtualLayoutTree | LayoutBox {
  const rendered = render(editor.state, config.componentRegistry, config.attrRegistry);
  const cascaded = cascadePass(rendered.root);
  return layoutTree(cascaded, config.containerWidth, layoutMeasurer, config.pageConfig);
}

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const PAGE: PageConfig = {
  pageInlineSize: 600,
  pageBlockSize: 200,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 24,
};

// Mock shaper: createMockShaper(8, 16) → each char is 8px wide, 16px tall.
// PAGE.pageInlineSize = 600. So each line fits 600/8 = 75 characters.
// Each "word " is 5 chars → 75/5 = 15 words per line.
// PAGE.pageBlockSize = 200; 200/16 = 12.5 → 12 lines per page.

function buildParagraph(words: number): RenderNode {
  const text = "word ".repeat(words).trim();
  return {
    type: "element" as const,
    key: "p",
    style: { display: "block" },
    children: [{ type: "text" as const, key: "t", style: {}, text }],
  };
}

function buildDocumentRoot(children: readonly RenderNode[]): RenderNode {
  return {
    type: "element" as const,
    key: "doc",
    style: { display: "block" },
    children,
  };
}

function countLinesIn(page: PageBox): number {
  function walkBox(box: LayoutBox): number {
    if (box.type === "line") return 1;
    if (box.type === "text-run" || box.type === "marker") return 0;
    if ("children" in box) {
      let total = 0;
      for (const c of box.children as readonly LayoutBox[]) {
        total += walkBox(c);
      }
      return total;
    }
    return 0;
  }
  let total = 0;
  for (const child of page.children) {
    total += walkBox(child);
  }
  return total;
}

describe("pagination integration — within-block fragmentation", () => {
  it("fragments a tall paragraph across two pages", () => {
    // 20 lines * 15 words/line = 300 words.
    // page fits 12 lines → 20-line paragraph must span at least 2 pages.
    const para = buildParagraph(20 * 15);
    const root = buildDocumentRoot([para]);
    const result = paginatedHarness(root, PAGE);
    expect(result.pages.length).toBeGreaterThanOrEqual(2);
    const totalLines = result.pages.reduce((sum, p) => sum + countLinesIn(p), 0);
    expect(totalLines).toBe(20);
  });

  it("respects break-before: page on a body paragraph", () => {
    const para1 = buildParagraph(15); // 1 line
    const para2: RenderNode = {
      type: "element" as const,
      key: "p2",
      style: { display: "block", breakBefore: "page" },
      children: [
        {
          type: "text" as const,
          key: "t2",
          style: {},
          text: "word ".repeat(15).trim(),
        },
      ],
    };
    const root = buildDocumentRoot([para1, para2]);
    const result = paginatedHarness(root, PAGE);
    // break-before: page forces para2 onto a new page regardless of remaining space.
    expect(result.pages).toHaveLength(2);
  });

  it("empty document produces one blank page", () => {
    const root = buildDocumentRoot([]);
    const result = paginatedHarness(root, PAGE);
    expect(result.pages).toHaveLength(1);
    // PageBox holds a single wrapping content-area block (positioned at the
    // page's margin offset); the wrapping block has no flow children.
    expect(nth(result.pages, 0, "page").children).toHaveLength(1);
    const contentArea = nth(nth(result.pages, 0, "page").children, 0, "content area");
    expect(contentArea.type).toBe("block");
    if (contentArea.type !== "block") throw new Error("expected wrapping content-area block");
    expect(contentArea.children).toHaveLength(0);
  });

  it("honors widows constraint", () => {
    // 14-line paragraph. Page fits 12 lines.
    // With widows=5: second page must have at least 5 lines.
    const para: RenderNode = {
      type: "element" as const,
      key: "p",
      style: { display: "block", widows: 5 },
      children: [
        {
          type: "text" as const,
          key: "t",
          style: {},
          text: "word ".repeat(14 * 15).trim(),
        },
      ],
    };
    const root = buildDocumentRoot([para]);
    const result = paginatedHarness(root, PAGE);
    // Total lines must be 14 regardless of distribution.
    const totalLines = result.pages.reduce((sum, p) => sum + countLinesIn(p), 0);
    expect(totalLines).toBe(14);
    // Content must be split across pages.
    expect(result.pages.length).toBeGreaterThanOrEqual(2);
    if (result.pages.length >= 2) {
      // With widows=5, second page must have at least 5 lines.
      const p1Lines = countLinesIn(nth(result.pages, 1, "page"));
      expect(p1Lines).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("pagination integration — edits to fragmented content", () => {
  it("re-paginates after the document grows: 1 page → 2 pages", () => {
    // 20 words → 1-2 lines (well within 1 page).
    const small = buildParagraph(20);
    // 300 words → 20 lines (spans multiple pages).
    const big = buildParagraph(20 * 15);

    const before = paginatedHarness(buildDocumentRoot([small]), PAGE);
    expect(before.pages).toHaveLength(1);

    const after = paginatedHarness(buildDocumentRoot([big]), PAGE);
    expect(after.pages.length).toBeGreaterThan(1);
  });

  it("re-paginates after the document shrinks: multi-page → 1 page", () => {
    const big = buildParagraph(20 * 15);
    const small = buildParagraph(20);

    const before = paginatedHarness(buildDocumentRoot([big]), PAGE);
    expect(before.pages.length).toBeGreaterThan(1);

    const after = paginatedHarness(buildDocumentRoot([small]), PAGE);
    expect(after.pages).toHaveLength(1);
  });
});

describe("pagination integration — layoutTreeIncremental + pageConfig", () => {
  // Regression test for the BFC reuse-cache bug: when fragmentation is active,
  // the cached full-document BlockBox must NOT short-circuit layoutBlock —
  // doing so would collapse a multi-page document into one page.
  it("preserves multi-page output when layoutTreeIncremental re-lays out an unchanged document", () => {
    const big = buildParagraph(20 * 15); // 20 lines → multi-page at PAGE
    const root = buildDocumentRoot([big]);
    const shaper = createMockShaper(8, 16);
    const cascaded = cascadePass(root);

    // First pass: cold incremental (no oldRoot/oldLayout). In paginated mode
    // this returns a VirtualLayoutTree; the test asserts over the page tree
    // assembled by the test-only `positionTreeForTest` oracle.
    const r1 = layoutTreeIncremental(cascaded, null, null, PAGE.pageInlineSize, shaper, PAGE);
    expect(r1.type).toBe("virtual-root");
    const r1Positioned = positionTreeForTest(r1);
    expect(r1Positioned.type).toBe("block");
    const r1Pages = (r1Positioned as BlockBox).children.filter((c): c is PageBox => c.type === "page");
    expect(r1Pages.length).toBeGreaterThan(1);

    // Second pass: same document, prior layout passed in. This is the path
    // that previously short-circuited via the BFC reuse cache when the root's
    // children were reference-equal to the cached version.
    const r2 = layoutTreeIncremental(cascaded, cascaded, r1, PAGE.pageInlineSize, shaper, PAGE);
    expect(r2.type).toBe("virtual-root");
    const r2Positioned = positionTreeForTest(r2);
    expect(r2Positioned.type).toBe("block");
    const r2Pages = (r2Positioned as BlockBox).children.filter((c): c is PageBox => c.type === "page");
    // Same page count as r1 — fragmentation must not be short-circuited.
    expect(r2Pages.length).toBe(r1Pages.length);
  });
});

describe("virtualized layout — EditorState.layoutTree is virtual-root after a paginated edit", () => {
  // The reducer's paginated layout path produces a VirtualLayoutTree
  // (discriminated by `type: "virtual-root"`), not a positioned BlockBox.
  // Production consumers read it per-page via `getPage`; this test assembles
  // the whole page tree via the test-only `positionTreeForTest` oracle.
  function makePaginatedConfig(): EditorConfig {
    return {
      componentRegistry: createDefaultComponentRegistry(),
      attrRegistry: createDefaultAttrRegistry(),
      containerWidth: 600,
      pageConfig: {
        pageInlineSize: 816,
        pageBlockSize: 1056,
        pageMargins: { blockStart: 96, blockEnd: 96, inlineStart: 72, inlineEnd: 72 },
        pageGap: 24,
      },
    };
  }

  it("createInitialEditorState + a paginated INSERT_TEXT yield a virtual-root layoutTree", () => {
    const config = makePaginatedConfig();
    const editor0 = createInitialEditorState(config);
    // Initial paginated layout is already virtual.
    expect(layoutOf(editor0, config).type).toBe("virtual-root");

    const root = getBlock(editor0.state, editor0.state.rootId);
    if (root === null || root.firstChildId === null) throw new Error("no first child");
    const firstId = root.firstChildId;
    const editor1 = reduceEditor(
      editor0,
      { type: "SET_SELECTION", selection: createSpan(createPosition(firstId, 0), createPosition(firstId, 0)) },
      config,
    );
    const editor2 = reduceEditor(editor1, { type: "INSERT_TEXT", text: "hello" }, config);
    // A paginated edit (incremental path) still yields a virtual-root tree.
    const tree2 = layoutOf(editor2, config);
    expect(tree2.type).toBe("virtual-root");
    // And it materializes to the same shape a positioned tree would (the bridge).
    const positioned = positionTreeForTest(tree2);
    expect(positioned.type).toBe("block");
  });
});
