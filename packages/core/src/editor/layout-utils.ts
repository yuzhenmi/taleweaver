import type { LayoutBox, TextLayoutBox } from "../layout/layout-node";

export interface AbsoluteTextBox {
  box: TextLayoutBox;
  absoluteX: number;
  absoluteY: number;
  pageIndex: number;
}

/** Collect all text layout boxes with absolute coordinates from a layout tree. */
export function collectAllTextBoxes(
  box: LayoutBox,
  parentX: number,
  parentY: number,
  out: AbsoluteTextBox[],
  pageIndex: number = 0,
): void {
  if (box.type === "text") {
    out.push({
      box,
      absoluteX: parentX + box.x,
      absoluteY: parentY + box.y,
      pageIndex,
    });
    return;
  }
  const absX = parentX + box.x;
  const absY = parentY + box.y;
  if (box.type === "page") {
    // Page children use this page's index; extract from key "page-N"
    const idx = parseInt(box.key.slice(5), 10);
    const pi = isNaN(idx) ? pageIndex : idx;
    for (const child of box.children) {
      collectAllTextBoxes(child, absX, absY, out, pi);
    }
    return;
  }
  for (const child of box.children) {
    collectAllTextBoxes(child, absX, absY, out, pageIndex);
  }
}
