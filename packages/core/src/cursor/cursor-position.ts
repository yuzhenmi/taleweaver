import { getBlock } from "../state";
import type { State, Position } from "../state";
import type { LayoutBox } from "../layout/layout-node";
import type { VirtualLayoutTree } from "../layout/virtual-layout-tree";
import type { TextShaper } from "../layout/text-shaper";
import type { TextMeasurer } from "../layout/text-measurer";
import { isTextShaper, adaptShaperToMeasurer } from "../layout/text-measurer";
import {
  collectLineLeaves,
  getLineIndex,
  type AbsoluteLineBox,
} from "./line-flatten";
import { markStart, markEnd } from "../perf/perf-trace";

/**
 * Pixel-position result for a resolved Position. Coords are page-
 * relative (descendants of PageBox use the page's coordinate frame;
 * otherwise document-relative).
 */
export interface PixelPosition {
  x: number;
  /** Cursor y (top of line box, page-relative). */
  y: number;
  /** Cursor height (line height, excluding margins). */
  height: number;
  /** Top of the line box (page-relative, no margin offset). */
  lineY: number;
  /** Full line height (excluding margins). */
  lineHeight: number;
  /** Resolved top margin of the line in px. */
  lineMarginTop: number;
  /** Resolved bottom margin of the line in px. */
  lineMarginBottom: number;
  /** Page this position is on. */
  pageIndex: number;
}

/** Default-shape PixelPosition used when no spatial information is available. */
function defaultPixelPosition(): PixelPosition {
  return {
    x: 0,
    y: 0,
    height: 16,
    lineY: 0,
    lineHeight: 16,
    lineMarginTop: 0,
    lineMarginBottom: 0,
    pageIndex: 0,
  };
}

/**
 * Resolve a state Position to pixel coordinates using the layout tree.
 *
 * Algorithm (LineBox-canonical; see
 * `docs/superpowers/specs/2026-05-23-linebox-canonical-anchor-design.md`):
 *   1. `getBlock(state, position.blockId)`. Returns null on miss.
 *   2. Walk every LineBox; pick the one whose
 *      `(ownerBlockId, inlineOffsetStart..inlineOffsetEnd)` contains
 *      the position. Soft-wrap preference: at an exact boundary
 *      `offset === currentLine.inlineOffsetEnd`, prefer the NEXT
 *      line's start when both belong to the same block (caret at
 *      visual line break stays on the new line, matching Word /
 *      Google Docs).
 *   3. Within the picked line, walk leaves accumulating
 *      `offsetContribution` until we cover
 *      `withinLineOffset = position.offset - line.inlineOffsetStart`.
 *      For text-run leaves: prefix-measure for X. For inline-block
 *      leaves: X = leading edge (offset == cumulative) or trailing
 *      edge (offset == cumulative + 1).
 *   4. Empty line: caret at `(line.absoluteX, line.absoluteY)`.
 *   5. No line for blockId (defensive — empty container block with
 *      null inlineContent): fall back to a block-baseline walk that
 *      finds the block's `BlockBox` and returns its top-left.
 *
 * Accepts EITHER a fully-positioned `LayoutBox` (unpaginated /
 * legacy-fallback / the `materializeAll()` bridge) OR a
 * `VirtualLayoutTree` (paginated mode). For a virtual tree the
 * cursor's page is resolved via the `PagePlan` and only that page (+
 * an adjacent page at the cross-page soft-wrap edge) is materialized
 * via `getPage` — never `materializeAll()`. This is what makes caret
 * resolution O(1 page) on the typing/Enter hot path (Phase 3 Task 3).
 */
