// packages/core/src/test-utils/paginated-harness.ts
import { cascadePass } from "../cascade";
import { layoutTree } from "../layout/dispatch";
import { resolvePositionedTree } from "../layout/positioned-tree";
import { createMockShaper } from "../layout/mock-shaper";
import type { RenderNode } from "../render/render-node";
import type { PageConfig } from "../layout/page-config";
import type { BlockBox, LayoutBox } from "../layout/layout-box-v2";
import type { PageBox } from "../layout/page-box";

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
  // Bridge the (virtual, in paginated mode) layout result to the positioned
  // page tree the harness asserts over (Phase 3 Task 1).
  const result = resolvePositionedTree(
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
  for (let p = 0; p < result.pages.length; p++) {
    const lc = countLines(result.pages[p]);
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
