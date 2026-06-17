import {
  getBlock,
  createPosition,
  firstLeafBlock,
  lastLeafBlock,
  inlineContentLength,
  selectionContextOf,
} from "@taleweaver/core";
import type { State, Position, BlockId } from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-node";
import type { VirtualLayoutTree } from "../layout/virtual-layout-tree";
import type { TextShaper } from "@taleweaver/core";
import type { TextMeasurer } from "@taleweaver/core";
import { isTextShaper, adaptShaperToMeasurer } from "@taleweaver/core";
import { resolvePixelPosition, resolveTemplateBlockPage, resolveFootnoteBlockPage, resolveNestedMainTreeBlockPage } from "./cursor-position";
import { resolvePositionFromPixel } from "./hit-test";
import type { CaretAffinity } from "./line-bidi";
import { collectBlockLinesAcrossPages } from "./block-line-collector";
import {
  getLineIndex,
  findLineForPosition,
  makeContextFilter,
  lineCoordOf,
  lineSizeAlong,
  type AbsoluteLineBox,
} from "./line-flatten";
import { axisMapFor } from "@taleweaver/core";
import { markStart, markEnd } from "@taleweaver/core";
import { isDevMode } from "@taleweaver/core";

/**
 * Result of a vertical line move: the new caret `position`, the preserved
 * inline-axis goal (`targetX`) threaded into the next move, AND the
 * `caretAffinity` the move resolved for that position.
 *
 * `caretAffinity` is LOAD-BEARING at a soft-wrap / column boundary, where the
 * landed offset is SHARED between two visual lines (the previous line's END
 * offset equals the next line's START offset). Only the affinity disambiguates
 * which line the caret renders on. The hit-test at the target line's own
 * coordinates already computed the correct side (it picked the target line at
 * the target's block-axis band), so the move THREADS it out to seed
 * `EditorState.caretAffinity` — without it, an offset-shared caret renders with
 * the default ("after"), which pins to the LATER line, so an ArrowUp across a
 * column/soft-wrap boundary would appear to do nothing (#500). For the common
 * NON-boundary offset the affinity is the same value the caret would have anyway
 * (the offset is unambiguously on one line), so threading it is inert there.
 *
 * Document-boundary fallbacks (`startOfDocument`/`endOfDocument`) have no
 * hit-test; they seed a direction-consistent default ("after" at the document
 * start = the offset-0 caret sticks to the first line; "before" at the document
 * end = an offset at a wrapped last-line end sticks to that line rather than
 * jumping forward).
 */
type LineMoveResult = {
  position: Position;
  targetX: number;
  caretAffinity: CaretAffinity;
};

/**
 * Move cursor to the line above or below `position`, preserving the
 * inline-axis goal coordinate (the visual column; physical-X in
 * horizontal-tb, physical-Y in vertical modes).
 *
 * Returns `{ position, targetX, caretAffinity }` for the new caret location.
 * `targetX` is the value to thread into the next vertical move (pass
 * it back as the `targetX` arg) so the caret remembers its column
 * across multiple up/down keystrokes. `caretAffinity` seeds
 * `EditorState.caretAffinity` so an offset shared across a soft-wrap / column
 * boundary renders on the line the move landed on (#500) — see `LineMoveResult`.
 *
 * Edge cases:
 *   - At the topmost line moving up: return start-of-document
 *     (offset 0 of the first leaf block).
 *   - At the bottommost line moving down: return end-of-document
 *     (offset = inline-content length of the last leaf block).
 *   - Empty document or unresolvable position: return null.
 *
 * Accepts EITHER a fully-positioned `LayoutBox` (unpaginated /
 * legacy-fallback) OR a
 * `VirtualLayoutTree` (paginated mode). For a virtual tree the move is
 * resolved PER-PAGE: only the caret's page (+ at most one adjacent page
 * for a page-boundary crossing) is materialized via `getPage` — never
 * the whole document. This is what keeps the first arrow keypress after
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
): LineMoveResult | null {
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
 *   1. Resolve current position to a PixelPosition for the initial inline-axis
 *      goal (`PixelPosition.x` is the INLINE-axis coord per the P3.5 contract).
 *   2. Use the WeakMap-cached doc-wide `LineIndex` (L-PERF-D) and find
 *      the current line via `findLineForPosition`.
 *   3. Pick the previous / next entry in the flat list (CONTEXT-FILTERED
 *      per #327 — only same-context lines are candidates).
 *   4. Resolve the preserved inline-axis goal onto the adjacent line's
 *      block-axis band via `resolveTargetLine` (which projects to a physical
 *      click through the target line's axis map).
 * Also the fallback the virtual path delegates to (over whole-tree positioning)
 * for blocks that span pages.
 */