export function resolvePixelPosition(
  state: State,
  position: Position,
  layoutTree: LayoutBox | VirtualLayoutTree,
  shaperOrMeasurer: TextShaper | TextMeasurer,
): PixelPosition | null {
  const t = markStart("cursor.cursor-position");
  try {
    if (getBlock(state, position.blockId) === null) return null;

    const measurer: TextMeasurer = isTextShaper(shaperOrMeasurer)
      ? adaptShaperToMeasurer(shaperOrMeasurer)
      : shaperOrMeasurer;

    if (layoutTree.type === "virtual-root") {
      return resolveInVirtualTree(layoutTree, position, measurer);
    }

    // Positioned-tree path (unchanged): O(1) lookup via the cached
    // BlockId→AbsoluteLineBox[] index. Previously this filtered the full
    // line list per call (O(N_lines)); at scale that dominated cursor-
    // position cost on a hot doc (L-PERF-D).
    const ownLines = getLineIndex(layoutTree).byBlock.get(position.blockId) ?? [];
    if (ownLines.length === 0) {
      // Defensive fallback: block has no LineBoxes (no IFC ran for
      // it — e.g., a container block with null inlineContent). Walk
      // the layout tree for the BlockBox and return its top-left.
      const baseline = findBlockBaseline(layoutTree, position.blockId);
      return baseline ?? defaultPixelPosition();
    }

    return resolvePositionInOwnLines(ownLines, position, measurer);
  } finally {
    markEnd("cursor.cursor-position", t);
  }
}

/**
 * Resolve a position within a `VirtualLayoutTree` by materializing only the
 * page(s) the cursor touches — never the whole document.
 *
 * Page resolution: `plan.pageIndexOfBlock(blockId)` returns the page where the
 * block makes whole-block progress, i.e. the LAST page a spanning block touches
 * (a paragraph crossing pages N..M maps to M). We start there and walk earlier
 * pages only while the offset precedes the page's first own-line — so a block on
 * a single page materializes exactly ONE page, and a spanning block
 * materializes only as many pages as separate the cursor offset from the
 * block's end. The walk is FLOORED at the block's first page
 * (`plan.pageSpanOfBlock(blockId).first`) so it never steps onto a page the
 * block does not occupy — that would both materialize unrelated pages (perf) and
 * risk resolving against a different block's line at offset 0 (correctness).
 *
 * Cross-page soft-wrap edge: at a block's last line on page N with
 * `offset === inlineOffsetEnd`, if the block continues onto page N+1 we fetch
 * `getPage(N+1)` and return its first same-block line (Word/Docs convention —
 * the caret snaps to the visual next line). Bounded to one extra page.
 *
 * Falls back to a full materialize + search only when the plan cannot map the
 * block (a nested, non-top-level block — `pageIndexOfBlock` returns -1). That
 * is rare and off the flat-document hot path.
 */
