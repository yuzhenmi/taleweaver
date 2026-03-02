import type { LayoutBox, GridLayoutBox, SelectionRect } from "@taleweaver/core";
import { buildCssFontString, FONT_CONFIG } from "./font-config";
import type { ImageCache } from "./image-cache";

interface PaintState {
  lastFont: string;
  imageCache?: ImageCache;
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
  imageCache?: ImageCache,
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
  const state: PaintState = { lastFont: "", imageCache };
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
  imageCache?: ImageCache,
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
  const state: PaintState = { lastFont: "", imageCache };
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

  if (box.type === "block" && box.metadata) {
    if (box.metadata.type === "horizontal-line") {
      ctx.fillStyle = "#dadce0";
      ctx.fillRect(absX + 8, absY + box.height / 2 - 0.5, box.width - 16, 1);
      return;
    }
    if (box.metadata.type === "image" && typeof box.metadata.src === "string") {
      const imgWidth = typeof box.metadata.width === "number" ? box.metadata.width : box.width;
      const imgHeight = typeof box.metadata.height === "number" ? box.metadata.height : box.height;
      const imgY = absY + (box.height - imgHeight) / 2;
      const img = state.imageCache?.get(box.metadata.src);
      if (img) {
        ctx.drawImage(img, absX, imgY, imgWidth, imgHeight);
      } else {
        ctx.fillStyle = "#f0f0f0";
        ctx.fillRect(absX, imgY, imgWidth, imgHeight);
      }
      return;
    }
  }

  if (box.type === "block" && box.marker) {
    const fontSize = FONT_CONFIG.fontSize;
    const lineHeight = FONT_CONFIG.lineHeight;
    const halfLeading = (lineHeight - fontSize) / 2;
    const markerFontStr = buildCssFontString({});
    if (markerFontStr !== state.lastFont) {
      ctx.font = markerFontStr;
      state.lastFont = markerFontStr;
    }
    ctx.fillStyle = "black";
    ctx.fillText(box.marker, absX + 2, absY + halfLeading);
  }

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

  if (box.type === "grid") {
    // Paint children (rows → cells → text)
    for (const child of box.children) {
      paintBox(ctx, child, absX, absY, visibleTop, visibleBottom, state);
    }
    // Draw outer border + column/row separator lines
    paintGridBorders(ctx, box, absX, absY);
    return;
  }

  for (const child of box.children) {
    paintBox(ctx, child, absX, absY, visibleTop, visibleBottom, state);
  }
}

function paintGridBorders(
  ctx: CanvasRenderingContext2D,
  box: GridLayoutBox,
  absX: number,
  absY: number,
): void {
  ctx.strokeStyle = "#dadce0";
  ctx.lineWidth = 1;

  // Outer border
  ctx.strokeRect(absX + 0.5, absY + 0.5, box.width - 1, box.height - 1);

  // Vertical column separator lines
  let colX = 0;
  for (let c = 0; c < box.columnWidths.length - 1; c++) {
    colX += box.columnWidths[c];
    const lineX = absX + colX + 0.5;
    ctx.beginPath();
    ctx.moveTo(lineX, absY + 0.5);
    ctx.lineTo(lineX, absY + box.height - 0.5);
    ctx.stroke();
  }

  // Horizontal row separator lines
  let rowY = 0;
  for (let r = 0; r < box.rowHeights.length - 1; r++) {
    rowY += box.rowHeights[r];
    const lineY = absY + rowY + 0.5;
    ctx.beginPath();
    ctx.moveTo(absX + 0.5, lineY);
    ctx.lineTo(absX + box.width - 0.5, lineY);
    ctx.stroke();
  }
}