function moveToLineInPositioned(
  state: State,
  position: Position,
  layoutTree: LayoutBox,
  measurer: TextMeasurer,
  direction: "up" | "down",
  targetX: number | null,
): LineMoveResult | null {
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
    const above = lines[currentLineIdx - 1];
    if (above === undefined) {
      throw new Error(`line-navigation: lines[${currentLineIdx - 1}] missing (unreachable)`);
    }
    return resolveTargetLine(state, layoutTree, measurer, x, above);
  }

  // direction === "down"
  if (currentLineIdx === lines.length - 1) {
    return caretContext === state.rootId ? endOfDocument(state, x) : null;
  }
  const below = lines[currentLineIdx + 1];
  if (below === undefined) {
    throw new Error(`line-navigation: lines[${currentLineIdx + 1}] missing (unreachable)`);
  }
  return resolveTargetLine(state, layoutTree, measurer, x, below);
}

/**
 * Virtual-tree line move: resolve the caret's page from the plan and
 * navigate within it, fetching at most one adjacent page at a page edge.
 *
 * Spanning-block path (LOAD-BEARING): when the caret's block spans pages
 * (`pageSpanOfBlock.first !== last`), the per-page lookup alone is wrong —
 * `resolvePixelPosition` resolves the cross-page soft-wrap edge (a caret at
 * a block's last line-end on page N whose block continues to N+1 resolves to
 * N+1), so a per-page `findLineForPosition` would put the caret at `idx 0` of
 * N+1 and "up" would target the last line of N — the same visual line (the
 * double-Up regression). And `findLineForPosition`'s soft-wrap look-ahead
 * can't see a fragment on the next page. So spanning blocks route through
 * `moveToLineInSpanningBlock`, which stitches the block's per-page fragments
 * into one OFFSET-domain list via `collectBlockLinesAcrossPages` (the offset
 * domain dissolves the double-Up: both candidate lines at a fragment boundary
 * are adjacent in that list), then resolves the chosen target line's geometry
 * PER-PAGE via `getPage(target.pageIndex)` — never the whole document.
 * Spanning blocks (a paragraph taller than a page) are the rare case, off the
 * flat-document hot path.
 */
