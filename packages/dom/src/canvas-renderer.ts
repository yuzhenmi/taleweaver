import type { LayoutBox, SelectionRect } from "@taleweaver/core";
import { buildCssFontString, FONT_CONFIG } from "./font-config";

interface PaintState {
  lastFont: string;
}

export type CursorState = "active" | "inactive" | "hidden";

export function paintCanvas(
  ctx: CanvasRenderingContext2D,
  layoutTree: LayoutBox,
  selectionRects: SelectionRect[],
  cursorPos: { x: number; y: number; height: number },
  cursorState: CursorState,
  canvasWidth: number,
  canvasHeight: number,
  visibleTop: number,
  visibleBottom: number,
): void {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.textBaseline = "top";

  // Selection rects (drawn first, behind text)
  if (selectionRects.length > 0) {
    ctx.fillStyle = "rgba(59, 130, 246, 0.3)";
    for (const rect of selectionRects) {
      if (rect.y + rect.height < visibleTop || rect.y > visibleBottom) continue;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  }

  // Layout tree
  const state: PaintState = { lastFont: "" };
  paintBox(ctx, layoutTree, 0, 0, visibleTop, visibleBottom, state);

  // Cursor
  if (cursorState === "active") {
    ctx.fillStyle = "black";
    ctx.fillRect(cursorPos.x, cursorPos.y, 2, cursorPos.height);
  } else if (cursorState === "inactive") {
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.fillRect(cursorPos.x, cursorPos.y, 2, cursorPos.height);
  }
}

export function paintPage(
  ctx: CanvasRenderingContext2D,
  pageBox: LayoutBox,
  selectionRects: SelectionRect[],
  cursorPos: { x: number; y: number; height: number } | null,
  cursorState: CursorState,
): void {
  // White background
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, pageBox.width, pageBox.height);
  ctx.textBaseline = "top";

  // Selection rects (already page-relative and filtered by pageIndex)
  if (selectionRects.length > 0) {
    ctx.fillStyle = "rgba(59, 130, 246, 0.3)";
    for (const rect of selectionRects) {
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  }

  // Paint the page box contents (page.y is 0, children are page-relative)
  const state: PaintState = { lastFont: "" };
  paintBox(ctx, pageBox, 0, 0, 0, pageBox.height, state);

  // Cursor (null means cursor is not on this page)
  if (cursorPos) {
    if (cursorState === "active") {
      ctx.fillStyle = "black";
      ctx.fillRect(cursorPos.x, cursorPos.y, 2, cursorPos.height);
    } else if (cursorState === "inactive") {
      ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
      ctx.fillRect(cursorPos.x, cursorPos.y, 2, cursorPos.height);
    }
  }
}

function paintBox(
  ctx: CanvasRenderingContext2D,
  box: LayoutBox,
  parentX: number,
  parentY: number,
  visibleTop: number,
  visibleBottom: number,
  state: PaintState,
): void {
  const absX = parentX + box.x;
  const absY = parentY + box.y;

  // Viewport culling: skip entire subtree if out of visible range
  if (absY + box.height < visibleTop || absY > visibleBottom) return;

  if (box.type === "text") {
    const styles = box.styles ?? {};
    const fontStr = buildCssFontString(styles);
    if (fontStr !== state.lastFont) {
      ctx.font = fontStr;
      state.lastFont = fontStr;
    }

    // Half-leading: center text glyphs vertically within the line height
    const fontSize = styles.fontSize ?? FONT_CONFIG.fontSize;
    const lineHeight = styles.lineHeight ?? FONT_CONFIG.lineHeight;
    const halfLeading = (lineHeight - fontSize) / 2;

    ctx.fillStyle = "black";
    ctx.fillText(box.text, absX, absY + halfLeading);

    // Underline
    if (styles.textDecoration === "underline") {
      const underlineY = absY + halfLeading + fontSize + 1;
      ctx.fillRect(absX, underlineY, box.width, 1);
    }
    return;
  }

  for (const child of box.children) {
    paintBox(ctx, child, absX, absY, visibleTop, visibleBottom, state);
  }
}
