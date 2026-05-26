import { getBlock, createPosition, firstLeafBlock, lastLeafBlock, inlineContentLength } from "../state";
import type { State, Position } from "../state";
import type { LayoutBox } from "../layout/layout-node";
import type { VirtualLayoutTree } from "../layout/virtual-layout-tree";
import type { TextShaper } from "../layout/text-shaper";
import type { TextMeasurer } from "../layout/text-measurer";
import { isTextShaper, adaptShaperToMeasurer } from "../layout/text-measurer";
import { resolvePixelPosition } from "./cursor-position";
import { resolvePositionFromPixel } from "./hit-test";
import {
  getLineIndex,
  findLineForPosition,
  type AbsoluteLineBox,
} from "./line-flatten";
import { markStart, markEnd } from "../perf/perf-trace";

/**
 * Move cursor to the line above or below `position`, preserving the
 * horizontal x-coordinate (caret-affinity).
 *
 * Returns `{ position, targetX }` for the new caret location.
 * `targetX` is the value to thread into the next vertical move (pass
 * it back as the `targetX` arg) so the caret remembers its column
 * across multiple up/down keystrokes.
 *
 * Edge cases:
 *   - At the topmost line moving up: return start-of-document
 *     (offset 0 of the first leaf block).
 *   - At the bottommost line moving down: return end-of-document
 *     (offset = inline-content length of the last leaf block).
 *   - Empty document or unresolvable position: return null.
 *
 * Accepts EITHER a fully-positioned `LayoutBox` (unpaginated /
 * legacy-fallback / the `materializeAll()` bridge) OR a
 * `VirtualLayoutTree` (paginated mode). For a virtual tree the move is
 * resolved PER-PAGE: only the caret's page (+ at most one adjacent page
 * for a page-boundary crossing) is materialized via `getPage` — never
 * `materializeAll()`. This is what keeps the first arrow keypress after
 * an edit O(1 page) on a large doc instead of O(N_pages) (Phase 4).
 */
export function moveToLine(
  state: State,
  position: Position,
  layoutTree: LayoutBox | VirtualLayoutTree,
  shaperOrMeasurer: TextShaper | TextMeasurer,
  direction: "up" | "down",
  targetX: number | null,
): { position: Position; targetX: number } | null {
  const t = markStart("cursor.line-navigation.moveToLine");
  try {
    const measurer: TextMeasurer = isTextShaper(shaperOrMeasurer)
      ? adaptShaperToMeasurer(shaperOrMeasurer)
      : shaperOrMeasurer;

    if (layoutTree.type === "virtual-root") {
      return moveToLineVirtual(state, position, layoutTree, measurer, direction, targetX);
    }
    return moveToLineInPositioned(state, position, layoutTree, measurer, direction, targetX);
  } finally {
    markEnd("cursor.line-navigation.moveToLine", t);
  }
}

/**
 * Positioned-tree line move (algorithm LineBox-canonical):
 *   1. Resolve current position to a PixelPosition for the initial X.
 *   2. Use the WeakMap-cached doc-wide `LineIndex` (L-PERF-D) and find
 *      the current line via `findLineForPosition`.
 *   3. Pick the previous / next entry in the flat list.
 *   4. Resolve the target X on the adjacent line's Y via
 *      `resolvePositionFromPixel`.
 * Also the fallback the virtual path delegates to (over `materializeAll()`)
 * for blocks that span pages.
 */
function moveToLineInPositioned(
  state: State,
  position: Position,
  layoutTree: LayoutBox,
  measurer: TextMeasurer,
  direction: "up" | "down",
  targetX: number | null,
): { position: Position; targetX: number } | null {
  const currentPixel = resolvePixelPosition(state, position, layoutTree, measurer);
  if (currentPixel === null) return null;
  const x = targetX ?? currentPixel.x;

  const lines = getLineIndex(layoutTree).all;
  if (lines.length === 0) return null;

  const currentLineIdx = findLineForPosition(lines, position);
  if (currentLineIdx < 0) return null;

  if (direction === "up") {
    if (currentLineIdx === 0) {
      return startOfDocument(state, x);
    }
    return resolveTargetLine(state, layoutTree, measurer, x, lines[currentLineIdx - 1]);
  }

  // direction === "down"
  if (currentLineIdx === lines.length - 1) {
    return endOfDocument(state, x);
  }
  return resolveTargetLine(state, layoutTree, measurer, x, lines[currentLineIdx + 1]);
}