function moveToLineVirtual(
  state: State,
  position: Position,
  tree: VirtualLayoutTree,
  measurer: TextMeasurer,
  direction: "up" | "down",
  targetX: number | null,
  caretPageHint?: number,
): LineMoveResult | null {
  const plan = tree.plan;
  const endPage = plan.pageIndexOfBlock(position.blockId);
  const span = plan.pageSpanOfBlock(position.blockId);

  // #323: a header/footer SLOT (template) block isn't in `pageIndexOfBlock`
  // (it's never a top-level body child). Resolve it per-page on the HINTED page
  // (with the I1 empty-slot fallback) so a footer line-move stays O(1) on the
  // page the user is editing instead of positioning the whole document. The footer
  // is single-line within its isolated slot context, so Up/Down is a no-op (the
  // #327 context filter), but it must run on the right page.
  if (endPage < 0) {
    const templatePage = resolveTemplateBlockPageWithLines(state, tree, position.blockId, caretPageHint);
    if (templatePage >= 0) {
      return moveToLineOnPage(state, position, tree, measurer, direction, targetX, templatePage);
    }
    // FOOTNOTE-body caret: resolve its slot page per-page (the body lives in the
    // embedContents tree, so neither `pageIndexOfBlock` nor the template resolver
    // maps it). Up/Down is a no-op within the isolated footnote context (#327
    // filter), but it must run on the right page.
    const footnotePage = resolveFootnoteBlockPage(state, tree, position);
    if (footnotePage >= 0) {
      return moveToLineOnPage(state, position, tree, measurer, direction, targetX, footnotePage);
    }
    // TABLE-CELL (or any MAIN-tree block nested inside a top-level container):
    // walk up parentId to the page-mapped containing top-level block (the table)
    // and move within its page (#495). Unlike the footnote/footer cases above, a
    // table cell is NOT an isolated context — `selectionContextOf` walks a cell
    // paragraph up to `state.rootId`, so the #327 context filter spans the full
    // main body and Up/Down navigates across cells + surrounding paragraphs (the
    // crash fix only ensures it resolves the right page, not table-aware nav).
    const nestedPage = resolveNestedMainTreeBlockPage(state, tree, position);
    if (nestedPage >= 0) {
      return moveToLineOnPage(state, position, tree, measurer, direction, targetX, nestedPage);
    }
    // Not a top-level body, header/footer, footnote, or nested main-tree block.
    // In a well-formed doc every caret maps to a page; reaching here is a
    // stale-caret programmer error. Dev-throw to catch it; in prod no-op (the
    // caret stays put — `moveToLine`'s contract allows null). NEVER materialize
    // the whole tree.
    if (isDevMode()) {
      throw new Error(
        `moveToLineVirtual: block ${position.blockId} maps to no page ` +
          `(not a top-level body, header/footer, footnote, or nested main-tree block) — stale caret?`,
      );
    }
    return null;
  }

  if (span !== null && span.first !== span.last) {
    return moveToLineInSpanningBlock(state, position, tree, measurer, direction, targetX, span);
  }

  const currentPixel = resolvePixelPosition(state, position, tree, measurer);
  if (currentPixel === null) return null;
  return moveToLineOnPage(state, position, tree, measurer, direction, targetX, currentPixel.pageIndex);
}

/**
 * Line move for a SPANNING block (one paragraph taller than a page, so its
 * line fragments live on `span.first..span.last`). Stitches the block's
 * per-page fragments into ONE offset-ordered list (`collectBlockLinesAcrossPages`)
 * so the caret's current line and its previous/next line are adjacent entries —
 * regardless of which page each fragment is on. This is what dissolves the
 * double-Up bug: a single per-page `findLineForPosition` is blind to the
 * fragment on the next page (and `resolvePixelPosition` already snaps the caret
 * to the continuation page at a cross-page soft-wrap edge).
 *
 * The collector list is the OFFSET domain (cross-fragment ordering); geometry
 * is resolved PER-PAGE on the chosen target line's own `PageBox`
 * (`tree.getPage(target.pageIndex)` — its page-local coords are correct there).
 * The goal-x is page-invariant (all pages share the inline content origin), so
 * it threads across the page seam unchanged. Never materializes the whole tree.
 *
 * At the block's own first/last line, an Up/Down step leaves the block (the
 * line above/below belongs to a different block, possibly on an adjacent page);
 * that crossing is delegated to `moveToLineOnPage` on the boundary fragment's
 * page, with the already-resolved goal-x passed as `targetX` so it is not
 * re-measured (and the same #327 context-filter / document-boundary rules apply).
 */
