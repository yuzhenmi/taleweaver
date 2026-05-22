import type { LayoutBox, TextRunBox, LineBox } from "../layout/layout-node";
import { createTextRunBox } from "../layout/layout-node";
import type { BlockId } from "../state/block-id";

export interface AbsoluteTextBox {
  box: TextRunBox;
  absoluteX: number;
  absoluteY: number;
  lineMarginTop: number;
  lineMarginBottom: number;
  pageIndex: number;
  /**
   * True when this entry is a synthetic stand-in for an empty
   * (strut) line — there is no real text-run in the layout tree for
   * that line, but the line still occupies one line-height of vertical
   * space and selection-rect / hit-test computation needs an entry to
   * drive its line-edge maps and pixel→Position mapping for empty
   * paragraphs.
   *
   * Consumers handling synthetic entries:
   *   - Selection-rect line edges, line navigation y coordinates,
   *     hit-test fall-back for clicks on empty paragraphs — use them.
   *   - State→pixel mapping (cursor-position) skips them because the
   *     synthetic key shape doesn't match `${blockId}/inline/${idx}`
   *     and parseInlineBoxKey returns null.
   *
   * The synthetic box has `text === ""` and `width === line.width` so
   * the line's full content area shows up as a non-zero highlight.
   * Its key shape is `${lineKey}:strut` (NOT an inline-item key), so
   * `parseInlineBoxKey` returns null — consumers that gate on
   * parseInlineBoxKey naturally exclude synthetic entries unless they
   * read `blockId` directly.
   */
  synthetic?: boolean;
  /**
   * The owning block's id, populated ONLY on synthetic entries. Used
   * by hit-test to derive a Position when a click lands on an empty
   * paragraph's strut line (no real text-run to parse). Non-synthetic
   * entries leave this `undefined`; their blockId is derived via
   * `parseInlineBoxKey(box.key)`.
   */
  blockId?: BlockId;
}

/**
 * Build a synthetic AbsoluteTextBox entry for an empty (strut) LineBox.
 * The synthetic TextRunBox carries the line's width/height/style so that
 * selection-rect line-edge maps produce a full-line highlight on empty
 * paragraphs (browser-faithful empty-<p> selection behavior).
 *
 * `ownerBlockId` is the id of the block whose IFC produced this strut line
 * — populated on the returned entry so hit-test can derive a Position when
 * a click lands on this empty line.
 */
function makeSyntheticStrutEntry(
  line: LineBox,
  absoluteX: number,
  absoluteY: number,
  pageIndex: number,
  ownerBlockId: BlockId | null,
): AbsoluteTextBox {
  const synthetic = createTextRunBox(
    `${line.key}:strut`,
    0, 0,
    line.inlineSize, line.blockSize,
    line.writingMode, line.direction,
    line.computedStyle, line.usedStyle,
    "",
    line.inlineSize,
  );
  const entry: AbsoluteTextBox = {
    box: synthetic,
    absoluteX,
    absoluteY,
    lineMarginTop: 0,
    lineMarginBottom: 0,
    pageIndex,
    synthetic: true,
  };
  if (ownerBlockId !== null) entry.blockId = ownerBlockId;
  return entry;
}

/**
 * Collect all text-run layout boxes (and synthetic stand-ins for
 * strut/empty lines) with absolute coordinates from a layout tree.
 *
 * For each `LineBox` whose children produced no real text-run entries
 * (an empty paragraph's strut line, per CSS line-box semantics), one
 * synthetic entry is appended carrying the line's geometry and its
 * owning block's id. See `AbsoluteTextBox.synthetic` for consumer
 * guidance.
 *
 * `ownerBlockId` (internal recursion arg) tracks the most-recent
 * `BlockBox` ancestor's key, which the BFC sets to the source block's
 * id (`createBlockBox(node.key, ...)` in bfc.ts; `node.key` is the
 * BlockId from the render tree). This is the block that owns any
 * `LineBox`es directly under it.
 */
