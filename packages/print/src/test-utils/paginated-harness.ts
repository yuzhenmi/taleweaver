// packages/core/src/test-utils/paginated-harness.ts
import { cascadePass } from "@taleweaver/core";
import { layoutTree } from "../layout/dispatch";
import { positionTreeForTest } from "./position-tree";
import { createMockShaper } from "@taleweaver/core";
import { createElementBox, createTextBox } from "@taleweaver/core";
import type { ElementBox, RenderNode } from "@taleweaver/core";
import type { PageConfig } from "../layout/page-config";
import type { BlockBox, LayoutBox } from "../layout/layout-box";
import type { PageBox } from "../layout/page-box";
import type { BlockId } from "@taleweaver/core";
import type { Style } from "@taleweaver/core";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { makeRootContext } from "../layout/layout-context";
import { buildBlockFitMetas } from "../layout/build-fit-metas";
import { measurePass } from "../layout/measure-pass";
import { IMPLICIT_SECTION_PLAN } from "../layout/section-plan";
import { makeVirtualLayoutTree } from "../layout/virtual-layout-tree";
import type { VirtualLayoutTree } from "../layout/virtual-layout-tree";

export interface PaginatedHarnessResult {
  readonly root: BlockBox;
  readonly pages: readonly PageBox[];
}

/** Run cascade + layout + paginate; return the page list for assertion. */
export function paginatedHarness(
  rootSpec: RenderNode,
  pageConfig: PageConfig,
  containerInlineSize: number = pageConfig.pageInlineSize,
): PaginatedHarnessResult {
  const shaper = createMockShaper(8, 16);
  const cascaded = cascadePass(rootSpec);
  // Assemble the (virtual, in paginated mode) layout result into the positioned
  // page tree the harness asserts over (test-only oracle).
  const result = positionTreeForTest(
    layoutTree(cascaded, containerInlineSize, shaper, pageConfig),
  );
  if (result.type !== "block") {
    throw new Error(`paginatedHarness: expected block root, got "${result.type}"`);
  }
  const root = result as BlockBox;
  const pages = root.children.filter((c): c is PageBox => c.type === "page");
  return { root, pages };
}

/** Recursive line count under a layout box. */
function countLines(box: LayoutBox): number {
  if (box.type === "line") return 1;
  if (box.type === "text-run" || box.type === "marker") return 0;
  if ("children" in box) {
    let total = 0;
    for (const c of box.children as readonly LayoutBox[]) total += countLines(c);
    return total;
  }
  return 0;
}

export function assertPageHasLines(
  result: PaginatedHarnessResult,
  pageIndex: number,
  expected: number,
): void {
  const page = result.pages[pageIndex];
  if (page === undefined) {
    throw new Error(
      `assertPageHasLines: page ${pageIndex} not found (only ${result.pages.length} pages)`,
    );
  }
  const lineCount = countLines(page);
  if (lineCount !== expected) {
    throw new Error(`Page ${pageIndex} expected ${expected} lines, found ${lineCount}`);
  }
}

export function assertLineOnPage(
  result: PaginatedHarnessResult,
  lineIndex: number,
  expectedPageIndex: number,
): void {
  let cumulative = 0;
  // `result.pages` is a dense array; iterate values to drop the index read.
  for (const [p, page] of result.pages.entries()) {
    const lc = countLines(page);
    if (lineIndex < cumulative + lc) {
      if (p !== expectedPageIndex) {
        throw new Error(
          `Line ${lineIndex} found on page ${p}, expected page ${expectedPageIndex}`,
        );
      }
      return;
    }
    cumulative += lc;
  }
  throw new Error(
    `Line ${lineIndex} not found in any page (only ${cumulative} lines total)`,
  );
}

/** Result of `buildSpanningTree`: a virtual tree + the spanning paragraph's id. */
export interface SpanningTreeResult {
  readonly tree: VirtualLayoutTree;
  readonly blockId: BlockId;
}

/**
 * Build a `VirtualLayoutTree` over a document whose SOLE top-level child is one
 * paragraph tall enough to span `pages` pages, plus the paragraph's `blockId`.
 *
 * Mirrors the canonical virtual-layout setup (cascade the seeded doc →
 * `buildBlockFitMetas` → `measurePass` → `makeVirtualLayoutTree`, NOT
 * `paginateRoot`). The page geometry is a small no-margin config whose content
 * area holds a fixed integer number of lines (`linesPerPage`), so a paragraph of
 * `pages * linesPerPage` `\n`-separated lines distributes across exactly `pages`
 * pages with non-empty fragments on each.
 *
 * The mock shaper uses a 16px line-height; an 80px content area ⇒ 5 lines/page.
 * The paragraph carries `whiteSpace: "pre"` so each `\n` forces its own line.
 */
export function buildSpanningTree({ pages }: { pages: number }): SpanningTreeResult {
  const linesPerPage = 5;
  const lineHeight = 16;
  const pageBlockSize = linesPerPage * lineHeight; // 80px content area (no margins).
  const pageInlineSize = 600;
  const pageConfig: PageConfig = {
    pageInlineSize,
    pageBlockSize,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 20,
  };

  const blockId = "spanning-p" as BlockId;
  const numLines = pages * linesPerPage;
  const text = Array.from({ length: numLines }, () => "x").join("\n");
  const textNode = createTextBox(`${blockId}-t`, { whiteSpace: "pre" }, text);
  const paragraph = createElementBox(
    blockId,
    { display: "block", whiteSpace: "pre" } as Style,
    [textNode],
  );
  const rootSpec = createElementBox("root", { display: "block" } as Style, [paragraph]);
  const cascaded = cascadePass(rootSpec);
  if (cascaded.type !== "element") {
    throw new Error("buildSpanningTree: cascadePass returned a non-element root");
  }
  const root: ElementBox = cascaded;

  const pageContentInlineSize =
    pageConfig.pageInlineSize - pageConfig.pageMargins.inlineStart - pageConfig.pageMargins.inlineEnd;
  const shaper = createMockShaper(8, lineHeight);
  const metas = buildBlockFitMetas(root, shaper, undefined, pageContentInlineSize);
  const plan = measurePass(metas, pageConfig, IMPLICIT_SECTION_PLAN, root.children);
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
  const tree = makeVirtualLayoutTree(plan, root, ctx, createMockShaper(8, lineHeight), pageConfig);
  return { tree, blockId };
}