function moveToLineInSpanningBlock(
  state: State,
  position: Position,
  tree: VirtualLayoutTree,
  measurer: TextMeasurer,
  direction: "up" | "down",
  targetX: number | null,
  span: { readonly first: number; readonly last: number },
): LineMoveResult | null {
  const blockLines = collectBlockLinesAcrossPages(tree, position.blockId, span);
  const idx = findLineForPosition(blockLines, position);
  if (idx < 0) {
    // Defensive: the caret isn't on any of this block's lines (shouldn't happen
    // for a spanning-block caret). Resolve the caret's page and fall back to the
    // per-page walk there.
    const currentPixel = resolvePixelPosition(state, position, tree, measurer);
    if (currentPixel === null) return null;
    return moveToLineOnPage(state, position, tree, measurer, direction, targetX, currentPixel.pageIndex);
  }

  // Resolve goal-x on the caret line's OWN page (page-invariant inline coord).
  const caretLine = blockLines[idx];
  if (caretLine === undefined) {
    throw new Error(`line-navigation: blockLines[${idx}] missing (unreachable — idx >= 0)`);
  }
  const caretPage = caretLine.pageIndex;
  const currentPixel = resolvePixelPosition(state, position, tree, measurer, caretPage);
  if (currentPixel === null) return null;
  const x = targetX ?? currentPixel.x;

  if (direction === "up") {
    if (idx > 0) {
      // Within the block: the previous fragment line (geometry per its page).
      const target = blockLines[idx - 1];
      if (target === undefined) {
        throw new Error(`line-navigation: blockLines[${idx - 1}] missing (unreachable)`);
      }
      return resolveTargetLine(state, tree.getPage(target.pageIndex), measurer, x, target);
    }
    // The block's FIRST line — the line above is cross-block. Delegate to the
    // per-page walk on the block's first page (passing the resolved goal-x so it
    // isn't re-measured), which handles the cross-block / adjacent-page step and
    // the document-top boundary.
    const first = blockLines[0];
    if (first === undefined) {
      throw new Error("line-navigation: blockLines[0] missing (unreachable — idx >= 0)");
    }
    return moveToLineOnPage(state, position, tree, measurer, "up", x, first.pageIndex);
  }

  // direction === "down"
  if (idx < blockLines.length - 1) {
    const target = blockLines[idx + 1];
    if (target === undefined) {
      throw new Error(`line-navigation: blockLines[${idx + 1}] missing (unreachable)`);
    }
    return resolveTargetLine(state, tree.getPage(target.pageIndex), measurer, x, target);
  }
  // The block's LAST line — the line below is cross-block. Delegate on the
  // block's last page.
  const last = blockLines[blockLines.length - 1];
  if (last === undefined) {
    throw new Error("line-navigation: last blockLine missing (unreachable — idx >= 0)");
  }
  return moveToLineOnPage(state, position, tree, measurer, "down", x, last.pageIndex);
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
): LineMoveResult | null {
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
    // A valid caret always has a line on its own (context-filtered) page. `< 0`
    // means the position is out of sync with the layout — a programmer error
    // (stale caret). Dev-throw to catch it; in prod no-op (caret stays put;
    // `moveToLine`'s contract allows null). NEVER materialize the whole tree.
    if (isDevMode()) {
      throw new Error(
        `moveToLineOnPage: position (block ${position.blockId}, offset ${position.offset}) ` +
          `has no line on page ${p} — stale caret?`,
      );
    }
    return null;
  }

  if (direction === "up") {
    if (idx > 0) {
      const above = pageLines[idx - 1];
      if (above === undefined) {
        throw new Error(`moveToLineOnPage: pageLines[${idx - 1}] missing (unreachable)`);
      }
      return resolveTargetLine(state, tree.getPage(p), measurer, x, above);
    }
    // For an isolated slot context (header/footer) there is no adjacent-page
    // continuation and no document boundary to fall to — stay put (no-op).
    if (caretContext !== state.rootId) return null;
    if (p > 0) {
      const prev = filter(getLineIndex(tree.getPage(p - 1)).all);
      const prevLast = prev[prev.length - 1];
      if (prevLast === undefined) {
        // Degenerate previous page with zero context-lines: clamp to the document
        // start (the same fallback the `p === 0` branch below uses) rather than
        // materializing. Crash-free, sensible behavior.
        return startOfDocument(state, x);
      }
      // Target the adjacent visual line directly (NOT filtered by blockId).
      return resolveTargetLine(state, tree.getPage(p - 1), measurer, x, prevLast);
    }
    return startOfDocument(state, x);
  }

  // direction === "down"
  if (idx < pageLines.length - 1) {
    const below = pageLines[idx + 1];
    if (below === undefined) {
      throw new Error(`moveToLineOnPage: pageLines[${idx + 1}] missing (unreachable)`);
    }
    return resolveTargetLine(state, tree.getPage(p), measurer, x, below);
  }
  if (caretContext !== state.rootId) return null;
  if (p < plan.entries.length - 1) {
    const next = filter(getLineIndex(tree.getPage(p + 1)).all);
    const nextFirst = next[0];
    if (nextFirst === undefined) {
      // Degenerate next page with zero context-lines: clamp to the document end
      // (the same fallback the last-page branch below uses) rather than
      // materializing. Crash-free, sensible behavior.
      return endOfDocument(state, x);
    }
    return resolveTargetLine(state, tree.getPage(p + 1), measurer, x, nextFirst);
  }
  return endOfDocument(state, x);
}