export function collectAllTextBoxes(
  box: LayoutBox,
  parentX: number,
  parentY: number,
  out: AbsoluteTextBox[],
  pageIndex: number = 0,
  lineMarginTop: number = 0,
  lineMarginBottom: number = 0,
  ownerBlockId: BlockId | null = null,
): void {
  if (box.type === "text-run") {
    out.push({
      box,
      absoluteX: parentX + box.x,
      absoluteY: parentY + box.y,
      lineMarginTop,
      lineMarginBottom,
      pageIndex,
    });
    return;
  }
  if (box.type === "marker") return;
  if (box.type === "page") {
    // PageBox is a frame: descend into children with page-content-relative
    // origin (0, 0) and the page's pageIndex. The page's own (x, y) is
    // document-relative and not part of the descendant coordinate system.
    // ownerBlockId resets at the page boundary — page children begin a new
    // block lineage.
    for (const child of box.children) {
      collectAllTextBoxes(child, 0, 0, out, box.pageIndex, lineMarginTop, lineMarginBottom, null);
    }
    return;
  }
  const absX = parentX + box.x;
  const absY = parentY + box.y;
  // Thread margins from line boxes to their text-run children
  let mt = lineMarginTop;
  let mb = lineMarginBottom;
  if (box.type === "line") {
    // TODO Plan 2 — use actual line margin when available
    mt = 0;
    mb = 0;
  }
  // When entering a BlockBox, its key is the block's id (per bfc.ts where
  // createBlockBox is invoked with node.key === BlockId from the render
  // tree). Capture it as the owner for any LineBoxes directly underneath.
  // For non-block container boxes (inline, inline-block, table*), keep the
  // current owner unchanged — those don't produce IFC line-bearing scope of
  // their own. (Table cells DO eventually run their own IFC; their BlockBox
  // child will overwrite ownerBlockId there.)
  const nextOwner: BlockId | null =
    box.type === "block" ? (box.key as BlockId) : ownerBlockId;
  // LineBox: if no real text-run children produce entries for this
  // line, emit one synthetic entry so selection-rect / line-navigation
  // / hit-test see the line. Detect by comparing `out.length` before/
  // after recursion.
  const startLen = box.type === "line" ? out.length : -1;
  for (const child of box.children) {
    collectAllTextBoxes(child, absX, absY, out, pageIndex, mt, mb, nextOwner);
  }
  if (box.type === "line" && out.length === startLen && box.blockSize > 0) {
    out.push(makeSyntheticStrutEntry(box, absX, absY, pageIndex, ownerBlockId));
  }
}

/** Collect lineKeys for lines that are at paragraph boundaries (last line of a block). */
export function collectBlockBoundaryLines(
  box: LayoutBox,
  parentX: number,
  parentY: number,
  out: Set<string>,
  pageIndex: number = 0,
): void {
  if (box.type === "text-run" || box.type === "marker") return;

  if (box.type === "page") {
    for (const child of box.children) {
      collectBlockBoundaryLines(child, 0, 0, out, box.pageIndex);
    }
    return;
  }

  const absX = parentX + box.x;
  const absY = parentY + box.y;

  // A block whose children are lines represents a paragraph.
  // The last line is the paragraph boundary.
  if (box.type === "block" && box.children.length > 0 && box.children[0].type === "line") {
    const lastLine = box.children[box.children.length - 1];
    addTextLineKeys(lastLine, absX, absY, out, pageIndex);
  }

  for (const child of box.children) {
    collectBlockBoundaryLines(child, absX, absY, out, pageIndex);
  }
}

/** Add lineKeys for all text-run boxes within a subtree. */
function addTextLineKeys(
  box: LayoutBox,
  parentX: number,
  parentY: number,
  out: Set<string>,
  pageIndex: number,
): void {
  if (box.type === "text-run") {
    out.add(`${pageIndex}:${parentY + box.y}`);
    return;
  }
  if (box.type === "marker") return;
  if (box.type === "page") {
    for (const child of box.children) {
      addTextLineKeys(child, 0, 0, out, box.pageIndex);
    }
    return;
  }
  const absX = parentX + box.x;
  const absY = parentY + box.y;
  for (const child of box.children) {
    addTextLineKeys(child, absX, absY, out, pageIndex);
  }
}
