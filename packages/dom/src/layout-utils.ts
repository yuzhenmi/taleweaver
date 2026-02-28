import type { LayoutBox, TextLayoutBox } from "@taleweaver/core";

export interface AbsoluteTextBox {
  box: TextLayoutBox;
  absoluteX: number;
  absoluteY: number;
}

/** Collect all text layout boxes with absolute coordinates from a layout tree. */
export function collectAllTextBoxes(
  box: LayoutBox,
  parentX: number,
  parentY: number,
  out: AbsoluteTextBox[],
): void {
  if (box.type === "text") {
    out.push({
      box,
      absoluteX: parentX + box.x,
      absoluteY: parentY + box.y,
    });
    return;
  }
  const absX = parentX + box.x;
  const absY = parentY + box.y;
  for (const child of box.children) {
    collectAllTextBoxes(child, absX, absY, out);
  }
}