/**
 * #323 helper for line-nav: resolve which PAGE a header/footer template-block
 * caret is on, then VERIFY the chosen page actually carries the block's lines —
 * applying the I1 empty-slot fallback (a hint at a page whose slot lacks this
 * body recomputes WITHOUT the hint). Returns the page that carries the block's
 * lines, or -1 if none does (the caller then tries the footnote resolver, else
 * degrades safely). Never positions the whole document — only `getPage` of the
 * candidate page(s).
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
 * Resolve the preserved INLINE-axis goal `x` onto a target line via hit-test.
 * `pageBoxOrRoot` is either the full positioned root or a single `PageBox`
 * (virtual path) — `resolvePositionFromPixel` filters by `target.pageIndex`,
 * which for a single page is every line on it (a no-op filter), and the
 * target line's coords are page-content-relative in both cases, so the two
 * are consistent.
 *
 * `x` is the preserved inline-axis goal (the visual column to keep across
 * up/down): physical-X in `horizontal-tb`, physical-Y in the vertical modes.
 * `resolvePositionFromPixel` takes a PHYSICAL click `(clickX, clickY)`, so we
 * project `(inlineGoal=x, targetBlockCoord=target's block-axis position)` to a
 * physical point via the TARGET line's axis map (the line the caret is moving
 * TO — a per-line read, since a doc could mix writing modes). The inline goal
 * goes on the physical INLINE axis, the target line's block coord on the
 * physical BLOCK axis.
 *
 * `targetBlockCoord` is the target line's FLOW-START block edge — the edge that
 * faces the PREVIOUS line in document/flow order, so the click lands strictly
 * INSIDE the target line's block band (mirroring `target.absoluteY` = a line's
 * top in `horizontal-tb`). For the ascending block axis (`horizontal-tb`,
 * `vertical-lr`) that edge is `lineCoordOf` (the block-start). For `vertical-rl`
 * blocks stack right→left, so the flow-start edge is the line's HIGH edge
 * (`lineCoordOf + lineSizeAlong`); using the low edge would put the click
 * exactly on the target line's own block boundary, and the hit-test's
 * band-membership test (`flowSign * clickBlock < flowSign * facingEdge` in
 * `hit-test.ts`) uses a strict `<`, so a click sitting ON that edge falls
 * through past the target — skipping a line. The HIGH edge places the click
 * strictly inside the band. For
 * `horizontal-tb` (`am.inline === "x"`, `am.block === "y"`, ascending) this
 * reduces to `clickX = x`, `clickY = target.absoluteY` — byte-identical to the
 * prior hardcoded call. For `vertical-lr` (ascending, `am.inline === "y"`) it is
 * `clickX = target.absoluteX`, `clickY = x`; for `vertical-rl` (descending)
 * `clickX = target.absoluteX + blockSize`, `clickY = x`.
 */
