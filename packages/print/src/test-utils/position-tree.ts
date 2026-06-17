// packages/core/src/test-utils/position-tree.ts
//
// TEST-ONLY oracle: assemble a `VirtualLayoutTree`'s pages into one positioned
// `BlockBox` so a test can feed the whole document to a consumer that takes a
// single positioned `LayoutBox` (`getLineIndex`, `computeSelectionRects`, the
// hit-test resolvers). Production NEVER materializes the whole tree — every
// production consumer reads per-page via `getPage(i)` (see the VL bridge-removal
// spec, 2026-06-09). This helper exists solely as the equivalence oracle that
// replaced the deleted whole-tree-positioning bridge: it walks the tree's OWN
// `getPages(0..N-1)` (each page already positioned at its document-absolute
// `blockOffset`) and wraps them in a minimal outer box, reproducing the exact
// document-absolute line geometry the bridge produced.
//
// A plain positioned `LayoutBox` (non-paginated / float-clear legacy fallback)
// is returned unchanged — there is nothing to assemble.

import { createBlockBox } from "../layout/layout-box";
import type { BlockBox, LayoutBox } from "../layout/layout-box";
import type { VirtualLayoutTree } from "../layout/virtual-layout-tree";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { computeUsedStyle } from "../layout/used-style";

/**
 * Assemble a layout tree into a single positioned `BlockBox`/`LayoutBox`.
 *
 * - Already-positioned `LayoutBox` (non-paginated / legacy fallback) → returned
 *   as-is (identity).
 * - `VirtualLayoutTree` → an outer `BlockBox` whose children are the tree's own
 *   `getPages(0..N-1)`, each positioned at its document-absolute `blockOffset`.
 *   This reproduces the document-absolute coordinate space the former
 *   former whole-tree-positioning bridge produced, so it is a faithful equivalence oracle.
 */
export function positionTreeForTest(lt: LayoutBox | VirtualLayoutTree): LayoutBox {
  if (lt.type !== "virtual-root") return lt;
  const pageCount = lt.plan.entries.length;
  const pages = lt.getPages(0, pageCount - 1);
  const usedStyle = computeUsedStyle(INITIAL_COMPUTED_STYLE, lt.inlineSize, "indefinite");
  const outer: BlockBox = createBlockBox(
    "virtual-root",
    0,
    0,
    lt.inlineSize,
    lt.blockSize,
    INITIAL_COMPUTED_STYLE.writingMode,
    INITIAL_COMPUTED_STYLE.direction,
    INITIAL_COMPUTED_STYLE,
    usedStyle,
    pages,
    lt.inlineSize,
  );
  return outer;
}
