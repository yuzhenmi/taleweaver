import type { State } from "../state/state";
import { getBlock } from "../state/state";
import type { Position } from "../state/block-position";
import type { BlockId } from "../state/block-id";
import type { LayoutBox } from "../layout/layout-node";
import type { TextShaper } from "../layout/text-shaper";
import type { TextMeasurer } from "../layout/text-measurer";
import { isTextShaper, adaptShaperToMeasurer } from "../layout/text-measurer";
import {
  collectAllTextBoxes,
  type AbsoluteTextBox,
} from "../editor/layout-utils";
import { findItemAtOffset } from "../state/inline-content";
import { markStart, markEnd } from "../perf/perf-trace";

/**
 * Pixel-position result for a resolved Position. Matches the legacy shape
 * so that downstream consumers (P11.4 cutover) can swap implementations
 * without changing call sites.
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

/**
 * Parsed result of a new-renderer inline-item box key.
 *
 * The new renderer keys inline items as `${blockId}/inline/${itemIndex}`
 * (see `render.ts` -> `expandInlineItems`). The IFC may further append
 * `:${runIndex}` when an item is split across multiple text-runs by the
 * line-break pass; both forms parse to the same blockId + itemIndex.
 */
interface ParsedInlineBoxKey {
  readonly blockId: BlockId;
  readonly itemIndex: number;
}

/**
 * Parse a layout-box key into a `{ blockId, itemIndex }` record, or `null`
 * if the key is not an inline-item box for any block.
 *
 * Accepted forms:
 *   - `${blockId}/inline/${itemIndex}`
 *   - `${blockId}/inline/${itemIndex}:${runIndex}`
 *
 * `runIndex` (when present) is discarded — the same itemIndex spans every
 * fragment produced by the IFC line-break pass.
 */