function resolveTargetLine(
  state: State,
  pageBoxOrRoot: LayoutBox,
  measurer: TextMeasurer,
  x: number,
  target: AbsoluteLineBox,
): LineMoveResult | null {
  const am = axisMapFor(target.line.writingMode, target.line.computedStyle.direction);
  // Multi-column slice 3b: clamp the preserved inline goal to the TARGET line's
  // inline extent so the hit-test below lands on THIS line's column (after slice
  // 3a the hit-test restricts candidates to the column containing the click; a
  // cross-column move's raw goal X is the SOURCE column's X, which would re-pick
  // a SOURCE-column line at the target's block band). For single-column the goal
  // already lies within the full-width line (or the hit-test clamps identically),
  // so this is a no-op. Mode-general: clamp along the INLINE axis (`am.inline`),
  // reusing the SAME `lineCoordOf`/`lineSizeAlong` helpers used for the block
  // axis. NOTE: the RETURNED `targetX` stays the ORIGINAL unclamped `x` (below)
  // so the goal column is preserved across successive moves (Up-undoes-Down
  // returns to the original column).
  const lineInlineStart = lineCoordOf(target, am.inline);
  const lineInlineExtent = lineSizeAlong(target, am.inline);
  const inlineGoal = Math.max(lineInlineStart, Math.min(x, lineInlineStart + lineInlineExtent));
  // The flow-START block edge of the target line (faces the previous line in
  // flow), so the click sits strictly inside the line's own block band and
  // passes hit-test's strict-`<` band-membership test. Ascending block axis:
  // the block-start (`lineCoordOf`). `vertical-rl` (the only descending
  // block-axis mode): the HIGH edge (start + extent).
  const blockReversed = target.line.writingMode === "vertical-rl";
  const targetBlockCoord = blockReversed
    ? lineCoordOf(target, am.block) + lineSizeAlong(target, am.block)
    : lineCoordOf(target, am.block);
  const clickX = am.inline === "x" ? inlineGoal : targetBlockCoord;
  const clickY = am.inline === "y" ? inlineGoal : targetBlockCoord;
  // #500: THREAD the hit-test's caretAffinity out instead of discarding it. The
  // hit-test picked the TARGET line at the target's block-axis band, so the
  // affinity it returns pins the caret to THAT line — load-bearing when the
  // landed offset is SHARED across a soft-wrap / column boundary (the previous
  // line's end offset equals the next line's start offset; only the affinity
  // separates them). Without this, an offset-shared up-move would render with the
  // default ("after"), pinning to the LATER line, so ArrowUp at the top of a
  // column/wrap would appear to do nothing. For a non-boundary offset the
  // hit-test returns the same affinity the caret would have anyway, so threading
  // it is inert. `targetX` stays the ORIGINAL unclamped goal-x (preserve column).
  const hit = resolvePositionFromPixel(
    state, pageBoxOrRoot, measurer, clickX, clickY, target.pageIndex,
  );
  if (hit === null) return null;
  return { position: hit.position, targetX: x, caretAffinity: hit.caretAffinity };
}

function startOfDocument(state: State, x: number): LineMoveResult | null {
  const firstLeaf = firstLeafBlock(state, state.rootId);
  if (firstLeaf === null) return null;
  // No hit-test here (the up-move fell off the top). The offset-0 caret can only
  // sit on the first line's START, so "after" is correct (and matches the prior
  // implicit default — the central reset left affinity undefined, which
  // `resolvePixelPosition` treats as "after").
  return { position: createPosition(firstLeaf, 0), targetX: x, caretAffinity: "after" };
}

