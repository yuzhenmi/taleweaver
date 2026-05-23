import type { State } from "../state/state";
import { getBlock } from "../state/state";
import type { Position } from "../state/block-position";
import type { LayoutBox } from "../layout/layout-node";
import type { TextShaper } from "../layout/text-shaper";
import type { TextMeasurer } from "../layout/text-measurer";
import { isTextShaper, adaptShaperToMeasurer } from "../layout/text-measurer";
import {
  collectLineBoxes,
  collectLineLeaves,
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
 */
export function resolvePixelPosition(
  state: State,
  position: Position,
  layoutTree: LayoutBox,
  shaperOrMeasurer: TextShaper | TextMeasurer,
): PixelPosition | null {
  const t = markStart("cursor.cursor-position");
  try {
    if (getBlock(state, position.blockId) === null) return null;

    const measurer: TextMeasurer = isTextShaper(shaperOrMeasurer)
      ? adaptShaperToMeasurer(shaperOrMeasurer)
      : shaperOrMeasurer;

    const allLines: AbsoluteLineBox[] = [];
    collectLineBoxes(layoutTree, 0, 0, allLines);

    // Lines owned by the target block, in document order.
    const ownLines = allLines.filter(l => l.line.ownerBlockId === position.blockId);
    if (ownLines.length === 0) {
      // Defensive fallback: block has no LineBoxes (no IFC ran for
      // it — e.g., a container block with null inlineContent). Walk
      // the layout tree for the BlockBox and return its top-left.
      const baseline = findBlockBaseline(layoutTree, position.blockId);
      return baseline ?? defaultPixelPosition();
    }

    // Pick the target line. Walk in order; the line whose
    // [start, end] contains the offset wins. At the soft-wrap edge
    // (offset === current.end AND next is same block) prefer next's
    // start (caret moves visually onto the new line).
    //
    // `ownLines` is already block-filtered above, so `ownLines[i + 1]`
    // is guaranteed to belong to the same block when it exists — no
    // additional ownerBlockId check needed in the soft-wrap branch.
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
      // Otherwise the offset is past this line; continue to next.
      // If we exhaust the loop without finding a containing line,
      // `targetIdx` ends up at `ownLines.length - 1` (the last line)
      // via this assignment — correct clamp: caret stays at the end
      // of the last line for past-everything offsets.
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

    // Walk leaves accumulating offsetContribution until covering
    // withinLineOffset.
    let cursorOffset = 0;
    for (const leaf of leaves) {
      const leafEnd = cursorOffset + leaf.offsetContribution;
      if (withinLineOffset <= leafEnd) {
        const localOffset = withinLineOffset - cursorOffset;
        if (leaf.kind === "text-run") {
          const prefix = leaf.box.text.slice(0, localOffset);
          const xOffset = measurer.measureWidth(prefix, leaf.computedStyle);
          return pixelPositionForLine(target, leaf.absoluteX + xOffset);
        }
        // inline-block: localOffset is either 0 (leading edge) or 1
        // (trailing edge — past the embed).
        const x = localOffset === 0 ? leaf.absoluteX : leaf.absoluteX + leaf.width;
        return pixelPositionForLine(target, x);
      }
      cursorOffset = leafEnd;
    }
    // Past last leaf (shouldn't happen if withinLineOffset is
    // clamped to <= line.inlineOffsetEnd - inlineOffsetStart).
    // Defensive: caret at the end of the last leaf.
    const last = leaves[leaves.length - 1];
    return pixelPositionForLine(target, last.absoluteX + last.width);
  } finally {
    markEnd("cursor.cursor-position", t);
  }
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
