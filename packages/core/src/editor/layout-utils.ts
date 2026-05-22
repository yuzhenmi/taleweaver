import type { LayoutBox, TextRunBox, LineBox } from "../layout/layout-node";
import { createTextRunBox } from "../layout/layout-node";

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
   * space and selection-rect computation needs an entry to drive its
   * line-edge maps.
   *
   * Consumers that interpret entries as actual rendered text (hit-test
   * mapping pixel → state Position, cursor-position mapping state →
   * pixel) should filter these out. Consumers that only care about
   * line geometry (selection-rect line edges, line navigation y
   * coordinates) can treat them like any other entry.
   *
   * The synthetic box has `text === ""` and `width === line.width` so
   * the line's full content area shows up as a non-zero highlight.
   * Its key does NOT match the inline-item key format
   * (`${blockId}/inline/${itemIndex}`), so `parseInlineBoxKey` returns
   * null for it — code that gates on parseInlineBoxKey naturally
   * excludes synthetic entries.
   */
  synthetic?: boolean;
}

/**
 * Build a synthetic AbsoluteTextBox entry for an empty (strut) LineBox.
 * The synthetic TextRunBox carries the line's width/height/style so that
 * selection-rect line-edge maps produce a full-line highlight on empty
 * paragraphs (browser-faithful empty-<p> selection behavior).
 */
function makeSyntheticStrutEntry(
  line: LineBox,
  absoluteX: number,
  absoluteY: number,
  pageIndex: number,
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
  return {
    box: synthetic,
    absoluteX,
    absoluteY,
    lineMarginTop: 0,
    lineMarginBottom: 0,
    pageIndex,
    synthetic: true,
  };
}

/**
 * Collect all text-run layout boxes (and synthetic stand-ins for
 * strut/empty lines) with absolute coordinates from a layout tree.
 *
 * For each `LineBox` whose children produced no real text-run entries
 * (an empty paragraph's strut line, per CSS line-box semantics), one
 * synthetic entry is appended carrying the line's geometry. See
 * `AbsoluteTextBox.synthetic` for consumer guidance.
 */
export function collectAllTextBoxes(
  box: LayoutBox,
  parentX: number,
  parentY: number,
  out: AbsoluteTextBox[],
  pageIndex: number = 0,
  lineMarginTop: number = 0,
  lineMarginBottom: number = 0,
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
    for (const child of box.children) {
      collectAllTextBoxes(child, 0, 0, out, box.pageIndex, lineMarginTop, lineMarginBottom);
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
  // LineBox: if no real text-run children produce entries for this
  // line, emit one synthetic entry so selection-rect / line-navigation
  // see the line. Detect by comparing `out.length` before/after recursion.
  const startLen = box.type === "line" ? out.length : -1;
  for (const child of box.children) {
    collectAllTextBoxes(child, absX, absY, out, pageIndex, mt, mb);
  }
  if (box.type === "line" && out.length === startLen && box.blockSize > 0) {
    out.push(makeSyntheticStrutEntry(box, absX, absY, pageIndex));
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
