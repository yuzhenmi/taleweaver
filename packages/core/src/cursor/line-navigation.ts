import {
  getBlock,
  createPosition,
  firstLeafBlock,
  lastLeafBlock,
  inlineContentLength,
  selectionContextOf,
} from "../state";
import type { State, Position, BlockId } from "../state";
import type { LayoutBox } from "../layout/layout-node";
import type { VirtualLayoutTree } from "../layout/virtual-layout-tree";
import type { TextShaper } from "../layout/text-shaper";
import type { TextMeasurer } from "../layout/text-measurer";
import { isTextShaper, adaptShaperToMeasurer } from "../layout/text-measurer";
import { resolvePixelPosition, resolveTemplateBlockPage } from "./cursor-position";
import { resolvePositionFromPixel } from "./hit-test";
import {
  getLineIndex,
  findLineForPosition,
  makeContextFilter,
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
  // #323: which page's header/footer SLOT instance the caret is on (view state).
  // Threaded into the virtual-tree per-page resolution so a template-block
  // line-move stays on the page the user is editing (instead of jumping to the
  // body's first carrying page). `undefined` for a body caret / single-page.
  caretPageHint?: number,
): { position: Position; targetX: number } | null {
  const t = markStart("cursor.line-navigation.moveToLine");
  try {
    const measurer: TextMeasurer = isTextShaper(shaperOrMeasurer)
      ? adaptShaperToMeasurer(shaperOrMeasurer)
      : shaperOrMeasurer;

    if (layoutTree.type === "virtual-root") {
      return moveToLineVirtual(state, position, layoutTree, measurer, direction, targetX, caretPageHint);
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
 *   3. Pick the previous / next entry in the flat list (CONTEXT-FILTERED
 *      per #327 — only same-context lines are candidates).
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

  const caretContext = selectionContextOf(state, position.blockId);
  const filter = makeContextFilter(state, caretContext);
  const lines = filter(getLineIndex(layoutTree).all);
  if (lines.length === 0) return null;

  const currentLineIdx = findLineForPosition(lines, position);
  if (currentLineIdx < 0) return null;

  if (direction === "up") {
    if (currentLineIdx === 0) {
      // No same-context line above. In the main body this is the top of the
      // document; for an isolated slot context (header/footer) there is no
      // document boundary to fall to, so stay put (no-op).
      return caretContext === state.rootId ? startOfDocument(state, x) : null;
    }
    return resolveTargetLine(state, layoutTree, measurer, x, lines[currentLineIdx - 1]);
  }

  // direction === "down"
  if (currentLineIdx === lines.length - 1) {
    return caretContext === state.rootId ? endOfDocument(state, x) : null;
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
  caretPageHint?: number,
): { position: Position; targetX: number } | null {
  const plan = tree.plan;
  const endPage = plan.pageIndexOfBlock(position.blockId);
  const span = plan.pageSpanOfBlock(position.blockId);

  // #323: a header/footer SLOT (template) block isn't in `pageIndexOfBlock`
  // (it's never a top-level body child). Resolve it per-page on the HINTED page
  // (with the I1 empty-slot fallback) so a footer line-move stays O(1) on the
  // page the user is editing instead of falling to `materializeAll`. The footer
  // is single-line within its isolated slot context, so Up/Down is a no-op (the
  // #327 context filter), but it must run on the right page.
  if (endPage < 0) {
    const templatePage = resolveTemplateBlockPageWithLines(state, tree, position.blockId, caretPageHint);
    if (templatePage < 0) {
      // Not a template block we can resolve (or its slot produced no lines):
      // fall back to the bridge. Off the hot path.
      return moveToLineInPositioned(state, position, tree.materializeAll(), measurer, direction, targetX);
    }
    return moveToLineOnPage(state, position, tree, measurer, direction, targetX, templatePage);
  }

  if (span !== null && span.first !== span.last) {
    return moveToLineInPositioned(state, position, tree.materializeAll(), measurer, direction, targetX);
  }

  const currentPixel = resolvePixelPosition(state, position, tree, measurer);
  if (currentPixel === null) return null;
  return moveToLineOnPage(state, position, tree, measurer, direction, targetX, currentPixel.pageIndex);
}

/**
 * The per-page line-move body, shared by the main-body path (page = the caret's
 * own page) and the #323 template path (page = the resolved header/footer SLOT
 * page). `p` is the page the caret is currently on; the same context-filtered
 * adjacent-line walk runs, with the slot-context no-op rule and the body
 * adjacent-page continuation. The caret's X is measured on page `p` (passed as
 * the hint so a template caret measures against its OWN slot instance, not the
 * first-page default).
 */
function moveToLineOnPage(
  state: State,
  position: Position,
  tree: VirtualLayoutTree,
  measurer: TextMeasurer,
  direction: "up" | "down",
  targetX: number | null,
  p: number,
): { position: Position; targetX: number } | null {
  const plan = tree.plan;
  const currentPixel = resolvePixelPosition(state, position, tree, measurer, p);
  if (currentPixel === null) return null;
  const x = targetX ?? currentPixel.x;

  // #327: constrain candidate lines to the caret's selection context — never
  // cross the body↔header/footer (slot) boundary. The header/footer slot lines
  // live in the SAME per-page index as the body lines (C.2c T6), so an
  // unfiltered ArrowUp from a page's top body line would step into the header.
  const caretContext = selectionContextOf(state, position.blockId);
  const filter = makeContextFilter(state, caretContext);

  const pageLines = filter(getLineIndex(tree.getPage(p)).all);
  const idx = findLineForPosition(pageLines, position);
  if (idx < 0) {
    return moveToLineInPositioned(state, position, tree.materializeAll(), measurer, direction, targetX);
  }

  if (direction === "up") {
    if (idx > 0) {
      return resolveTargetLine(state, tree.getPage(p), measurer, x, pageLines[idx - 1]);
    }
    // For an isolated slot context (header/footer) there is no adjacent-page
    // continuation and no document boundary to fall to — stay put (no-op).
    if (caretContext !== state.rootId) return null;
    if (p > 0) {
      const prev = filter(getLineIndex(tree.getPage(p - 1)).all);
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
  if (caretContext !== state.rootId) return null;
  if (p < plan.entries.length - 1) {
    const next = filter(getLineIndex(tree.getPage(p + 1)).all);
    if (next.length === 0) {
      return moveToLineInPositioned(state, position, tree.materializeAll(), measurer, direction, targetX);
    }
    return resolveTargetLine(state, tree.getPage(p + 1), measurer, x, next[0]);
  }
  return endOfDocument(state, x);
}

/**
 * #323 helper for line-nav: resolve which PAGE a header/footer template-block
 * caret is on, then VERIFY the chosen page actually carries the block's lines —
 * applying the I1 empty-slot fallback (a hint at a page whose slot lacks this
 * body recomputes WITHOUT the hint). Returns the page that carries the block's
 * lines, or -1 if none does (the caller falls back to the bridge). Never calls
 * `materializeAll` — only `getPage` of the candidate page(s).
 */
function resolveTemplateBlockPageWithLines(
  state: State,
  tree: VirtualLayoutTree,
  blockId: BlockId,
  caretPageHint: number | undefined,
): number {
  const page = resolveTemplateBlockPage(state, tree.plan, blockId, caretPageHint);
  if (page < 0) return -1;
  if (getLineIndex(tree.getPage(page)).byBlock.get(blockId)?.length) return page;
  if (caretPageHint !== undefined) {
    // I1 STALE-FALLBACK: the hinted page's slot doesn't carry this body. Retry
    // on the template-root default carrying page (no hint).
    const defaultPage = resolveTemplateBlockPage(state, tree.plan, blockId, undefined);
    if (defaultPage >= 0 && defaultPage !== page &&
        getLineIndex(tree.getPage(defaultPage)).byBlock.get(blockId)?.length) {
      return defaultPage;
    }
  }
  return -1;
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
  // Up/down navigation does NOT reseed caret affinity (it preserves the existing
  // caret's affinity); this wrapper only needs the resolved position. Destructure
  // `.position` from the hit-test result and discard the affinity seed.
  const hit = resolvePositionFromPixel(
    state, pageBoxOrRoot, measurer, x, target.absoluteY, target.pageIndex,
  );
  if (hit === null) return null;
  return { position: hit.position, targetX: x };
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
  state: State,
  position: Position,
  layoutTree: LayoutBox | VirtualLayoutTree,
  _shaperOrMeasurer: TextShaper | TextMeasurer,
  boundary: "start" | "end",
  // #323: which page's header/footer SLOT instance the caret is on (view state).
  caretPageHint?: number,
): Position | null {
  const t = markStart("cursor.line-navigation.moveToLineBoundary");
  try {
    if (layoutTree.type === "virtual-root") {
      const plan = layoutTree.plan;
      let p = plan.pageIndexOfBlock(position.blockId);
      const span = plan.pageSpanOfBlock(position.blockId);
      if (p < 0) {
        // #323: a header/footer SLOT (template) block — resolve its page on the
        // HINTED page (with the I1 empty-slot fallback) instead of falling to
        // materializeAll. Home/End stays inside the slot context (one LineBox).
        p = resolveTemplateBlockPageWithLines(state, layoutTree, position.blockId, caretPageHint);
        if (p < 0) {
          return lineBoundaryInPositioned(layoutTree.materializeAll(), position, boundary);
        }
      } else if (span !== null && span.first !== span.last) {
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