function resolveInVirtualTree(
  tree: VirtualLayoutTree,
  position: Position,
  measurer: TextMeasurer,
): PixelPosition | null {
  const plan = tree.plan;
  const endPage = plan.pageIndexOfBlock(position.blockId);

  if (endPage < 0) {
    // Block not mapped by the plan (nested / non-top-level). Fall back to the
    // bridge: materialize the whole positioned tree and resolve there. Correct,
    // and off the flat-document hot path the plan always maps.
    const positioned = tree.materializeAll();
    const ownLines = getLineIndex(positioned).byBlock.get(position.blockId) ?? [];
    if (ownLines.length === 0) {
      const baseline = findBlockBaseline(positioned, position.blockId);
      return baseline ?? defaultPixelPosition();
    }
    return resolvePositionInOwnLines(ownLines, position, measurer);
  }

  // The block's FIRST page floors the backward walk. `pageIndexOfBlock`
  // (== `endPage`) is the block's whole-block-progress (LAST) page; `endPage` is
  // where we START. Without a floor at the block's first page the walk would
  // decrement down to page 0 (the DOCUMENT start) — materializing pages the
  // block does not occupy, and possibly resolving against a DIFFERENT block's
  // line that happens to begin at offset 0 on an unrelated earlier page. The
  // span's `first` bounds the walk to the block's own page range.
  const span = plan.pageSpanOfBlock(position.blockId);
  // `first` should be ≤ `endPage`; if the plan can't span the block (shouldn't
  // happen for a mapped block) fall back to flooring at endPage itself (the
  // single page we know it occupies) — never below.
  const firstPage = span !== null ? Math.min(span.first, endPage) : endPage;

  // Walk from the block's last page backward to the page that contains the
  // offset, never stepping below the block's first page. Per-page own-lines are
  // monotonically increasing in offset, so the first page (going backward)
  // whose first own-line starts at or before the offset is the page that owns
  // it.
  let pageIndex = endPage;
  let ownLines: readonly AbsoluteLineBox[] = [];
  for (;;) {
    const page = tree.getPage(pageIndex);
    ownLines = getLineIndex(page).byBlock.get(position.blockId) ?? [];
    if (ownLines.length === 0) {
      // No own-lines on this page (shouldn't happen within the block's span, but
      // be defensive): try the block-baseline walk on this page, else give up.
      const baseline = findBlockBaseline(page, position.blockId);
      if (baseline !== null) return baseline;
      if (pageIndex <= firstPage) return defaultPixelPosition();
      pageIndex--;
      continue;
    }
    const firstStart = ownLines[0].line.inlineOffsetStart;
    if (position.offset >= firstStart || pageIndex <= firstPage) {
      break;
    }
    // The offset precedes this page's own-lines: it lives on an earlier page
    // within the block's span.
    pageIndex--;
  }

  // Cross-page soft-wrap edge: caret at the block's last own-line on THIS page
  // with `offset === inlineOffsetEnd`, and the block continues onto the next
  // page (the next page has own-lines for this block). The within-page resolver
  // would pin the caret to the bottom of page N; instead snap to page N+1's
  // first same-block line (matching the doc-wide soft-wrap preference).
  const lastOwn = ownLines[ownLines.length - 1];
  if (
    position.offset === lastOwn.line.inlineOffsetEnd &&
    pageIndex + 1 < plan.entries.length
  ) {
    const nextPage = tree.getPage(pageIndex + 1);
    const nextOwn = getLineIndex(nextPage).byBlock.get(position.blockId) ?? [];
    if (nextOwn.length > 0) {
      return resolvePositionInOwnLines([nextOwn[0]], position, measurer);
    }
  }

  return resolvePositionInOwnLines(ownLines, position, measurer);
}

/**
 * Resolve a position to pixel coords given the block's own `AbsoluteLineBox`es
 * (already filtered to `position.blockId`, in document order). Shared by the
 * positioned-tree and virtual-tree paths.
 *
 * `ownLines` must be non-empty. Picks the target line (with the same soft-wrap
 * preference the doc-wide path uses: at an exact line-end boundary prefer the
 * next same-block line when one exists in `ownLines`), then walks that line's
 * leaves to measure the X for `position.offset`.
 */