/**
 * Virtual-tree line move: resolve the caret's page from the plan and
 * navigate within it, fetching at most one adjacent page at a page edge.
 *
 * Spanning-block fallback (LOAD-BEARING): when the caret's block spans
 * pages (`pageSpanOfBlock.first !== last`) or the plan can't map it, the
 * whole query falls back to the positioned algorithm over
 * `materializeAll()`. This is NOT just an optimization guard — it is
 * required for correctness: `resolvePixelPosition` already resolves the
 * cross-page soft-wrap edge (a caret at a block's last line-end on page N
 * whose block continues to N+1 resolves to N+1), so a per-page lookup
 * there would put the caret at `idx 0` of N+1 and "up" would target the
 * last line of N — the same visual line (the double-Up regression). And
 * `findLineForPosition`'s soft-wrap look-ahead can't see a fragment on
 * the next page. Spanning blocks (a paragraph taller than a page) are the
 * rare case, off the flat-document hot path, so this is acceptable.
 */
function moveToLineVirtual(
  state: State,
  position: Position,
  tree: VirtualLayoutTree,
  measurer: TextMeasurer,
  direction: "up" | "down",
  targetX: number | null,
): { position: Position; targetX: number } | null {
  const plan = tree.plan;
  const endPage = plan.pageIndexOfBlock(position.blockId);
  const span = plan.pageSpanOfBlock(position.blockId);
  if (endPage < 0 || (span !== null && span.first !== span.last)) {
    return moveToLineInPositioned(state, position, tree.materializeAll(), measurer, direction, targetX);
  }

  const currentPixel = resolvePixelPosition(state, position, tree, measurer);
  if (currentPixel === null) return null;
  const x = targetX ?? currentPixel.x;
  const p = currentPixel.pageIndex;

  const pageLines = getLineIndex(tree.getPage(p)).all;
  const idx = findLineForPosition(pageLines, position);
  if (idx < 0) {
    return moveToLineInPositioned(state, position, tree.materializeAll(), measurer, direction, targetX);
  }

  if (direction === "up") {
    if (idx > 0) {
      return resolveTargetLine(state, tree.getPage(p), measurer, x, pageLines[idx - 1]);
    }
    if (p > 0) {
      const prev = getLineIndex(tree.getPage(p - 1)).all;
      if (prev.length === 0) {
        return moveToLineInPositioned(state, position, tree.materializeAll(), measurer, direction, targetX);
      }
      // Target the adjacent visual line directly (NOT filtered by blockId).
      return resolveTargetLine(state, tree.getPage(p - 1), measurer, x, prev[prev.length - 1]);
    }
    return startOfDocument(state, x);
  }

  // direction === "down"
  if (idx < pageLines.length - 1) {
    return resolveTargetLine(state, tree.getPage(p), measurer, x, pageLines[idx + 1]);
  }
  if (p < plan.entries.length - 1) {
    const next = getLineIndex(tree.getPage(p + 1)).all;
    if (next.length === 0) {
      return moveToLineInPositioned(state, position, tree.materializeAll(), measurer, direction, targetX);
    }
    return resolveTargetLine(state, tree.getPage(p + 1), measurer, x, next[0]);
  }
  return endOfDocument(state, x);
}

/**
 * Resolve `targetX` onto a target line via hit-test. `pageBoxOrRoot` is
 * either the full positioned root or a single `PageBox` (virtual path) —
 * `resolvePositionFromPixel` filters by `target.pageIndex`, which for a
 * single page is every line on it (a no-op filter), and `target.absoluteY`
 * is page-content-relative in both cases, so the two are consistent.
 */