function endOfDocument(state: State, x: number): LineMoveResult | null {
  const lastLeaf = lastLeafBlock(state, state.rootId);
  if (lastLeaf === null) return null;
  const lastBlock = getBlock(state, lastLeaf);
  if (lastBlock === null) return null;
  const endOffset =
    lastBlock.inlineContent === null ? 0 : inlineContentLength(lastBlock.inlineContent);
  // No hit-test here (the down-move fell off the bottom). The end offset of the
  // last block is the END of its last line; "before" pins the caret to that line
  // (rather than letting a soft-wrap boundary push it forward — there is no later
  // line to push to, but "before" is the semantically-correct end-of-line side
  // and is inert for a hard block end).
  return { position: createPosition(lastLeaf, endOffset), targetX: x, caretAffinity: "before" };
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
 * the whole document. A block that SPANS pages runs the SAME
 * find-line→boundary-offset logic over its stitched cross-page fragment list
 * (`collectBlockLinesAcrossPages`) instead of one page (rare; off the hot
 * path) — no pixel resolution, no whole-document positioning.
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
      if (p >= 0 && span !== null && span.first !== span.last) {
        // SPANNING block: the caret's line fragment may live on any page in the
        // block's span. Run the SAME find-line→boundary-offset logic over the
        // block's STITCHED cross-page fragment list (offset domain) — no pixel
        // resolution, no whole-document positioning. (`p >= 0` ⇒ a main-body block, so
        // the collector's per-page `byBlock` lookups are well-defined.)
        const lines = collectBlockLinesAcrossPages(layoutTree, position.blockId, span);
        const idx = findLineForPosition(lines, position);
        // `idx < 0` shouldn't happen for a spanning-block caret; return the input
        // position unchanged (safe no-op) rather than materializing.
        if (idx < 0) return position;
        const spanLine = lines[idx];
        if (spanLine === undefined) {
          throw new Error(`moveToLineBoundary: spanning lines[${idx}] missing (unreachable)`);
        }
        return boundaryPositionOfLine(spanLine, boundary);
      }
      if (p < 0) {
        // #323: a header/footer SLOT (template) block — resolve its page on the
        // HINTED page (with the I1 empty-slot fallback) instead of falling to
        // whole-document positioning. Home/End stays inside the slot context (one LineBox).
        p = resolveTemplateBlockPageWithLines(state, layoutTree, position.blockId, caretPageHint);
        if (p < 0) {
          // FOOTNOTE-body caret: resolve its slot page per-page (embedContents
          // body — neither pageIndexOfBlock nor the template resolver maps it).
          p = resolveFootnoteBlockPage(state, layoutTree, position);
          if (p < 0) {
            // TABLE-CELL (or any MAIN-tree block nested in a top-level container):
            // walk up parentId to the page-mapped containing top-level block (the
            // table) and run Home/End on its page (#495).
            p = resolveNestedMainTreeBlockPage(state, layoutTree, position);
          }
          if (p < 0) {
            // Not a top-level body, header/footer, footnote, or nested main-tree
            // block. Stale-caret programmer error: dev-throw to catch it; in prod
            // no-op (return the input position unchanged — Home/End does nothing).
            // NEVER materialize.
            if (isDevMode()) {
              throw new Error(
                `moveToLineBoundary: block ${position.blockId} maps to no page ` +
                  `(not a top-level body, header/footer, footnote, or nested main-tree block) — stale caret?`,
              );
            }
            return position;
          }
        }
      }
      const pageLines = getLineIndex(layoutTree.getPage(p)).all;
      const idx = findLineForPosition(pageLines, position);
      if (idx < 0) {
        // A valid caret always has a line on its resolved page. `< 0` ⇒ a
        // stale-caret programmer error: dev-throw to catch it; in prod return the
        // input position unchanged (Home/End no-op). NEVER materialize the tree.
        if (isDevMode()) {
          throw new Error(
            `moveToLineBoundary: position (block ${position.blockId}, offset ` +
              `${position.offset}) has no line on page ${p} — stale caret?`,
          );
        }
        return position;
      }
      const pageLine = pageLines[idx];
      if (pageLine === undefined) {
        throw new Error(`moveToLineBoundary: pageLines[${idx}] missing (unreachable — idx >= 0)`);
      }
      return boundaryPositionOfLine(pageLine, boundary);
    }
    return lineBoundaryInPositioned(layoutTree, position, boundary);
  } finally {
    markEnd("cursor.line-navigation.moveToLineBoundary", t);
  }
}

/**
 * The Home/End position of a resolved line: its owning block plus the line's
 * inline-offset start (Home) or end (End). Shared by every `moveToLineBoundary`
 * path (positioned, per-page virtual, and spanning-block collector) so the
 * boundary-offset rule lives in exactly one place.
 */
function boundaryPositionOfLine(
  line: AbsoluteLineBox,
  boundary: "start" | "end",
): Position {
  const l = line.line;
  return createPosition(
    l.ownerBlockId,
    boundary === "start" ? l.inlineOffsetStart : l.inlineOffsetEnd,
  );
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

  const currentLine = lines[currentLineIdx];
  if (currentLine === undefined) {
    throw new Error(
      `lineBoundaryInPositioned: lines[${currentLineIdx}] missing (unreachable — idx >= 0)`,
    );
  }
  return boundaryPositionOfLine(currentLine, boundary);
}