function parseInlineBoxKey(key: string): ParsedInlineBoxKey | null {
  const marker = "/inline/";
  const markerIdx = key.lastIndexOf(marker);
  if (markerIdx === -1) return null;
  const blockId = key.slice(0, markerIdx);
  if (blockId.length === 0) return null;
  const tail = key.slice(markerIdx + marker.length);
  // tail is `${itemIndex}` or `${itemIndex}:${runIndex}`.
  const colon = tail.indexOf(":");
  const itemIndexStr = colon === -1 ? tail : tail.slice(0, colon);
  if (itemIndexStr.length === 0) return null;
  const itemIndex = Number.parseInt(itemIndexStr, 10);
  if (!Number.isFinite(itemIndex) || itemIndex < 0) return null;
  return { blockId: blockId as BlockId, itemIndex };
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

/** Build a PixelPosition at a specific x on the given text box. */
function pixelPositionAtBox(
  box: AbsoluteTextBox,
  x: number,
): PixelPosition {
  return {
    x,
    y: box.absoluteY,
    height: box.box.height,
    lineY: box.absoluteY,
    lineHeight: box.box.height,
    lineMarginTop: box.lineMarginTop,
    lineMarginBottom: box.lineMarginBottom,
    pageIndex: box.pageIndex,
  };
}

/**
 * Spatial sort key for text boxes belonging to a single block. Page first,
 * then y (line order), then x (inline order). Stable for boxes with equal
 * keys.
 */
function spatialCompare(a: AbsoluteTextBox, b: AbsoluteTextBox): number {
  if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
  if (a.absoluteY !== b.absoluteY) return a.absoluteY - b.absoluteY;
  return a.absoluteX - b.absoluteX;
}

interface ItemBoxes {
  readonly itemIndex: number;
  readonly boxes: AbsoluteTextBox[]; // spatially sorted
}

/**
 * Group all text boxes for `blockId` by their itemIndex (parsed from the
 * box key). Each group's boxes are sorted in spatial order.
 *
 * Returns groups sorted by itemIndex ascending. itemIndices that have no
 * text-runs (e.g., embed items) do not appear here — they're handled by
 * the caller via `findItemAtOffset` lookups.
 */
function groupBoxesByItemIndex(
  allBoxes: readonly AbsoluteTextBox[],
  blockId: BlockId,
): ItemBoxes[] {
  const groups = new Map<number, AbsoluteTextBox[]>();
  for (const tb of allBoxes) {
    const parsed = parseInlineBoxKey(tb.box.key);
    if (parsed === null) continue;
    if (parsed.blockId !== blockId) continue;
    const arr = groups.get(parsed.itemIndex);
    if (arr === undefined) {
      groups.set(parsed.itemIndex, [tb]);
    } else {
      arr.push(tb);
    }
  }
  const out: ItemBoxes[] = [];
  for (const [itemIndex, boxes] of groups) {
    boxes.sort(spatialCompare);
    out.push({ itemIndex, boxes });
  }
  out.sort((a, b) => a.itemIndex - b.itemIndex);
  return out;
}

/**
 * Resolve a state Position to pixel coordinates using the layout tree.
 *
 * Input contract:
 *   - `state` has a block at `position.blockId` (returns null otherwise).
 *   - `layoutTree` was produced by laying out the result of
 *     `render(state, componentRegistry, attrRegistry).root`.
 *   - `shaperOrMeasurer` shaped the same layout pass; this function uses
 *     it (adapted to a measurer if needed) to compute prefix widths
 *     within a text-run.
 *
 * Output:
 *   - For known blockIds: a `PixelPosition` whose coords are page-relative
 *     (descendants of a PageBox use the page's coordinate frame; otherwise
 *     they're document-relative).
 *   - For unknown blockIds (`getBlock` returns null): `null`. Consumers
 *     should fall back (e.g., clamp to nearest known block) or surface
 *     an error.
 *
 * Algorithm:
 *   1. Locate the inline item at `position.offset` via `findItemAtOffset`.
 *   2. Collect all text-run boxes whose key parses to the target blockId
 *      (`${blockId}/inline/${itemIndex}[:runIndex]`).
 *   3. For text items: walk the boxes of the matching itemIndex in spatial
 *      order, accumulating characters until `withinItem` is consumed.
 *      Soft-wrap boundary: when consumption ends exactly at a box's end
 *      AND the next box is on a different line, prefer the start of the
 *      next line.
 *   4. For embed items: the embed has no own text-run box. Use the end of
 *      the preceding text-run (if any) or the start of the following one.
 *   5. Empty blocks (no text-runs, no items): return baseline coords of
 *      the block-level ElementBox.
 */
export function resolvePixelPosition(
  state: State,
  position: Position,
  layoutTree: LayoutBox,
  shaperOrMeasurer: TextShaper | TextMeasurer,
): PixelPosition | null {
  const t = markStart("cursor.cursor-position");
  try {
    const block = getBlock(state, position.blockId);
    if (block === null) return null;

    const measurer: TextMeasurer = isTextShaper(shaperOrMeasurer)
      ? adaptShaperToMeasurer(shaperOrMeasurer)
      : shaperOrMeasurer;

    // Empty block (no inline content, or inlineContent with zero items):
    // return baseline coords of the block-level ElementBox via a layout walk.
    const inline = block.inlineContent;
    if (inline === null || inline.items.length === 0) {
      const baseline = findBlockBaseline(layoutTree, position.blockId);
      if (baseline === null) return defaultPixelPosition();
      return baseline;
    }

    // Collect every text-run from the layout tree, then filter to the
    // target block's inline items.
    const allBoxes: AbsoluteTextBox[] = [];
    collectAllTextBoxes(layoutTree, 0, 0, allBoxes);
    const itemGroups = groupBoxesByItemIndex(allBoxes, position.blockId);

    // If the block has inline items but none of them produced text-runs
    // (e.g., only embeds), fall back to baseline.
    if (itemGroups.length === 0) {
      const baseline = findBlockBaseline(layoutTree, position.blockId);
      if (baseline === null) return defaultPixelPosition();
      return baseline;
    }

    const located = findItemAtOffset(inline, position.offset);
    const targetItemIndex = located.itemIndex;
    const withinItem = located.withinItem;

    // Position past end of all inline content (itemIndex === items.length):
    // fall through to the "after last text run" path below.
    if (targetItemIndex < inline.items.length) {
      const targetItem = inline.items[targetItemIndex];
      if (targetItem.kind === "text") {
        const group = findGroup(itemGroups, targetItemIndex);
        if (group !== null) {
          return resolveWithinTextItem(group.boxes, withinItem, measurer);
        }
        // Item is text but produced no text-runs (e.g., empty text item).
        // Fall through to embed-style boundary handling below.
      }
      // Embed item OR text item with no boxes: use boundary between
      // preceding text-run (if any) and following text-run.
      return resolveAtItemBoundary(itemGroups, targetItemIndex);
    }

    // Offset past end of all items: position at end of last text-run.
    const lastGroup = itemGroups[itemGroups.length - 1];
    const lastBox = lastGroup.boxes[lastGroup.boxes.length - 1];
    return pixelPositionAtBox(lastBox, lastBox.absoluteX + lastBox.box.width);
  } finally {
    markEnd("cursor.cursor-position", t);
  }
}

function findGroup(
  groups: readonly ItemBoxes[],
  itemIndex: number,
): ItemBoxes | null {
  for (const g of groups) {
    if (g.itemIndex === itemIndex) return g;
  }
  return null;
}

/**
 * Walk the spatially-sorted text-runs of a single text item, consuming
 * `withinItem` characters. Returns the pixel position once exhausted.
 *
 * Soft-wrap boundary: when `withinItem === 0` after consuming all of a
 * box's characters AND the next box is on a different line, prefer the
 * start of the next line. This matches Word/Google Docs caret behavior
 * at a wrapped line break.
 */
function resolveWithinTextItem(
  boxes: readonly AbsoluteTextBox[],
  withinItem: number,
  measurer: TextMeasurer,
): PixelPosition {
  let remaining = withinItem;
  for (let i = 0; i < boxes.length; i++) {
    const match = boxes[i];
    const textLen = match.box.text.length;
    if (remaining <= textLen) {
      if (remaining === textLen) {
        const next: AbsoluteTextBox | undefined = boxes[i + 1];
        if (
          next !== undefined &&
          (next.absoluteY !== match.absoluteY ||
            next.pageIndex !== match.pageIndex)
        ) {
          return pixelPositionAtBox(next, next.absoluteX);
        }
      }
      const prefix = match.box.text.slice(0, remaining);
      const xOffset = measurer.measureWidth(prefix, match.box.computedStyle);
      return pixelPositionAtBox(match, match.absoluteX + xOffset);
    }
    remaining -= textLen;
  }
  // Exhausted all boxes: caret at end of last one.
  const last = boxes[boxes.length - 1];
  return pixelPositionAtBox(last, last.absoluteX + last.box.width);
}

/**
 * Resolve a caret position at the start of `targetItemIndex` (i.e., on an
 * embed slot, or on a text item that produced no text-runs). Uses the end
 * of the closest preceding text-run group, or the start of the closest
 * following one if there's nothing before.
 */
function resolveAtItemBoundary(
  groups: readonly ItemBoxes[],
  targetItemIndex: number,
): PixelPosition {
  // Preceding group (largest itemIndex < target).
  let preceding: ItemBoxes | null = null;
  let following: ItemBoxes | null = null;
  for (const g of groups) {
    if (g.itemIndex < targetItemIndex) {
      if (preceding === null || g.itemIndex > preceding.itemIndex) preceding = g;
    } else if (g.itemIndex > targetItemIndex) {
      if (following === null || g.itemIndex < following.itemIndex) following = g;
    }
  }
  if (preceding !== null) {
    const last = preceding.boxes[preceding.boxes.length - 1];
    return pixelPositionAtBox(last, last.absoluteX + last.box.width);
  }
  if (following !== null) {
    const first = following.boxes[0];
    return pixelPositionAtBox(first, first.absoluteX);
  }
  // No text runs at all (shouldn't reach here — caller guards).
  return defaultPixelPosition();
}

/**
 * Walk the layout tree looking for the block-level box keyed `blockId`
 * (the new renderer keys block ElementBoxes by their `view.id`, which is
 * the block id). Returns a baseline PixelPosition at the box's top-left,
 * or null if not found.
 *
 * Used for empty blocks (no inline content / no text-runs to anchor on).
 */
function findBlockBaseline(
  box: LayoutBox,
  blockId: BlockId,
  parentX: number = 0,
  parentY: number = 0,
  pageIndex: number = 0,
): PixelPosition | null {
  // PageBox is a frame — descend with its pageIndex, page-content-relative origin.
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