function resolveTargetLine(
  state: State,
  pageBoxOrRoot: LayoutBox,
  measurer: TextMeasurer,
  x: number,
  target: AbsoluteLineBox,
): { position: Position; targetX: number } | null {
  const pos = resolvePositionFromPixel(
    state, pageBoxOrRoot, measurer, x, target.absoluteY, target.pageIndex,
  );
  if (pos === null) return null;
  return { position: pos, targetX: x };
}

function startOfDocument(state: State, x: number): { position: Position; targetX: number } | null {
  const firstLeaf = firstLeafBlock(state, state.rootId);
  if (firstLeaf === null) return null;
  return { position: createPosition(firstLeaf, 0), targetX: x };
}

function endOfDocument(state: State, x: number): { position: Position; targetX: number } | null {
  const lastLeaf = lastLeafBlock(state, state.rootId);
  if (lastLeaf === null) return null;
  const lastBlock = getBlock(state, lastLeaf);
  if (lastBlock === null) return null;
  const endOffset =
    lastBlock.inlineContent === null ? 0 : inlineContentLength(lastBlock.inlineContent);
  return { position: createPosition(lastLeaf, endOffset), targetX: x };
}

/**
 * Move cursor to the start or end of the current visual line
 * (Home / End).
 *
 * Algorithm (LineBox-canonical): find the line containing `position`
 * via `findLineForPosition`, return `(ownerBlockId, inlineOffsetStart)`
 * for "start" or `(ownerBlockId, inlineOffsetEnd)` for "end". Going
 * directly through the LineBox's offset range keeps us inside one
 * LineBox by construction (no soft-wrap step-back machinery needed).
 *
 * Accepts a positioned `LayoutBox` OR a `VirtualLayoutTree`. The virtual
 * path resolves the caret's page from the plan (no pixel measurement
 * needed) and reads only that page's lines via `getPage` — never
 * `materializeAll()`. Blocks that span pages fall back to the positioned
 * algorithm over `materializeAll()` (rare; off the hot path).
 */
export function moveToLineBoundary(
  _state: State,
  position: Position,
  layoutTree: LayoutBox | VirtualLayoutTree,
  _shaperOrMeasurer: TextShaper | TextMeasurer,
  boundary: "start" | "end",
): Position | null {
  const t = markStart("cursor.line-navigation.moveToLineBoundary");
  try {
    if (layoutTree.type === "virtual-root") {
      const plan = layoutTree.plan;
      const p = plan.pageIndexOfBlock(position.blockId);
      const span = plan.pageSpanOfBlock(position.blockId);
      if (p < 0 || (span !== null && span.first !== span.last)) {
        return lineBoundaryInPositioned(layoutTree.materializeAll(), position, boundary);
      }
      const pageLines = getLineIndex(layoutTree.getPage(p)).all;
      const idx = findLineForPosition(pageLines, position);
      if (idx < 0) {
        return lineBoundaryInPositioned(layoutTree.materializeAll(), position, boundary);
      }
      const line = pageLines[idx].line;
      return createPosition(
        line.ownerBlockId,
        boundary === "start" ? line.inlineOffsetStart : line.inlineOffsetEnd,
      );
    }
    return lineBoundaryInPositioned(layoutTree, position, boundary);
  } finally {
    markEnd("cursor.line-navigation.moveToLineBoundary", t);
  }
}

function lineBoundaryInPositioned(
  layoutTree: LayoutBox,
  position: Position,
  boundary: "start" | "end",
): Position | null {
  const lines = getLineIndex(layoutTree).all;
  if (lines.length === 0) return null;

  const currentLineIdx = findLineForPosition(lines, position);
  if (currentLineIdx < 0) return null;

  const line = lines[currentLineIdx].line;
  const offset = boundary === "start" ? line.inlineOffsetStart : line.inlineOffsetEnd;
  return createPosition(line.ownerBlockId, offset);
}