function resolvePositionInOwnLines(
  ownLines: readonly AbsoluteLineBox[],
  position: Position,
  measurer: TextMeasurer,
): PixelPosition {
  // Pick the target line. Walk in order; the line whose [start, end] contains
  // the offset wins. At the soft-wrap edge (offset === current.end AND next is
  // same block) prefer next's start (caret moves visually onto the new line).
  //
  // `ownLines` is block-filtered, so `ownLines[i + 1]` is guaranteed to belong
  // to the same block when it exists — no extra ownerBlockId check needed.
  let targetIdx = 0;
  for (let i = 0; i < ownLines.length; i++) {
    const l = ownLines[i].line;
    if (position.offset < l.inlineOffsetStart) {
      // Past-start case shouldn't normally happen (lines cover
      // [0, total] contiguously); clamp to this line's start.
      targetIdx = i;
      break;
    }
    if (position.offset <= l.inlineOffsetEnd) {
      const isExactEnd = position.offset === l.inlineOffsetEnd;
      const next = ownLines[i + 1];
      if (isExactEnd && next !== undefined) {
        // Soft-wrap boundary: prefer the next line's start.
        targetIdx = i + 1;
      } else {
        targetIdx = i;
      }
      break;
    }
    // Otherwise the offset is past this line; continue to next. If we exhaust
    // the loop without finding a containing line, `targetIdx` ends up at
    // `ownLines.length - 1` (the last line) — correct clamp.
    targetIdx = i;
  }
  const target = ownLines[targetIdx];
  const line = target.line;

  // Per-line within-offset.
  const withinLineOffset = Math.max(
    0,
    Math.min(position.offset - line.inlineOffsetStart, line.inlineOffsetEnd - line.inlineOffsetStart),
  );

  const leaves = collectLineLeaves(line, target.absoluteX);
  if (leaves.length === 0) {
    // Empty (strut) line — caret at line origin.
    return pixelPositionForLine(target, target.absoluteX);
  }

  // Walk leaves accumulating offsetContribution until covering withinLineOffset.
  let cursorOffset = 0;
  for (const leaf of leaves) {
    const leafEnd = cursorOffset + leaf.offsetContribution;
    if (withinLineOffset <= leafEnd) {
      const localOffset = withinLineOffset - cursorOffset;
      if (leaf.kind === "text-run") {
        // `offsetContribution` (state span) can exceed the rendered text
        // length when this run absorbed trailing collapsed whitespace, so
        // `localOffset` may point INTO that collapsed-whitespace tail. Clamp
        // to the rendered chars explicitly (don't rely on JS slice's silent
        // clamp): an offset inside the collapsed tail measures to the run's
        // rendered right edge, which is the visual boundary before the next
        // run/word.
        const localChar = Math.min(localOffset, leaf.box.text.length);
        const prefix = leaf.box.text.slice(0, localChar);
        const xOffset = measurer.measureWidth(prefix, leaf.computedStyle);
        return pixelPositionForLine(target, leaf.absoluteX + xOffset);
      }
      // inline-block: localOffset is either 0 (leading edge) or 1 (trailing
      // edge — past the embed).
      const x = localOffset === 0 ? leaf.absoluteX : leaf.absoluteX + leaf.width;
      return pixelPositionForLine(target, x);
    }
    cursorOffset = leafEnd;
  }
  // Past last leaf (shouldn't happen if withinLineOffset is clamped to
  // <= line.inlineOffsetEnd - inlineOffsetStart). Defensive: caret at the end
  // of the last leaf.
  const last = leaves[leaves.length - 1];
  return pixelPositionForLine(target, last.absoluteX + last.width);
}

function pixelPositionForLine(target: AbsoluteLineBox, x: number): PixelPosition {
  const line = target.line;
  return {
    x,
    y: target.absoluteY,
    height: line.blockSize,
    lineY: target.absoluteY,
    lineHeight: line.blockSize,
    lineMarginTop: 0,
    lineMarginBottom: 0,
    pageIndex: target.pageIndex,
  };
}

/**
 * Walk the layout tree looking for the block-level box keyed
 * `blockId` and return its top-left as a baseline PixelPosition.
 * Used only as a defensive fallback when a block has no LineBoxes
 * (e.g., container block with null inlineContent — cursor shouldn't
 * be positioned there in normal flow, but the function degrades
 * gracefully).
 */
function findBlockBaseline(
  box: LayoutBox,
  blockId: string,
  parentX: number = 0,
  parentY: number = 0,
  pageIndex: number = 0,
): PixelPosition | null {
  if (box.type === "page") {
    for (const child of box.children) {
      const found = findBlockBaseline(child, blockId, 0, 0, box.pageIndex);
      if (found !== null) return found;
    }
    return null;
  }
  if (box.type === "text-run" || box.type === "marker") return null;

  const absX = parentX + box.x;
  const absY = parentY + box.y;

  if (box.key === blockId) {
    return {
      x: absX,
      y: absY,
      height: box.height > 0 ? box.height : 16,
      lineY: absY,
      lineHeight: box.height > 0 ? box.height : 16,
      lineMarginTop: 0,
      lineMarginBottom: 0,
      pageIndex,
    };
  }

  if (
    box.type === "block" ||
    box.type === "line" ||
    box.type === "inline" ||
    box.type === "inline-block" ||
    box.type === "table" ||
    box.type === "table-row" ||
    box.type === "table-cell"
  ) {
    for (const child of box.children) {
      const found = findBlockBaseline(child, blockId, absX, absY, pageIndex);
      if (found !== null) return found;
    }
  }
  return null;
}
