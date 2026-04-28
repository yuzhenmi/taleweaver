import type { LayoutBox, TextRunBox } from "../layout/layout-node";

export interface AbsoluteTextBox {
  box: TextRunBox;
  absoluteX: number;
  absoluteY: number;
  lineMarginTop: number;
  lineMarginBottom: number;
  pageIndex: number;
}

/** Collect all text-run layout boxes with absolute coordinates from a layout tree. */
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
  // BlockBox or LineBox — recurse into children
  for (const child of box.children) {
    collectAllTextBoxes(child, absX, absY, out, pageIndex, mt, mb);
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
  const absX = parentX + box.x;
  const absY = parentY + box.y;
  for (const child of box.children) {
    addTextLineKeys(child, absX, absY, out, pageIndex);
  }
}
